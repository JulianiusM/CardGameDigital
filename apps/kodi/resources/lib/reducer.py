"""Pure state reducer. All I/O is returned as data-only Effect descriptions."""

from __future__ import annotations

from dataclasses import replace
from typing import Any, Iterable, Optional, Tuple

from .actions import Action, Effect, effect
from .discovery.registry import merge_records
from .help_content import LOCAL_HELP_TOPICS, local_help_topic
from .protocol.validation import (
    CONNECTED_HOST_STATE,
    DATASPACE_SESSION_PERSISTENCE,
    DISCONNECT_EXPIRED_PARTICIPANT_REASON,
    EPHEMERAL_SESSION_PERSISTENCE,
    NAMED_REVEAL_MODE,
    PRE_CONNECTION_HOST_STATES,
    VETOED_CARD_REPLACEMENT_REASON,
)
from .routes import ACTIVE_ROUTES, Route
from .state import (
    ActiveRoom,
    AppState,
    Confirmation,
    Preferences,
    RecoveryEnvelope,
    ServerRecord,
    SetupDraft,
    bump,
    initial_setup,
)
from .strings import Text
from . import strings


Transition = Tuple[AppState, Tuple[Effect, ...]]


def _transition(state: AppState, *effects: Effect) -> Transition:
    return state, tuple(effects)


def _server(state: AppState) -> Optional[ServerRecord]:
    return next(
        (entry for entry in state.servers if entry.server_id == state.selected_server_id),
        None,
    )


def _card_identity(snapshot: object) -> Optional[str]:
    if not isinstance(snapshot, dict):
        return None
    card = snapshot.get("currentCard")
    if not isinstance(card, dict) or not card.get("id"):
        return None
    return str(card["id"])


def _merge_server(
    servers: Iterable[ServerRecord],
    candidate: ServerRecord,
) -> tuple[ServerRecord, ...]:
    retained = tuple(
        current
        for current in servers
        if not (
            current.origin == candidate.origin
            and current.server_id.startswith("pending:")
        )
    )
    return merge_records((*retained, candidate))[:50]


def _route(state: AppState, route: Route, push: bool = True) -> AppState:
    stack = state.route_stack
    if route == Route.HOME:
        stack = ()
    elif push and state.route != route:
        stack = (*stack, state.route)
    return bump(
        state,
        route=route,
        route_stack=stack,
        confirmation=None,
        notification=None,
        collection_page=0,
        card_page=0,
    )


def _setup_stack(topology: str, destination: Route) -> tuple[Route, ...]:
    steps = [Route.HOME, Route.SETUP_GROUP, Route.SETUP_MODE, Route.SETUP_PROFILE]
    if topology == "COUCH":
        steps.append(Route.SETUP_PLAYERS)
    steps.extend((Route.SETUP_CUSTOMIZE, Route.SETUP_REVIEW))
    try:
        return tuple(steps[: steps.index(destination)])
    except ValueError:
        return (Route.HOME,)


def _selected_transport(state: AppState) -> dict[str, Any]:
    server = _server(state)
    if not server:
        return {}
    return {
        "server_id": server.server_id,
        "origin": server.origin,
        "server_info": dict(state.server_info or {}),
    }


def _room_player_count(snapshot: dict[str, Any]) -> int:
    total = 0
    for participant in snapshot.get("participants", ()):
        if participant.get("role") == "DISPLAY":
            continue
        total += 1 + len(participant.get("devicePlayers", ()))
    return max(2, total)


def _room_settings_changed_by_other_participant(
    state: AppState, snapshot: dict[str, Any]
) -> bool:
    """Recognize an authoritative pre-session settings update after the first snapshot."""
    if snapshot.get("session") is not None or not state.active_room:
        return False
    previous_snapshot = state.room_snapshot
    if not isinstance(previous_snapshot, dict) or previous_snapshot.get("session") is not None:
        return False
    previous_settings = previous_snapshot.get("settings")
    current_settings = snapshot.get("settings")
    if not isinstance(previous_settings, dict) or not isinstance(current_settings, dict):
        return False
    previous_revision = previous_settings.get("revision")
    current_revision = current_settings.get("revision")
    updated_by = current_settings.get("updatedByParticipantId")
    if not isinstance(previous_revision, int) or not isinstance(current_revision, int):
        return False
    return (
        current_revision > previous_revision
        and isinstance(updated_by, str)
        and bool(updated_by)
        and updated_by != state.active_room.participant_id
    )


def _notice(payload: Any, fallback: int = strings.COMMAND_REJECTED) -> Text:
    message_id = payload.get("message_id")
    if isinstance(message_id, int):
        arguments = tuple(payload.get("arguments", ()))
        return Text.message(message_id, *arguments)
    message = payload.get("message")
    if isinstance(message, str) and message:
        return Text.raw(message)
    return Text.message(fallback)


def _exit_confirmation() -> Confirmation:
    return Confirmation(
        title_id=strings.EXIT_ADDON_TITLE,
        body_id=strings.EXIT_ADDON_BODY,
        action_id=strings.EXIT_ADDON,
        confirm_action="exit-addon",
    )


