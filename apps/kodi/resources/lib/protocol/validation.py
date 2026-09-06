"""Small runtime validator backed by generated schemas/fixtures for drift tests.

Kodi ships no guaranteed JSON Schema engine. Runtime checks therefore validate the
security- and rendering-relevant subset while generated JSON Schemas remain the source
artifact used in CI and integration tests.
"""

from __future__ import annotations

import json
import math
import re
import uuid
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlsplit

from ..contract_data import generated_enums

_ENUMS = generated_enums()
_CONSTRAINTS = _ENUMS["constraints"]
ROOM_GAME_SETTING_CONSTRAINTS = _CONSTRAINTS["roomGameSettings"]
PROTOCOL_VERSION = int(_ENUMS["protocolVersion"])
MAX_MESSAGE_BYTES = int(_CONSTRAINTS["maximumWebSocketMessageBytes"])
ROOM_CODE = re.compile(str(_CONSTRAINTS["roomCodePattern"]))
HOST_STATE_ORDER = tuple(_ENUMS["roomHostStates"])
(
    AWAITING_FIRST_HOST_STATE,
    CONNECTING_HOST_STATE,
    CONNECTED_HOST_STATE,
    RECONNECTING_HOST_STATE,
    AWAITING_REPLACEMENT_HOST_STATE,
) = HOST_STATE_ORDER
HOST_STATES = frozenset(HOST_STATE_ORDER)
PRE_CONNECTION_HOST_STATES = frozenset(
    (
        AWAITING_FIRST_HOST_STATE,
        AWAITING_REPLACEMENT_HOST_STATE,
        RECONNECTING_HOST_STATE,
    )
)
DISPLAY_ACTIONS = {"DISPLAY_SESSION", "LEAVE_ROOM"}
SESSION_STATES = frozenset(_ENUMS["sessionStates"])
GAME_MODES = frozenset(_ENUMS["gameModes"])
CARD_TYPES = frozenset(_ENUMS["cardTypes"])
INTENSITY_LEVELS = frozenset(_ENUMS["intensityLevels"])
ROOM_ROLES = frozenset(_ENUMS["clientRoles"])
ROOM_BOOTSTRAP_MODES = frozenset(_ENUMS["roomBootstrapModes"])
ROLE_CHANGE_REASONS = frozenset(_ENUMS["roomRoleChangeReasons"])
PROTOCOL_ERROR_CODES = frozenset(_ENUMS["protocolErrorCodes"])
SOCIAL_SENSITIVITIES = frozenset(_ENUMS["socialSensitivities"])
INTENSITY_PROGRESSION_UNITS = frozenset(_ENUMS["intensityProgressionUnits"])
CARD_LIFECYCLE_ORDER = tuple(_ENUMS["cardLifecycles"])
ACTIVE_CARD_LIFECYCLE, RETIRED_CARD_LIFECYCLE = CARD_LIFECYCLE_ORDER
CARD_LIFECYCLES = frozenset(CARD_LIFECYCLE_ORDER)
SESSION_PERSISTENCE_ORDER = tuple(_ENUMS["sessionPersistenceModes"])
EPHEMERAL_SESSION_PERSISTENCE, DATASPACE_SESSION_PERSISTENCE = SESSION_PERSISTENCE_ORDER
SESSION_PERSISTENCE_MODES = frozenset(SESSION_PERSISTENCE_ORDER)
NEVER_HAVE_I_EVER_VOTE_STATUS_ORDER = tuple(_ENUMS["neverHaveIEverVoteStatuses"])
PENDING_VOTE_STATUS, VOTED_VOTE_STATUS = NEVER_HAVE_I_EVER_VOTE_STATUS_ORDER
NEVER_HAVE_I_EVER_VOTE_STATUSES = frozenset(NEVER_HAVE_I_EVER_VOTE_STATUS_ORDER)
NEVER_HAVE_I_EVER_VOTE_VALUE_ORDER = tuple(_ENUMS["neverHaveIEverVoteValues"])
YES_VOTE, NO_VOTE = NEVER_HAVE_I_EVER_VOTE_VALUE_ORDER
NEVER_HAVE_I_EVER_VOTE_VALUES = frozenset(NEVER_HAVE_I_EVER_VOTE_VALUE_ORDER)
PARTICIPANT_LEFT_REASON_ORDER = tuple(_ENUMS["participantLeftReasons"])
LEFT_PARTICIPANT_REASON, DISCONNECT_EXPIRED_PARTICIPANT_REASON = (
    PARTICIPANT_LEFT_REASON_ORDER
)
PARTICIPANT_LEFT_REASONS = frozenset(PARTICIPANT_LEFT_REASON_ORDER)
CARD_REPLACEMENT_REASON_ORDER = tuple(_ENUMS["cardReplacementReasons"])
SKIPPED_CARD_REPLACEMENT_REASON, VETOED_CARD_REPLACEMENT_REASON = (
    CARD_REPLACEMENT_REASON_ORDER
)
CARD_REPLACEMENT_REASONS = frozenset(CARD_REPLACEMENT_REASON_ORDER)
PARTICIPANT_CONNECTION_STATUS_ORDER = tuple(_ENUMS["participantConnectionStatuses"])
CONNECTED_PARTICIPANT_STATUS, TEMPORARILY_DISCONNECTED_PARTICIPANT_STATUS = (
    PARTICIPANT_CONNECTION_STATUS_ORDER
)
PARTICIPANT_CONNECTION_STATUSES = frozenset(PARTICIPANT_CONNECTION_STATUS_ORDER)
NEVER_HAVE_I_EVER_REVEAL_MODE_ORDER = tuple(_ENUMS["neverHaveIEverRevealModes"])
ANONYMOUS_REVEAL_MODE, NAMED_REVEAL_MODE = NEVER_HAVE_I_EVER_REVEAL_MODE_ORDER
NEVER_HAVE_I_EVER_REVEAL_MODES = frozenset(NEVER_HAVE_I_EVER_REVEAL_MODE_ORDER)


class ProtocolViolation(ValueError):
    """A remote value violated a required protocol invariant."""


