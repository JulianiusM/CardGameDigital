#!/usr/bin/env python3
r"""Development-only real-Kodi visual fixtures.

The release packager excludes ``clients/kodi/tools``.  Install the unpacked add-on and
ask Kodi to execute this file with exactly one scenario argument, for example::

    RunScript(C:\path\to\script.partycard.tv\tools\visual_fixture.py,lobby-worst-first)

The script uses the production ``MainWindow``, ``Application`` controller, presentation
mapping, localization catalogs, and skin.  It replaces only the startup state and
suppresses fixture actions that would contact a server.  Arrow keys/D-pad, OK, Context,
Page Up, and Page Down therefore still enter through ``MainWindow``.  Physical Back
closes the fixture immediately.

Run this file with ``--list`` or ``--check`` under ordinary CPython; neither command
imports Kodi modules.
"""

from __future__ import annotations

import copy
import sys
import tempfile
import time
from dataclasses import replace
from pathlib import Path
from typing import Callable


CLIENT_ROOT = Path(__file__).resolve().parents[1]
RESOURCES_ROOT = CLIENT_ROOT / "resources"
if str(RESOURCES_ROOT) not in sys.path:
    sys.path.insert(0, str(RESOURCES_ROOT))

from lib import strings  # noqa: E402
from lib.actions import action  # noqa: E402
from lib.app import (  # noqa: E402
    GAME_ROSTER_LABEL_WIDTH,
    MARQUEE_FINAL_HOLD_SECONDS,
    MARQUEE_INITIAL_HOLD_SECONDS,
    MARQUEE_SCROLL_PIXELS_PER_SECOND,
    ROSTER_NAME_MAX_GLYPH_WIDTH,
    Application,
    auto_page_interval_seconds,
)
from lib.presentation import (  # noqa: E402
    COLLECTION_PAGE_SIZE,
    COUCH_VOTER_PAGE_SIZE,
    GAME_ROSTER_PAGE_SIZE,
    LOBBY_ROSTER_PAGE_SIZE,
    NAMED_RESULT_COLUMN_PAGE_SIZE,
    present,
)
from lib.reducer import reduce  # noqa: E402
from lib.routes import Route  # noqa: E402
from lib.state import (  # noqa: E402
    ActiveRoom,
    AppState,
    Preferences,
    RecoveryEnvelope,
    ServerRecord,
    initial_setup,
)


ADDON_ID = "script.partycard.tv"
ROOM_CODE = "ABC234"
MAXIMUM_COUNTER = 9_007_199_254_740_991
MAXIMUM_NAME_LENGTH = 40
SUPPORTED_FIXTURE_LOCALES = ("en-GB", "de-DE")
ROOM_PLAYER_COUNT = 1_000
ROOM_PARTICIPANT_COUNT = ROOM_PLAYER_COUNT // 2
LOBBY_LAST_PAGE = (ROOM_PLAYER_COUNT - 1) // LOBBY_ROSTER_PAGE_SIZE
LOBBY_MIDDLE_PAGE = LOBBY_LAST_PAGE // 2 + 1
GAME_LAST_PAGE = (ROOM_PLAYER_COUNT - 1) // GAME_ROSTER_PAGE_SIZE
GAME_MIDDLE_PAGE = GAME_LAST_PAGE // 2 + 1
COUCH_VOTER_LAST_PAGE = (ROOM_PLAYER_COUNT - 1) // COUCH_VOTER_PAGE_SIZE
NAMED_LAST_PAGE = (
    ROOM_PLAYER_COUNT // 2 - 1
) // NAMED_RESULT_COLUMN_PAGE_SIZE
NAMED_MIDDLE_PAGE = NAMED_LAST_PAGE // 2
FIXTURE_ROOM = ActiveRoom(
    "00000000-0000-4000-8000-000000000001",
    ROOM_CODE,
    "00000000-0000-4000-8000-000000000002",
    "fixture-reference",
    "DISPLAY",
    "DISPLAY_WAITING_FOR_HOST",
)


def _fixture_uuid(index: int) -> str:
    return f"00000000-0000-4000-8000-{index:012x}"


def _maximum_name(prefix: str, index: int) -> str:
    stem = f"{prefix}{index:04d}"
    return stem + (prefix * (MAXIMUM_NAME_LENGTH - len(stem)))


def _configuration() -> dict:
    return {
        "enabledQuestionCategoryIds": [
            "CAT_EVERYDAY",
            "CAT_CHILDHOOD",
            "CAT_PERSONALITY",
            "CAT_SCENARIO",
            "CAT_FRIENDSHIP",
            "CAT_RELATIONSHIP",
            "CAT_BODY",
            "CAT_SEXUALITY",
            "CAT_SEX_OPENNESS",
            "CAT_INTOXICATION",
        ],
        "enabledDareTypeIds": [
            "DARE_SILLY",
            "DARE_OTHER",
            "DARE_TOUCH",
            "DARE_TOUCH_SPICY",
        ],
        "blockedOperationalFlags": [
            "INVOLVES_THIRD_PARTY",
            "INVOLVES_ALCOHOL",
            "INVOLVES_RECREATIONAL_SUBSTANCES",
            "REMOVES_CLOTHING",
            "REQUIRES_NUDITY",
        ],
        "maximumSocialSensitivity": "EXPLICIT",
        "startingIntensity": 5,
        "maximumIntensity": 5,
        "intensityProgressionUnit": "CARDS",
        "intensityProgressionInterval": 100,
        "intensityProgressionIncrement": 5,
        "randomQuestionRatio": 0.5,
        "maximumTypeStreak": 100,
        "letsTalkMetaInterval": 100,
    }


FIXTURE_TAXONOMY = {
    "questionCategories": [
        {"id": "CAT_RELATIONSHIP", "label": "Relationships"},
        {"id": "CAT_SEX_TENSION", "label": "Sexual tension"},
    ],
    "dareTypes": [],
}

GERMAN_FIXTURE_TAXONOMY = {
    "questionCategories": [
        {"id": "CAT_RELATIONSHIP", "label": "Beziehungen"},
        {"id": "CAT_SEX_TENSION", "label": "Sexuelle Spannung"},
    ],
    "dareTypes": [],
}


def _profile(index: int, spicy: bool = False) -> dict:
    profile_id = "PROFILE_SPICY" if spicy else f"PROFILE_FIXTURE_{index:02d}"
    name = "Spicy" if spicy else f"Fixture profile {index + 1}"
    if spicy:
        description = (
            "For adults who want the boldest questions and dares, explicit topics, "
            "intimate conversations, and deliberately challenging social prompts "
            "without hiding any important explanation from the selection card."
        )
    else:
        description = (
            f"Profile {index + 1} keeps its complete multi-line explanation visible "
            "while the D-pad moves across a paginated collection of profile cards."
        )
    return {
        "id": profile_id,
        "name": name,
        "description": description,
        "requiresAdultConfirmation": spicy,
        **_configuration(),
    }


