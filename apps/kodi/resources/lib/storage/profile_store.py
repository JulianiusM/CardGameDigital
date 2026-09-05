"""Atomic, versioned non-secret profile persistence."""

from __future__ import annotations

import json
import math
import os
import tempfile
import threading
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit

from ..native_settings_metadata import (
    AUTO_PAGE_SECONDS,
    DISPLAY_NAME,
    LOCALE,
    LOCALE_VALUES,
    SETTING_DEFAULTS,
    SETTING_INTEGER_RANGES,
    SETTING_MAXIMUM_LENGTHS,
)
from ..protocol.validation import PROTOCOL_VERSION, ROOM_CODE
from ..state import Preferences, RecoveryEnvelope, ServerRecord


SCHEMA_VERSION = 1
MAX_PROFILE_BYTES = 2 * 1024 * 1024

class StorageVersionError(RuntimeError):
    pass


@dataclass(frozen=True)
class StorageBundle:
    preferences: Preferences
    servers: tuple[ServerRecord, ...]
    recovery: Optional[RecoveryEnvelope]


class ProfileStore:
    def __init__(self, profile_directory: str | Path) -> None:
        self.root = Path(profile_directory).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self._settings_path = self.root / "client.json"
        self._recovery_path = self.root / "recovery.json"
        self._lock = threading.RLock()

    def load(self) -> StorageBundle:
        with self._lock:
            settings = self._read(self._settings_path, {"schemaVersion": SCHEMA_VERSION})
            recovery_data = self._read(self._recovery_path, None)
        try:
            preferences = _preferences(settings.get("preferences", {}))
            server_values = settings.get("servers", ())
            if not isinstance(server_values, list) or len(server_values) > 50:
                raise ValueError("saved server registry is invalid")
            servers = tuple(_server(entry) for entry in server_values)
        except (KeyError, TypeError, ValueError):
            self._quarantine(self._settings_path)
            preferences = Preferences()
            servers = ()
        try:
            recovery = _recovery(recovery_data) if recovery_data else None
        except (KeyError, TypeError, ValueError):
            self._quarantine(self._recovery_path)
            recovery = None
        return StorageBundle(preferences, servers, recovery)

    def save(self, preferences: Preferences, servers: tuple[ServerRecord, ...]) -> None:
        value = {
            "schemaVersion": SCHEMA_VERSION,
            "preferences": asdict(preferences),
            "servers": [asdict(server) for server in servers if not server.server_id.startswith("pending:")],
        }
        with self._lock:
            atomic_json_write(self._settings_path, value)

    def save_recovery(self, recovery: RecoveryEnvelope) -> None:
        value = asdict(recovery)
        value["schemaVersion"] = SCHEMA_VERSION
        with self._lock:
            atomic_json_write(self._recovery_path, value)

    def clear_recovery(self) -> None:
        with self._lock:
            try:
                self._recovery_path.unlink()
            except FileNotFoundError:
                pass

    def clear_all(self) -> None:
        with self._lock:
            for target in (self._settings_path, self._recovery_path):
                try:
                    target.unlink()
                except FileNotFoundError:
                    pass

    @staticmethod
    def _read(path: Path, default: Any) -> Any:
        try:
            with path.open("r", encoding="utf-8") as handle:
                raw = handle.read(MAX_PROFILE_BYTES + 1)
            if len(raw.encode("utf-8")) > MAX_PROFILE_BYTES:
                ProfileStore._quarantine(path)
                return default
            value = json.loads(raw)
        except FileNotFoundError:
            return default
        except (json.JSONDecodeError, UnicodeDecodeError):
            ProfileStore._quarantine(path)
            return default
        except OSError as error:
            raise StorageVersionError(f"Client profile file is unreadable: {path.name}") from error
        if not isinstance(value, dict):
            ProfileStore._quarantine(path)
            return default
        version = value.get("schemaVersion", 0)
        if not isinstance(version, int) or version > SCHEMA_VERSION:
            raise StorageVersionError(f"Client profile file is newer than this add-on: {path.name}")
        return migrate(value, version)

    @staticmethod
    def _quarantine(path: Path) -> None:
        if not path.exists():
            return
        target = path.with_name(f"{path.name}.corrupt-{int(time.time())}")
        try:
            path.replace(target)
        except OSError:
            pass