def generated_data_root() -> Path:
    return Path(__file__).resolve().parents[2] / "data"


def load_generated_json(relative_path: str) -> Any:
    target = generated_data_root() / relative_path
    with target.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _mapping(value: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ProtocolViolation(f"{name} must be an object")
    return value


def _string(value: Any, name: str, minimum: int = 1, maximum: int = 500) -> str:
    if not isinstance(value, str) or not minimum <= len(value) <= maximum:
        raise ProtocolViolation(f"{name} must be a bounded string")
    return value


def _integer(
    value: Any, name: str, minimum: int = 0, maximum: int | None = None
) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < minimum
        or (maximum is not None and value > maximum)
    ):
        raise ProtocolViolation(f"{name} must be an integer greater than or equal to {minimum}")
    return value


def _number(value: Any, name: str, minimum: float, maximum: float) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not minimum <= value <= maximum
    ):
        raise ProtocolViolation(f"{name} must be a finite number from {minimum} to {maximum}")
    return float(value)


def _boolean(value: Any, name: str) -> bool:
    if not isinstance(value, bool):
        raise ProtocolViolation(f"{name} must be boolean")
    return value


def _list(value: Any, name: str, maximum: int, minimum: int = 0) -> list[Any]:
    if not isinstance(value, list) or not minimum <= len(value) <= maximum:
        raise ProtocolViolation(f"{name} must be a bounded list")
    return value


def _string_list(
    value: Any,
    name: str,
    maximum_items: int,
    maximum_length: int = 100,
    unique: bool = True,
) -> list[str]:
    result = _list(value, name, maximum_items)
    for index, entry in enumerate(result):
        _string(entry, f"{name}[{index}]", 1, maximum_length)
    if unique and len({entry.casefold() for entry in result}) != len(result):
        raise ProtocolViolation(f"{name} must contain unique values")
    return result


def _uuid(value: Any, name: str) -> str:
    result = _string(value, name, 36, 36)
    try:
        parsed = uuid.UUID(result)
    except (AttributeError, ValueError) as error:
        raise ProtocolViolation(f"{name} must be a UUID") from error
    is_boundary_form = parsed.int in {0, (1 << 128) - 1}
    if str(parsed) != result.lower() or (
        not is_boundary_form
        and (parsed.variant != uuid.RFC_4122 or parsed.version not in range(1, 9))
    ):
        raise ProtocolViolation(f"{name} must be a UUID")
    return result


def _optional_string(value: Any, name: str, maximum: int = 100) -> str | None:
    if value is None:
        return None
    return _string(value, name, 1, maximum)


def _validate_current_card(value: Any, name: str) -> Mapping[str, Any]:
    card = _mapping(value, name)
    _uuid(card.get("id"), f"{name}.id")
    _string(card.get("cardText"), f"{name}.cardText", 0, 10_000)
    card_type = card.get("cardType")
    if card_type not in CARD_TYPES:
        raise ProtocolViolation(f"{name}.cardType is invalid")
    _integer(card.get("intensity"), f"{name}.intensity", 1, 5)
    _integer(card.get("cardIntensity"), f"{name}.cardIntensity", 1, 5)
    question = _optional_string(card.get("questionCategoryId"), f"{name}.questionCategoryId")
    dare = _optional_string(card.get("dareTypeId"), f"{name}.dareTypeId")
    if card_type == "QUESTION" and (question is None or dare is not None):
        raise ProtocolViolation(f"{name} has inconsistent Question taxonomy")
    if card_type == "DARE" and (dare is None or question is not None):
        raise ProtocolViolation(f"{name} has inconsistent Dare taxonomy")
    if card_type == "CONVERSATION_META" and dare is not None:
        raise ProtocolViolation(f"{name} has Dare taxonomy on a conversation meta Card")
    return card


def _relative_endpoint(value: Any, name: str) -> str:
    result = _string(value, name, 1, 500)
    parsed = urlsplit(result)
    if not result.startswith("/") or result.startswith("//"):
        raise ProtocolViolation(f"{name} must be same-origin relative")
    if parsed.scheme or parsed.netloc or parsed.username or parsed.password:
        raise ProtocolViolation(f"{name} must not contain an authority")
    return result


def _http_origin(value: Any, name: str) -> str:
    result = _string(value, name, 1, 500)
    parsed = urlsplit(result)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ProtocolViolation(f"{name} must be an HTTP(S) origin")
    try:
        parsed.port
    except ValueError as error:
        raise ProtocolViolation(f"{name} has an invalid port") from error
    return result