PROFILES = tuple([_profile(0, spicy=True)] + [_profile(index) for index in range(1, 10)])
GROUPS = (
    {
        "id": "00000000-0000-4000-8000-000000000100",
        "name": _maximum_name("G", 0),
        "members": [_maximum_name("M", index) for index in range(20)],
    },
)
LOCALES = (
    {"id": "en-GB", "nativeName": "English (United Kingdom)"},
    {"id": "de-DE", "nativeName": "Deutsch (Deutschland)"},
)
SERVER = ServerRecord(
    "12345678-1234-4234-8234-123456789abc",
    "http://127.0.0.1:3000",
    "W" * 80,
    "local",
    "manual",
    1.0,
    capabilities={"displayBootstrapRoomCreation": True},
    endpoints={"roomJoinPathTemplate": "/play/?room={roomCode}"},
)
LONG_HOSTNAME = ("h" * 63) + ".example.test"
JOIN_BASE_URLS = (
    "http://127.0.0.1:3000",
    f"https://{LONG_HOSTNAME}:3000",
    "http://192.168.100.200:3000",
    "http://[fd00::1234]:3000",
    "https://fifth-address.party.example.test:30443",
    "https://sixth-address.party.example.test:30443",
)
SERVER_INFO = {
    "version": 1,
    "serverId": SERVER.server_id,
    "displayName": SERVER.display_name,
    "deploymentMode": "local",
    "protocolVersions": [2],
    "capabilities": {
        "displayBootstrapRoomCreation": True,
        "nativeDeviceAuthorization": False,
    },
    "roomAccess": {
        "configuredBaseUrl": None,
        "availableBaseUrls": list(JOIN_BASE_URLS),
    },
    "endpoints": {
        "apiBasePath": "/api/v1",
        "webSocketPath": "/ws",
        "roomJoinPathTemplate": "/play/?room={roomCode}",
    },
}


def _maximum_room_roster() -> tuple[list[dict], list[dict]]:
    participants: list[dict] = []
    players: list[dict] = []
    for index in range(ROOM_PARTICIPANT_COUNT):
        participant_id = _fixture_uuid(1_000 + index)
        player_id = _fixture_uuid(2_000 + index)
        owner_name = _maximum_name("W", index)
        player_name = _maximum_name("W", index + ROOM_PARTICIPANT_COUNT)
        participants.append(
            {
                "id": participant_id,
                "roomId": FIXTURE_ROOM.room_id,
                "role": "HOST" if index == 0 else "PLAYER",
                "displayName": owner_name,
                "connectionStatus": "CONNECTED",
                "devicePlayers": [{"id": player_id, "name": player_name}],
            }
        )
        players.extend(
            (
                {"id": participant_id, "name": owner_name},
                {"id": player_id, "name": player_name},
            )
        )
    return participants, players


ROOM_PARTICIPANTS, ROOM_PLAYERS = _maximum_room_roster()
ROOM_NAMES = tuple(player["name"] for player in ROOM_PLAYERS)


def _preferences() -> Preferences:
    return Preferences(
        locale="en-GB",
        auto_page_seconds=15,
        display_name="Kodi visual fixture",
        last_server_id=SERVER.server_id,
    )


def _base_state(route: Route, **changes) -> AppState:
    return AppState(
        lifecycle="RUNNING",
        route=route,
        preferences=_preferences(),
        taxonomy=FIXTURE_TAXONOMY,
        **changes,
    )


def _help_body(topic: str, locale: str = "en-GB") -> str:
    paragraphs = []
    for index in range(1, 13):
        if locale == "de-DE":
            paragraphs.append(
                f"{topic}, Abschnitt {index}. "
                "Dieser deterministische Absatz prüft, ob vollständige deutsche Sätze "
                "lesbar bleiben, der Seiteninhalt die verfügbare Höhe nutzt und die "
                "horizontale Steuerkreuz-Navigation die vorherige oder nächste Seite "
                "erreicht, ohne zuvor jedes Hilfethema durchlaufen zu müssen. "
                "Jede Seite endet für die Sichtprüfung an einer beabsichtigten Satzgrenze."
            )
        else:
            paragraphs.append(
                f"{topic}, section {index}. "
                "This deterministic paragraph verifies that complete sentences remain "
                "readable, that the page body uses the available height, and that horizontal "
                "D-pad movement reaches the previous and next page controls without walking "
                "through every topic first. "
                "Every page ends at a deliberate sentence boundary for visual review."
            )
    return "\n\n".join(paragraphs)


def _help_long() -> AppState:
    topics = tuple(
        {
            "slug": f"fixture-topic-{index:02d}",
            "title": f"Visual help topic {index + 1}",
        }
        for index in range(12)
    )
    selected = topics[5]
    return _base_state(
        Route.HELP,
        route_stack=(Route.HOME,),
        servers=(SERVER,),
        selected_server_id=SERVER.server_id,
        server_info=SERVER_INFO,
        help_topics=topics,
        help_slug=selected["slug"],
        help_title=selected["title"],
        help_body=_help_body(selected["title"]),
        help_page=0,
    )


def _neutral_setup():
    setup = initial_setup("COUCH", PROFILES, "en-GB", True)
    return replace(setup, mode="CLASSIC_TRUTH_OR_DARE")


def _setup_profile_unselected() -> AppState:
    setup = _neutral_setup()
    if setup.profile_id:
        raise AssertionError("Profile fixture must start without a selected profile")
    return _base_state(
        Route.SETUP_PROFILE,
        route_stack=(Route.HOME, Route.SETUP_GROUP, Route.SETUP_MODE),
        profiles=PROFILES,
        locales=LOCALES,
        setup=setup,
    )


def _setup_paginated() -> AppState:
    setup = replace(
        _neutral_setup(),
        profile_id=PROFILES[1]["id"],
        configuration=_configuration(),
        players=tuple(_maximum_name("W", index) for index in range(20)),
    )
    return _base_state(
        Route.SETUP_PLAYERS,
        route_stack=(
            Route.HOME,
            Route.SETUP_GROUP,
            Route.SETUP_MODE,
            Route.SETUP_PROFILE,
        ),
        profiles=PROFILES,
        locales=LOCALES,
        setup=setup,
        collection_page=1,
    )


def _setup_intensity() -> AppState:
    setup = replace(
        _neutral_setup(),
        profile_id=PROFILES[1]["id"],
        configuration=_configuration(),
    )
    return _base_state(
        Route.SETUP_INTENSITY,
        route_stack=(
            Route.HOME,
            Route.SETUP_GROUP,
            Route.SETUP_MODE,
            Route.SETUP_PROFILE,
            Route.SETUP_CUSTOMIZE,
        ),
        profiles=PROFILES,
        locales=LOCALES,
        setup=setup,
    )


def _setup_card_policy() -> AppState:
    setup = replace(
        _neutral_setup(),
        profile_id=PROFILES[1]["id"],
        configuration=_configuration(),
    )
    return _base_state(
        Route.SETUP_CARD_POLICY,
        route_stack=(
            Route.HOME,
            Route.SETUP_GROUP,
            Route.SETUP_MODE,
            Route.SETUP_PROFILE,
            Route.SETUP_CUSTOMIZE,
        ),
        profiles=PROFILES,
        locales=LOCALES,
        setup=setup,
    )