def migrate(value: dict[str, Any], version: int) -> dict[str, Any]:
    current = dict(value)
    if version == 0:
        current = {
            "schemaVersion": 1,
            "preferences": current.get("preferences", current.get("settings", {})),
            "servers": current.get("servers", ()),
            **({"recovery": current["recovery"]} if "recovery" in current else {}),
        }
        version = 1
    if version != SCHEMA_VERSION:
        raise StorageVersionError("Unsupported client profile version")
    return current


def atomic_json_write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        try:
            path.chmod(0o600)
        except OSError:
            pass
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
        raise


def _preferences(value: dict[str, Any]) -> Preferences:
    if not isinstance(value, dict):
        raise ValueError("preferences must be an object")
    defaults = asdict(Preferences())
    accepted = {key: value.get(key, default) for key, default in defaults.items()}
    if (
        isinstance(accepted["schema_version"], bool)
        or not isinstance(accepted["schema_version"], int)
        or accepted["schema_version"] != SCHEMA_VERSION
    ):
        raise ValueError("preferences schema version is invalid")
    if accepted[LOCALE] not in LOCALE_VALUES:
        accepted[LOCALE] = SETTING_DEFAULTS[LOCALE]
    auto_page_seconds = accepted[AUTO_PAGE_SECONDS]
    page_minimum, _page_step, page_maximum = SETTING_INTEGER_RANGES[AUTO_PAGE_SECONDS]
    if (
        isinstance(auto_page_seconds, bool)
        or not isinstance(auto_page_seconds, int)
        or not page_minimum <= auto_page_seconds <= page_maximum
    ):
        accepted[AUTO_PAGE_SECONDS] = defaults[AUTO_PAGE_SECONDS]
    display_name = accepted[DISPLAY_NAME]
    if not isinstance(display_name, str) or not display_name.strip():
        accepted[DISPLAY_NAME] = defaults[DISPLAY_NAME]
    else:
        accepted[DISPLAY_NAME] = display_name.strip()[
            : SETTING_MAXIMUM_LENGTHS[DISPLAY_NAME]
        ]
    if accepted["last_server_id"] is not None and not isinstance(
        accepted["last_server_id"], str
    ):
        accepted["last_server_id"] = None
    return Preferences(**accepted)


def _server(value: dict[str, Any]) -> ServerRecord:
    if not isinstance(value, dict):
        raise ValueError("saved server must be an object")
    server_id = _uuid(value["server_id"], "saved server ID")
    origin = _origin(value["origin"], "saved server origin")
    display_name = str(value.get("display_name", value["origin"])).strip()
    deployment_mode = value.get("deployment_mode", "local")
    source = value.get("source", "saved")
    last_seen = value.get("last_seen", 0)
    capabilities = value.get("capabilities", {})
    endpoints = value.get("endpoints", {})
    available = value.get("available", False)
    if not 1 <= len(display_name) <= 80:
        raise ValueError("saved server display name is invalid")
    if deployment_mode not in {"local", "public"} or source not in {
        "saved",
        "manual",
        "mdns",
    }:
        raise ValueError("saved server classification is invalid")
    if (
        isinstance(last_seen, bool)
        or not isinstance(last_seen, (int, float))
        or not math.isfinite(float(last_seen))
        or float(last_seen) < 0
    ):
        raise ValueError("saved server timestamp is invalid")
    if not isinstance(capabilities, dict) or not isinstance(endpoints, dict):
        raise ValueError("saved server metadata is invalid")
    if len(capabilities) > 50 or len(endpoints) > 50 or not isinstance(available, bool):
        raise ValueError("saved server identity is invalid")
    return ServerRecord(
        server_id=server_id,
        origin=origin,
        display_name=display_name,
        deployment_mode=str(deployment_mode),
        source=str(source),
        last_seen=float(last_seen),
        capabilities=dict(capabilities),
        endpoints=dict(endpoints),
        available=available,
    )