def _validate_configuration(value: Any, name: str) -> Mapping[str, Any]:
    configuration = _mapping(value, name)
    _string_list(configuration.get("enabledQuestionCategoryIds"), f"{name}.question categories", 100)
    _string_list(configuration.get("enabledDareTypeIds"), f"{name}.DareTypes", 100)
    _string_list(configuration.get("blockedOperationalFlags"), f"{name}.operational flags", 100)
    if configuration.get("maximumSocialSensitivity") not in SOCIAL_SENSITIVITIES:
        raise ProtocolViolation(f"{name}.maximumSocialSensitivity is invalid")
    starting = _integer(
        configuration.get("startingIntensity"),
        f"{name}.startingIntensity",
        min(INTENSITY_LEVELS),
        max(INTENSITY_LEVELS),
    )
    maximum = _integer(
        configuration.get("maximumIntensity"),
        f"{name}.maximumIntensity",
        min(INTENSITY_LEVELS),
        max(INTENSITY_LEVELS),
    )
    if starting > maximum:
        raise ProtocolViolation(f"{name}.startingIntensity exceeds maximumIntensity")
    if configuration.get("intensityProgressionUnit") not in INTENSITY_PROGRESSION_UNITS:
        raise ProtocolViolation(f"{name}.intensityProgressionUnit is invalid")
    _integer(
        configuration.get("intensityProgressionInterval"),
        f"{name}.intensityProgressionInterval",
        ROOM_GAME_SETTING_CONSTRAINTS["intensityProgressionInterval"]["minimum"],
        ROOM_GAME_SETTING_CONSTRAINTS["intensityProgressionInterval"]["maximum"],
    )
    increment = _number(
        configuration.get("intensityProgressionIncrement"),
        f"{name}.intensityProgressionIncrement",
        ROOM_GAME_SETTING_CONSTRAINTS["intensityProgressionIncrement"]["minimum"],
        ROOM_GAME_SETTING_CONSTRAINTS["intensityProgressionIncrement"]["maximum"],
    )
    increment_step = ROOM_GAME_SETTING_CONSTRAINTS["intensityProgressionIncrement"]["step"]
    if not (increment / increment_step).is_integer():
        raise ProtocolViolation(f"{name}.intensityProgressionIncrement must use half steps")
    _number(
        configuration.get("randomQuestionRatio"),
        f"{name}.randomQuestionRatio",
        ROOM_GAME_SETTING_CONSTRAINTS["randomQuestionRatio"]["minimum"],
        ROOM_GAME_SETTING_CONSTRAINTS["randomQuestionRatio"]["maximum"],
    )
    _integer(
        configuration.get("maximumTypeStreak"),
        f"{name}.maximumTypeStreak",
        ROOM_GAME_SETTING_CONSTRAINTS["maximumTypeStreak"]["minimum"],
        ROOM_GAME_SETTING_CONSTRAINTS["maximumTypeStreak"]["maximum"],
    )
    _integer(
        configuration.get("letsTalkMetaInterval"),
        f"{name}.letsTalkMetaInterval",
        ROOM_GAME_SETTING_CONSTRAINTS["letsTalkMetaInterval"]["minimum"],
        ROOM_GAME_SETTING_CONSTRAINTS["letsTalkMetaInterval"]["maximum"],
    )
    return configuration


def _validate_card_language_settings(value: Any, name: str) -> None:
    if value is None:
        return
    settings = _mapping(value, name)
    locale = _string(settings.get("cardLocale"), f"{name}.cardLocale", 2, 35)
    _boolean(settings.get("cardFallbackEnabled"), f"{name}.cardFallbackEnabled")
    fallbacks = _string_list(
        settings.get("cardFallbackLocales"), f"{name}.cardFallbackLocales", 100, 35
    )
    if locale.casefold() in {entry.casefold() for entry in fallbacks}:
        raise ProtocolViolation(f"{name}.cardFallbackLocales includes the primary locale")


def _validate_group(value: Any, name: str = "Group") -> dict[str, Any]:
    group = dict(_mapping(value, name))
    _uuid(group.get("id"), f"{name}.id")
    _string(group.get("name"), f"{name}.name", 1, 80)
    _string_list(group.get("members"), f"{name}.members", 50, 40, unique=False)
    _string(group.get("updatedAt"), f"{name}.updatedAt", 1, 64)
    history_reset = group.get("historyResetAt")
    if history_reset is not None:
        _string(history_reset, f"{name}.historyResetAt", 1, 64)
    profile_id = group.get("preferredProfileId")
    if profile_id is not None:
        _string(profile_id, f"{name}.preferredProfileId", 1, 100)
    custom = group.get("customConfiguration")
    if custom is not None:
        _validate_configuration(custom, f"{name}.customConfiguration")
    _validate_card_language_settings(group.get("cardLanguageSettings"), f"{name}.cardLanguageSettings")
    return group


def validate_profiles(value: Any) -> tuple[dict[str, Any], ...]:
    root = _mapping(value, "game profiles")
    profiles = _list(root.get("profiles"), "game profiles.profiles", 20, 1)
    result: list[dict[str, Any]] = []
    identifiers: set[str] = set()
    for index, value_profile in enumerate(profiles):
        name = f"game profiles.profiles[{index}]"
        profile = dict(_mapping(value_profile, name))
        profile_id = _string(profile.get("id"), f"{name}.id", 1, 100)
        if profile_id in identifiers:
            raise ProtocolViolation("game profile IDs must be unique")
        identifiers.add(profile_id)
        _string(profile.get("name"), f"{name}.name", 1, 200)
        _string(profile.get("description"), f"{name}.description", 0, 2_000)
        _boolean(profile.get("requiresAdultConfirmation"), f"{name}.requiresAdultConfirmation")
        _boolean(profile.get("immutable"), f"{name}.immutable")
        _validate_configuration(profile, name)
        result.append(profile)
    return tuple(result)


def validate_locales(value: Any) -> dict[str, Any]:
    result = dict(_mapping(value, "Card locales"))
    default_locale = _string(result.get("defaultLocale"), "default Card locale", 2, 35)
    locales = _list(result.get("locales"), "Card locales.locales", 100, 1)
    identifiers: set[str] = set()
    for index, value_locale in enumerate(locales):
        current = _mapping(value_locale, f"Card locales.locales[{index}]")
        locale_id = _string(current.get("id"), f"Card locales.locales[{index}].id", 2, 35)
        folded_id = locale_id.casefold()
        if folded_id in identifiers:
            raise ProtocolViolation("Card locale IDs must be unique")
        identifiers.add(folded_id)
        _string(current.get("nativeName"), f"Card locales.locales[{index}].nativeName", 1, 100)
        _number(current.get("coverage"), f"Card locales.locales[{index}].coverage", 0, 1)
    if default_locale.casefold() not in identifiers:
        raise ProtocolViolation("default Card locale is not active")
    return result


def validate_taxonomy(value: Any) -> dict[str, Any]:
    result = dict(_mapping(value, "Card taxonomy"))
    _string(result.get("locale"), "Card taxonomy.locale", 2, 35)
    for key in ("questionCategories", "dareTypes"):
        entries = _list(result.get(key), f"Card taxonomy.{key}", 100)
        identifiers: set[str] = set()
        for index, value_entry in enumerate(entries):
            name = f"Card taxonomy.{key}[{index}]"
            entry = _mapping(value_entry, name)
            entry_id = _string(entry.get("id"), f"{name}.id", 1, 80)
            if entry_id in identifiers:
                raise ProtocolViolation(f"Card taxonomy.{key} IDs must be unique")
            identifiers.add(entry_id)
            _string(entry.get("label"), f"{name}.label", 1, 200)
            description = entry.get("description")
            if description is not None:
                _string(description, f"{name}.description", 0, 2_000)
    return result