def _setup_card_rule_values() -> AppState:
    rule_id = _fixture_uuid(7_500)
    setup = replace(
        _neutral_setup(),
        profile_id=PROFILES[1]["id"],
        configuration=_configuration(),
        card_policy={
            "scopeDefault": {},
            "conditionalRules": [
                {
                    "id": rule_id,
                    "name": "Every topic",
                    "order": 0,
                    "enabled": True,
                    "predicate": {"questionCategoryIds": ["CAT_RELATIONSHIP"]},
                    "directives": {},
                }
            ],
            "exactCards": [],
        },
        selected_rule_id=rule_id,
        policy_facet="questionCategoryIds",
    )
    return _base_state(
        Route.SETUP_POLICY_VALUES,
        route_stack=(
            Route.HOME,
            Route.SETUP_GROUP,
            Route.SETUP_MODE,
            Route.SETUP_PROFILE,
            Route.SETUP_CUSTOMIZE,
            Route.SETUP_CARD_POLICY,
            Route.SETUP_POLICY_RULES,
            Route.SETUP_POLICY_RULE,
            Route.SETUP_POLICY_PREDICATE,
        ),
        profiles=PROFILES,
        locales=LOCALES,
        setup=setup,
    )


EXACT_SEARCH_TOTAL = COLLECTION_PAGE_SIZE * 3 + 1


def _exact_search_setup(page: int):
    bounded_page = max(0, min(3, page))
    first = bounded_page * COLLECTION_PAGE_SIZE
    count = min(COLLECTION_PAGE_SIZE, EXACT_SEARCH_TOTAL - first)
    cards = tuple(
        {
            "id": _fixture_uuid(8_000 + first + index),
            "text": (
                f"Have you ever reached deterministic search result {first + index + 1}? "
                "The complete two-line Card summary remains visible for exact selection."
            ),
        }
        for index in range(count)
    )
    history = tuple(_fixture_uuid(9_000 + index) for index in range(bounded_page))
    return replace(
        _neutral_setup(),
        profile_id=PROFILES[1]["id"],
        configuration=_configuration(),
        card_search_query="Have you ever",
        card_search_results=cards,
        card_search_cursor=(history[-1] if history else None),
        card_search_next_cursor=(
            _fixture_uuid(9_100 + bounded_page) if bounded_page < 3 else None
        ),
        card_search_cursor_history=history,
        card_search_total=EXACT_SEARCH_TOTAL,
    )


def _exact_search() -> AppState:
    return _base_state(
        Route.SETUP_EXACT_CARDS,
        route_stack=(
            Route.HOME,
            Route.SETUP_GROUP,
            Route.SETUP_MODE,
            Route.SETUP_PROFILE,
            Route.SETUP_CUSTOMIZE,
            Route.SETUP_CARD_POLICY,
        ),
        profiles=PROFILES,
        locales=LOCALES,
        setup=_exact_search_setup(0),
    )


def _home_recovery() -> AppState:
    return _base_state(
        Route.HOME,
        servers=(SERVER,),
        selected_server_id=SERVER.server_id,
        server_info=SERVER_INFO,
        profiles=PROFILES,
        groups=GROUPS,
        locales=LOCALES,
        recovery=RecoveryEnvelope(
            1,
            SERVER.server_id,
            SERVER.origin,
            "COUCH",
            1.0,
            2.0,
            couch_session_id="00000000-0000-4000-8000-000000000300",
        ),
    )


def _diagnostics_long() -> AppState:
    diagnostic_server = replace(
        SERVER,
        origin=f"https://{LONG_HOSTNAME}:30443",
    )
    events = tuple(
        {
            "event": "server.validated" if index % 2 else "discovery.candidate_rejected",
            "origin": f"https://{LONG_HOSTNAME}:{30_000 + index}",
            "source": f"deterministic-visual-source-{index:02d}",
            "error_type": "ConnectionRefusedErrorWithAnIntentionallyLongName",
            "server_id": SERVER.server_id,
        }
        for index in range(14)
    )
    return _base_state(
        Route.DIAGNOSTICS,
        route_stack=(Route.PREFERENCES,),
        servers=(diagnostic_server,),
        selected_server_id=diagnostic_server.server_id,
        server_info=SERVER_INFO,
        transport_state="RECONNECTING",
        diagnostics=events,
        collection_page=0,
    )


def _room_settings() -> dict:
    return {
        "mode": "NEVER_HAVE_I_EVER",
        "profileId": PROFILES[0]["id"],
        "groupId": GROUPS[0]["id"],
        "adultContentConfirmed": True,
        "cardLocale": "en-GB",
        "cardFallbackEnabled": True,
        "cardFallbackLocales": ["de-DE"],
        "neverHaveIEverRevealMode": "NAMED_ANSWERS",
        "configuration": _configuration(),
        "cardPolicy": {"scopeDefault": {}, "conditionalRules": [], "exactCards": []},
        "revision": MAXIMUM_COUNTER,
        "updatedByParticipantId": ROOM_PARTICIPANTS[0]["id"],
    }