def reduce(state: AppState, incoming: Action) -> Transition:
    kind = incoming.kind
    payload = incoming.payload

    if kind == "START":
        next_state = bump(state, lifecycle="RUNNING", route=Route.BOOTSTRAP)
        return _transition(
            next_state,
            effect("LOAD_STORAGE", owner="lifecycle"),
            effect("DISCOVER_SERVERS", owner="discovery"),
        )

    if kind == "STORAGE_LOADED":
        preferences = payload.get("preferences", Preferences())
        servers = merge_records((*tuple(payload.get("servers", ())), *state.servers))[:50]
        recovery = payload.get("recovery")
        configured_server_origin = payload.get("configured_server_origin")
        if configured_server_origin:
            next_state = bump(
                state,
                preferences=preferences,
                servers=servers,
                recovery=recovery,
                busy_operation="server.validate",
                route=Route.BOOTSTRAP,
            )
            effects = [
                effect(
                    "VALIDATE_SERVER",
                    owner="server",
                    operation_id="startup-configured-server",
                    origin=str(configured_server_origin),
                    source="manual",
                )
            ]
            if servers:
                effects.append(
                    effect("PROBE_SAVED_SERVERS", owner="saved-probes", servers=servers)
                )
            return _transition(next_state, *effects)
        selected = preferences.last_server_id
        candidate = next((item for item in servers if item.server_id == selected), None)
        if candidate:
            next_state = bump(
                state,
                preferences=preferences,
                servers=servers,
                recovery=recovery,
                selected_server_id=candidate.server_id,
                busy_operation="server.validate",
                route=Route.BOOTSTRAP,
            )
            return _transition(
                next_state,
                effect(
                    "VALIDATE_SERVER",
                    owner="server",
                    operation_id="startup-server",
                    origin=candidate.origin,
                    source=candidate.source,
                ),
                effect("PROBE_SAVED_SERVERS", owner="saved-probes", servers=servers),
            )
        next_state = bump(
                state,
                preferences=preferences,
                servers=servers,
                recovery=recovery,
                route=Route.SERVER_LIST,
            )
        saved_probe = (
            (effect("PROBE_SAVED_SERVERS", owner="saved-probes", servers=servers),)
            if servers
            else ()
        )
        return _transition(next_state, *saved_probe)

    if kind == "STORAGE_FAILED":
        return _transition(bump(state, route=Route.SERVER_LIST, notification=_notice(payload, strings.STORAGE_ERROR)))

    if kind == "DISCOVERY_STARTED":
        return _transition(bump(state, transport_state="DISCOVERING"))

    if kind == "DISCOVERY_REQUESTED":
        return _transition(
            bump(state, transport_state="DISCOVERING", notification=None),
            effect("DISCOVER_SERVERS", owner="discovery"),
        )

    if kind == "SERVER_DISCOVERED":
        candidate = payload["server"]
        return _transition(bump(state, servers=_merge_server(state.servers, candidate)))

    if kind == "SERVER_UNAVAILABLE":
        server_id = str(payload["server_id"])
        servers = tuple(
            replace(server, available=False) if server.server_id == server_id else server
            for server in state.servers
        )
        return _transition(bump(state, servers=servers))

    if kind == "DISCOVERY_FINISHED":
        transport = "CONNECTED" if state.server_info else "DISCONNECTED"
        return _transition(bump(state, transport_state=transport))

    if kind == "SELECT_SERVER":
        next_state = bump(
            state,
            route=Route.SERVER_DETAILS,
            selected_server_id=payload.get("server_id"),
            busy_operation="server.validate",
            notification=None,
        )
        return _transition(
            next_state,
            effect(
                "VALIDATE_SERVER",
                owner="server",
                operation_id=incoming.operation_id,
                origin=payload["origin"],
                source=payload.get("source", "manual"),
            ),
        )

    if kind == "SERVER_DETAILS_OPENED":
        server_id = str(payload["server_id"])
        if not any(server.server_id == server_id for server in state.servers):
            return _transition(state)
        next_state = _route(state, Route.SERVER_DETAILS)
        return _transition(bump(next_state, server_details_id=server_id))

    if kind == "SERVER_VALIDATED":
        candidate = payload["server"]
        preferences = replace(state.preferences, last_server_id=candidate.server_id)
        next_state = bump(
            state,
            route=Route.HOME,
            route_stack=(),
            preferences=preferences,
            servers=_merge_server(state.servers, candidate),
            selected_server_id=candidate.server_id,
            server_details_id=None,
            server_info=payload["server_info"],
            transport_state="CONNECTED",
            busy_operation="metadata.load",
            notification=None,
            profiles=(),
            groups=(),
            locales=(),
            taxonomy=None,
            taxonomy_locale=None,
            game_settings=None,
            authorization=None,
            qr_path=None,
        )
        return _transition(
            next_state,
            effect("LOAD_METADATA", owner="server", **_selected_transport(next_state)),
            effect("SAVE_STORAGE", owner="storage", state=next_state),
        )

    if kind == "SERVER_VALIDATION_FAILED":
        return _transition(
            bump(
                state,
                route=Route.SERVER_LIST,
                selected_server_id=None,
                server_details_id=None,
                server_info=None,
                busy_operation=None,
                transport_state="DISCONNECTED",
                notification=_notice(payload, strings.UNSUPPORTED_SERVER),
            )
        )

    if kind == "METADATA_LOADED":
        return _transition(
            bump(
                state,
                profiles=tuple(payload.get("profiles", ())),
                groups=tuple(payload.get("groups", ())),
                locales=tuple(payload.get("locales", ())),
                default_card_locale=str(payload.get("default_card_locale", "de-DE")),
                taxonomy=payload.get("taxonomy"),
                taxonomy_locale=str(payload.get("default_card_locale", "de-DE")),
                game_settings=payload.get("game_settings"),
                authorization=payload.get("authorization"),
                busy_operation=None,
            )
        )

    if kind == "METADATA_PARTIAL":
        return _transition(
            bump(
                state,
                profiles=tuple(payload.get("profiles", state.profiles)),
                locales=tuple(payload.get("locales", state.locales)),
                default_card_locale=str(
                    payload.get("default_card_locale", state.default_card_locale)
                ),
                taxonomy=payload.get("taxonomy", state.taxonomy),
                taxonomy_locale=str(
                    payload.get("default_card_locale", state.taxonomy_locale or "de-DE")
                ),
                busy_operation=None,
                notification=_notice(payload),
            )
        )

    if kind == "SERVERS_REPLACED":
        servers = tuple(payload["servers"])
        selected = state.selected_server_id
        server_info = state.server_info
        preferences = state.preferences
        if selected and not any(server.server_id == selected for server in servers):
            selected = None
            server_info = None
            preferences = replace(preferences, last_server_id=None)
        details = state.server_details_id
        if details and not any(server.server_id == details for server in servers):
            details = None
        next_state = bump(
            state,
            servers=servers,
            selected_server_id=selected,
            server_details_id=details,
            server_info=server_info,
            preferences=preferences,
            profiles=state.profiles if server_info else (),
            groups=state.groups if server_info else (),
            locales=state.locales if server_info else (),
            taxonomy=state.taxonomy if server_info else None,
            taxonomy_locale=state.taxonomy_locale if server_info else None,
            game_settings=state.game_settings if server_info else None,
        )
        return _transition(next_state, effect("SAVE_STORAGE", owner="storage", state=next_state))

    if kind == "NAVIGATE":
        route = payload["route"]
        next_state = _route(state, route, bool(payload.get("push", True)))
        if route == Route.HELP and state.server_info:
            return _transition(
                bump(next_state, busy_operation="help.load", help_page=0),
                effect(
                    "LOAD_HELP",
                    owner="help",
                    slug=state.help_slug,
                    **_selected_transport(state),
                ),
            )
        if route == Route.HELP and not state.server_info:
            slug = state.help_slug
            if not local_help_topic(str(slug or "")):
                slug = LOCAL_HELP_TOPICS[0][0]
            return _transition(
                bump(
                    next_state,
                    help_slug=slug,
                    help_title="",
                    help_body="",
                    help_page=0,
                    busy_operation=None,
                )
            )
        return _transition(next_state)

    if kind == "HELP_LOADED":
        document = payload["document"]
        return _transition(
            bump(
                state,
                help_topics=tuple(payload["topics"]),
                help_slug=str(document["slug"]),
                help_title=str(document["title"]),
                help_body=str(document["body"]),
                help_page=0,
                busy_operation=None,
            )
        )

    if kind == "HELP_TOPIC_SELECTED":
        slug = str(payload["slug"])
        if not state.server_info:
            if not local_help_topic(slug):
                return _transition(state)
            return _transition(
                bump(
                    state,
                    help_slug=slug,
                    help_title="",
                    help_body="",
                    help_page=0,
                    busy_operation=None,
                )
            )
        if not any(topic.get("slug") == slug for topic in state.help_topics):
            return _transition(state)
        return _transition(
            bump(state, help_slug=slug, help_page=0, busy_operation="help.document"),
            effect(
                "LOAD_HELP_DOCUMENT",
                owner="help-document",
                slug=slug,
                **_selected_transport(state),
            ),
        )

    if kind == "HELP_DOCUMENT_LOADED":
        document = payload["document"]
        if str(document["slug"]) != state.help_slug:
            return _transition(state)
        return _transition(
            bump(
                state,
                help_title=str(document["title"]),
                help_body=str(document["body"]),
                help_page=0,
                busy_operation=None,
            )
        )

    if kind == "HELP_PAGE_CHANGED":
        return _transition(bump(state, help_page=max(0, int(payload["page"]))))

    if kind == "COLLECTION_PAGE_CHANGED":
        return _transition(bump(state, collection_page=max(0, int(payload["page"]))))

    if kind == "BACK":
        if state.confirmation:
            return _transition(bump(state, confirmation=None))
        if state.route == Route.HOME:
            return _transition(
                bump(state, route_stack=(), confirmation=_exit_confirmation())
            )
        if state.route == Route.ROOM_SUMMARY_DISPLAY and state.active_room:
            confirmation = Confirmation(
                title_id=strings.ROOM_DISPLAY_LEAVE_TITLE,
                body_id=strings.ROOM_DISPLAY_LEAVE_BODY,
                action_id=strings.LEAVE,
                confirm_action="leave-active",
            )
            return _transition(bump(state, route_stack=(), confirmation=confirmation))
        if state.route in {Route.COUCH_SUMMARY, Route.ROOM_SUMMARY_DISPLAY}:
            return _transition(
                bump(
                    state,
                    route=Route.HOME,
                    route_stack=(),
                    couch_snapshot=None,
                    room_snapshot=None,
                    notification=None,
                )
            )
        if state.route in ACTIVE_ROUTES:
            confirmation = Confirmation(
                title_id=strings.LEAVE_TITLE,
                body_id=strings.LEAVE_BODY,
                action_id=strings.LEAVE,
                confirm_action="leave-active",
            )
            return _transition(bump(state, confirmation=confirmation))
        if state.route_stack:
            return _transition(
                bump(
                    state,
                    route=state.route_stack[-1],
                    route_stack=state.route_stack[:-1],
                    notification=None,
                    collection_page=0,
                )
            )
        if state.active_room is not None:
            confirmation = Confirmation(
                title_id=strings.LEAVE_TITLE,
                body_id=strings.LEAVE_BODY,
                action_id=strings.LEAVE,
                confirm_action="leave-active",
            )
            return _transition(bump(state, confirmation=confirmation))
        if state.route != Route.HOME and state.server_info:
            return _transition(
                bump(state, route=Route.HOME, route_stack=(), notification=None)
            )
        return _transition(bump(state, route_stack=(), confirmation=_exit_confirmation()))

    if kind == "BEGIN_SETUP":
        persistent_access = bool(state.game_settings is not None)
        setup = initial_setup(
            str(payload["topology"]),
            state.profiles,
            state.default_card_locale,
            persistent_access,
        )
        return _transition(
            bump(
                state,
                route=Route.SETUP_GROUP,
                route_stack=(Route.HOME,),
                setup=setup,
                couch_snapshot=None,
                active_room=None,
                room_snapshot=None,
                notification=None,
            )
        )

    if kind == "RESTART_SETUP":
        if not state.setup:
            return _transition(state)
        setup = replace(
            state.setup,
            mode="",
            profile_id="",
            adult_content_confirmed=False,
            selected_player_index=None,
            selected_rule_id=None,
            selected_card_id=None,
            policy_facet=None,
            eligibility=None,
        )
        if state.active_room:
            return _transition(
                bump(
                    state,
                    setup=setup,
                    confirmation=None,
                    busy_operation="room.leave",
                    leave_destination=Route.SETUP_MODE,
                ),
                effect("WS_LEAVE", owner="room", room=state.active_room),
            )
        return _transition(
            bump(
                state,
                route=Route.SETUP_MODE,
                route_stack=_setup_stack(setup.topology, Route.SETUP_MODE),
                setup=setup,
                couch_snapshot=None,
                room_snapshot=None,
                notification=None,
                collection_page=0,
            )
        )

    if kind == "SETUP_REPLACED":
        setup = payload["setup"]
        next_state = bump(state, setup=setup, notification=None)
        if payload.get("preview", True):
            return _transition(
                next_state,
                effect(
                    "ELIGIBILITY_PREVIEW",
                    owner="setup-preview",
                    operation_id=incoming.operation_id,
                    settings=setup.room_settings(),
                    player_count=max(2, len(setup.players)),
                    **_selected_transport(state),
                ),
            )
        return _transition(next_state)

    if kind == "POLICY_EDITOR_TARGET":
        return _transition(
            bump(
                state,
                setup=(
                    replace(
                        state.setup,
                        selected_rule_id=payload.get(
                            "rule_id",
                            state.setup.selected_rule_id if state.setup else None,
                        ),
                        selected_card_id=payload.get(
                            "card_id",
                            state.setup.selected_card_id if state.setup else None,
                        ),
                        policy_facet=payload.get(
                            "facet",
                            state.setup.policy_facet if state.setup else None,
                        ),
                    )
                    if state.setup
                    else None
                ),
            )
        )

    if kind == "TAXONOMY_REQUESTED":
        return _transition(
            bump(
                state,
                taxonomy=None,
                taxonomy_locale=str(payload["locale"]),
            ),
            effect(
                "LOAD_TAXONOMY",
                owner="taxonomy",
                locale=str(payload["locale"]),
                **_selected_transport(state),
            ),
        )

    if kind == "TAXONOMY_LOADED":
        locale = str(payload.get("locale", state.taxonomy_locale or ""))
        if state.taxonomy_locale and locale != state.taxonomy_locale:
            return _transition(state)
        return _transition(
            bump(
                state,
                taxonomy=payload["taxonomy"],
                taxonomy_locale=locale,
            )
        )

    if kind == "ELIGIBILITY_LOADED":
        if payload.get("target") == "room":
            return _transition(bump(state, room_eligibility=payload["preview"]))
        if not state.setup:
            return _transition(state)
        return _transition(bump(state, setup=replace(state.setup, eligibility=payload["preview"])))

    if kind == "CARD_SEARCHED":
        if not state.setup:
            return _transition(state)
        return _transition(
            bump(
                state,
                setup=replace(
                    state.setup,
                    card_search_results=tuple(payload.get("cards", ())),
                    card_search_next_cursor=payload.get("next_cursor"),
                    card_search_total=max(0, int(payload.get("total", 0))),
                ),
                busy_operation=None,
            )
        )

    if kind == "SEARCH_CARDS_REQUESTED":
        if not state.setup:
            return _transition(state)
        setup = replace(
            state.setup,
            card_search_query=str(payload.get("query", state.setup.card_search_query)),
            card_search_cursor=payload.get("cursor"),
        )
        return _transition(
            bump(state, setup=setup, busy_operation="cards.search"),
            effect(
                "SEARCH_SESSION_CARDS",
                owner="card-search",
                operation_id=incoming.operation_id,
                policy=state.setup.card_policy,
                group_id=state.setup.group_id,
                locale=state.setup.card_locale,
                query=str(payload.get("query", "")),
                cursor=payload.get("cursor"),
                **_selected_transport(state),
            ),
        )

    if kind == "CREATE_COUCH_REQUESTED":
        if not state.setup:
            return _transition(state)
        return _transition(
            bump(state, busy_operation="couch.create", notification=None),
            effect(
                "CREATE_COUCH",
                owner="couch",
                request=state.setup.couch_request(),
                **_selected_transport(state),
            ),
        )

    if kind == "COUCH_COMMAND_REQUESTED":
        if not state.couch_snapshot:
            return _transition(state)
        command = str(payload["command"])
        vote_phase = state.couch_vote_phase
        if command == "vote" and vote_phase == "CHOICE":
            # PageUp/PageDown are private ballot shortcuts. Hide the chosen
            # controls synchronously before I/O so Kodi cannot momentarily show
            # which answer was pressed while its list handles the same key.
            vote_phase = "SUBMITTING"
        return _transition(
            bump(
                state,
                busy_operation=f"couch.{command}",
                notification=None,
                couch_vote_phase=vote_phase,
            ),
            effect(
                "COUCH_COMMAND",
                owner="couch",
                command=command,
                session_id=state.couch_snapshot["id"],
                revision=state.couch_snapshot["revision"],
                extra=payload.get("extra", {}),
                **_selected_transport(state),
            ),
        )

    if kind == "COUCH_RESYNC_REQUESTED":
        if not state.couch_snapshot:
            return _transition(state)
        return _transition(
            bump(state, busy_operation="couch.resync", notification=None),
            effect(
                "RESYNC_COUCH",
                owner="couch",
                session_id=state.couch_snapshot["id"],
                **_selected_transport(state),
            ),
        )

    if kind == "CREATE_ROOM_REQUESTED":
        if not state.setup:
            return _transition(state)
        return _transition(
            bump(state, route=Route.ROOM_CREATING, busy_operation="room.create", notification=None),
            effect(
                "CREATE_DISPLAY_ROOM",
                owner="room-create",
                display_name=state.preferences.display_name,
                persistence=state.setup.persistence,
                settings=state.setup.room_settings(),
                **_selected_transport(state),
            ),
        )

    if kind == "JOIN_ROOM_REQUESTED":
        return _transition(
            bump(state, busy_operation="room.join", notification=None),
            effect(
                "JOIN_DISPLAY_ROOM",
                owner="room-create",
                room_code=str(payload["room_code"]),
                display_name=state.preferences.display_name,
                **_selected_transport(state),
            ),
        )

    if kind == "CREATE_GROUP_REQUESTED":
        return_route = state.route_stack[-1] if state.route_stack else Route.GROUP_LIST
        return _transition(
            bump(state, busy_operation="group.create", notification=None),
            effect(
                "CREATE_GROUP",
                owner="groups",
                name=str(payload["name"]),
                members=list(payload.get("members", ())),
                return_route=return_route,
                **_selected_transport(state),
            ),
        )

    if kind == "UPDATE_GROUP_REQUESTED":
        group_id = payload.get("group_id")
        group = next((entry for entry in state.groups if entry.get("id") == group_id), None)
        if not group:
            return _transition(
                bump(state, notification=Text.message(strings.INVALID_CONFIGURATION))
            )
        return_route = state.route_stack[-1] if state.route_stack else Route.GROUP_LIST
        return _transition(
            bump(state, busy_operation="group.update", notification=None),
            effect(
                "UPDATE_GROUP",
                owner="groups",
                group=group,
                name=str(payload["name"]),
                members=list(payload.get("members", ())),
                return_route=return_route,
                **_selected_transport(state),
            ),
        )

    if kind == "RECOVER_REQUESTED":
        if not state.recovery:
            return _transition(state)
        return _transition(
            bump(state, route=Route.BOOTSTRAP, busy_operation="recovery", notification=None),
            effect(
                "RECOVER_ACTIVE",
                owner="recovery",
                recovery=state.recovery,
                **_selected_transport(state),
            ),
        )

    if kind == "DISCARD_RECOVERY":
        reference = state.recovery.credential_reference if state.recovery else None
        return _transition(
            bump(state, recovery=None),
            effect("CLEAR_RECOVERY", owner="storage", credential_reference=reference),
        )

    if kind == "CLEAR_DATA_REQUESTED":
        return _transition(
            bump(
                state,
                preferences=Preferences(),
                servers=(),
                selected_server_id=None,
                server_info=None,
                recovery=None,
                route=Route.SERVER_LIST,
                route_stack=(),
            ),
            effect("CLEAR_ALL_STORAGE", owner="storage"),
        )

    if kind == "CLEAR_RECENT_SERVERS":
        next_state = bump(
            state,
            route=Route.SERVER_LIST,
            route_stack=(),
            servers=(),
            selected_server_id=None,
            server_info=None,
            profiles=(),
            groups=(),
            locales=(),
            taxonomy=None,
            taxonomy_locale=None,
            game_settings=None,
            setup=None,
            authorization=None,
            confirmation=None,
            notification=None,
            collection_page=0,
        )
        return _transition(
            next_state,
            effect("SAVE_STORAGE", owner="storage", state=next_state),
            effect("DISCOVER_SERVERS", owner="discovery"),
        )

    if kind == "OPERATION_STARTED":
        return _transition(
            bump(
                state,
                busy_operation=str(payload["name"]),
                route=payload.get("route", state.route),
                notification=None,
            )
        )

    if kind == "COUCH_CREATED":
        snapshot = payload["snapshot"]
        recovery = payload["recovery"]
        next_state = bump(
            state,
            route=Route.COUCH_GAME,
            route_stack=(),
            couch_snapshot=snapshot,
            recovery=recovery,
            busy_operation=None,
            notification=None,
            couch_vote_player_id=None,
            couch_vote_phase="SELECT",
            couch_sync_required=False,
            couch_pool_exhausted=False,
            couch_end_destination=None,
            auto_page=0,
            auto_page_epoch=state.auto_page_epoch + 1,
            collection_page=0,
            card_page=0,
        )
        return _transition(next_state)

    if kind == "COUCH_UPDATED":
        snapshot = payload["snapshot"]
        reset_result_page = _named_result_changed(state.couch_snapshot, snapshot)
        reset_card_page = _card_identity(state.couch_snapshot) != _card_identity(snapshot)
        previous_session_state = (state.couch_snapshot or {}).get("state")
        reset_voter_page = reset_card_page or (
            snapshot.get("state") == "COLLECTING_ANSWERS"
            and previous_session_state != "COLLECTING_ANSWERS"
        )
        ended = snapshot.get("state") == "ENDED"
        route = state.couch_end_destination if ended and state.couch_end_destination else None
        route = route or (Route.COUCH_SUMMARY if ended else Route.COUCH_GAME)
        selected_vote = state.couch_vote_player_id
        if selected_vote in snapshot.get("votedPlayerIds", ()):
            selected_vote = None
        vote_phase = state.couch_vote_phase
        if selected_vote is None:
            vote_phase = "SELECT"
        elif vote_phase == "SUBMITTING":
            # A successful refresh that did not record the vote is definitive:
            # return to the private choice without retaining either selection.
            vote_phase = "CHOICE"
        destination_stack = () if ended else state.route_stack
        if ended and route in {Route.SETUP_CUSTOMIZE, Route.SETUP_MODE} and state.setup:
            destination_stack = _setup_stack(state.setup.topology, route)
        next_state = bump(
            state,
            couch_snapshot=None if ended and state.couch_end_destination else snapshot,
            route=route,
            route_stack=destination_stack,
            busy_operation=None,
            notification=None,
            transport_state="CONNECTED",
            recovery=None if ended else state.recovery,
            couch_vote_player_id=selected_vote,
            couch_vote_phase=vote_phase,
            couch_sync_required=False,
            couch_pool_exhausted=False,
            couch_end_destination=None,
            auto_page=0 if reset_result_page else state.auto_page,
            auto_page_epoch=(
                state.auto_page_epoch + 1
                if reset_result_page
                else state.auto_page_epoch
            ),
            collection_page=0 if reset_voter_page else state.collection_page,
            card_page=0 if reset_card_page else state.card_page,
        )
        if ended:
            return _transition(next_state, effect("CLEAR_RECOVERY", owner="storage-recovery"))
        return _transition(next_state)

    if kind == "COUCH_VOTE_PLAYER_SELECTED":
        return _transition(
            bump(
                state,
                couch_vote_player_id=str(payload["player_id"]),
                # Collection is identical for both reveal modes. Only the
                # completed-result projection differs, so selecting a voter
                # always opens that person's ballot directly.
                couch_vote_phase="CHOICE",
            )
        )

    if kind == "COUCH_VOTE_CANCELLED":
        if state.couch_vote_phase == "SUBMITTING":
            return _transition(state)
        return _transition(
            bump(
                state,
                couch_vote_player_id=None,
                couch_vote_phase="SELECT",
            )
        )

    if kind == "ROOM_JOINED":
        active_room = payload["room"]
        recovery = payload["recovery"]
        next_state = bump(
            state,
            route=Route.ROOM_LOBBY_DISPLAY,
            route_stack=(),
            active_room=active_room,
            room_snapshot=None,
            room_eligibility=None,
            room_eligibility_signature=None,
            qr_path=None,
            recovery=recovery,
            transport_state="CONNECTING",
            busy_operation=None,
            notification=None,
            auto_page=0,
            auto_page_epoch=state.auto_page_epoch + 1,
        )
        return _transition(
            next_state,
            effect(
                "WS_CONNECT",
                owner="room",
                room=active_room,
                **_selected_transport(next_state),
            ),
            effect(
                "GENERATE_ROOM_QR",
                owner="room-qr",
                room_code=active_room.room_code,
                **_selected_transport(next_state),
            ),
        )

    if kind == "WS_STATE":
        return _transition(
            bump(
                state,
                transport_state=str(payload["state"]),
                notification=_notice(payload) if payload.get("message") or payload.get("message_id") else state.notification,
            )
        )

    if kind == "WS_ENVELOPE":
        return _websocket_event(state, payload["envelope"])

    if kind == "QR_READY":
        if not state.active_room:
            return _transition(state)
        return _transition(bump(state, qr_path=str(payload["path"])))

    if kind == "ROOM_CLOSED":
        reference = state.active_room.credential_reference if state.active_room else None
        return _transition(
            bump(
                state,
                route=Route.HOME,
                route_stack=(),
                active_room=None,
                room_snapshot=None,
                room_eligibility=None,
                room_eligibility_signature=None,
                transport_state="DISCONNECTED",
                recovery=None,
                qr_path=None,
                notification=_notice(payload, strings.ROOM_CLOSED),
            ),
            effect(
                "CLEAR_RECOVERY",
                owner="storage-recovery",
                credential_reference=reference,
            ),
            effect("CLEAR_ROOM_QR", owner="room-qr"),
        )

    if kind == "LEAVE_ACTIVE":
        if state.active_room:
            return _transition(
                bump(
                    state,
                    confirmation=None,
                    busy_operation="room.leave",
                    leave_destination=payload.get("destination", Route.HOME),
                ),
                effect("WS_LEAVE", owner="room", room=state.active_room),
            )
        if state.couch_snapshot:
            return _transition(
                bump(state, confirmation=None, busy_operation="couch.end"),
                effect(
                    "COUCH_COMMAND",
                    owner="couch",
                    command="end",
                    session_id=state.couch_snapshot["id"],
                    revision=state.couch_snapshot["revision"],
                    **_selected_transport(state),
                ),
            )
        return _transition(state)

    if kind == "END_COUCH_FOR_SETUP":
        if not state.couch_snapshot or not state.setup:
            return _transition(state)
        return _transition(
            bump(
                state,
                confirmation=None,
                busy_operation="couch.end",
                couch_end_destination=Route.SETUP_CUSTOMIZE,
            ),
            effect(
                "COUCH_COMMAND",
                owner="couch",
                command="end",
                session_id=state.couch_snapshot["id"],
                revision=state.couch_snapshot["revision"],
                **_selected_transport(state),
            ),
        )

    if kind == "LEAVE_COMPLETED":
        reference = state.active_room.credential_reference if state.active_room else None
        destination = state.leave_destination
        destination_stack: tuple[Route, ...] = ()
        if state.setup and destination in {
            Route.SETUP_MODE,
            Route.SETUP_CUSTOMIZE,
            Route.SETUP_REVIEW,
        }:
            destination_stack = _setup_stack(state.setup.topology, destination)
        return _transition(
            bump(
                state,
                route=destination,
                route_stack=destination_stack,
                active_room=None,
                room_snapshot=None,
                room_eligibility=None,
                room_eligibility_signature=None,
                couch_snapshot=None,
                recovery=None,
                qr_path=None,
                busy_operation=None,
                transport_state="CONNECTED" if state.server_info else "DISCONNECTED",
                leave_destination=Route.HOME,
            ),
            effect(
                "CLEAR_RECOVERY",
                owner="storage-recovery",
                credential_reference=reference,
            ),
            effect("CLEAR_ROOM_QR", owner="room-qr"),
        )

    if kind == "PREFERENCES_CHANGED":
        preferences = payload["preferences"]
        next_state = bump(state, preferences=preferences)
        return _transition(next_state, effect("SAVE_STORAGE", owner="storage", state=next_state))

    if kind == "DIAGNOSTICS_REQUESTED":
        return _transition(state, effect("LOAD_DIAGNOSTICS", owner="diagnostics"))

    if kind == "DIAGNOSTICS_LOADED":
        return _transition(bump(state, diagnostics=tuple(payload.get("entries", ()))))

    if kind == "GROUPS_LOADED":
        route = payload.get("route", state.route)
        destination = route
        groups = tuple(payload["groups"])
        setup = state.setup
        selected_group_id = payload.get("selected_group_id")
        if setup and route == Route.SETUP_GROUP and selected_group_id:
            selected_group = next(
                (entry for entry in groups if entry.get("id") == selected_group_id),
                None,
            )
            if selected_group:
                setup = replace(
                    setup,
                    group_choice="SAVED",
                    group_id=str(selected_group_id),
                    persistence=DATASPACE_SESSION_PERSISTENCE,
                    players=tuple(selected_group.get("members", ())),
                )
                destination = Route.SETUP_MODE
        stack = state.route_stack
        if destination == route and route != state.route and stack and stack[-1] == route:
            stack = stack[:-1]
        return _transition(
            bump(
                state,
                groups=groups,
                setup=setup,
                busy_operation=None,
                group_draft_id=None,
                group_draft_name="",
                group_draft_members=(),
                group_draft_member_index=None,
                route=destination,
                route_stack=stack,
                collection_page=0,
            )
        )

    if kind == "GROUP_DRAFT_STARTED":
        group = payload.get("group")
        if group is None:
            return _transition(
                bump(
                    state,
                    group_draft_id=None,
                    group_draft_name="",
                    group_draft_members=(),
                    group_draft_member_index=None,
                    collection_page=0,
                )
            )
        return _transition(
            bump(
                state,
                group_draft_id=str(group["id"]),
                group_draft_name=str(group.get("name", "")),
                group_draft_members=tuple(group.get("members", ())),
                group_draft_member_index=None,
                collection_page=0,
            )
        )

    if kind == "GROUP_DRAFT_UPDATED":
        return _transition(
            bump(
                state,
                group_draft_name=str(payload.get("name", state.group_draft_name)),
                group_draft_members=tuple(payload.get("members", state.group_draft_members)),
                group_draft_member_index=payload.get(
                    "member_index", state.group_draft_member_index
                ),
            )
        )

    if kind == "AUTHORIZATION_UPDATED":
        return _transition(bump(state, authorization=payload["authorization"], busy_operation=None))

    if kind == "AUTH_LINK_REQUESTED":
        return _transition(
            bump(state, busy_operation="authorization.begin", notification=None),
            effect("AUTHORIZE_DEVICE", owner="authorization", **_selected_transport(state)),
        )

    if kind == "AUTHORIZATION_PENDING":
        return _transition(
            bump(
                state,
                authorization=payload["authorization"],
                qr_path=str(payload["qr_path"]),
                busy_operation="authorization.poll",
                notification=None,
            )
        )

    if kind == "AUTHORIZATION_COMPLETE":
        next_state = bump(
            state,
            authorization=payload["authorization"],
            qr_path=None,
            busy_operation="metadata.load",
            notification=Text.message(strings.AUTHORIZATION_COMPLETE),
        )
        return _transition(
            next_state,
            effect("LOAD_METADATA", owner="server", **_selected_transport(next_state)),
        )

    if kind == "AUTH_CANCEL_REQUESTED":
        return _transition(
            bump(
                state,
                authorization=None,
                qr_path=None,
                busy_operation=None,
                route=Route.PREFERENCES,
                route_stack=tuple(
                    route for route in state.route_stack if route != Route.DEVICE_LINK
                ),
            ),
            effect("AUTH_CANCEL", owner="authorization"),
        )

    if kind == "AUTHORIZATION_CANCELLED":
        return _transition(bump(state, authorization=None, qr_path=None, busy_operation=None))

    if kind == "AUTH_UNLINK_REQUESTED":
        return _transition(
            bump(state, confirmation=None, busy_operation="authorization.unlink"),
            effect("UNLINK_DEVICE", owner="authorization", **_selected_transport(state)),
        )

    if kind == "AUTHORIZATION_UNLINKED":
        setup = state.setup
        if setup and setup.group_id:
            setup = replace(
                setup, group_id=None, persistence=EPHEMERAL_SESSION_PERSISTENCE
            )
        next_state = bump(
            state,
            authorization=None,
            groups=(),
            game_settings=None,
            setup=setup,
            qr_path=None,
            busy_operation="metadata.load",
            notification=None,
        )
        return _transition(
            next_state,
            effect("LOAD_METADATA", owner="server", **_selected_transport(next_state)),
        )

    if kind == "CONFIRM":
        confirmation = Confirmation(
            title_id=int(payload["title_id"]),
            body_id=int(payload["body_id"]),
            action_id=int(payload["action_id"]),
            confirm_action=str(payload["confirm_action"]),
        )
        return _transition(bump(state, confirmation=confirmation))

    if kind == "CANCEL_CONFIRMATION":
        return _transition(bump(state, confirmation=None))

    if kind == "NOTIFY":
        return _transition(bump(state, notification=_notice(payload)))

    if kind == "CLEAR_NOTIFICATION":
        return _transition(bump(state, notification=None))

    if kind == "OPERATION_FAILED":
        code = payload.get("code")
        if state.couch_snapshot and code == "CARD_POOL_EXHAUSTED":
            return _transition(
                bump(
                    state,
                    busy_operation=None,
                    notification=Text.message(strings.POOL_EXHAUSTED),
                    couch_pool_exhausted=True,
                    couch_sync_required=False,
                )
            )
        if state.couch_snapshot and code == "COUCH_STATE_UNRESOLVED":
            return _transition(
                bump(
                    state,
                    busy_operation=None,
                    notification=Text.message(strings.COUCH_SYNC_REQUIRED),
                    couch_sync_required=True,
                    transport_state="RECONNECTING",
                )
            )
        return _transition(
            bump(
                state,
                busy_operation=None,
                notification=_notice(payload),
                transport_state=payload.get("transport_state", state.transport_state),
                couch_vote_phase=(
                    "CHOICE"
                    if state.busy_operation == "couch.vote"
                    and state.couch_vote_phase == "SUBMITTING"
                    else state.couch_vote_phase
                ),
            )
        )

    if kind == "STOP":
        if state.lifecycle == "STOPPING":
            return _transition(state)
        return _transition(
            bump(state, lifecycle="STOPPING"),
            effect("SHUTDOWN", owner="lifecycle"),
        )

    return _transition(state)