def validate_groups(value: Any) -> tuple[dict[str, Any], ...]:
    root = _mapping(value, "Groups")
    groups = _list(root.get("groups"), "Groups.groups", 2_000)
    result = tuple(_validate_group(group, f"Groups.groups[{index}]") for index, group in enumerate(groups))
    if len({group["id"] for group in result}) != len(result):
        raise ProtocolViolation("Group IDs must be unique")
    return result


def validate_group(value: Any) -> dict[str, Any]:
    return _validate_group(value)


def validate_game_settings(value: Any) -> dict[str, Any]:
    result = dict(_mapping(value, "game settings"))
    settings = _mapping(result.get("settings"), "game settings.settings")
    _string(settings.get("preferredProfileId"), "game settings.preferredProfileId", 1, 100)
    starting = _integer(
        settings.get("startingIntensity"),
        "game settings.startingIntensity",
        min(INTENSITY_LEVELS),
        max(INTENSITY_LEVELS),
    )
    maximum = _integer(
        settings.get("maximumIntensity"),
        "game settings.maximumIntensity",
        min(INTENSITY_LEVELS),
        max(INTENSITY_LEVELS),
    )
    if starting > maximum:
        raise ProtocolViolation("game settings startingIntensity exceeds maximumIntensity")
    if settings.get("maximumSocialSensitivity") not in SOCIAL_SENSITIVITIES:
        raise ProtocolViolation("game settings maximumSocialSensitivity is invalid")
    if settings.get("intensityProgressionUnit") not in INTENSITY_PROGRESSION_UNITS:
        raise ProtocolViolation("game settings intensityProgressionUnit is invalid")
    _integer(
        settings.get("intensityProgressionInterval"),
        "game settings progression interval",
        ROOM_GAME_SETTING_CONSTRAINTS["intensityProgressionInterval"]["minimum"],
        ROOM_GAME_SETTING_CONSTRAINTS["intensityProgressionInterval"]["maximum"],
    )
    increment = _number(
        settings.get("intensityProgressionIncrement"),
        "game settings progression increment",
        ROOM_GAME_SETTING_CONSTRAINTS["intensityProgressionIncrement"]["minimum"],
        ROOM_GAME_SETTING_CONSTRAINTS["intensityProgressionIncrement"]["maximum"],
    )
    increment_step = ROOM_GAME_SETTING_CONSTRAINTS["intensityProgressionIncrement"]["step"]
    if not (increment / increment_step).is_integer():
        raise ProtocolViolation("game settings progression increment must use half steps")
    _number(
        settings.get("randomQuestionRatio"),
        "game settings question ratio",
        ROOM_GAME_SETTING_CONSTRAINTS["randomQuestionRatio"]["minimum"],
        ROOM_GAME_SETTING_CONSTRAINTS["randomQuestionRatio"]["maximum"],
    )
    _integer(
        settings.get("letsTalkMetaInterval"),
        "game settings conversation interval",
        ROOM_GAME_SETTING_CONSTRAINTS["letsTalkMetaInterval"]["minimum"],
        ROOM_GAME_SETTING_CONSTRAINTS["letsTalkMetaInterval"]["maximum"],
    )
    default_group = settings.get("defaultGroupId")
    if default_group is not None:
        _uuid(default_group, "game settings.defaultGroupId")
    _validate_configuration(settings.get("customConfiguration"), "game settings.customConfiguration")
    _validate_card_language_settings(
        settings.get("cardLanguageSettings"), "game settings.cardLanguageSettings"
    )
    data_space = _mapping(result.get("dataSpace"), "game settings.dataSpace")
    _uuid(data_space.get("id"), "game settings.dataSpace.id")
    _string(data_space.get("name"), "game settings.dataSpace.name", 1, 80)
    return result


def validate_eligibility_preview(value: Any) -> dict[str, Any]:
    result = dict(_mapping(value, "eligibility preview"))
    total = _integer(result.get("total"), "eligibility preview.total")
    available = _integer(result.get("availableAtStart"), "eligibility preview.availableAtStart")
    if available > total:
        raise ProtocolViolation("eligibility preview availableAtStart exceeds total")
    for key in ("byType", "atStartByType"):
        counts = _mapping(result.get(key), f"eligibility preview.{key}")
        for card_type in CARD_TYPES:
            _integer(counts.get(card_type), f"eligibility preview.{key}.{card_type}")
    _integer(result.get("playerCount"), "eligibility preview.playerCount", 2, 10_000)
    _boolean(result.get("adultConfirmationRequired"), "eligibility preview.adultConfirmationRequired")
    return result


def validate_help_index(value: Any) -> tuple[dict[str, str], ...]:
    result = _mapping(value, "Help index")
    documents = _list(result.get("documents"), "Help index.documents", 50, 1)
    validated: list[dict[str, str]] = []
    slugs: set[str] = set()
    for index, candidate in enumerate(documents):
        document = _mapping(candidate, f"Help index.documents[{index}]")
        slug = _string(document.get("slug"), f"Help index.documents[{index}].slug", 1, 80)
        if not re.fullmatch(r"[a-z0-9_-]+", slug) or slug in slugs:
            raise ProtocolViolation("Help document slugs must be unique and URL-safe")
        title = _string(document.get("title"), f"Help index.documents[{index}].title", 1, 160)
        slugs.add(slug)
        validated.append({"slug": slug, "title": title})
    return tuple(validated)


def validate_help_document(value: Any) -> dict[str, str]:
    document = _mapping(value, "Help document")
    slug = _string(document.get("slug"), "Help document.slug", 1, 80)
    if not re.fullmatch(r"[a-z0-9_-]+", slug):
        raise ProtocolViolation("Help document slug is invalid")
    return {
        "slug": slug,
        "title": _string(document.get("title"), "Help document.title", 1, 160),
        "html": _string(document.get("html"), "Help document.html", 1, 100_000),
    }