def _long_card_text() -> str:
    start = "START OF MAXIMUM CARD. "
    end = " END OF MAXIMUM CARD."
    sentence = (
        "Have you ever kept a complicated secret for years because telling the complete "
        "story would change how everyone in the room understands a friendship, and what "
        "would you want each person to know before you finally explained it? "
        "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW "
    )
    middle_length = 10_000 - len(start) - len(end)
    middle = (sentence * ((middle_length // len(sentence)) + 1))[:middle_length]
    return start + middle + end


def _long_german_card_text() -> str:
    start = "ANFANG DER MAXIMAL LANGEN KARTE. "
    end = " ENDE DER MAXIMAL LANGEN KARTE."
    sentence = (
        "Hast du jemals ein kompliziertes Geheimnis jahrelang bewahrt, weil die "
        "vollständige Geschichte verändern würde, wie alle Personen im Raum eine "
        "Freundschaft verstehen, und was sollte jede Person wissen, bevor du endlich "
        "alles erklärst? "
        "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW "
    )
    middle_length = 10_000 - len(start) - len(end)
    middle = (sentence * ((middle_length // len(sentence)) + 1))[:middle_length]
    return start + middle + end


def _german_profiles(profiles):
    localized = []
    for index, profile in enumerate(profiles):
        value = dict(profile)
        if profile.get("id") == "PROFILE_SPICY":
            value["name"] = "Spicy"
            value["description"] = (
                "Für Erwachsene, die besonders mutige Fragen und Pflichten, explizite "
                "Themen, intime Gespräche und bewusst herausfordernde soziale Impulse "
                "möchten, ohne dass eine wichtige Erklärung auf der Auswahlkarte "
                "abgeschnitten oder ausgelassen wird."
            )
        else:
            value["name"] = f"Deutsches Testprofil {index + 1}"
            value["description"] = (
                f"Testprofil {index + 1} zeigt seine vollständige mehrzeilige deutsche "
                "Erklärung, während das Steuerkreuz durch mehrere Seiten mit "
                "Profilkarten navigiert."
            )
        localized.append(value)
    return tuple(localized)


def _localize_snapshot(
    snapshot: Optional[dict],
    locale: str,
) -> Optional[dict]:
    if snapshot is None or locale != "de-DE":
        return snapshot
    localized = copy.deepcopy(snapshot)
    settings = localized.get("settings")
    if isinstance(settings, dict):
        settings["cardLocale"] = "de-DE"
        settings["cardFallbackLocales"] = ["en-GB"]
    session = localized.get("session")
    if isinstance(session, dict):
        session_settings = session.get("settings")
        if isinstance(session_settings, dict):
            session_settings["cardLocale"] = "de-DE"
            session_settings["cardFallbackLocales"] = ["en-GB"]
        card = session.get("currentCard")
        if isinstance(card, dict):
            card["cardText"] = _long_german_card_text()
    card = localized.get("currentCard")
    if isinstance(card, dict):
        card["cardText"] = _long_german_card_text()
    return localized


def _localized_setup(setup, locale: str):
    if setup is None or locale != "de-DE":
        return setup
    results = tuple(
        {
            **dict(card),
            "text": (
                f"Hast du jemals das deterministische Suchergebnis {index + 1} "
                "erreicht? Die vollständige mehrzeilige deutsche Kartenbeschreibung "
                "bleibt für die exakte Auswahl lesbar."
            ),
        }
        for index, card in enumerate(setup.card_search_results)
    )
    return replace(
        setup,
        card_locale="de-DE",
        card_fallback_locales=("en-GB",) if setup.card_fallback_enabled else (),
        card_search_query=(
            "Hast du jemals" if setup.card_search_query else setup.card_search_query
        ),
        card_search_results=results,
    )


def _localized_fixture_state(state: AppState, locale: str) -> AppState:
    if locale not in SUPPORTED_FIXTURE_LOCALES:
        raise ValueError(f"Unsupported visual fixture locale: {locale}")
    preferences = replace(state.preferences, locale=locale)
    if locale == "en-GB":
        return replace(state, preferences=preferences)

    topics = tuple(
        {
            **dict(topic),
            "title": f"Visuelles Hilfethema {index + 1}",
        }
        for index, topic in enumerate(state.help_topics)
    )
    selected_topic = next(
        (topic for topic in topics if topic.get("slug") == state.help_slug),
        None,
    )
    help_title = str(selected_topic.get("title", "")) if selected_topic else state.help_title
    help_body = _help_body(help_title, locale) if state.help_body else state.help_body
    return replace(
        state,
        preferences=preferences,
        profiles=_german_profiles(tuple(state.profiles)),
        taxonomy=(GERMAN_FIXTURE_TAXONOMY if state.taxonomy else state.taxonomy),
        taxonomy_locale="de-DE" if state.taxonomy else state.taxonomy_locale,
        default_card_locale="de-DE",
        setup=_localized_setup(state.setup, locale),
        couch_snapshot=_localize_snapshot(state.couch_snapshot, locale),
        room_snapshot=_localize_snapshot(state.room_snapshot, locale),
        help_topics=topics,
        help_title=help_title,
        help_body=help_body,
    )


def _room_snapshot(include_session: bool) -> dict:
    session = None
    if include_session:
        progress = [
            {
                "playerId": player["id"],
                "status": "VOTED" if index % 3 else "PENDING",
            }
            for index, player in enumerate(ROOM_PLAYERS)
        ]
        session = {
            "id": "00000000-0000-4000-8000-000000000400",
            "startedAt": MAXIMUM_COUNTER,
            "mode": "NEVER_HAVE_I_EVER",
            "state": "COLLECTING_ANSWERS",
            "revision": MAXIMUM_COUNTER,
            "roundNumber": MAXIMUM_COUNTER,
            "cardsShown": MAXIMUM_COUNTER,
            "remainingCardCount": MAXIMUM_COUNTER,
            "players": list(ROOM_PLAYERS),
            "activePlayer": dict(ROOM_PLAYERS[-1]),
            "viewer": {
                "role": "DISPLAY",
                "participantId": FIXTURE_ROOM.participant_id,
                "displayName": "Kodi visual fixture",
            },
            "availableActions": [],
            "controllablePlayers": [],
            "hasVoted": False,
            "currentCard": {
                "id": "00000000-0000-4000-8000-000000000401",
                "cardText": _long_card_text(),
                "cardType": "QUESTION",
                "questionCategoryId": "CAT_SEX_TENSION",
                "dareTypeId": None,
                "cardIntensity": 5,
                "intensity": 5,
            },
            "neverHaveIEverVoting": {
                "revealMode": "NAMED_ANSWERS",
                "progress": progress,
                "result": None,
            },
        }
    return {
        "roomId": FIXTURE_ROOM.room_id,
        "capacity": {
            "maximumParticipants": ROOM_PARTICIPANT_COUNT,
            "maximumPlayers": 10_000,
        },
        "participants": list(ROOM_PARTICIPANTS),
        "bootstrapMode": "DISPLAY_WAITING_FOR_HOST",
        "hostStatus": {
            "state": "CONNECTED",
            "participantId": ROOM_PARTICIPANTS[0]["id"],
            "displayName": ROOM_PARTICIPANTS[0]["displayName"],
            "deadline": None,
        },
        "boundaryConfigured": True,
        "settings": _room_settings(),
        "session": session,
    }


def _room_state(route: Route, auto_page: int, card_page: int = 0) -> AppState:
    include_session = route == Route.ROOM_GAME_DISPLAY
    return _base_state(
        route,
        servers=(SERVER,),
        selected_server_id=SERVER.server_id,
        server_info=SERVER_INFO,
        profiles=PROFILES,
        groups=GROUPS,
        locales=LOCALES,
        active_room=FIXTURE_ROOM,
        room_snapshot=_room_snapshot(include_session),
        room_eligibility={
            "total": MAXIMUM_COUNTER,
            "availableAtStart": MAXIMUM_COUNTER,
            "playerCount": ROOM_PLAYER_COUNT,
        },
        transport_state="CONNECTED",
        auto_page=auto_page,
        card_page=card_page,
    )


def _lobby_worst_first() -> AppState:
    return _room_state(Route.ROOM_LOBBY_DISPLAY, 0)


def _lobby_worst_middle() -> AppState:
    return _room_state(Route.ROOM_LOBBY_DISPLAY, LOBBY_MIDDLE_PAGE)


def _lobby_worst_last() -> AppState:
    return _room_state(Route.ROOM_LOBBY_DISPLAY, LOBBY_LAST_PAGE)


def _lobby_address_five() -> AppState:
    return _room_state(Route.ROOM_LOBBY_DISPLAY, 4)


def _room_game_worst_first() -> AppState:
    return _room_state(Route.ROOM_GAME_DISPLAY, 0)


def _room_game_worst_middle() -> AppState:
    return _room_state(Route.ROOM_GAME_DISPLAY, GAME_MIDDLE_PAGE)


def _room_game_worst_last() -> AppState:
    return _room_state(Route.ROOM_GAME_DISPLAY, GAME_LAST_PAGE)


def _room_game_marquee_timing() -> AppState:
    state = _room_state(Route.ROOM_GAME_DISPLAY, 0)
    return replace(
        state,
        preferences=replace(state.preferences, auto_page_seconds=5),
    )


def _room_ended_open() -> AppState:
    state = _room_state(Route.ROOM_GAME_DISPLAY, GAME_LAST_PAGE)
    snapshot = dict(state.room_snapshot or {})
    session = dict(snapshot.get("session") or {})
    session.update(
        {
            "state": "ENDED",
            "currentCard": None,
            "neverHaveIEverVoting": None,
            "availableActions": [],
        }
    )
    snapshot["session"] = session
    return replace(
        state,
        route=Route.ROOM_SUMMARY_DISPLAY,
        route_stack=(),
        room_snapshot=snapshot,
    )


def _couch_players(count: int, prefix: str = "W") -> list[dict]:
    return [
        {"id": _fixture_uuid(4_000 + index), "name": _maximum_name(prefix, index)}
        for index in range(count)
    ]


def _couch_snapshot(players: list[dict], state: str) -> dict:
    return {
        "id": "00000000-0000-4000-8000-000000000500",
        "startedAt": MAXIMUM_COUNTER,
        "mode": "NEVER_HAVE_I_EVER",
        "revision": MAXIMUM_COUNTER,
        "state": state,
        "roundNumber": MAXIMUM_COUNTER,
        "cardsShown": MAXIMUM_COUNTER,
        "remainingCardCount": MAXIMUM_COUNTER,
        "players": players,
        "activePlayer": players[-1] if players else None,
        "currentCard": {
            "id": "00000000-0000-4000-8000-000000000501",
            "cardText": _long_card_text(),
            "cardType": "QUESTION",
            "questionCategoryId": "CAT_RELATIONSHIP",
            "dareTypeId": None,
            "cardIntensity": 5,
            "intensity": 5,
        },
        "votedPlayerIds": [],
        "neverHaveIEverVoting": {
            "revealMode": "NAMED_ANSWERS",
            "progress": [
                {"playerId": player["id"], "status": "PENDING"}
                for player in players
            ],
            "result": None,
        },
        "persistence": "EPHEMERAL",
        "settings": {
            "mode": "NEVER_HAVE_I_EVER",
            "profileId": PROFILES[0]["id"],
            "adultContentConfirmed": True,
            "cardLocale": "en-GB",
            "cardFallbackEnabled": False,
            "cardFallbackLocales": [],
            "neverHaveIEverRevealMode": "NAMED_ANSWERS",
            "configuration": _configuration(),
            "cardPolicy": {"scopeDefault": {}, "conditionalRules": [], "exactCards": []},
        },
    }


def _couch_voters_nine() -> AppState:
    players = _couch_players(9)
    return _base_state(
        Route.COUCH_GAME,
        couch_snapshot=_couch_snapshot(players, "COLLECTING_ANSWERS"),
        collection_page=0,
    )


def _couch_voter_page_complete() -> AppState:
    players = _couch_players(9, "C")
    snapshot = _couch_snapshot(players, "COLLECTING_ANSWERS")
    completed_ids = [player["id"] for player in players[:COUCH_VOTER_PAGE_SIZE]]
    snapshot["votedPlayerIds"] = completed_ids
    snapshot["neverHaveIEverVoting"]["progress"] = [
        {
            "playerId": player["id"],
            "status": "VOTED" if player["id"] in completed_ids else "PENDING",
        }
        for player in players
    ]
    return _base_state(
        Route.COUCH_GAME,
        couch_snapshot=snapshot,
        collection_page=0,
    )


def _couch_voters_thousand_final() -> AppState:
    players = _couch_players(ROOM_PLAYER_COUNT, "V")
    voted_player_ids = [
        player["id"]
        for index, player in enumerate(players)
        if index % 2 == 0
    ]
    snapshot = _couch_snapshot(players, "COLLECTING_ANSWERS")
    snapshot["votedPlayerIds"] = voted_player_ids
    snapshot["neverHaveIEverVoting"]["progress"] = [
        {
            "playerId": player["id"],
            "status": "VOTED" if index % 2 == 0 else "PENDING",
        }
        for index, player in enumerate(players)
    ]
    return _base_state(
        Route.COUCH_GAME,
        couch_snapshot=snapshot,
        collection_page=COUCH_VOTER_LAST_PAGE,
    )


def _named_answers() -> tuple[list[dict], list[dict]]:
    players = _couch_players(ROOM_PLAYER_COUNT, "W")
    answers = [
        {
            "playerId": player["id"],
            "displayName": player["name"],
            "vote": "YES" if index % 2 == 0 else "NO",
        }
        for index, player in enumerate(players)
    ]
    return players, answers


NAMED_PLAYERS, NAMED_ANSWERS = _named_answers()


def _named_state(auto_page: int) -> AppState:
    snapshot = _couch_snapshot(list(NAMED_PLAYERS), "SHOWING_RESULTS")
    snapshot["neverHaveIEverVoting"] = {
        "revealMode": "NAMED_ANSWERS",
        "progress": [
            {"playerId": player["id"], "status": "VOTED"}
            for player in NAMED_PLAYERS
        ],
        "result": {
            "yes": ROOM_PLAYER_COUNT // 2,
            "no": ROOM_PLAYER_COUNT // 2,
            "total": ROOM_PLAYER_COUNT,
            "namedAnswers": list(NAMED_ANSWERS),
        },
    }
    return _base_state(
        Route.COUCH_GAME,
        couch_snapshot=snapshot,
        auto_page=auto_page,
    )


def _named_first() -> AppState:
    return _named_state(0)


def _named_middle() -> AppState:
    return _named_state(NAMED_MIDDLE_PAGE)


def _named_last() -> AppState:
    return _named_state(NAMED_LAST_PAGE)


def _private_choice(reveal_mode: str = "NAMED_ANSWERS") -> AppState:
    players = list(NAMED_PLAYERS)
    selected = players[-1]
    snapshot = _couch_snapshot(players, "COLLECTING_ANSWERS")
    snapshot["neverHaveIEverVoting"]["revealMode"] = reveal_mode
    snapshot["settings"]["neverHaveIEverRevealMode"] = reveal_mode
    return _base_state(
        Route.COUCH_GAME,
        couch_snapshot=snapshot,
        couch_vote_player_id=selected["id"],
        couch_vote_phase="CHOICE",
    )


def _private_choice_anonymous() -> AppState:
    return _private_choice("ANONYMOUS_AGGREGATE")


ScenarioBuilder = Callable[[], AppState]
SCENARIOS: dict[str, ScenarioBuilder] = {
    "help-long": _help_long,
    "setup-profile-unselected": _setup_profile_unselected,
    "setup-paginated": _setup_paginated,
    "setup-intensity": _setup_intensity,
    "setup-card-policy": _setup_card_policy,
    "setup-card-rule-values": _setup_card_rule_values,
    "exact-search": _exact_search,
    "home-recovery": _home_recovery,
    "diagnostics-long": _diagnostics_long,
    "lobby-worst-first": _lobby_worst_first,
    "lobby-worst-middle": _lobby_worst_middle,
    "lobby-worst-last": _lobby_worst_last,
    "lobby-worst-address-5": _lobby_address_five,
    "room-game-worst-first": _room_game_worst_first,
    "room-game-worst-middle": _room_game_worst_middle,
    "room-game-worst-last": _room_game_worst_last,
    "room-game-marquee-timing": _room_game_marquee_timing,
    "room-ended-open": _room_ended_open,
    "couch-voters-9": _couch_voters_nine,
    "couch-voter-page-complete": _couch_voter_page_complete,
    "couch-voters-1000-final": _couch_voters_thousand_final,
    "named-first": _named_first,
    "named-middle": _named_middle,
    "named-last": _named_last,
    "private-choice": _private_choice,
    "private-choice-anonymous": _private_choice_anonymous,
}


def _validate_worst_case_data() -> None:
    if len(ROOM_NAMES) != ROOM_PLAYER_COUNT or len(set(ROOM_NAMES)) != ROOM_PLAYER_COUNT:
        raise AssertionError("Room fixture must have 1,000 unique represented names")
    if len(NAMED_PLAYERS) != ROOM_PLAYER_COUNT:
        raise AssertionError("Named-result fixture must have 1,000 players")
    final_voter_players = _couch_voters_thousand_final().couch_snapshot["players"]
    final_voter_names = tuple(player["name"] for player in final_voter_players)
    if (
        len(final_voter_names) != ROOM_PLAYER_COUNT
        or len(set(final_voter_names)) != ROOM_PLAYER_COUNT
    ):
        raise AssertionError("Couch voter fixture must have 1,000 unique players")
    all_names = (
        *ROOM_NAMES,
        *(player["name"] for player in NAMED_PLAYERS),
        *final_voter_names,
    )
    if any(len(name) != MAXIMUM_NAME_LENGTH for name in all_names):
        raise AssertionError("Every worst-case player name must be exactly 40 characters")
    if any(any(character.isspace() for character in name) for name in all_names):
        raise AssertionError("Worst-case player names must not contain breakable spaces")
    if len(_long_card_text()) != 10_000:
        raise AssertionError("Worst-case Card text must use the 10,000-character contract limit")
    if len(_long_german_card_text()) != 10_000:
        raise AssertionError(
            "German worst-case Card text must use the 10,000-character contract limit"
        )
    if len(JOIN_BASE_URLS) < 5 or len(LONG_HOSTNAME.split(".", maxsplit=1)[0]) != 63:
        raise AssertionError("Address fixture must include five URLs and a 63-character label")


def _check() -> int:
    _validate_worst_case_data()
    for name, builder in SCENARIOS.items():
        state = builder()
        view = present(state)
        if state.lifecycle != "RUNNING" or not view.view_mode:
            raise AssertionError(f"Scenario {name} did not produce a runnable view")
        if name.startswith("lobby-worst") and len(view.roster) != LOBBY_ROSTER_PAGE_SIZE:
            raise AssertionError("Worst-case lobby must retain its dense eight-player page")
        if name.startswith("room-game-worst"):
            if len(view.roster) != GAME_ROSTER_PAGE_SIZE:
                raise AssertionError("Worst-case Room game must retain five visible players")
            if view.card_page_count != 1 or view.card_text.literal != _long_card_text():
                raise AssertionError(
                    "Passive Room Card must preserve its complete text for skin autoscroll"
                )
        if name == "room-ended-open":
            confirmation_state, confirmation_effects = reduce(state, action("BACK"))
            if (
                state.active_room is None
                or (state.room_snapshot or {}).get("session", {}).get("state")
                != "ENDED"
                or view.body.message_id != strings.ROOM_ENDED_OPEN_BODY
                or view.actions
                or view.preferred_focus is not None
                or confirmation_effects
                or confirmation_state.confirmation is None
                or confirmation_state.confirmation.title_id
                != strings.ROOM_DISPLAY_LEAVE_TITLE
                or confirmation_state.confirmation.body_id
                != strings.ROOM_DISPLAY_LEAVE_BODY
            ):
                raise AssertionError(
                    "Ended-but-open Room display must stay attached, explain Room reuse, "
                    "expose no terminal summary actions, and describe leaving the Room"
                )
        if name in {"private-choice", "private-choice-anonymous"}:
            selected_name = state.couch_snapshot["players"][-1]["name"]
            expected_mode = (
                "ANONYMOUS_AGGREGATE"
                if name == "private-choice-anonymous"
                else "NAMED_ANSWERS"
            )
            if (
                state.couch_snapshot["neverHaveIEverVoting"]["revealMode"]
                != expected_mode
                or not view.private_vote_choice
                or view.actions
                or view.voters
                or view.voting_player.literal != selected_name
                or view.voting_stage_label.message_id != strings.CASTING_VOTE
                or view.voting_hint.message_id != strings.PRIVATE_VOTE_HINT
                or view.card_page_count <= 1
                or not (view.card_text.literal or "").startswith(
                    "START OF MAXIMUM CARD."
                )
            ):
                raise AssertionError(
                    "Private ballot must keep the Card and voter visible while using "
                    "the fixed D-pad/mouse controls"
                )
        if name == "couch-voter-page-complete":
            if (
                any(entry.enabled for entry in view.voters)
                or view.pagination is None
                or not view.pagination.next_enabled
                or view.preferred_focus != view.pagination.next_key
            ):
                raise AssertionError(
                    "A completed Couch voter page must prefer its enabled Next voters action"
                )
        if name == "couch-voters-1000-final":
            snapshot = state.couch_snapshot or {}
            expected_total_pages = (
                ROOM_PLAYER_COUNT + COUCH_VOTER_PAGE_SIZE - 1
            ) // COUCH_VOTER_PAGE_SIZE
            voter_statuses = tuple(entry.secondary.message_id for entry in view.voters)
            if (
                len(snapshot.get("players", ())) != ROOM_PLAYER_COUNT
                or state.collection_page != expected_total_pages - 1
                or view.pagination is None
                or view.pagination.status.message_id != strings.VOTER_PAGE_STATUS
                or view.pagination.status.arguments
                != (expected_total_pages, expected_total_pages)
                or not view.pagination.previous_enabled
                or view.pagination.next_enabled
                or len(view.voters) != COUCH_VOTER_PAGE_SIZE
                or set(voter_statuses) != {strings.PENDING, strings.VOTED_STATUS}
                or [entry.enabled for entry in view.voters]
                != [False, True, False, True]
                or [entry.key for entry in view.actions] != ["couch:skip"]
                or view.card_page_count <= 1
                or not (view.card_text.literal or "").startswith(
                    "START OF MAXIMUM CARD."
                )
            ):
                raise AssertionError(
                    "Final Couch voter fixture must retain the Card and Skip alongside "
                    "a stable Pending/Voted page 250 of 250"
                )
        if name == "setup-intensity":
            interval = next(
                entry
                for entry in view.items
                if entry.key == "setup:value:intensityProgressionInterval"
            )
            if interval.detail.message_id != strings.NUMBER_RANGE:
                raise AssertionError("Intensity fixture must expose the compact range hint")
        if name == "setup-card-policy":
            inherited = next(
                entry for entry in view.items if entry.key == "setup:policy:default"
            )
            if inherited.badge.message_id != strings.INHERIT:
                raise AssertionError(
                    "Card-policy fixture must expose its inherited scope-default badge"
                )
        if name == "setup-card-rule-values":
            if [entry.key for entry in view.actions] != [
                "setup:predicate:all",
                "setup:predicate:none",
                "nav:back",
            ]:
                raise AssertionError(
                    "Card-rule selection fixture must keep All and None outside the values"
                )
        if name == "exact-search":
            if view.pagination is None or view.pagination.status.arguments != (1, 4):
                raise AssertionError("Exact-search fixture must begin on stable page 1/4")
        german_state = _localized_fixture_state(state, "de-DE")
        german_view = present(german_state)
        if german_state.preferences.locale != "de-DE" or not german_view.view_mode:
            raise AssertionError(f"Scenario {name} did not produce a German view")
        if name == "room-game-marquee-timing":
            expected_interval = (
                MARQUEE_INITIAL_HOLD_SECONDS
                + (
                    MAXIMUM_NAME_LENGTH * ROSTER_NAME_MAX_GLYPH_WIDTH
                    - GAME_ROSTER_LABEL_WIDTH
                )
                / MARQUEE_SCROLL_PIXELS_PER_SECOND
                + MARQUEE_FINAL_HOLD_SECONDS
            )
            actual_interval = auto_page_interval_seconds(german_state)
            if (
                len(german_view.roster) != GAME_ROSTER_PAGE_SIZE
                or actual_interval != expected_interval
                or actual_interval <= german_state.preferences.auto_page_seconds
            ):
                raise AssertionError(
                    "German marquee timing fixture must derive its dwell from the "
                    "longest visible 40-character player name"
                )
        if name == "help-long":
            if not german_state.help_title.startswith("Visuelles Hilfethema"):
                raise AssertionError("German Help fixture must use localized server copy")
            if "vollständige deutsche Sätze" not in german_state.help_body:
                raise AssertionError("German Help fixture must exercise long German body copy")
        if name == "setup-profile-unselected":
            description = german_view.items[0].secondary.literal or ""
            if "Für Erwachsene" not in description or len(description) < 200:
                raise AssertionError(
                    "German profile fixture must exercise its complete worst-case description"
                )
        if name == "exact-search":
            description = german_view.items[0].label.literal or ""
            if not description.startswith("Hast du jemals"):
                raise AssertionError("German exact-search fixture must use German Card copy")
        if name in {
            "room-game-worst-first",
            "room-game-worst-middle",
            "room-game-worst-last",
            "room-game-marquee-timing",
            "couch-voters-9",
            "couch-voters-1000-final",
            "named-first",
            "named-middle",
            "named-last",
            "private-choice",
            "private-choice-anonymous",
        }:
            if not (german_view.card_text.literal or "").startswith(
                "ANFANG DER MAXIMAL LANGEN KARTE."
            ):
                raise AssertionError(f"Scenario {name} did not retain the German Card")
        print(f"{name}: {state.route.value} / {view.view_mode}")
    print("Validated explicit de-DE projections for every fixture.")
    print(f"Validated {len(SCENARIOS)} deterministic visual fixtures.")
    return 0


def _runtime_state(state: AppState, profile_directory: str) -> AppState:
    if state.route != Route.ROOM_LOBBY_DISPLAY:
        return state
    from lib.qr import encode_text, write_png

    join_url = f"{JOIN_BASE_URLS[0]}/play/?room={ROOM_CODE}"
    target = Path(profile_directory) / "fixture-room-join.png"
    write_png(encode_text(join_url), target)
    return replace(state, qr_path=str(target))


def _run_in_kodi(scenario: str, locale: str) -> int:
    if scenario not in SCENARIOS:
        available = ", ".join(SCENARIOS)
        raise SystemExit(f"Unknown visual fixture {scenario!r}. Available: {available}")
    if locale not in SUPPORTED_FIXTURE_LOCALES:
        available_locales = ", ".join(SUPPORTED_FIXTURE_LOCALES)
        raise SystemExit(
            f"Unknown visual fixture locale {locale!r}. Available: {available_locales}"
        )
    _validate_worst_case_data()

    # The production runtime adapter owns Kodi imports.  Loading it dynamically keeps
    # ``--list`` and ``--check`` usable under ordinary CPython.
    runtime = __import__("lib.kodi_runtime", fromlist=("MainWindow", "xbmc"))
    xbmc = runtime.xbmc
    MainWindow = runtime.MainWindow
    from lib.navigation import (
        BACK_BUTTON,
        CONFIRM_ACCEPT,
        CONFIRM_CANCEL,
        GAME_SETTINGS,
        HELP_BUTTON,
    )
    from lib.screens.main_window import BACK_ACTIONS

    prefix = f"Party Game TV visual fixture [{scenario} / {locale}]"

    def log(message: str, level=None) -> None:
        xbmc.log(f"{prefix}: {message}", level=level or xbmc.LOGINFO)

    class FixtureApplication(Application):
        def __init__(self, profile_directory: str, fixture_state: AppState) -> None:
            super().__init__(
                profile_directory,
                locale_provider=lambda: locale,
                discovery_enabled=False,
            )
            self.state = fixture_state
            self._dirty = True
            self._timing_started_at = None
            if scenario == "room-game-marquee-timing":
                # The live timing fixture starts its clock when Kodi first takes
                # the rendered view, not while the dialog is still opening.
                self._last_auto_page = float("inf")
            else:
                # Keep named/address/roster page variants fixed for reproducible captures.
                self._last_auto_page = time.monotonic() + 86_400.0

        def _replace_setup(self, setup, preview: bool = True) -> None:
            # Setup fixtures exercise the real editor and reducer, but eligibility
            # belongs to the live server.  Keep deterministic visual mutations local
            # instead of turning a successful All/None action into a network notice.
            super()._replace_setup(setup, preview=False)

        def take_view(self):
            view = super().take_view()
            if (
                view is not None
                and scenario == "room-game-marquee-timing"
                and self._timing_started_at is None
            ):
                started = time.monotonic()
                self._timing_started_at = started
                self._last_auto_page = started
                minimum = auto_page_interval_seconds(self.state)
                log(
                    "marquee timer started "
                    f"page={self.state.auto_page + 1} minimum_dwell={minimum:.3f}s"
                )
            return view

        def tick(self, maximum_events: int = 32) -> None:
            previous_page = self.state.auto_page
            super().tick(maximum_events)
            if (
                scenario == "room-game-marquee-timing"
                and self.state.auto_page != previous_page
            ):
                required = self._auto_page_interval_cache
                now = time.monotonic()
                started = self._timing_started_at or now
                log(
                    "marquee page advanced "
                    f"from={previous_page + 1} to={self.state.auto_page + 1} "
                    f"elapsed={now - started:.3f}s required={required:.3f}s"
                )
                self._timing_started_at = now

        def activate(self, key: str) -> None:
            if key == "home:recover" or key == "diagnostics:refresh":
                log(f"suppressed external fixture action semantic={key}")
                return
            if key == "couch:skip":
                # Model the authoritative post-command snapshot locally so a real
                # D-pad run can prove that focus leaves the incidental pager/Skip
                # control and returns to the first participant on the fresh Card.
                snapshot = copy.deepcopy(self.state.couch_snapshot or {})
                players = list(snapshot.get("players") or ())
                current_card = copy.deepcopy(snapshot.get("currentCard") or {})
                current_card["id"] = _fixture_uuid(5_999)
                snapshot["revision"] = int(snapshot.get("revision", 0)) + 1
                snapshot["currentCard"] = current_card
                snapshot["votedPlayerIds"] = []
                voting = snapshot.get("neverHaveIEverVoting")
                if isinstance(voting, dict):
                    voting["progress"] = [
                        {"playerId": player["id"], "status": "PENDING"}
                        for player in players
                    ]
                    voting["result"] = None
                self.state = replace(
                    self.state,
                    couch_snapshot=snapshot,
                    couch_vote_player_id=None,
                    couch_vote_phase="SELECT",
                    busy_operation=None,
                    collection_page=0,
                    revision=self.state.revision + 1,
                )
                self._dirty = True
                log("simulated authoritative post-skip snapshot")
                return
            parts = key.split(":")
            if len(parts) >= 2 and parts[0] == "couch" and parts[1] in {
                "advance",
                "choose",
                "resync",
                "start",
                "vote",
            }:
                log(f"accepted fixture action without network semantic={key}")
                return
            if key.startswith("help:topic:"):
                slug = key.rsplit(":", maxsplit=1)[1]
                topic = next(
                    (
                        current
                        for current in self.state.help_topics
                        if current.get("slug") == slug
                    ),
                    None,
                )
                if topic:
                    title = str(topic.get("title", slug))
                    self.state = replace(
                        self.state,
                        help_slug=slug,
                        help_title=title,
                        help_body=_help_body(title, locale),
                        help_page=0,
                        revision=self.state.revision + 1,
                    )
                    self._dirty = True
                    return
            if key in {
                "setup:cards:page-previous",
                "setup:cards:page-next",
            } and self.state.route == Route.SETUP_EXACT_CARDS:
                setup = self.state.setup
                if setup is None:
                    return
                page = len(setup.card_search_cursor_history)
                delta = -1 if key.endswith("page-previous") else 1
                next_page = max(0, min(3, page + delta))
                if next_page == page:
                    return
                self.state = replace(
                    self.state,
                    setup=_localized_setup(_exact_search_setup(next_page), locale),
                    revision=self.state.revision + 1,
                )
                self._dirty = True
                log(f"advanced exact-search fixture to page={next_page + 1}/4")
                return
            super().activate(key)

        def private_vote_shortcut(self, vote: str) -> bool:
            snapshot = self.state.couch_snapshot or {}
            accepted = (
                self.state.route == Route.COUCH_GAME
                and snapshot.get("state") == "COLLECTING_ANSWERS"
                and self.state.couch_vote_phase == "CHOICE"
                and bool(self.state.couch_vote_player_id)
                and vote in {"YES", "NO"}
            )
            if accepted:
                self.state = replace(
                    self.state,
                    couch_vote_phase="SUBMITTING",
                    busy_operation="couch.vote",
                    revision=self.state.revision + 1,
                )
                self._dirty = True
                log(f"accepted private fixture vote={vote}; entered neutral submitting state")
            return accepted

    class FixtureWindow(MainWindow):
        def onAction(self, incoming) -> None:  # noqa: N802 - Kodi callback name
            if incoming.getId() in BACK_ACTIONS:
                if scenario == "room-ended-open" and not self.application.state.confirmation:
                    log("physical Back opened the ended Room leave confirmation")
                    super().onAction(incoming)
                    return
                log("physical Back requested fixture stop")
                self.application.dispatch(action("STOP"))
                return
            super().onAction(incoming)

    monitor = xbmc.Monitor()
    application = None
    window = None
    with tempfile.TemporaryDirectory(prefix="partycard-kodi-visual-") as profile_directory:
        try:
            fixture_state = _localized_fixture_state(SCENARIOS[scenario](), locale)
            fixture_state = _runtime_state(fixture_state, profile_directory)
            application = FixtureApplication(profile_directory, fixture_state)
            window = FixtureWindow(
                "script-partycard-tv-main.xml",
                str(CLIENT_ROOT),
                "Default",
                "1080i",
                application=application,
                addon_root=str(CLIENT_ROOT),
            )
            window.show()
            log(f"opened route={fixture_state.route.value} locale={locale}")

            labels = {
                49: "private-vote-neutral",
                96: "private-vote:yes",
                97: "private-vote:no",
                98: "private-vote:cancel",
                BACK_BUTTON: "nav:physical-back",
                HELP_BUTTON: "nav:help",
                GAME_SETTINGS: "game:settings",
                CONFIRM_CANCEL: "confirm:cancel",
                CONFIRM_ACCEPT: "confirm:accept",
            }
            last_focus = None
            while (
                not monitor.abortRequested()
                and application.state.lifecycle != "STOPPING"
            ):
                application.tick()
                window.render_if_changed()
                try:
                    control_id = window.getFocusId()
                    semantic = window._semantic_for_control(control_id)
                    if not semantic:
                        semantic = labels.get(control_id, "")
                    current_focus = (control_id, semantic)
                    if current_focus != last_focus:
                        log(f"focus control={control_id} semantic={semantic or '-'}")
                        last_focus = current_focus
                except RuntimeError:
                    pass
                if monitor.waitForAbort(0.05):
                    break
        finally:
            if application is not None:
                application.stop()
            if window is not None:
                window.release_runtime_inhibitors()
                window.close()
            reason = "Kodi abort" if monitor.abortRequested() else "fixture stop"
            log(f"closed promptly reason={reason}")
    return 0


def main(arguments: list[str]) -> int:
    if len(arguments) not in (1, 2):
        available = ", ".join(SCENARIOS)
        print(
            "Usage: visual_fixture.py <scenario> [en-GB|de-DE] "
            f"or <--list|--check>\nAvailable: {available}"
        )
        return 2
    command = arguments[0]
    if command == "--list":
        if len(arguments) != 1:
            return 2
        for name in SCENARIOS:
            print(name)
        return 0
    if command == "--check":
        if len(arguments) != 1:
            return 2
        return _check()
    locale = arguments[1] if len(arguments) == 2 else "en-GB"
    return _run_in_kodi(command, locale)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