def _recovery(value: dict[str, Any]) -> RecoveryEnvelope:
    if not isinstance(value, dict):
        raise ValueError("recovery must be an object")
    schema_version = value.get("schema_version", value.get("schemaVersion", 1))
    if (
        isinstance(schema_version, bool)
        or not isinstance(schema_version, int)
        or schema_version != SCHEMA_VERSION
    ):
        raise ValueError("recovery schema version is invalid")
    server_id = _uuid(value["server_id"], "recovery server ID")
    origin = _origin(value["origin"], "recovery origin")
    mode = value.get("mode")
    if mode not in {"COUCH", "ROOM"}:
        raise ValueError("recovery mode is invalid")
    created_at = _timestamp(value["created_at"], "recovery created time")
    last_connected_at = _timestamp(value["last_connected_at"], "recovery connection time")
    if last_connected_at < created_at:
        raise ValueError("recovery connection time predates creation")
    couch_session_id, room_code, participant_id, credential_reference, protocol_version = _recovery_credentials(value, mode)
    return RecoveryEnvelope(
        schema_version=schema_version,
        server_id=server_id,
        origin=origin,
        mode=str(mode),
        created_at=created_at,
        last_connected_at=last_connected_at,
        couch_session_id=couch_session_id,
        room_code=str(room_code) if room_code is not None else None,
        participant_id=participant_id,
        credential_reference=(
            str(credential_reference) if credential_reference is not None else None
        ),
        protocol_version=protocol_version,
    )

def _recovery_credentials(value, mode):
    couch_session_id = value.get("couch_session_id")
    room_code = value.get("room_code")
    participant_id = value.get("participant_id")
    credential_reference = value.get("credential_reference")
    protocol_version = value.get("protocol_version")
    if couch_session_id is not None:
        couch_session_id = _uuid(couch_session_id, "Couch recovery session ID")
    if room_code is not None and not ROOM_CODE.fullmatch(str(room_code)):
        raise ValueError("recovery Room code is invalid")
    if participant_id is not None:
        participant_id = _uuid(participant_id, "recovery participant ID")
    if credential_reference is not None and not 1 <= len(str(credential_reference)) <= 200:
        raise ValueError("recovery credential reference is invalid")
    if protocol_version is not None and protocol_version != PROTOCOL_VERSION:
        raise ValueError("recovery protocol version is invalid")
    if mode == "COUCH" and not couch_session_id:
        raise ValueError("Couch recovery is incomplete")
    if mode == "ROOM" and not all((room_code, participant_id, credential_reference)):
        raise ValueError("Room recovery is incomplete")
    return couch_session_id, room_code, participant_id, credential_reference, protocol_version


def _uuid(value: Any, name: str) -> str:
    rendered = str(value)
    try:
        parsed = uuid.UUID(rendered)
    except (ValueError, AttributeError) as error:
        raise ValueError(f"{name} is invalid") from error
    if str(parsed) != rendered.casefold():
        raise ValueError(f"{name} is not canonical")
    return str(parsed)


def _origin(value: Any, name: str) -> str:
    rendered = str(value)
    parsed = urlsplit(rendered)
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError(f"{name} port is invalid") from error
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or (port is not None and not 1 <= port <= 65_535)
        or len(rendered) > 500
        or any(character.isspace() for character in rendered)
    ):
        raise ValueError(f"{name} is invalid")
    return rendered.rstrip("/")


def _timestamp(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} is invalid")
    result = float(value)
    if not math.isfinite(result) or result < 0:
        raise ValueError(f"{name} is invalid")
    return result