def validate_card_search(value: Any, maximum_cards: int = 50) -> dict[str, Any]:
    result = dict(_mapping(value, "Card search"))
    _integer(result.get("total"), "Card search.total")
    cursor = result.get("nextCursor")
    if cursor is not None:
        _uuid(cursor, "Card search.nextCursor")
    cards = _list(result.get("cards"), "Card search.cards", maximum_cards)
    identifiers: set[str] = set()
    for index, value_card in enumerate(cards):
        name = f"Card search.cards[{index}]"
        card = _mapping(value_card, name)
        card_id = _uuid(card.get("id"), f"{name}.id")
        if card_id in identifiers:
            raise ProtocolViolation("Card search IDs must be unique")
        identifiers.add(card_id)
        _string(card.get("text"), f"{name}.text", 0, 10_000)
        _string(card.get("locale"), f"{name}.locale", 2, 35)
        if card.get("lifecycle") not in CARD_LIFECYCLES:
            raise ProtocolViolation(f"{name}.lifecycle is invalid")
        if card.get("cardType") not in CARD_TYPES:
            raise ProtocolViolation(f"{name}.cardType is invalid")
        _mapping(card.get("effective"), f"{name}.effective")
        _mapping(card.get("localDirectives"), f"{name}.localDirectives")
    return result


def validate_server_info(value: Any) -> dict[str, Any]:
    info = dict(_mapping(value, "server-info"))
    if info.get("version") != 1:
        raise ProtocolViolation("Unsupported HTTP API information version")
    _uuid(info.get("serverId"), "serverId")
    _string(info.get("displayName"), "displayName", 1, 80)
    if info.get("deploymentMode") not in {"local", "public"}:
        raise ProtocolViolation("deploymentMode is invalid")
    if info.get("publicRuntimeSecurity") not in {"enforced", "development"}:
        raise ProtocolViolation("publicRuntimeSecurity is invalid")
    if not isinstance(info.get("authenticationAvailable"), bool):
        raise ProtocolViolation("authenticationAvailable must be boolean")
    versions = info.get("protocolVersions")
    if not isinstance(versions, list) or PROTOCOL_VERSION not in versions:
        raise ProtocolViolation(f"WebSocket protocol {PROTOCOL_VERSION} is not supported")
    capacity = _mapping(info.get("roomCapacity"), "roomCapacity")
    _integer(capacity.get("maximumParticipants"), "maximumParticipants", 2)
    _integer(capacity.get("maximumPlayers"), "maximumPlayers", 2)
    _validate_server_capabilities(info)
    discovery = _mapping(info.get("localNetworkDiscovery"), "localNetworkDiscovery")
    if not isinstance(discovery.get("advertising"), bool):
        raise ProtocolViolation("discovery advertising must be boolean")
    _string(discovery.get("serviceType"), "serviceType", 1, 255)
    _integer(discovery.get("txtVersion"), "txtVersion", 1)
    access = _mapping(info.get("roomAccess"), "roomAccess")
    configured_url = access.get("configuredBaseUrl")
    if configured_url is not None:
        _http_origin(configured_url, "configuredBaseUrl")
    available_urls = access.get("availableBaseUrls")
    if not isinstance(available_urls, list) or len(available_urls) > 100:
        raise ProtocolViolation("availableBaseUrls must be a bounded list")
    for index, origin in enumerate(available_urls):
        _http_origin(origin, f"availableBaseUrls[{index}]")
    return info

def _validate_server_capabilities(info):
    capabilities = _mapping(info.get("capabilities"), "capabilities")
    for name in ("localNetworkDiscovery", "displayBootstrapRoomCreation"):
        if not isinstance(capabilities.get(name), bool):
            raise ProtocolViolation(f"capability {name} must be boolean")
    native_authorization = capabilities.get("nativeDeviceAuthorization", False)
    if not isinstance(native_authorization, bool):
        raise ProtocolViolation("capability nativeDeviceAuthorization must be boolean")
    endpoints = _mapping(info.get("endpoints"), "endpoints")
    _relative_endpoint(endpoints.get("apiBasePath"), "apiBasePath")
    _relative_endpoint(endpoints.get("webSocketPath"), "webSocketPath")
    join_path = _relative_endpoint(endpoints.get("roomJoinPathTemplate"), "roomJoinPathTemplate")
    if "{roomCode}" not in join_path:
        raise ProtocolViolation("roomJoinPathTemplate must include {roomCode}")
    if native_authorization:
        _validate_server_info_native_authorization(endpoints, info)
    elif info.get("nativeDeviceAuthorization") is not None:
        raise ProtocolViolation("disabled native device authorization must have no descriptor")

def _validate_server_info_native_authorization(endpoints, info):
    for name in ("deviceAuthorizationPath", "deviceTokenPath"):
        _relative_endpoint(endpoints.get(name), name)
    if endpoints.get("deviceRevocationPath") is not None:
        _relative_endpoint(endpoints.get("deviceRevocationPath"), "deviceRevocationPath")
    native = _mapping(info.get("nativeDeviceAuthorization"), "nativeDeviceAuthorization")
    _string(native.get("clientId"), "nativeDeviceAuthorization.clientId", 1, 100)
    scopes = native.get("scopes")
    if (
        not isinstance(scopes, list)
        or not 1 <= len(scopes) <= 20
        or not all(isinstance(scope, str) and 1 <= len(scope) <= 100 for scope in scopes)
    ):
        raise ProtocolViolation("native device scopes must be a bounded string list")


def validate_room_join(value: Any, required_role: str = "DISPLAY") -> dict[str, Any]:
    result = dict(_mapping(value, "room join"))
    _uuid(result.get("roomId"), "roomId")
    code = _string(result.get("roomCode"), "roomCode", 6, 6)
    if not ROOM_CODE.fullmatch(code):
        raise ProtocolViolation("roomCode is invalid")
    _uuid(result.get("participantId"), "participantId")
    _string(result.get("participantCredential"), "participantCredential", 32, 200)
    if result.get("role") != required_role:
        raise ProtocolViolation(f"TV expected role {required_role}")
    bootstrap = result.get("bootstrapMode")
    if bootstrap is not None and bootstrap not in ROOM_BOOTSTRAP_MODES:
        raise ProtocolViolation("bootstrapMode is invalid")
    if "hostStatus" in result:
        _validate_host_status(result["hostStatus"])
    return result