def _websocket_event(state: AppState, envelope: dict[str, Any]) -> Transition:
    event_type = envelope.get("type")
    payload = envelope.get("payload", {})
    if event_type == "server.hello":
        if payload.get("role") != "DISPLAY":
            return _transition(
                bump(
                    state,
                    transport_state="ERROR",
                    notification=Text.message(strings.ROLE_SECURITY_ERROR),
                ),
                effect("WS_DISCONNECT", owner="room"),
            )
        if not state.active_room:
            return _transition(state)
        room = replace(state.active_room, role="DISPLAY")
        return _transition(bump(state, active_room=room, transport_state="CONNECTED"))
    if event_type == "room.snapshot":
        snapshot = payload
        session = snapshot.get("session")
        previous_session = (state.room_snapshot or {}).get("session")
        reset_result_page = _named_result_changed(previous_session, session)
        reset_card_page = _card_identity(previous_session) != _card_identity(session)
        settings_changed_by_other = _room_settings_changed_by_other_participant(
            state, snapshot
        )
        if session and session.get("state") == "ENDED":
            route = Route.ROOM_SUMMARY_DISPLAY
        elif session:
            route = Route.ROOM_GAME_DISPLAY
        else:
            route = Route.ROOM_LOBBY_DISPLAY
        entering_game = previous_session is None and route == Route.ROOM_GAME_DISPLAY
        returning_to_lobby = (
            isinstance(previous_session, dict)
            and previous_session.get("state") == "ENDED"
            and route == Route.ROOM_LOBBY_DISPLAY
        )
        reset_auto_page = reset_result_page or entering_game or returning_to_lobby
        previous_host_state = (
            (state.room_snapshot or {}).get("hostStatus", {}).get("state")
        )
        host_status = snapshot.get("hostStatus", {})
        # Event notices such as participant departures and Card replacement
        # arrive immediately before the fresh snapshot. Preserve them instead
        # of clearing them before Kodi gets a render tick.
        notification = state.notification
        if (
            host_status.get("state") == CONNECTED_HOST_STATE
            and previous_host_state
            in PRE_CONNECTION_HOST_STATES
        ):
            notification = Text.message(
                strings.HOST_CONNECTED,
                host_status.get("displayName", ""),
            )
        if settings_changed_by_other:
            notification = Text.message(strings.ROOM_SETTINGS_CHANGED)
        settings = snapshot.get("settings")
        player_count = _room_player_count(snapshot)
        signature = None
        preview_effects: tuple[Effect, ...] = ()
        room_eligibility = state.room_eligibility
        if not session and isinstance(settings, dict):
            signature = f"{settings.get('revision', 0)}:{player_count}"
            if signature != state.room_eligibility_signature or room_eligibility is None:
                room_eligibility = None
                preview_settings = {
                    key: value
                    for key, value in settings.items()
                    if key not in {"revision", "updatedByParticipantId"}
                }
                preview_effects = (
                    effect(
                        "ELIGIBILITY_PREVIEW",
                        owner="room-preview",
                        target="room",
                        settings=preview_settings,
                        player_count=player_count,
                        **_selected_transport(state),
                    ),
                )
        taxonomy_effects: tuple[Effect, ...] = ()
        settings_locale = settings.get("cardLocale") if isinstance(settings, dict) else None
        if settings_locale and settings_locale != state.taxonomy_locale:
            taxonomy_effects = (
                effect(
                    "LOAD_TAXONOMY",
                    owner="room-taxonomy",
                    locale=str(settings_locale),
                    **_selected_transport(state),
                ),
            )
        next_state = bump(
            state,
            room_snapshot=snapshot,
            taxonomy=None if taxonomy_effects else state.taxonomy,
            taxonomy_locale=(
                str(settings_locale) if taxonomy_effects else state.taxonomy_locale
            ),
            room_eligibility=room_eligibility,
            room_eligibility_signature=signature,
            route=route,
            route_stack=() if session and session.get("state") == "ENDED" else state.route_stack,
            transport_state="CONNECTED",
            notification=notification,
            auto_page=0 if reset_auto_page else state.auto_page,
            auto_page_epoch=(
                state.auto_page_epoch + 1
                if reset_auto_page
                else state.auto_page_epoch
            ),
            card_page=0 if reset_card_page else state.card_page,
        )
        return _transition(next_state, *preview_effects, *taxonomy_effects)
    if event_type == "room.roleChanged":
        if payload.get("role") != "DISPLAY":
            return _transition(
                bump(state, notification=Text.message(strings.ROLE_SECURITY_ERROR)),
                effect("WS_DISCONNECT", owner="room"),
            )
        return _transition(state)
    if event_type == "room.participantLeft":
        name = str(payload.get("displayName", ""))
        message_id = (
            strings.PARTICIPANT_REMOVED
            if payload.get("reason") == DISCONNECT_EXPIRED_PARTICIPANT_REASON
            else strings.PARTICIPANT_LEFT
        )
        return _transition(bump(state, notification=Text.message(message_id, name)))
    if event_type == "session.cardReplaced":
        message_id = (
            strings.CARD_VETOED
            if payload.get("reason") == VETOED_CARD_REPLACEMENT_REASON
            else strings.CARD_SKIPPED
        )
        return _transition(bump(state, notification=Text.message(message_id)))
    if event_type == "error":
        code = payload.get("code")
        if code == "STALE_SESSION_REVISION":
            return _transition(
                bump(state, notification=Text.message(strings.STALE_REFRESH)),
                effect("WS_SNAPSHOT", owner="room"),
            )
        return _transition(bump(state, notification=_notice(payload)))
    return _transition(state)


def _named_result_changed(previous: Any, current: Any) -> bool:
    current_signature = _named_result_signature(current)
    if current_signature is None:
        return False
    return current_signature != _named_result_signature(previous)


def _named_result_signature(snapshot: Any) -> Any:
    if not isinstance(snapshot, dict):
        return None
    voting = snapshot.get("neverHaveIEverVoting")
    if not isinstance(voting, dict) or voting.get("revealMode") != NAMED_REVEAL_MODE:
        return None
    result = voting.get("result")
    if not isinstance(result, dict) or not isinstance(result.get("namedAnswers"), list):
        return None
    card = snapshot.get("currentCard")
    card_id = card.get("id") if isinstance(card, dict) else None
    answers = tuple(
        (entry.get("playerId"), entry.get("vote"))
        for entry in result["namedAnswers"]
        if isinstance(entry, dict)
    )
    return (
        card_id,
        snapshot.get("roundNumber"),
        result.get("yes"),
        result.get("no"),
        result.get("total"),
        answers,
    )
