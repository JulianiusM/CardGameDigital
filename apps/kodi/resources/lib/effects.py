"""Bounded worker/effect runtime. Workers publish actions and never touch Kodi controls."""

from __future__ import annotations

import hashlib
import json
import threading
import time
import uuid
from pathlib import Path
from typing import Callable, Mapping, Optional

from .actions import Action, Effect, action
from .auth import DeviceAuthorizationClient, DeviceAuthorizationError
from .diagnostics import DiagnosticBuffer
from .discovery.address_policy import relative_url, validate_transport, websocket_url
from .discovery.mdns import MdnsBrowser, same_machine_origins
from .discovery.registry import validated_record
from .native_settings_metadata import SOURCE_LOCALE
from .native_preferences import merge_preferences
from .protocol.validation import PROTOCOL_VERSION, ProtocolViolation
from .qr import encode_text, write_png
from .state import ActiveRoom, AppState, RecoveryEnvelope
from .storage import ProfileStore, SecretStore, StorageVersionError
from .transport.http import ApiClient, HttpFailure
from .transport.websocket import RoomConnectionSettings, RoomWebSocketWorker, envelope
from .version import APPLICATION_VERSION
from .worker_pool import BoundedWorkerPool
from . import strings


class CouchStateUnresolved(RuntimeError):
    code = "COUCH_STATE_UNRESOLVED"