def validate_couch_snapshot(value: Any) -> dict[str, Any]:
    snapshot = dict(_mapping(value, "Couch snapshot"))
    session_id = _uuid(snapshot.get("id"), "Couch session ID")
    _integer(snapshot.get("startedAt"), "Couch startedAt")
    if snapshot.get("mode") not in GAME_MODES:
        raise ProtocolViolation("Couch mode is invalid")
    _integer(snapshot.get("revision"), "Couch revision")
    if snapshot.get("state") not in SESSION_STATES:
        raise ProtocolViolation("Couch state is invalid")
    _integer(snapshot.get("roundNumber"), "Couch roundNumber", 1)
    players = snapshot.get("players")
    if not isinstance(players, list) or not 2 <= len(players) <= 20:
        raise ProtocolViolation("Couch players must be a bounded list")
    player_ids: set[str] = set()
    for player in players:
        current = _mapping(player, "Couch player")
        player_id = _uuid(current.get("id"), "Couch player ID")
        _string(current.get("name"), "Couch player name", 1, 40)
        if player_id in player_ids:
            raise ProtocolViolation("Couch player IDs must be unique")
        player_ids.add(player_id)
    active_player = snapshot.get("activePlayer")
    if active_player is not None:
        _validate_couch_active_player(active_player, player_ids)
    card = snapshot.get("currentCard")
    if card is not None:
        _validate_current_card(card, "Couch current Card")
    for name in ("cardsShown", "remainingCardCount"):
        _integer(snapshot.get(name), f"Couch {name}")
    vote_result = _mapping(snapshot.get("voteResult"), "Couch vote result")
    for name in ("yes", "no", "total"):
        _integer(vote_result.get(name), f"Couch vote result {name}")
    voted = snapshot.get("votedPlayerIds")
    if (
        not isinstance(voted, list)
        or len(voted) > len(players)
        or any(_uuid(entry, "Couch voted player ID") not in player_ids for entry in voted)
        or len(set(voted)) != len(voted)
    ):
        raise ProtocolViolation("Couch voted player IDs are invalid")
    _validate_couch_voting(snapshot.get("neverHaveIEverVoting"), player_ids)
    if snapshot.get("persistence") not in SESSION_PERSISTENCE_MODES:
        raise ProtocolViolation("Couch persistence is invalid")
    _validate_couch_settings(snapshot)
    snapshot["id"] = session_id
    return snapshot


def _validate_couch_active_player(active_player, player_ids):
    current = _mapping(active_player, "Couch active player")
    if _uuid(current.get("id"), "Couch active player ID") not in player_ids:
        raise ProtocolViolation("Couch active player is not in the roster")
    _string(current.get("name"), "Couch active player name", 1, 40)


def _validate_couch_settings(snapshot):
    settings = _mapping(snapshot.get("settings"), "Couch settings")
    if settings.get("mode") != snapshot.get("mode"):
        raise ProtocolViolation("Couch settings mode differs from the snapshot")
    _string(settings.get("profileId"), "Couch profile ID", 1, 100)
    primary_locale = _string(settings.get("cardLocale"), "Couch Card locale", 2, 35)
    _boolean(settings.get("cardFallbackEnabled"), "Couch Card fallback setting")
    fallbacks = _string_list(
        settings.get("cardFallbackLocales"), "Couch Card fallback locales", 100, 35
    )
    if primary_locale.casefold() in {locale.casefold() for locale in fallbacks}:
        raise ProtocolViolation("Couch fallback locales include the primary locale")
    if settings.get("neverHaveIEverRevealMode") not in NEVER_HAVE_I_EVER_REVEAL_MODES:
        raise ProtocolViolation("Couch Never Have I Ever reveal mode is invalid")
    _validate_configuration(settings.get("configuration"), "Couch configuration")
    _mapping(settings.get("cardPolicy"), "Couch Card policy")


def _validate_couch_voting(value: Any, player_ids: set[str]) -> None:
    if value is None:
        return
    voting = _mapping(value, "Couch voting")
    if voting.get("revealMode") not in NEVER_HAVE_I_EVER_REVEAL_MODES:
        raise ProtocolViolation("Couch reveal mode is invalid")
    progress = voting.get("progress")
    if not isinstance(progress, list) or len(progress) > len(player_ids):
        raise ProtocolViolation("Couch voting progress is invalid")
    progress_ids: set[str] = set()
    _validate_vote_progress(progress, player_ids, progress_ids)
    result = voting.get("result")
    if result is None:
        return
    current_result = _mapping(result, "Couch voting result")
    for name in ("yes", "no", "total"):
        _integer(current_result.get(name), f"Couch voting result {name}")
    named = current_result.get("namedAnswers")
    if named is None:
        return
    if voting.get("revealMode") != NAMED_REVEAL_MODE or not isinstance(named, list):
        raise ProtocolViolation("Couch named answers are invalid")
    if len(named) > len(player_ids):
        raise ProtocolViolation("Couch named answers exceed the roster")
    named_ids: set[str] = set()
    for entry in named:
        _validate_named_vote(entry, named_ids, player_ids)


def _validate_named_vote(entry, named_ids, player_ids):
    current = _mapping(entry, "Couch named answer")
    player_id = _uuid(current.get("playerId"), "Couch named answer player ID")
    if player_id not in player_ids or player_id in named_ids:
        raise ProtocolViolation("Couch named answer player is invalid")
    named_ids.add(player_id)
    _string(current.get("displayName"), "Couch named answer display name", 1, 40)
    if current.get("vote") not in NEVER_HAVE_I_EVER_VOTE_VALUES:
        raise ProtocolViolation("Couch named answer vote is invalid")


def _validate_vote_progress(progress, player_ids, progress_ids):
    for entry in progress:
        current = _mapping(entry, "Couch voting progress")
        player_id = _uuid(current.get("playerId"), "Couch voting player ID")
        if player_id not in player_ids or player_id in progress_ids:
            raise ProtocolViolation("Couch voting player is invalid")
        progress_ids.add(player_id)
        _string(current.get("displayName"), "Couch voting display name", 1, 40)
        if current.get("status") not in NEVER_HAVE_I_EVER_VOTE_STATUSES:
            raise ProtocolViolation("Couch voting status is invalid")


