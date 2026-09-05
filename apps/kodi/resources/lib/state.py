"""Immutable-by-convention application state and pending-game setup helpers."""

from __future__ import annotations

import copy
from dataclasses import dataclass, field, replace
from typing import cast, Any, Mapping, Optional

from .native_settings_metadata import (
    AUTO_PAGE_SECONDS,
    DISPLAY_NAME,
    LOCALE,
    SETTING_DEFAULTS,
)
from .protocol.validation import (
    ANONYMOUS_REVEAL_MODE,
    DATASPACE_SESSION_PERSISTENCE,
    EPHEMERAL_SESSION_PERSISTENCE,
)
from .routes import Route
from .strings import Text


JsonObject = Mapping[str, Any]


EMPTY_SESSION_POLICY: JsonObject = {
    "scopeDefault": {},
    "conditionalRules": [],
    "exactCards": [],
}


@dataclass(frozen=True)
class Preferences:
    schema_version: int = 1
    locale: str = str(SETTING_DEFAULTS[LOCALE])
    auto_page_seconds: int = int(SETTING_DEFAULTS[AUTO_PAGE_SECONDS])
    display_name: str = str(SETTING_DEFAULTS[DISPLAY_NAME])
    last_server_id: Optional[str] = None


@dataclass(frozen=True)
class ServerRecord:
    server_id: str
    origin: str
    display_name: str
    deployment_mode: str
    source: str
    last_seen: float
    capabilities: JsonObject = field(default_factory=dict)
    endpoints: JsonObject = field(default_factory=dict)
    available: bool = True


@dataclass(frozen=True)
class SetupDraft:
    topology: str
    persistence: str
    group_choice: Optional[str]
    group_id: Optional[str]
    mode: str
    profile_id: str
    players: tuple[str, ...]
    adult_content_confirmed: bool
    card_locale: str
    card_fallback_enabled: bool
    card_fallback_locales: tuple[str, ...]
    never_reveal_mode: str
    configuration: JsonObject
    card_policy: JsonObject
    eligibility: Optional[JsonObject] = None
    selected_rule_id: Optional[str] = None
    selected_card_id: Optional[str] = None
    policy_facet: Optional[str] = None
    card_search_query: str = ""
    card_search_results: tuple[JsonObject, ...] = ()
    card_search_cursor: Optional[str] = None
    card_search_next_cursor: Optional[str] = None
    card_search_cursor_history: tuple[Optional[str], ...] = ()
    card_search_total: int = 0
    selected_player_index: Optional[int] = None
    option_editor: Optional[str] = None
    selected_fallback_locale: Optional[str] = None

    def room_settings(self) -> dict[str, Any]:
        fallback_enabled = self.card_fallback_enabled and bool(
            self.card_fallback_locales
        )
        return {
            "mode": self.mode,
            "profileId": self.profile_id,
            "groupId": self.group_id,
            "adultContentConfirmed": self.adult_content_confirmed,
            "cardLocale": self.card_locale,
            "cardFallbackEnabled": fallback_enabled,
            "cardFallbackLocales": list(self.card_fallback_locales),
            "neverHaveIEverRevealMode": self.never_reveal_mode,
            "configuration": copy.deepcopy(dict(self.configuration)),
            "cardPolicy": copy.deepcopy(dict(self.card_policy)),
        }

    def couch_request(self) -> dict[str, Any]:
        settings = self.room_settings()
        settings.pop("groupId")
        return {
            "persistence": self.persistence,
            "mode": self.mode,
            "players": [{"name": name} for name in self.players],
            "configuration": settings["configuration"],
            "profileId": self.profile_id,
            "adultContentConfirmed": self.adult_content_confirmed,
            "groupId": self.group_id,
            "cardLocale": self.card_locale,
            "cardFallbackEnabled": settings["cardFallbackEnabled"],
            "cardFallbackLocales": list(self.card_fallback_locales),
            "neverHaveIEverRevealMode": self.never_reveal_mode,
            "cardPolicy": settings["cardPolicy"],
        }


@dataclass(frozen=True)
class ActiveRoom:
    room_id: str
    room_code: str
    participant_id: str
    credential_reference: str
    role: str
    bootstrap_mode: str


@dataclass(frozen=True)
class RecoveryEnvelope:
    schema_version: int
    server_id: str
    origin: str
    mode: str
    created_at: float
    last_connected_at: float
    couch_session_id: Optional[str] = None
    room_code: Optional[str] = None
    participant_id: Optional[str] = None
    credential_reference: Optional[str] = None
    protocol_version: Optional[int] = None


@dataclass(frozen=True)
class Confirmation:
    title_id: int
    body_id: int
    action_id: int
    confirm_action: str