class EffectRunner:
    def __init__(
        self,
        profile_directory: str | Path,
        publish: Callable[[Action], None],
        locale_provider: Callable[[], str] = lambda: SOURCE_LOCALE,
        native_preferences: Optional[Mapping[str, str]] = None,
        configured_server_origin: Optional[str] = None,
        discovery_enabled: bool = True,
    ) -> None:
        self.profile_directory = Path(profile_directory).resolve()
        self.profile = ProfileStore(self.profile_directory)
        self.secrets = SecretStore(self.profile_directory)
        self.diagnostics = DiagnosticBuffer()
        self._publish = publish
        self._locale_provider = locale_provider
        self._native_preferences = dict(native_preferences or {})
        self._configured_server_origin = configured_server_origin
        self._discovery_enabled = discovery_enabled
        self._executor = BoundedWorkerPool(3, "party-game")
        self._tokens: dict[str, int] = {}
        self._token_lock = threading.Lock()
        self._storage_lock = threading.Lock()
        self._room_worker: Optional[RoomWebSocketWorker] = None
        self._discovery: Optional[MdnsBrowser] = None
        self._authorization_cancel: Optional[threading.Event] = None
        self._stopping = False

    def submit(self, request: Effect) -> None:
        if self._stopping and request.kind != "SHUTDOWN":
            return
        if request.kind == "WS_SNAPSHOT":
            if self._room_worker:
                self._room_worker.send(envelope("room.snapshot.request", {}))
            return
        if request.kind == "WS_LEAVE":
            if self._room_worker:
                self._room_worker.leave()
            else:
                self._publish(action("LEAVE_COMPLETED"))
            return
        if request.kind == "WS_DISCONNECT":
            self._stop_room()
            return
        if request.kind == "AUTH_CANCEL":
            if self._authorization_cancel:
                self._authorization_cancel.set()
            return
        if request.kind == "SHUTDOWN":
            self.shutdown()
            return
        if request.kind == "DISCOVER_SERVERS" and self._discovery:
            self._discovery.close()
        token = self._claim(request.owner)
        if not self._executor.submit(self._execute, request, token):
            self.diagnostics.add("effect.queue_rejected", effect=request.kind)

    def shutdown(self) -> None:
        if self._stopping:
            return
        self._stopping = True
        if self._discovery:
            self._discovery.close()
        if self._authorization_cancel:
            self._authorization_cancel.set()
        self._stop_room()
        remaining_workers = self._executor.shutdown(join_timeout=1.0)
        if remaining_workers:
            self.diagnostics.add(
                "shutdown.workers_detached",
                worker_count=remaining_workers,
            )

    def _claim(self, owner: Optional[str]) -> int:
        if not owner:
            return 0
        with self._token_lock:
            token = self._tokens.get(owner, 0) + 1
            self._tokens[owner] = token
            return token

    def _current(self, owner: Optional[str], token: int) -> bool:
        if not owner:
            return True
        with self._token_lock:
            return self._tokens.get(owner) == token

    def _emit(self, request: Effect, token: int, result: Action) -> None:
        if not self._stopping and self._current(request.owner, token):
            self._publish(result)

    def _execute(self, request: Effect, token: int) -> None:
        try:
            handler = getattr(self, f"_effect_{request.kind.lower()}")
            result = handler(request)
            if result:
                self._emit(request, token, result)
        except Exception as error:
            self.diagnostics.add(
                "effect.failed",
                effect=request.kind,
                error_type=type(error).__name__,
                status=getattr(error, "status", None),
                code=getattr(error, "code", None),
            )
            if request.kind == "VALIDATE_SERVER":
                kind = "SERVER_VALIDATION_FAILED"
            elif request.kind == "LOAD_STORAGE":
                kind = "STORAGE_FAILED"
            else:
                kind = "OPERATION_FAILED"
            result = action(kind, **_failure_notice(error, request.kind))
            self._emit(request, token, result)

    def _effect_load_storage(self, _request: Effect) -> Action:
        bundle = self.profile.load()
        return action(
            "STORAGE_LOADED",
            preferences=merge_preferences(bundle.preferences, self._native_preferences),
            servers=bundle.servers,
            recovery=bundle.recovery,
            configured_server_origin=self._configured_server_origin,
        )

    def _effect_load_diagnostics(self, _request: Effect) -> Action:
        return action("DIAGNOSTICS_LOADED", entries=self.diagnostics.entries())

    def _effect_save_storage(self, request: Effect) -> None:
        state: AppState = request.payload["state"]
        with self._storage_lock:
            self.profile.save(state.preferences, state.servers)
        return None

    def _effect_save_recovery(self, request: Effect) -> None:
        with self._storage_lock:
            self.profile.save_recovery(request.payload["recovery"])
        return None

    def _effect_clear_recovery(self, request: Effect) -> None:
        reference = request.payload.get("credential_reference")
        with self._storage_lock:
            self.profile.clear_recovery()
            if reference:
                self.secrets.delete(str(reference))
        self._remove_temporary_image("room-join.png")
        return None

    def _effect_clear_all_storage(self, _request: Effect) -> None:
        self._stop_room()
        with self._storage_lock:
            self.profile.clear_all()
            self.secrets.clear()
        self._remove_temporary_image("room-join.png")
        self._remove_temporary_image("device-link.png")
        return None

    def _effect_discover_servers(self, request: Effect) -> Action:
        self._publish(action("DISCOVERY_STARTED"))
        if not self._discovery_enabled:
            return action("DISCOVERY_FINISHED")
        seen_origins: set[str] = set()
        local_origins = same_machine_origins()
        discovered_local: set[str] = set()
        for origin in local_origins:
            if self._stopping:
                break
            seen_origins.add(origin)
            if self._probe_discovered_origin(origin, "same-machine", timeout=0.5):
                discovered_local.add(origin)
        browser = MdnsBrowser()
        self._discovery = browser
        try:
            for candidate in browser.browse(
                on_packet_error=lambda error: self.diagnostics.add(
                    "discovery.packet_rejected", error_type=type(error).__name__
                )
            ):
                if self._stopping:
                    break
                if candidate.origin in seen_origins:
                    continue
                seen_origins.add(candidate.origin)
                self._probe_discovered_origin(candidate.origin, "mdns")
        finally:
            self._discovery = None
        # Kodi and the server are often launched together. Re-probe local
        # front doors after the multicast window so a server that became ready
        # during startup is found without requiring a manual refresh.
        for origin in local_origins:
            if self._stopping or origin in discovered_local:
                continue
            self._probe_discovered_origin(origin, "same-machine", timeout=1.25)
        return action("DISCOVERY_FINISHED")

    def _probe_discovered_origin(
        self,
        candidate: str,
        source: str,
        timeout: float = 2.0,
    ) -> bool:
        try:
            origin, info = ApiClient.probe(candidate, self._locale(), timeout=timeout)
            server = validated_record(origin, source, info)
            self._publish(action("SERVER_DISCOVERED", server=server))
            return True
        except (HttpFailure, ProtocolViolation, ValueError, OSError) as error:
            self.diagnostics.add(
                "discovery.candidate_rejected",
                source=source,
                error_type=type(error).__name__,
            )
            return False

    def _effect_probe_saved_servers(self, request: Effect) -> None:
        for saved in request.payload.get("servers", ()):
            if self._stopping:
                break
            try:
                origin, info = ApiClient.probe(saved.origin, self._locale())
                server = validated_record(origin, "saved", info)
                self._publish(action("SERVER_DISCOVERED", server=server))
            except (HttpFailure, ProtocolViolation, ValueError, OSError) as error:
                self.diagnostics.add(
                    "discovery.saved_probe_failed",
                    server_id=saved.server_id,
                    error_type=type(error).__name__,
                )
                self._publish(action("SERVER_UNAVAILABLE", server_id=saved.server_id))
        return None

    def _effect_validate_server(self, request: Effect) -> Action:
        origin, info = ApiClient.probe(str(request.payload["origin"]), self._locale())
        server = validated_record(origin, str(request.payload.get("source", "manual")), info)
        self.diagnostics.add(
            "server.validated",
            server_id=server.server_id,
            deployment_mode=server.deployment_mode,
            origin=server.origin,
        )
        return action("SERVER_VALIDATED", server=server, server_info=info)

    def _effect_load_metadata(self, request: Effect) -> Action:
        client = self._api(request)
        profiles = client.get_profiles()
        locale_result = client.get_locales()
        default_locale = str(locale_result["defaultLocale"])
        locales = tuple(locale_result.get("locales", ()))
        taxonomy = client.get_taxonomy(default_locale)
        groups = ()
        game_settings = None
        partial_message = None
        try:
            groups = client.get_groups()
            game_settings = client.get_game_settings()
        except HttpFailure as error:
            if error.status not in {401, 403}:
                partial_message = str(error)
        if partial_message:
            return action(
                "METADATA_PARTIAL",
                profiles=profiles,
                locales=locales,
                default_card_locale=default_locale,
                taxonomy=taxonomy,
                message=partial_message,
            )
        return action(
            "METADATA_LOADED",
            profiles=profiles,
            groups=groups,
            locales=locales,
            default_card_locale=default_locale,
            taxonomy=taxonomy,
            game_settings=game_settings,
            authorization=self._authorization_summary(request),
        )

    def _effect_load_taxonomy(self, request: Effect) -> Action:
        locale = str(request.payload["locale"])
        taxonomy = self._api(request).get_taxonomy(locale)
        return action("TAXONOMY_LOADED", taxonomy=taxonomy, locale=locale)

    def _effect_load_help(self, request: Effect) -> Action:
        client = self._api(request)
        topics = client.get_help_index()
        slug = str(request.payload.get("slug") or topics[0]["slug"])
        document = client.get_help_document(slug)
        return action("HELP_LOADED", topics=topics, document=document)

    def _effect_load_help_document(self, request: Effect) -> Action:
        document = self._api(request).get_help_document(str(request.payload["slug"]))
        return action("HELP_DOCUMENT_LOADED", document=document)

    def _effect_eligibility_preview(self, request: Effect) -> Action:
        preview = self._api(request).eligibility_preview(
            request.payload["settings"], int(request.payload["player_count"])
        )
        return action(
            "ELIGIBILITY_LOADED",
            request.operation_id,
            preview=preview,
            target=request.payload.get("target", "setup"),
        )

    def _effect_search_session_cards(self, request: Effect) -> Action:
        result = self._api(request).search_session_cards(
            request.payload["policy"],
            str(request.payload["locale"]),
            str(request.payload["query"]),
            cursor=(
                str(request.payload["cursor"])
                if request.payload.get("cursor") is not None
                else None
            ),
            group_id=(
                str(request.payload["group_id"])
                if request.payload.get("group_id")
                else None
            ),
            limit=4,
        )
        return action(
            "CARD_SEARCHED",
            request.operation_id,
            cards=result.get("cards", ()),
            next_cursor=result.get("nextCursor"),
            total=result.get("total", 0),
        )

    def _effect_create_couch(self, request: Effect) -> Action:
        snapshot = self._api(request).create_couch(request.payload["request"])
        now = time.time()
        recovery = RecoveryEnvelope(
            schema_version=1,
            server_id=str(request.payload["server_id"]),
            origin=str(request.payload["origin"]),
            mode="COUCH",
            couch_session_id=str(snapshot["id"]),
            created_at=now,
            last_connected_at=now,
        )
        with self._storage_lock:
            self.profile.save_recovery(recovery)
        return action("COUCH_CREATED", snapshot=snapshot, recovery=recovery)

    def _effect_couch_command(self, request: Effect) -> Action:
        client = self._api(request)
        session_id = str(request.payload["session_id"])
        try:
            snapshot = client.couch_command(
                session_id,
                str(request.payload["command"]),
                int(request.payload["revision"]),
                request.payload.get("extra"),
            )
        except HttpFailure as error:
            if error.status is not None and error.code != "STALE_SESSION_REVISION":
                raise
            self.diagnostics.add(
                "couch.command_ambiguous",
                command=str(request.payload["command"]),
                code=error.code,
            )
            try:
                snapshot = client.get_couch(session_id)
            except HttpFailure as refresh_error:
                raise CouchStateUnresolved(
                    "The authoritative Couch state could not be refreshed"
                ) from refresh_error
        return action("COUCH_UPDATED", snapshot=snapshot)

    def _effect_resync_couch(self, request: Effect) -> Action:
        snapshot = self._api(request).get_couch(str(request.payload["session_id"]))
        return action("COUCH_UPDATED", snapshot=snapshot)

    def _effect_create_display_room(self, request: Effect) -> Action:
        create_request = {
            "displayName": request.payload["display_name"],
            "persistence": request.payload["persistence"],
            "bootstrapMode": "DISPLAY_WAITING_FOR_HOST",
            "settings": request.payload["settings"],
        }
        canonical = json.dumps(
            create_request,
            sort_keys=True,
            separators=(",", ":"),
        )
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        pending_reference = f"pending-room-create:{request.payload['server_id']}"
        pending_raw = self.secrets.get(pending_reference)
        pending = json.loads(pending_raw) if pending_raw else {}
        if pending:
            idempotency_key = str(pending["key"])
            pending_request = pending.get("request")
            if not isinstance(pending_request, dict):
                raise StorageVersionError("Pending Room creation record is incomplete")
            if pending.get("fingerprint") != digest:
                create_request = pending_request
        else:
            idempotency_key = str(uuid.uuid4())
            self.secrets.put(
                json.dumps(
                    {
                        "fingerprint": digest,
                        "key": idempotency_key,
                        "request": create_request,
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                ),
                pending_reference,
            )
        try:
            join = self._api(request).create_display_room(
                str(create_request["displayName"]),
                str(create_request["persistence"]),
                create_request["settings"],
                idempotency_key,
            )
        except HttpFailure as error:
            if error.code == "IDEMPOTENCY_RESULT_GONE":
                self.secrets.delete(pending_reference)
            raise
        joined = self._room_join_action(request, join)
        self.secrets.delete(pending_reference)
        return joined

    def _effect_join_display_room(self, request: Effect) -> Action:
        join = self._api(request).join_display(
            str(request.payload["room_code"]).strip().upper(),
            str(request.payload["display_name"]),
        )
        return self._room_join_action(request, join)

    def _effect_ws_connect(self, request: Effect) -> None:
        room: ActiveRoom = request.payload["room"]
        credential = self.secrets.get(room.credential_reference)
        if not credential:
            raise StorageVersionError("Room credential is unavailable")
        info = request.payload["server_info"]
        endpoint = info.get("endpoints", {}).get("webSocketPath", "/ws")
        origin = validate_transport(
            str(request.payload["origin"]),
            str(info.get("deploymentMode", "")),
        )
        url = websocket_url(origin, str(endpoint), self._locale())
        self._stop_room()
        settings = RoomConnectionSettings(
            url=url,
            origin=origin,
            room_code=room.room_code,
            participant_id=room.participant_id,
            role="DISPLAY",
            application_version=APPLICATION_VERSION,
        )
        worker = RoomWebSocketWorker(settings, credential, self._room_event)
        self._room_worker = worker
        worker.start()
        return None

    def _effect_generate_room_qr(self, request: Effect) -> Action:
        info = request.payload["server_info"]
        access = info.get("roomAccess", {})
        base = access.get("configuredBaseUrl") or request.payload["origin"]
        template = info.get("endpoints", {}).get("roomJoinPathTemplate", "/play/?room={roomCode}")
        path = str(template).replace("{roomCode}", str(request.payload["room_code"]))
        join_url = relative_url(str(base), path)
        if any(name in join_url.casefold() for name in ("credential=", "token=", "secret=")):
            raise ValueError("Join URL unexpectedly contains secret material")
        target = self.profile_directory / "room-join.png"
        write_png(encode_text(join_url), target)
        return action("QR_READY", path=str(target))

    def _effect_clear_room_qr(self, _request: Effect) -> None:
        self._remove_temporary_image("room-join.png")
        return None

    def _effect_create_group(self, request: Effect) -> Action:
        client = self._api(request)
        created = client.create_group(
            str(request.payload["name"]), list(request.payload["members"])
        )
        return action(
            "GROUPS_LOADED",
            groups=client.get_groups(),
            route=request.payload["return_route"],
            selected_group_id=created.get("id"),
        )

    def _effect_update_group(self, request: Effect) -> Action:
        client = self._api(request)
        group = request.payload["group"]
        client.update_group(
            {
                "id": group["id"],
                "name": str(request.payload["name"]),
                "members": list(request.payload["members"]),
                "preferredProfileId": group.get("preferredProfileId"),
                "customConfiguration": group.get("customConfiguration"),
                "cardLanguageSettings": group.get("cardLanguageSettings"),
            }
        )
        return action(
            "GROUPS_LOADED",
            groups=client.get_groups(),
            route=request.payload["return_route"],
        )

    def _effect_authorize_device(self, request: Effect) -> Action:
        info = request.payload["server_info"]
        client = DeviceAuthorizationClient(
            str(request.payload["origin"]),
            info,
            self._locale(),
        )
        cancelled = threading.Event()
        self._authorization_cancel = cancelled
        try:
            authorization = client.begin(client.client_id, client.scope)
            target = self.profile_directory / "device-link.png"
            qr_value = authorization.verification_uri_complete or authorization.verification_uri
            write_png(encode_text(qr_value), target)
            self._publish(
                action(
                    "AUTHORIZATION_PENDING",
                    authorization={
                        "status": "PENDING",
                        "user_code": authorization.user_code,
                        "verification_uri": authorization.verification_uri,
                        "expires_at": authorization.expires_at,
                    },
                    qr_path=str(target),
                )
            )
            try:
                token = client.poll(authorization, client.client_id, cancelled)
            except DeviceAuthorizationError:
                if cancelled.is_set():
                    return action("AUTHORIZATION_CANCELLED")
                raise
            if cancelled.is_set():
                return action("AUTHORIZATION_CANCELLED")
            summary = self._save_account_token(request, token)
            return action("AUTHORIZATION_COMPLETE", authorization=summary)
        finally:
            if self._authorization_cancel is cancelled:
                self._authorization_cancel = None
            self._remove_temporary_image("device-link.png")

    def _effect_unlink_device(self, request: Effect) -> Action:
        server_id = str(request.payload["server_id"])
        reference = f"account-token:{server_id}"
        raw = self.secrets.get(reference)
        try:
            if raw:
                record = json.loads(raw)
                token = record.get("refresh_token") or record.get("access_token")
                if token:
                    client = DeviceAuthorizationClient(
                        str(request.payload["origin"]),
                        request.payload["server_info"],
                        self._locale(),
                    )
                    if client.revocation_path:
                        client.revoke(str(token))
        except (DeviceAuthorizationError, HttpFailure) as error:
            self.diagnostics.add(
                "authorization.remote_revoke_failed",
                server_id=server_id,
                error_type=type(error).__name__,
            )
        finally:
            self.secrets.delete(reference)
            target = self.profile_directory / "device-link.png"
            try:
                target.unlink()
            except FileNotFoundError:
                pass
        return action("AUTHORIZATION_UNLINKED")

    def _effect_recover_active(self, request: Effect) -> Action:
        recovery: RecoveryEnvelope = request.payload["recovery"]
        if recovery.server_id != request.payload["server_id"] or recovery.origin != request.payload["origin"]:
            raise ValueError("Recovery belongs to a different server origin")
        if recovery.mode == "COUCH" and recovery.couch_session_id:
            snapshot = self._api(request).get_couch(recovery.couch_session_id)
            return action("COUCH_CREATED", snapshot=snapshot, recovery=recovery)
        if (
            recovery.mode == "ROOM"
            and recovery.room_code
            and recovery.participant_id
            and recovery.credential_reference
        ):
            if not self.secrets.get(recovery.credential_reference):
                raise StorageVersionError("Recovery credential is unavailable")
            room = ActiveRoom(
                room_id="",
                room_code=recovery.room_code,
                participant_id=recovery.participant_id,
                credential_reference=recovery.credential_reference,
                role="DISPLAY",
                bootstrap_mode="DISPLAY_WAITING_FOR_HOST",
            )
            return action("ROOM_JOINED", room=room, recovery=recovery)
        raise StorageVersionError("Recovery envelope is incomplete")

    def _room_join_action(self, request: Effect, join: dict) -> Action:
        credential_reference = self.secrets.put(str(join["participantCredential"]))
        room = ActiveRoom(
            room_id=str(join["roomId"]),
            room_code=str(join["roomCode"]),
            participant_id=str(join["participantId"]),
            credential_reference=credential_reference,
            role="DISPLAY",
            bootstrap_mode=str(join.get("bootstrapMode", "CREATOR_HOST")),
        )
        now = time.time()
        recovery = RecoveryEnvelope(
            schema_version=1,
            server_id=str(request.payload["server_id"]),
            origin=str(request.payload["origin"]),
            mode="ROOM",
            room_code=room.room_code,
            participant_id=room.participant_id,
            credential_reference=credential_reference,
            protocol_version=PROTOCOL_VERSION,
            created_at=now,
            last_connected_at=now,
        )
        try:
            with self._storage_lock:
                self.profile.save_recovery(recovery)
        except BaseException:
            self.secrets.delete(credential_reference)
            raise
        return action("ROOM_JOINED", room=room, recovery=recovery)

    def _room_event(self, event: str, payload: dict) -> None:
        if event == "state":
            self._publish(action("WS_STATE", **payload))
        elif event == "envelope":
            self._publish(action("WS_ENVELOPE", **payload))
        elif event == "closed":
            self._publish(action("ROOM_CLOSED", **payload))
        elif event == "left":
            self._stop_room(from_worker=True)
            self._publish(action("LEAVE_COMPLETED"))
        elif event == "error":
            if payload.get("code") == "PROTOCOL_VIOLATION":
                payload = {**payload, "message_id": strings.UNSUPPORTED_SERVER}
            elif payload.get("code") == "CONNECTION_REPLACED":
                payload = {**payload, "message_id": strings.CONNECTION_REPLACED}
            self._publish(action("OPERATION_FAILED", **payload))

    def _stop_room(self, from_worker: bool = False) -> None:
        worker = self._room_worker
        self._room_worker = None
        if worker and not from_worker:
            worker.stop()

    def _remove_temporary_image(self, name: str) -> None:
        target = self.profile_directory / name
        try:
            target.unlink()
        except FileNotFoundError:
            pass
        except OSError as error:
            self.diagnostics.add(
                "temporary_image.remove_failed",
                image=name,
                error_type=type(error).__name__,
            )

    def _api(self, request: Effect) -> ApiClient:
        server_id = str(request.payload.get("server_id", ""))
        bearer = self._account_access_token(request) if server_id else None
        return ApiClient(
            str(request.payload["origin"]),
            request.payload.get("server_info"),
            self._locale(),
            bearer,
        )

    def _authorization_summary(self, request: Effect) -> Optional[dict[str, object]]:
        server_id = str(request.payload.get("server_id", ""))
        raw = self.secrets.get(f"account-token:{server_id}") if server_id else None
        if not raw:
            return None
        try:
            record = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            return None
        if record.get("origin") != request.payload.get("origin"):
            return None
        return {
            "status": "LINKED",
            "label": str(record.get("label", "")),
            "scope": str(record.get("scope", "")),
        }

    def _account_access_token(self, request: Effect) -> Optional[str]:
        if not request.payload.get("server_info", {}).get("capabilities", {}).get(
            "nativeDeviceAuthorization"
        ):
            return None
        server_id = str(request.payload["server_id"])
        reference = f"account-token:{server_id}"
        raw = self.secrets.get(reference)
        if not raw:
            return None
        try:
            record = json.loads(raw)
        except (TypeError, json.JSONDecodeError) as error:
            raise StorageVersionError("Native authorization record is unreadable") from error
        if record.get("origin") != request.payload["origin"]:
            raise StorageVersionError("Native authorization belongs to another server origin")
        access_token = record.get("access_token")
        if not isinstance(access_token, str):
            raise StorageVersionError("Native authorization has no access token")
        if float(record.get("expires_at", 0)) > time.time() + 30:
            return access_token
        refresh_token = record.get("refresh_token")
        if not isinstance(refresh_token, str):
            raise StorageVersionError("Native authorization has expired")
        client = DeviceAuthorizationClient(
            str(request.payload["origin"]),
            request.payload["server_info"],
            self._locale(),
        )
        refreshed = client.refresh(refresh_token)
        self._save_account_token(request, refreshed, record)
        self.diagnostics.add("authorization.refreshed", server_id=server_id)
        return str(json.loads(self.secrets.get(reference) or "{}")["access_token"])

    def _save_account_token(
        self,
        request: Effect,
        token: dict,
        previous: Optional[dict] = None,
    ) -> dict[str, object]:
        access_token = token.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise StorageVersionError("Native authorization returned no access token")
        refresh_token = token.get("refresh_token") or (previous or {}).get("refresh_token")
        expires_in = max(30, min(int(token.get("expires_in", 300)), 86_400))
        label = str(token.get("device_label") or token.get("data_space_label") or "")[:80]
        scope = str(token.get("scope") or (previous or {}).get("scope") or "")[:500]
        record = {
            "origin": str(request.payload["origin"]),
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": time.time() + expires_in,
            "scope": scope,
            "label": label,
        }
        self.secrets.put(
            json.dumps(record, sort_keys=True, separators=(",", ":")),
            f"account-token:{request.payload['server_id']}",
        )
        return {"status": "LINKED", "label": label, "scope": scope}

    def _locale(self) -> str:
        locale = self._locale_provider().replace("_", "-")
        return locale if len(locale) >= 2 else SOURCE_LOCALE


def _failure_notice(error: Exception, effect_kind: str) -> dict[str, object]:
    if isinstance(error, CouchStateUnresolved):
        return {
            "message_id": strings.COUCH_SYNC_REQUIRED,
            "code": error.code,
        }
    if isinstance(error, HttpFailure):
        if error.code == "CARD_POOL_EXHAUSTED":
            return {
                "message_id": strings.POOL_EXHAUSTED,
                "code": error.code,
            }
        if error.code == "SERVER_NOT_READY":
            return {"message_id": strings.SERVER_NOT_READY}
        if error.code and error.status:
            return {"message": str(error)[:500], "code": error.code}
        if error.status and "non-JSON" in str(error):
            return {"message_id": strings.UNSUPPORTED_SERVER}
        return {"message_id": strings.NETWORK_ERROR}
    if isinstance(error, ProtocolViolation):
        return {"message_id": strings.UNSUPPORTED_SERVER}
    if isinstance(error, StorageVersionError):
        return {"message_id": strings.STORAGE_ERROR}
    if isinstance(error, ValueError) and effect_kind == "VALIDATE_SERVER":
        return {"message_id": strings.INVALID_SERVER_ADDRESS}
    if isinstance(error, ValueError):
        return {"message_id": strings.INVALID_CONFIGURATION}
    return {"message_id": strings.NETWORK_ERROR}