def decode_envelope(raw: str | bytes) -> dict[str, Any]:
    encoded = raw if isinstance(raw, bytes) else raw.encode("utf-8")
    if len(encoded) > MAX_MESSAGE_BYTES:
        raise ProtocolViolation(f"WebSocket message exceeds {MAX_MESSAGE_BYTES} bytes")
    try:
        value = json.loads(encoded.decode("utf-8", errors="strict"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProtocolViolation("WebSocket message is not valid UTF-8 JSON") from error
    return validate_server_envelope(value)


def validate_server_envelope(value: Any) -> dict[str, Any]:
    envelope = dict(_mapping(value, "WebSocket envelope"))
    if envelope.get("protocol") != PROTOCOL_VERSION:
        raise ProtocolViolation("Unsupported WebSocket protocol")
    event_type = _string(envelope.get("type"), "type", 1, 100)
    request_id = envelope.get("requestId")
    if request_id is not None:
        _string(request_id, "requestId", 1, int(_CONSTRAINTS["maximumRequestIdCharacters"]))
    revision = envelope.get("revision")
    if revision is not None:
        _integer(revision, "revision")
    payload = _mapping(envelope.get("payload"), "payload")
    null_revision_events = {
        "server.hello",
        "server.pong",
        "room.roleChanged",
        "room.presence",
        "room.participantLeft",
        "session.cardReplaced",
        "error",
    }
    if event_type in null_revision_events and revision is not None:
        raise ProtocolViolation(f"{event_type} must not carry a revision")
    _validate_server_event(event_type, payload, request_id, revision)
    return envelope

def _validate_server_event(event_type, payload, request_id, revision):
    if event_type == "server.hello":
        _validate_server_hello(payload)
    elif event_type == "server.pong":
        if request_id is None or revision is not None:
            raise ProtocolViolation("server.pong correlation fields are invalid")
        _integer(payload.get("serverTime"), "server.pong serverTime")
    elif event_type == "room.snapshot":
        _validate_snapshot(payload)
    elif event_type == "room.roleChanged":
        _validate_display_role_change(payload)
    elif event_type == "room.presence":
        _validate_server_envelope_room_presence(payload)
    elif event_type == "room.participantLeft":
        _validate_participant_departure(payload)
    elif event_type == "session.cardReplaced":
        if payload.get("reason") not in CARD_REPLACEMENT_REASONS:
            raise ProtocolViolation("Card replacement reason is invalid")
    elif event_type == "error":
        _validate_server_error(payload)
    else:
        raise ProtocolViolation("WebSocket event type is unsupported")


def _validate_server_error(payload):
    if payload.get("code") not in PROTOCOL_ERROR_CODES:
        raise ProtocolViolation("error code is invalid")
    _string(payload.get("message"), "error message", 1, 500)



def _validate_participant_departure(payload):
    _uuid(payload.get("participantId"), "departed participant ID")
    _string(payload.get("displayName"), "departed participant display name", 1, 80)
    if payload.get("reason") not in PARTICIPANT_LEFT_REASONS:
        raise ProtocolViolation("participant departure reason is invalid")


def _validate_display_role_change(payload):
    if payload.get("role") != "DISPLAY":
        raise ProtocolViolation("Server attempted to elevate the TV role")
    if payload.get("previousRole") not in ROOM_ROLES:
        raise ProtocolViolation("Room role change previousRole is invalid")
    if payload.get("reason") not in ROLE_CHANGE_REASONS:
        raise ProtocolViolation("Room role change reason is invalid")


def _validate_server_hello(payload):
    if payload.get("protocolVersion") != PROTOCOL_VERSION:
        raise ProtocolViolation("Server selected an unsupported protocol")
    _uuid(payload.get("participantId"), "participantId")
    if payload.get("role") != "DISPLAY":
        raise ProtocolViolation("Kodi Room participant must remain DISPLAY")


def _validate_server_envelope_room_presence(payload):
    connected = _list(payload.get("connected"), "Room presence", int(_CONSTRAINTS["maximumRoomParticipants"]))
    participant_ids: set[str] = set()
    for entry in connected:
        participant = _mapping(entry, "Room presence participant")
        participant_id = _uuid(
            participant.get("participantId"), "Room presence participant ID"
        )
        if participant_id in participant_ids:
            raise ProtocolViolation("Room presence participant IDs must be unique")
        participant_ids.add(participant_id)
        _string(participant.get("displayName"), "Room presence display name", 1, 40)
        if participant.get("role") not in ROOM_ROLES:
            raise ProtocolViolation("Room presence role is invalid")


def _validate_snapshot(value: Mapping[str, Any]) -> None:
    room_id = _uuid(value.get("roomId"), "roomId")
    _validate_host_status(value.get("hostStatus"))
    if value.get("bootstrapMode") not in ROOM_BOOTSTRAP_MODES:
        raise ProtocolViolation("Room bootstrapMode is invalid")
    capacity = _mapping(value.get("capacity"), "capacity")
    maximum_participants = _integer(
        capacity.get("maximumParticipants"), "capacity.maximumParticipants", 2, int(_CONSTRAINTS["maximumRoomParticipants"])
    )
    maximum_players = _integer(
        capacity.get("maximumPlayers"), "capacity.maximumPlayers", 2, int(_CONSTRAINTS["maximumRoomPlayers"])
    )
    participants = value.get("participants")
    if (
        not isinstance(participants, list)
        or len(participants) > maximum_participants
    ):
        raise ProtocolViolation("participants must be a bounded list")
    participant_ids: set[str] = set()
    _validate_room_participants(participants, participant_ids, room_id)
    _boolean(value.get("boundaryConfigured"), "boundaryConfigured")
    settings = _validate_room_settings(value)
    session = value.get("session")
    if session is None:
        return
    _validate_display_session(session, settings, maximum_players, participant_ids)

def _validate_display_session(session, settings, maximum_players, participant_ids):
    current_session = _mapping(session, "session")
    actions = _string_list(
        current_session.get("availableActions"), "session.availableActions", 20
    )
    if not set(actions).issubset(DISPLAY_ACTIONS):
        raise ProtocolViolation("Display snapshot exposes a private action")
    _uuid(current_session.get("id"), "session.id")
    _integer(current_session.get("startedAt"), "session.startedAt")
    if current_session.get("mode") not in GAME_MODES:
        raise ProtocolViolation("session.mode is invalid")
    if current_session.get("mode") != settings.get("mode"):
        raise ProtocolViolation("session.mode differs from Room settings")
    if current_session.get("state") not in SESSION_STATES:
        raise ProtocolViolation("session.state is invalid")
    _integer(current_session.get("revision"), "session.revision")
    _integer(current_session.get("roundNumber"), "session.roundNumber")
    players = _list(current_session.get("players"), "session.players", maximum_players)
    player_ids: set[str] = set()
    for player in players:
        current_player = _mapping(player, "session player")
        player_id = _uuid(current_player.get("id"), "session player ID")
        if player_id in player_ids:
            raise ProtocolViolation("session player IDs must be unique")
        player_ids.add(player_id)
        _string(current_player.get("name"), "session player name", 1, 40)
    active_player = current_session.get("activePlayer")
    if active_player is not None:
        _validate_display_active_player(active_player, player_ids)
    viewer = _mapping(current_session.get("viewer"), "session.viewer")
    if viewer.get("role") != "DISPLAY":
        raise ProtocolViolation("Display snapshot has a non-display viewer")
    if _uuid(viewer.get("participantId"), "session.viewer.participantId") not in participant_ids:
        raise ProtocolViolation("Display viewer is not a Room participant")
    _string(viewer.get("displayName"), "session.viewer.displayName", 1, 40)
    _boolean(current_session.get("hasVoted"), "session.hasVoted")
    controllable = _list(
        current_session.get("controllablePlayers"), "session.controllablePlayers", maximum_players
    )
    if controllable:
        raise ProtocolViolation("Display snapshot exposes controllable players")
    card = current_session.get("currentCard")
    if card is not None:
        _validate_current_card(card, "currentCard")
    for name in ("cardsShown", "remainingCardCount"):
        _integer(current_session.get(name), f"session.{name}")
    vote_result = _mapping(current_session.get("voteResult"), "session.voteResult")
    for name in ("yes", "no", "total"):
        _integer(vote_result.get(name), f"session.voteResult.{name}")
    _validate_couch_voting(current_session.get("neverHaveIEverVoting"), player_ids)


def _validate_display_active_player(active_player, player_ids):
    current_player = _mapping(active_player, "session active player")
    if _uuid(current_player.get("id"), "session active player ID") not in player_ids:
        raise ProtocolViolation("session active player is not in the roster")
    _string(current_player.get("name"), "session active player name", 1, 40)


def _validate_room_settings(value):
    settings = _mapping(value.get("settings"), "settings")
    if settings.get("mode") not in GAME_MODES:
        raise ProtocolViolation("settings.mode is invalid")
    _integer(settings.get("revision"), "settings.revision")
    _string(settings.get("profileId"), "settings.profileId", 1, 100)
    group_id = settings.get("groupId")
    if group_id is not None:
        _uuid(group_id, "settings.groupId")
    _boolean(settings.get("adultContentConfirmed"), "settings.adultContentConfirmed")
    primary_locale = _string(settings.get("cardLocale"), "settings.cardLocale", 2, 35)
    _boolean(settings.get("cardFallbackEnabled"), "settings.cardFallbackEnabled")
    fallbacks = _string_list(
        settings.get("cardFallbackLocales"), "settings.cardFallbackLocales", 100, 35
    )
    if primary_locale.casefold() in {locale.casefold() for locale in fallbacks}:
        raise ProtocolViolation("settings fallback locales include the primary locale")
    if settings.get("neverHaveIEverRevealMode") not in NEVER_HAVE_I_EVER_REVEAL_MODES:
        raise ProtocolViolation("settings Never Have I Ever reveal mode is invalid")
    _validate_configuration(settings.get("configuration"), "settings.configuration")
    _mapping(settings.get("cardPolicy"), "settings.cardPolicy")
    updated_by = settings.get("updatedByParticipantId")
    if updated_by is not None:
        _uuid(updated_by, "settings.updatedByParticipantId")
    return settings

def _validate_room_participants(participants, participant_ids, room_id):
    for participant in participants:
        current = _mapping(participant, "participant")
        participant_id = _uuid(current.get("id"), "participant.id")
        if participant_id in participant_ids:
            raise ProtocolViolation("participant IDs must be unique")
        participant_ids.add(participant_id)
        if _uuid(current.get("roomId"), "participant.roomId") != room_id:
            raise ProtocolViolation("participant belongs to another Room")
        if current.get("role") not in ROOM_ROLES:
            raise ProtocolViolation("participant.role is invalid")
        _string(current.get("displayName"), "participant.displayName", 1, 40)
        if current.get("connectionStatus") not in PARTICIPANT_CONNECTION_STATUSES:
            raise ProtocolViolation("participant.connectionStatus is invalid")
        device_players = _list(current.get("devicePlayers"), "participant.devicePlayers", 19)
        for player in device_players:
            current_player = _mapping(player, "participant device player")
            _uuid(current_player.get("id"), "participant device player ID")
            _string(current_player.get("name"), "participant device player name", 1, 40)


def _validate_host_status(value: Any) -> None:
    status = _mapping(value, "hostStatus")
    if status.get("state") not in HOST_STATES:
        raise ProtocolViolation("hostStatus.state is invalid")
    participant_id = status.get("participantId")
    if participant_id is not None:
        _uuid(participant_id, "hostStatus.participantId")
    display_name = status.get("displayName")
    if display_name is not None:
        _string(display_name, "hostStatus.displayName", 1, 40)
    deadline = status.get("deadline")
    if deadline is not None:
        _integer(deadline, "hostStatus.deadline")