@dataclass(frozen=True)
class AppState:
    lifecycle: str = "CREATED"
    route: Route = Route.BOOTSTRAP
    route_stack: tuple[Route, ...] = ()
    preferences: Preferences = field(default_factory=Preferences)
    servers: tuple[ServerRecord, ...] = ()
    selected_server_id: Optional[str] = None
    server_details_id: Optional[str] = None
    server_info: Optional[JsonObject] = None
    profiles: tuple[JsonObject, ...] = ()
    groups: tuple[JsonObject, ...] = ()
    locales: tuple[JsonObject, ...] = ()
    default_card_locale: str = "de-DE"
    taxonomy: Optional[JsonObject] = None
    taxonomy_locale: Optional[str] = None
    game_settings: Optional[JsonObject] = None
    setup: Optional[SetupDraft] = None
    couch_snapshot: Optional[JsonObject] = None
    active_room: Optional[ActiveRoom] = None
    room_snapshot: Optional[JsonObject] = None
    room_eligibility: Optional[JsonObject] = None
    room_eligibility_signature: Optional[str] = None
    transport_state: str = "DISCONNECTED"
    busy_operation: Optional[str] = None
    notification: Optional[Text] = None
    confirmation: Optional[Confirmation] = None
    recovery: Optional[RecoveryEnvelope] = None
    focus_memory: JsonObject = field(default_factory=dict)
    diagnostics: tuple[JsonObject, ...] = ()
    authorization: Optional[JsonObject] = None
    qr_path: Optional[str] = None
    help_topics: tuple[JsonObject, ...] = ()
    help_slug: Optional[str] = None
    help_title: str = ""
    help_body: str = ""
    help_page: int = 0
    group_draft_id: Optional[str] = None
    group_draft_name: str = ""
    group_draft_members: tuple[str, ...] = ()
    group_draft_member_index: Optional[int] = None
    couch_vote_player_id: Optional[str] = None
    couch_vote_phase: str = "SELECT"
    couch_sync_required: bool = False
    couch_pool_exhausted: bool = False
    couch_end_destination: Optional[Route] = None
    leave_destination: Route = Route.HOME
    auto_page: int = 0
    auto_page_epoch: int = 0
    collection_page: int = 0
    card_page: int = 0
    revision: int = 0


def copy_mapping(value: Mapping[str, Any]) -> dict[str, Any]:
    return copy.deepcopy(dict(value))


def configuration_from_profile(profile: Mapping[str, Any]) -> dict[str, Any]:
    keys = (
        "enabledQuestionCategoryIds",
        "enabledDareTypeIds",
        "blockedOperationalFlags",
        "maximumSocialSensitivity",
        "startingIntensity",
        "maximumIntensity",
        "intensityProgressionUnit",
        "intensityProgressionInterval",
        "intensityProgressionIncrement",
        "randomQuestionRatio",
        "maximumTypeStreak",
        "letsTalkMetaInterval",
    )
    return {key: copy.deepcopy(profile[key]) for key in keys}


def initial_setup(
    topology: str,
    default_locale: str,
    persistent_access: bool,
) -> SetupDraft:
    # A profile tile is itself the forward action. Keep the draft neutral until
    # the player deliberately selects one instead of painting an arbitrary tile
    # as selected when the step first opens.
    configuration = {
        "enabledQuestionCategoryIds": [],
        "enabledDareTypeIds": [],
        "blockedOperationalFlags": [],
        "maximumSocialSensitivity": "GENERAL",
        "startingIntensity": 1,
        "maximumIntensity": 1,
        "intensityProgressionUnit": "CARDS",
        "intensityProgressionInterval": 2,
        "intensityProgressionIncrement": 1,
        "randomQuestionRatio": 0.5,
        "maximumTypeStreak": 3,
        "letsTalkMetaInterval": 5,
    }
    return SetupDraft(
        topology=topology,
        persistence=(
            DATASPACE_SESSION_PERSISTENCE
            if persistent_access
            else EPHEMERAL_SESSION_PERSISTENCE
        ),
        group_choice=None,
        group_id=None,
        # The mode card itself advances this step, so nothing is selected
        # before the player has made that choice.
        mode="",
        profile_id="",
        players=(),
        adult_content_confirmed=False,
        card_locale=default_locale,
        card_fallback_enabled=False,
        card_fallback_locales=(),
        never_reveal_mode=ANONYMOUS_REVEAL_MODE,
        configuration=configuration,
        card_policy=copy_mapping(EMPTY_SESSION_POLICY),
    )


def bump(state: AppState, **changes: Any) -> AppState:
    return cast(AppState, replace(state, revision=state.revision + 1, **changes))
