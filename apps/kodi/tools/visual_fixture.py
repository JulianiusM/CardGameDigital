#!/usr/bin/env python3
r"""Development-only real-Kodi visual fixtures.

The release packager excludes ``apps/kodi/tools``.  Install the unpacked add-on and
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
from lib.protocol.validation import PROTOCOL_VERSION  # noqa: E402
from lib.reducer import reduce  # noqa: E402
from lib.routes import Route  # noqa: E402
from lib.state import (  # noqa: E402
    ActiveRoom,
    AppState,
    Confirmation,
    Preferences,
    RecoveryEnvelope,
    ServerRecord,
    initial_setup,
)


ADDON_ID = "script.partycard.tv"
ROOM_CODE = "ABC234"
MAXIMUM_COUNTER = 9_007_199_254_740_991
MAXIMUM_NAME_LENGTH = 40
MAXIMUM_GROUP_NAME_LENGTH = 80
MAXIMUM_LOCALE_NAME_LENGTH = 80
MAXIMUM_RULE_NAME_LENGTH = 100
MAXIMUM_SEARCH_QUERY_LENGTH = 200
MAXIMUM_NOTIFICATION_LENGTH = 500
MAXIMUM_PROFILE_NAME_LENGTH = 200
MAXIMUM_PROFILE_DESCRIPTION_LENGTH = 2_000
MAXIMUM_TAXONOMY_LABEL_LENGTH = 200
MAXIMUM_SERVER_ORIGIN_LENGTH = 500
MAXIMUM_JOIN_PATH_LENGTH = 500
MAXIMUM_DEVICE_USER_CODE_LENGTH = 200
MAXIMUM_DEVICE_VERIFICATION_URI_LENGTH = 500
HOSTILE_HELP_TITLE_LENGTH = 160
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


def _marked_text(prefix: str, suffix: str, length: int, fill: str) -> str:
    if len(prefix) + len(suffix) > length:
        raise AssertionError("Fixture markers exceed their requested length")
    return prefix + (fill * (length - len(prefix) - len(suffix))) + suffix


def _maximum_http_origin(prefix: str, suffix: str) -> str:
    """Return an accepted 500-character HTTP origin with DNS-sized labels."""
    result = f"https://{prefix}"
    terminal = f".{suffix}"
    while len(result) + len(terminal) < MAXIMUM_SERVER_ORIGIN_LENGTH:
        remaining = MAXIMUM_SERVER_ORIGIN_LENGTH - len(result) - len(terminal)
        if remaining == 1:
            result += "o"
            continue
        label_length = min(50, remaining - 1)
        result += "." + ("o" * label_length)
    return result + terminal


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
HOSTILE_PROFILE = {
    "id": "PROFILE_HOSTILE_LIMITS",
    "name": _marked_text(
        "PROFILE_NAME_START_",
        " _NAME_END",
        MAXIMUM_PROFILE_NAME_LENGTH,
        "P",
    ),
    "description": _marked_text(
        "PROFILE_DESCRIPTION_START_",
        " _DESCRIPTION_END",
        MAXIMUM_PROFILE_DESCRIPTION_LENGTH,
        "D",
    ),
    "requiresAdultConfirmation": False,
    "immutable": False,
    **_configuration(),
}
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
HOSTILE_GROUP = {
    "id": "00000000-0000-4000-8000-000000000101",
    "name": _marked_text(
        "GROUP_START_", "_GROUP_END", MAXIMUM_GROUP_NAME_LENGTH, "G"
    ),
    "members": [
        _marked_text(f"M{index}_START_", f"_M{index}_END", MAXIMUM_NAME_LENGTH, "M")
        for index in range(4)
    ],
}
HOSTILE_LOCALE = {
    "id": "aaa-aaaaaaaa-aaaaaaaa-aaaaaaaa-aaa",
    "nativeName": _marked_text(
        "LOCALE_START_", "_LOCALE_END", MAXIMUM_LOCALE_NAME_LENGTH, "L"
    ),
}
HOSTILE_TAXONOMY_LABEL = _marked_text(
    "TAXONOMY_START_",
    "_TAXONOMY_END",
    MAXIMUM_TAXONOMY_LABEL_LENGTH,
    "T",
)
HOSTILE_CONFIRMATION_TITLE = _marked_text(
    "CONFIRM_TITLE_START_", "_CONFIRM_TITLE_END", 160, "C"
)
HOSTILE_CONFIRMATION_BODY = _marked_text(
    "CONFIRM_BODY_START_", "_CONFIRM_BODY_END", 500, "B"
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
HOSTILE_SERVER = replace(
    SERVER,
    origin=_maximum_http_origin("ORIGIN-START", "ORIGIN-END"),
    display_name=_marked_text("SERVER_START_", "_SERVER_END", 80, "S"),
)
HOSTILE_JOIN_PATH = _marked_text(
    "/JOIN_PATH_START_{roomCode}_",
    "_JOIN_END",
    MAXIMUM_JOIN_PATH_LENGTH,
    "J",
)
HOSTILE_DEVICE_USER_CODE = _marked_text(
    "DEVICE_CODE_START_",
    "_DEVICE_CODE_END",
    MAXIMUM_DEVICE_USER_CODE_LENGTH,
    "C",
)
HOSTILE_DEVICE_VERIFICATION_URI = _maximum_http_origin(
    "DEVICE-URI-START", "DEVICE-URI-END"
)
HOSTILE_SETUP_PLAYER_NAME = _marked_text(
    "SETUP_PLAYER_START_", "_PLAYER_END", MAXIMUM_NAME_LENGTH, "P"
)
HOSTILE_GROUP_MEMBER_NAME = _marked_text(
    "GROUP_MEMBER_START_", "_MEMBER_END", MAXIMUM_NAME_LENGTH, "M"
)
HOSTILE_HOST_NAME = _marked_text(
    "HOST_START_", "_HOST_END", MAXIMUM_NAME_LENGTH, "H"
)
ANONYMOUS_RESULT_CARD_TEXT = (
    "ANONYMOUS_RESULT_CARD_START. A private Never Have I Ever vote only reveals "
    "the aggregate totals on this shared screen. ANONYMOUS_RESULT_CARD_END"
)
GERMAN_ANONYMOUS_RESULT_CARD_TEXT = (
    "ANONYMOUS_RESULT_CARD_START. Eine private Ich-habe-noch-nie-Abstimmung zeigt "
    "auf diesem gemeinsamen Bildschirm nur die Summen. ANONYMOUS_RESULT_CARD_END"
)
CONVERSATION_META_CARD_TEXT = (
    "CONVERSATION_META_CARD_START. Take a breath, check the atmosphere together, "
    "and decide whether the group wants to continue at this intensity. "
    "CONVERSATION_META_CARD_END"
)
GERMAN_CONVERSATION_META_CARD_TEXT = (
    "CONVERSATION_META_CARD_START. Atmet kurz durch, prüft gemeinsam die Stimmung "
    "und entscheidet, ob die Gruppe mit dieser Intensität weitermachen möchte. "
    "CONVERSATION_META_CARD_END"
)
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
    "protocolVersions": [PROTOCOL_VERSION],
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
    setup = initial_setup("COUCH", "en-GB", True)
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


def _setup_profile_hostile() -> AppState:
    setup = initial_setup("COUCH", "en-GB", True)
    return _base_state(
        Route.SETUP_PROFILE,
        route_stack=(Route.HOME, Route.SETUP_GROUP, Route.SETUP_MODE),
        profiles=(HOSTILE_PROFILE,),
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


def _setup_player_profile_hostile() -> AppState:
    setup = replace(
        _neutral_setup(),
        profile_id=PROFILES[1]["id"],
        players=(HOSTILE_SETUP_PLAYER_NAME, "Second player"),
        selected_player_index=0,
    )
    return _base_state(
        Route.SETUP_PLAYER,
        route_stack=(
            Route.HOME,
            Route.SETUP_GROUP,
            Route.SETUP_MODE,
            Route.SETUP_PROFILE,
            Route.SETUP_PLAYERS,
        ),
        profiles=PROFILES,
        locales=LOCALES,
        setup=setup,
    )


def _group_member_profile_hostile() -> AppState:
    return _base_state(
        Route.GROUP_MEMBER,
        route_stack=(Route.HOME, Route.GROUP_LIST, Route.GROUP_CREATE),
        servers=(SERVER,),
        selected_server_id=SERVER.server_id,
        server_info=SERVER_INFO,
        group_draft_id=HOSTILE_GROUP["id"],
        group_draft_name=HOSTILE_GROUP["name"],
        group_draft_members=(HOSTILE_GROUP_MEMBER_NAME, "Second member"),
        group_draft_member_index=0,
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


def _setup_groups_hostile() -> AppState:
    setup = replace(_neutral_setup(), group_choice="SAVED")
    return _base_state(
        Route.SETUP_GROUP_SELECT,
        route_stack=(Route.HOME, Route.SETUP_GROUP),
        servers=(HOSTILE_SERVER,),
        selected_server_id=HOSTILE_SERVER.server_id,
        profiles=PROFILES,
        groups=(HOSTILE_GROUP,),
        locales=LOCALES,
        setup=setup,
    )


def _setup_rule_hostile() -> AppState:
    rule_id = _fixture_uuid(7_501)
    rule_name = _marked_text(
        "RULE_START_", "_RULE_END", MAXIMUM_RULE_NAME_LENGTH, "R"
    )
    setup = replace(
        _neutral_setup(),
        profile_id=PROFILES[1]["id"],
        configuration=_configuration(),
        card_policy={
            "scopeDefault": {},
            "conditionalRules": [
                {
                    "id": rule_id,
                    "name": rule_name,
                    "order": 0,
                    "enabled": True,
                    "predicate": {},
                    "directives": {},
                }
            ],
            "exactCards": [],
        },
        selected_rule_id=rule_id,
    )
    return _base_state(
        Route.SETUP_POLICY_RULES,
        route_stack=(Route.HOME, Route.SETUP_CARD_POLICY),
        servers=(HOSTILE_SERVER,),
        selected_server_id=HOSTILE_SERVER.server_id,
        profiles=PROFILES,
        locales=LOCALES,
        setup=setup,
    )


def _setup_locale_hostile() -> AppState:
    setup = replace(
        _neutral_setup(),
        profile_id=PROFILES[1]["id"],
        configuration=_configuration(),
        card_locale=HOSTILE_LOCALE["id"],
    )
    return _base_state(
        Route.SETUP_CARD_LANGUAGE_PRIMARY,
        route_stack=(Route.HOME, Route.SETUP_CARD_LANGUAGE),
        servers=(HOSTILE_SERVER,),
        selected_server_id=HOSTILE_SERVER.server_id,
        profiles=PROFILES,
        locales=(HOSTILE_LOCALE,),
        setup=setup,
    )


def _setup_taxonomy_hostile() -> AppState:
    taxonomy = {
        "questionCategories": [
            {"id": "CAT_RELATIONSHIP", "label": HOSTILE_TAXONOMY_LABEL}
        ],
        "dareTypes": [],
    }
    setup = replace(
        _neutral_setup(),
        profile_id=PROFILES[1]["id"],
        configuration={
            **_configuration(),
            "enabledQuestionCategoryIds": ["CAT_RELATIONSHIP"],
        },
    )
    return replace(
        _base_state(
            Route.SETUP_CATEGORIES,
            route_stack=(Route.HOME, Route.SETUP_CUSTOMIZE),
            servers=(HOSTILE_SERVER,),
            selected_server_id=HOSTILE_SERVER.server_id,
            profiles=PROFILES,
            locales=LOCALES,
            setup=setup,
        ),
        taxonomy=taxonomy,
    )


def _setup_review_hostile() -> AppState:
    setup = replace(
        _neutral_setup(),
        group_choice="SAVED",
        group_id=HOSTILE_GROUP["id"],
        profile_id=PROFILES[1]["id"],
        players=tuple(HOSTILE_GROUP["members"]),
        configuration=_configuration(),
        eligibility={"total": MAXIMUM_COUNTER},
    )
    return _base_state(
        Route.SETUP_REVIEW,
        route_stack=(Route.HOME, Route.SETUP_CUSTOMIZE),
        servers=(HOSTILE_SERVER,),
        selected_server_id=HOSTILE_SERVER.server_id,
        profiles=PROFILES,
        groups=(HOSTILE_GROUP,),
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


def _exact_search_hostile() -> AppState:
    setup = replace(
        _exact_search_setup(0),
        card_search_query=_marked_text(
            "QUERY_START_", "_QUERY_END", MAXIMUM_SEARCH_QUERY_LENGTH, "Q"
        ),
        card_search_results=(
            {
                "id": _fixture_uuid(8_100),
                "text": _long_card_text(),
            },
        ),
        card_search_cursor=None,
        card_search_next_cursor=None,
        card_search_cursor_history=(),
        card_search_total=1,
    )
    return _base_state(
        Route.SETUP_EXACT_CARDS,
        route_stack=(Route.HOME, Route.SETUP_CARD_POLICY),
        servers=(HOSTILE_SERVER,),
        selected_server_id=HOSTILE_SERVER.server_id,
        profiles=PROFILES,
        locales=LOCALES,
        setup=setup,
    )


def _exact_card_preview_hostile() -> AppState:
    state = _exact_search_hostile()
    card_id = state.setup.card_search_results[0]["id"]
    return replace(
        state,
        route=Route.SETUP_EXACT_CARD_PREVIEW,
        route_stack=(*state.route_stack, Route.SETUP_EXACT_CARDS),
        setup=replace(state.setup, selected_card_id=card_id),
    )


def _help_title_hostile() -> AppState:
    title = _marked_text(
        "HELP_START_", "_HELP_END", HOSTILE_HELP_TITLE_LENGTH, "H"
    )
    return _base_state(
        Route.HELP,
        route_stack=(Route.HOME,),
        servers=(HOSTILE_SERVER,),
        selected_server_id=HOSTILE_SERVER.server_id,
        server_info=SERVER_INFO,
        help_topics=({"slug": "hostile-title", "title": title},),
        help_slug="hostile-title",
        help_title=title,
        help_body=_help_body("Hostile Help heading"),
        help_page=0,
    )


def _servers_hostile() -> AppState:
    return _base_state(
        Route.SERVER_LIST,
        servers=(HOSTILE_SERVER,),
        selected_server_id=HOSTILE_SERVER.server_id,
    )


def _server_details_hostile() -> AppState:
    return _base_state(
        Route.SERVER_DETAILS,
        route_stack=(Route.SERVER_LIST,),
        servers=(HOSTILE_SERVER,),
        selected_server_id=HOSTILE_SERVER.server_id,
        server_details_id=HOSTILE_SERVER.server_id,
    )


def _device_link_hostile() -> AppState:
    server_info = copy.deepcopy(SERVER_INFO)
    server_info["capabilities"]["nativeDeviceAuthorization"] = True
    return _base_state(
        Route.DEVICE_LINK,
        route_stack=(Route.HOME, Route.PREFERENCES),
        servers=(HOSTILE_SERVER,),
        selected_server_id=HOSTILE_SERVER.server_id,
        server_info=server_info,
        authorization={
            "status": "PENDING",
            "user_code": HOSTILE_DEVICE_USER_CODE,
            "verification_uri": HOSTILE_DEVICE_VERIFICATION_URI,
            "expires_at": MAXIMUM_COUNTER,
        },
        busy_operation="authorization.poll",
    )


def _notification_hostile() -> AppState:
    return replace(
        _home_recovery(),
        notification=strings.Text.raw(
            _marked_text(
                "NOTICE_START_",
                "_NOTICE_END",
                MAXIMUM_NOTIFICATION_LENGTH,
                "N",
            )
        ),
    )


def _confirmation_exit() -> AppState:
    return _base_state(
        Route.HOME,
        servers=(HOSTILE_SERVER,),
        selected_server_id=HOSTILE_SERVER.server_id,
        confirmation=Confirmation(
            title_id=strings.EXIT_ADDON_TITLE,
            body_id=strings.EXIT_ADDON_BODY,
            action_id=strings.EXIT_ADDON,
            confirm_action="exit-addon",
        ),
    )


def _confirmation_hostile() -> AppState:
    return _confirmation_exit()


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
        if str(profile.get("name", "")).startswith("PROFILE_NAME_START_"):
            localized.append(value)
            continue
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
            if card.get("cardType") == "CONVERSATION_META":
                card["cardText"] = GERMAN_CONVERSATION_META_CARD_TEXT
            elif card.get("cardText") == ANONYMOUS_RESULT_CARD_TEXT:
                card["cardText"] = GERMAN_ANONYMOUS_RESULT_CARD_TEXT
            else:
                card["cardText"] = _long_german_card_text()
    card = localized.get("currentCard")
    if isinstance(card, dict):
        if card.get("cardType") == "CONVERSATION_META":
            card["cardText"] = GERMAN_CONVERSATION_META_CARD_TEXT
        elif card.get("cardText") == ANONYMOUS_RESULT_CARD_TEXT:
            card["cardText"] = GERMAN_ANONYMOUS_RESULT_CARD_TEXT
        else:
            card["cardText"] = _long_german_card_text()
    return localized


def _german_search_card_text(card: dict, index: int) -> str:
    if str(card.get("text", "")).startswith("START OF MAXIMUM CARD."):
        return _long_german_card_text()
    return (
        f"Hast du jemals das deterministische Suchergebnis {index + 1} "
        "erreicht? Die vollständige mehrzeilige deutsche Kartenbeschreibung "
        "bleibt für die exakte Auswahl lesbar."
    )


def _german_search_query(query: str) -> str:
    if query.startswith("QUERY_START_") or not query:
        return query
    return "Hast du jemals"


def _localized_setup(setup, locale: str):
    if setup is None or locale != "de-DE":
        return setup
    results = tuple(
        {
            **dict(card),
            "text": _german_search_card_text(card, index),
        }
        for index, card in enumerate(setup.card_search_results)
    )
    return replace(
        setup,
        card_locale="de-DE",
        card_fallback_locales=("en-GB",) if setup.card_fallback_enabled else (),
        card_search_query=_german_search_query(setup.card_search_query),
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
            "title": (
                str(topic.get("title", ""))
                if str(topic.get("title", "")).startswith("HELP_START_")
                else f"Visuelles Hilfethema {index + 1}"
            ),
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
        taxonomy=(
            state.taxonomy
            if any(
                str(entry.get("label", "")).startswith("TAXONOMY_START_")
                for entry in (state.taxonomy or {}).get("questionCategories", ())
            )
            else (GERMAN_FIXTURE_TAXONOMY if state.taxonomy else state.taxonomy)
        ),
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


def _lobby_max_join_url() -> AppState:
    state = _room_state(Route.ROOM_LOBBY_DISPLAY, 0)
    server_info = copy.deepcopy(SERVER_INFO)
    server_info["roomAccess"] = {
        "configuredBaseUrl": HOSTILE_SERVER.origin,
        "availableBaseUrls": [HOSTILE_SERVER.origin],
    }
    server_info["endpoints"]["roomJoinPathTemplate"] = HOSTILE_JOIN_PATH
    return replace(
        state,
        servers=(HOSTILE_SERVER,),
        selected_server_id=HOSTILE_SERVER.server_id,
        server_info=server_info,
    )


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


def _room_session_stage(
    session_state: str,
    *,
    pool_exhausted: bool = False,
    reconnecting: bool = False,
) -> AppState:
    state = _room_state(Route.ROOM_GAME_DISPLAY, 0)
    snapshot = copy.deepcopy(state.room_snapshot or {})
    session = snapshot["session"]
    session["state"] = session_state
    session["neverHaveIEverVoting"] = None
    if session_state == "CHOOSING_CARD_TYPE" or pool_exhausted:
        session["currentCard"] = None
    if pool_exhausted:
        session["remainingCardCount"] = 0
    snapshot["session"] = session
    return replace(
        state,
        room_snapshot=snapshot,
        transport_state="RECONNECTING" if reconnecting else "CONNECTED",
    )


def _room_waiting() -> AppState:
    return _room_session_stage("WAITING_FOR_PLAYER")


def _room_choice() -> AppState:
    return _room_session_stage("CHOOSING_CARD_TYPE")


def _room_pool_exhausted() -> AppState:
    return _room_session_stage("SELECTING_CARD", pool_exhausted=True)


def _room_reconnecting() -> AppState:
    return _room_session_stage("SHOWING_CARD", reconnecting=True)


def _room_host_state(host_state: str, display_name=None) -> AppState:
    state = _room_state(Route.ROOM_LOBBY_DISPLAY, 0)
    snapshot = copy.deepcopy(state.room_snapshot or {})
    participants = [copy.deepcopy(value) for value in snapshot.get("participants", ())]
    if participants:
        participants[0]["role"] = "DISPLAY"
        participants[0]["connectionStatus"] = "CONNECTED"
    if host_state == "RECONNECTING" and participants:
        participants[0]["role"] = "HOST"
        participants[0]["displayName"] = HOSTILE_HOST_NAME
        participants[0]["connectionStatus"] = "TEMPORARILY_DISCONNECTED"
    snapshot["participants"] = participants
    snapshot["hostStatus"] = {
        "state": host_state,
        "participantId": participants[0]["id"] if host_state == "RECONNECTING" else None,
        "displayName": display_name,
        "deadline": MAXIMUM_COUNTER if host_state != "AWAITING_REPLACEMENT_HOST" else None,
    }
    return replace(state, room_snapshot=snapshot)


def _room_host_awaiting_first() -> AppState:
    return _room_host_state("AWAITING_FIRST_HOST")


def _room_host_reconnecting() -> AppState:
    return _room_host_state("RECONNECTING", HOSTILE_HOST_NAME)


def _room_host_awaiting_replacement() -> AppState:
    return _room_host_state("AWAITING_REPLACEMENT_HOST")


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


def _couch_menu_four_actions() -> AppState:
    players = _couch_players(4, "O")
    return _base_state(
        Route.COUCH_MENU,
        servers=(SERVER,),
        selected_server_id=SERVER.server_id,
        server_info=SERVER_INFO,
        couch_snapshot=_couch_snapshot(players, "SHOWING_CARD"),
    )


def _couch_stage(
    session_state: str,
    *,
    sync_required: bool = False,
    pool_exhausted: bool = False,
) -> AppState:
    players = _couch_players(4, "S")
    snapshot = _couch_snapshot(players, session_state)
    snapshot["neverHaveIEverVoting"] = None
    if session_state == "CHOOSING_CARD_TYPE" or pool_exhausted:
        snapshot["currentCard"] = None
    if pool_exhausted:
        snapshot["remainingCardCount"] = 0
    return _base_state(
        Route.COUCH_GAME,
        couch_snapshot=snapshot,
        couch_sync_required=sync_required,
        couch_pool_exhausted=pool_exhausted,
    )


def _couch_sync_required() -> AppState:
    return _couch_stage("SHOWING_CARD", sync_required=True)


def _couch_waiting() -> AppState:
    return _couch_stage("WAITING_FOR_PLAYER")


def _couch_choice() -> AppState:
    return _couch_stage("CHOOSING_CARD_TYPE")


def _couch_pool_exhausted() -> AppState:
    return _couch_stage("SELECTING_CARD", pool_exhausted=True)


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


def _couch_classification_hostile() -> AppState:
    state = _named_state(0)
    snapshot = copy.deepcopy(state.couch_snapshot)
    snapshot["currentCard"]["cardText"] = "Classification overflow fixture Card."
    return replace(
        state,
        taxonomy={
            "questionCategories": [
                {"id": "CAT_RELATIONSHIP", "label": HOSTILE_TAXONOMY_LABEL}
            ],
            "dareTypes": [],
        },
        couch_snapshot=snapshot,
    )


def _anonymous_aggregate_result() -> AppState:
    players = _couch_players(ROOM_PLAYER_COUNT, "A")
    snapshot = _couch_snapshot(players, "SHOWING_RESULTS")
    snapshot["currentCard"]["cardText"] = ANONYMOUS_RESULT_CARD_TEXT
    snapshot["neverHaveIEverVoting"] = {
        "revealMode": "ANONYMOUS_AGGREGATE",
        "progress": [
            {"playerId": player["id"], "status": "VOTED"}
            for player in players
        ],
        "result": {
            "yes": ROOM_PLAYER_COUNT - 1,
            "no": 1,
            "total": ROOM_PLAYER_COUNT,
        },
    }
    snapshot["settings"]["neverHaveIEverRevealMode"] = "ANONYMOUS_AGGREGATE"
    return _base_state(Route.COUCH_GAME, couch_snapshot=snapshot)


def _conversation_meta_card() -> AppState:
    players = _couch_players(4, "T")
    snapshot = _couch_snapshot(players, "SHOWING_CARD")
    snapshot["mode"] = "LETS_TALK"
    snapshot["currentCard"] = {
        "id": "00000000-0000-4000-8000-000000000502",
        "cardText": CONVERSATION_META_CARD_TEXT,
        "cardType": "CONVERSATION_META",
        "questionCategoryId": None,
        "dareTypeId": None,
        "cardIntensity": 5,
        "intensity": 5,
    }
    snapshot["neverHaveIEverVoting"] = None
    snapshot["settings"]["mode"] = "LETS_TALK"
    return _base_state(Route.COUCH_GAME, couch_snapshot=snapshot)


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
    "help-title-hostile": _help_title_hostile,
    "setup-profile-unselected": _setup_profile_unselected,
    "setup-profile-hostile": _setup_profile_hostile,
    "setup-paginated": _setup_paginated,
    "setup-player-profile-hostile": _setup_player_profile_hostile,
    "group-member-profile-hostile": _group_member_profile_hostile,
    "setup-intensity": _setup_intensity,
    "setup-card-policy": _setup_card_policy,
    "setup-card-rule-values": _setup_card_rule_values,
    "setup-groups-hostile": _setup_groups_hostile,
    "setup-rule-hostile": _setup_rule_hostile,
    "setup-locale-hostile": _setup_locale_hostile,
    "setup-taxonomy-hostile": _setup_taxonomy_hostile,
    "setup-review-hostile": _setup_review_hostile,
    "exact-search": _exact_search,
    "exact-search-hostile": _exact_search_hostile,
    "exact-card-preview-hostile": _exact_card_preview_hostile,
    "servers-hostile": _servers_hostile,
    "server-details-hostile": _server_details_hostile,
    "device-link-hostile": _device_link_hostile,
    "home-recovery": _home_recovery,
    "notification-hostile": _notification_hostile,
    "confirmation-exit": _confirmation_exit,
    "confirmation-hostile": _confirmation_hostile,
    "diagnostics-long": _diagnostics_long,
    "lobby-worst-first": _lobby_worst_first,
    "lobby-worst-middle": _lobby_worst_middle,
    "lobby-worst-last": _lobby_worst_last,
    "lobby-worst-address-5": _lobby_address_five,
    "lobby-max-join-url": _lobby_max_join_url,
    "room-game-worst-first": _room_game_worst_first,
    "room-game-worst-middle": _room_game_worst_middle,
    "room-game-worst-last": _room_game_worst_last,
    "room-game-marquee-timing": _room_game_marquee_timing,
    "room-waiting": _room_waiting,
    "room-choice": _room_choice,
    "room-pool-exhausted": _room_pool_exhausted,
    "room-reconnecting": _room_reconnecting,
    "room-host-awaiting-first": _room_host_awaiting_first,
    "room-host-reconnecting": _room_host_reconnecting,
    "room-host-awaiting-replacement": _room_host_awaiting_replacement,
    "room-ended-open": _room_ended_open,
    "couch-menu-four-actions": _couch_menu_four_actions,
    "couch-sync-required": _couch_sync_required,
    "couch-waiting": _couch_waiting,
    "couch-choice": _couch_choice,
    "couch-pool-exhausted": _couch_pool_exhausted,
    "couch-voters-9": _couch_voters_nine,
    "couch-voter-page-complete": _couch_voter_page_complete,
    "couch-voters-1000-final": _couch_voters_thousand_final,
    "named-first": _named_first,
    "named-middle": _named_middle,
    "named-last": _named_last,
    "couch-classification-hostile": _couch_classification_hostile,
    "anonymous-aggregate-result": _anonymous_aggregate_result,
    "conversation-meta-card": _conversation_meta_card,
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
    if len(HOSTILE_GROUP["name"]) != MAXIMUM_GROUP_NAME_LENGTH:
        raise AssertionError("Hostile Group name must use the 80-character API limit")
    if any(len(name) != MAXIMUM_NAME_LENGTH for name in HOSTILE_GROUP["members"]):
        raise AssertionError("Hostile Group members must use the 40-character player limit")
    if len(HOSTILE_LOCALE["nativeName"]) != MAXIMUM_LOCALE_NAME_LENGTH:
        raise AssertionError("Hostile locale name must use the 80-character catalog limit")
    if len(HOSTILE_SERVER.display_name) != 80:
        raise AssertionError("Hostile server name must use the 80-character API limit")
    if (
        len(HOSTILE_SERVER.origin) != MAXIMUM_SERVER_ORIGIN_LENGTH
        or not HOSTILE_SERVER.origin.endswith("ORIGIN-END")
    ):
        raise AssertionError("Hostile server origin must use the 500-character API limit")
    if len(HOSTILE_TAXONOMY_LABEL) != MAXIMUM_TAXONOMY_LABEL_LENGTH:
        raise AssertionError("Hostile taxonomy label must use the 200-character catalog limit")
    if (
        len(HOSTILE_PROFILE["name"]) != MAXIMUM_PROFILE_NAME_LENGTH
        or len(HOSTILE_PROFILE["description"])
        != MAXIMUM_PROFILE_DESCRIPTION_LENGTH
    ):
        raise AssertionError("Hostile profile copy must use both protocol limits")
    if len(HOSTILE_JOIN_PATH) != MAXIMUM_JOIN_PATH_LENGTH:
        raise AssertionError("Hostile join path must use the 500-character endpoint limit")
    if (
        len(HOSTILE_DEVICE_USER_CODE) != MAXIMUM_DEVICE_USER_CODE_LENGTH
        or len(HOSTILE_DEVICE_VERIFICATION_URI)
        != MAXIMUM_DEVICE_VERIFICATION_URI_LENGTH
    ):
        raise AssertionError("Hostile device-link copy must use its validated limits")
    if (
        len(HOSTILE_CONFIRMATION_TITLE) != 160
        or len(HOSTILE_CONFIRMATION_BODY) != 500
    ):
        raise AssertionError("Hostile confirmation copy must keep its fixture boundaries")
    for player_name, terminal_marker in (
        (HOSTILE_SETUP_PLAYER_NAME, "_PLAYER_END"),
        (HOSTILE_GROUP_MEMBER_NAME, "_MEMBER_END"),
        (HOSTILE_HOST_NAME, "_HOST_END"),
    ):
        if len(player_name) != MAXIMUM_NAME_LENGTH or not player_name.endswith(
            terminal_marker
        ):
            raise AssertionError(
                "Hostile player and Host names must use the complete 40-character limit"
            )


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
        if name in {
            "setup-player-profile-hostile",
            "group-member-profile-hostile",
        }:
            expected_name = (
                HOSTILE_SETUP_PLAYER_NAME
                if name == "setup-player-profile-hostile"
                else HOSTILE_GROUP_MEMBER_NAME
            )
            if (
                view.view_mode != "player-profile"
                or len(view.facts) != 2
                or view.facts[0].value.literal != expected_name
                or [entry.key for entry in view.actions][-1] != "nav:back"
            ):
                raise AssertionError(
                    "Player-profile fixtures must preserve the complete 40-character name"
                )
        if name == "couch-menu-four-actions":
            if [entry.key for entry in view.actions] != [
                "couch:resume",
                "couch:menu-help",
                "couch:end",
                "app:exit",
            ]:
                raise AssertionError("Couch options must expose all four current actions")
        if name == "couch-sync-required":
            if (
                view.body.message_id != strings.COUCH_SYNC_BODY
                or [entry.key for entry in view.actions]
                != ["couch:resync", "couch:end"]
                or view.current_player.literal
                or view.card_intensity.literal
                or view.game_intensity.literal
                or not (view.card_text.literal or "").startswith(
                    "START OF MAXIMUM CARD."
                )
            ):
                raise AssertionError(
                    "Couch sync-required must preserve the Card and only offer recovery actions"
                )
        if name == "couch-waiting":
            if (
                view.card_text.message_id != strings.READY_NEXT_CARD
                or [entry.key for entry in view.actions] != ["couch:start"]
                or view.card_eyebrow.literal
                or view.card_classification.literal
            ):
                raise AssertionError("Couch waiting must show the next-Card gate")
        if name == "couch-choice":
            if (
                view.card_text.message_id != strings.CHOOSE_TRUTH_OR_DARE
                or [entry.key for entry in view.actions]
                != ["couch:choose:QUESTION", "couch:choose:DARE"]
                or view.card_eyebrow.literal
            ):
                raise AssertionError("Couch choice must expose Truth and Dare together")
        if name == "couch-pool-exhausted":
            if (
                view.card_eyebrow.message_id != strings.POOL_EXHAUSTED
                or view.card_text.message_id != strings.POOL_EXHAUSTED_BODY
                or [entry.key for entry in view.actions]
                != ["couch:adjust", "couch:end"]
            ):
                raise AssertionError("Couch pool exhaustion must expose both recovery actions")
        if name in {
            "room-waiting",
            "room-choice",
            "room-pool-exhausted",
            "room-reconnecting",
        }:
            expected_card_message = {
                "room-waiting": strings.READY_NEXT_CARD,
                "room-choice": strings.TRUTH_DARE_DEVICE_CHOICE,
                "room-pool-exhausted": strings.POOL_EXHAUSTED_BODY,
            }.get(name)
            if (
                view.view_mode != "card"
                or view.actions
                or len(view.roster) != GAME_ROSTER_PAGE_SIZE
                or (
                    expected_card_message is not None
                    and view.card_text.message_id != expected_card_message
                )
                or (
                    name == "room-reconnecting"
                    and view.body.message_id != strings.RECONNECTING_BODY
                )
            ):
                raise AssertionError(
                    "Passive Room stage fixtures must retain their distinct server state"
                )
        if name in {
            "room-host-awaiting-first",
            "room-host-reconnecting",
            "room-host-awaiting-replacement",
        }:
            expected_status = {
                "room-host-awaiting-first": strings.AWAITING_FIRST_HOST,
                "room-host-reconnecting": strings.HOST_RECONNECTING,
                "room-host-awaiting-replacement": strings.AWAITING_REPLACEMENT,
            }[name]
            if (
                view.view_mode != "lobby"
                or view.body.message_id != expected_status
                or (name == "room-host-reconnecting" and view.body.arguments != (HOSTILE_HOST_NAME,))
            ):
                raise AssertionError("Room Host fixtures must preserve all three host states")
        if name == "anonymous-aggregate-result":
            if (
                view.result_yes.arguments != (ROOM_PLAYER_COUNT - 1,)
                or view.result_no.arguments != (1,)
                or view.result_yes_players
                or view.result_no_players
                or view.result_yes_names.literal
                or view.result_no_names.literal
                or view.result_status.literal
                or (view.card_text.literal or "").replace("\n", "")
                != ANONYMOUS_RESULT_CARD_TEXT
            ):
                raise AssertionError(
                    "Anonymous NHIE results must expose totals without revealing identities"
                )
        if name == "conversation-meta-card":
            if (
                view.atmosphere != "CONVERSATION_META_5"
                or view.card_eyebrow.message_id != strings.CONVERSATION_META
                or view.card_classification.literal
                or (view.card_text.literal or "").replace("\n", "")
                != CONVERSATION_META_CARD_TEXT
            ):
                raise AssertionError(
                    "Conversation Meta must retain its dedicated Card and atmosphere"
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
        if name == "setup-groups-hostile":
            group = view.items[0]
            if (
                len(group.label.literal or "") != MAXIMUM_GROUP_NAME_LENGTH
                or not (group.label.literal or "").endswith("_GROUP_END")
                or not (group.secondary.literal or "").endswith("· +1")
                or "_M2_END" not in (group.secondary.literal or "")
            ):
                raise AssertionError("Hostile Group fixture must preserve its name and preview")
        if name == "setup-rule-hostile":
            rule_name = view.items[0].label.literal or ""
            if len(rule_name) != MAXIMUM_RULE_NAME_LENGTH or not rule_name.endswith(
                "_RULE_END"
            ):
                raise AssertionError("Hostile rule fixture must preserve its complete name")
        if name == "setup-locale-hostile":
            locale_name = view.items[0].label.literal or ""
            if len(locale_name) != MAXIMUM_LOCALE_NAME_LENGTH or not locale_name.endswith(
                "_LOCALE_END"
            ):
                raise AssertionError("Hostile locale fixture must preserve its complete name")
        if name == "setup-taxonomy-hostile":
            taxonomy_name = view.items[0].label.literal or ""
            if (
                len(taxonomy_name) != MAXIMUM_TAXONOMY_LABEL_LENGTH
                or not taxonomy_name.endswith("_TAXONOMY_END")
            ):
                raise AssertionError("Hostile taxonomy fixture must preserve its complete label")
        if name == "setup-profile-hostile":
            profile_name = view.items[0].label.literal or ""
            description = view.items[0].secondary.literal or ""
            if (
                len(profile_name) != MAXIMUM_PROFILE_NAME_LENGTH
                or not profile_name.endswith("_NAME_END")
                or len(description) != MAXIMUM_PROFILE_DESCRIPTION_LENGTH
                or not description.endswith("_DESCRIPTION_END")
            ):
                raise AssertionError("Hostile profile fixture must preserve both accepted limits")
        if name == "setup-review-hostile":
            group_name = view.facts[2].value.literal or ""
            if (
                view.view_mode != "summary"
                or len(view.facts) != 7
                or len(group_name) != MAXIMUM_GROUP_NAME_LENGTH
                or not group_name.endswith("_GROUP_END")
                or view.facts[6].label.message_id != strings.CARDS
                or view.facts[6].value.literal != str(MAXIMUM_COUNTER)
            ):
                raise AssertionError(
                    "Hostile review fixture must render all seven facts and its complete Group"
                )
        if name == "exact-search-hostile":
            card_text = view.items[0].label.literal or ""
            query = view.actions[0].secondary.literal or ""
            if (
                len(card_text) != 10_000
                or not card_text.endswith("END OF MAXIMUM CARD.")
                or len(query) != MAXIMUM_SEARCH_QUERY_LENGTH
                or not query.endswith("_QUERY_END")
            ):
                raise AssertionError("Hostile exact-Card search must preserve Card and query text")
        if name == "exact-card-preview-hostile":
            if (
                view.view_mode != "card"
                or view.card_page_count <= 1
                or not (view.card_text.literal or "").startswith(
                    "START OF MAXIMUM CARD."
                )
                or [entry.key for entry in view.actions]
                != ["setup:card:configure", "nav:back"]
            ):
                raise AssertionError(
                    "Hostile exact-Card preview must expose complete explicit Card pages"
                )
        if name == "help-title-hostile":
            title = view.heading.literal or ""
            if len(title) != HOSTILE_HELP_TITLE_LENGTH or not title.endswith("_HELP_END"):
                raise AssertionError("Hostile Help fixture must preserve its complete title")
        if name in {"servers-hostile", "server-details-hostile"}:
            server_name = (
                view.items[0].label.literal
                if name == "servers-hostile"
                else view.heading.literal
            ) or ""
            if len(server_name) != 80 or not server_name.endswith("_SERVER_END"):
                raise AssertionError("Hostile server fixture must preserve its complete name")
            origin = (
                view.items[0].secondary.literal
                if name == "servers-hostile"
                else view.facts[0].value.literal
            ) or ""
            if (
                len(origin.replace("\n", "")) != MAXIMUM_SERVER_ORIGIN_LENGTH
                or not origin.replace("\n", "").endswith("ORIGIN-END")
            ):
                raise AssertionError("Hostile server fixture must preserve its maximum origin")
        if name == "device-link-hostile":
            user_code = str(view.heading.arguments[0]) if view.heading.arguments else ""
            uri = view.footer.literal or ""
            if (
                len(user_code) != MAXIMUM_DEVICE_USER_CODE_LENGTH
                or not user_code.endswith("_DEVICE_CODE_END")
                or len(uri) != MAXIMUM_DEVICE_VERIFICATION_URI_LENGTH
                or not uri.endswith("DEVICE-URI-END")
            ):
                raise AssertionError("Hostile device-link fixture must preserve bounded response copy")
        if name == "lobby-max-join-url":
            join_url = (view.join_urls.literal or "").replace("\n", "")
            expected_join_url = (
                f"{HOSTILE_SERVER.origin}/"
                f"{HOSTILE_JOIN_PATH.lstrip('/').replace('{roomCode}', ROOM_CODE)}"
            )
            if join_url != expected_join_url or not join_url.endswith("_JOIN_END"):
                raise AssertionError("Hostile lobby fixture must preserve its complete join URL")
        if name == "couch-classification-hostile":
            classification = view.card_classification.literal or ""
            if (
                len(classification) != MAXIMUM_TAXONOMY_LABEL_LENGTH
                or not classification.endswith("_TAXONOMY_END")
                or not (view.result_yes.literal or view.result_yes.message_id)
            ):
                raise AssertionError("Hostile Couch result must preserve its full classification")
        if name == "notification-hostile":
            notice = state.notification.literal if state.notification else ""
            if len(notice or "") != MAXIMUM_NOTIFICATION_LENGTH or not str(notice).endswith(
                "_NOTICE_END"
            ):
                raise AssertionError("Hostile notification must use the 500-character limit")
        if name in {"confirmation-exit", "confirmation-hostile"} and state.confirmation is None:
            raise AssertionError("Confirmation fixture must open the production exit prompt")
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
            "exact-card-preview-hostile",
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
            if scenario == "notification-hostile" and self.state.notification:
                # Keep the deterministic boundary fixture visible long enough for
                # start/end captures; production notifications retain their timeout.
                self._last_notification = time.monotonic()
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
        def _resolve(self, value) -> str:
            if scenario == "confirmation-hostile" and value is not None:
                message_id = getattr(value, "message_id", None)
                if message_id == strings.EXIT_ADDON_TITLE:
                    return HOSTILE_CONFIRMATION_TITLE
                if message_id == strings.EXIT_ADDON_BODY:
                    return HOSTILE_CONFIRMATION_BODY
            return super()._resolve(value)

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
