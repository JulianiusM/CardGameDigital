"""Pure projection from authoritative/client state to a television view model."""

from __future__ import annotations

import json
import re
import textwrap
from dataclasses import dataclass, replace
from pathlib import Path
from typing import cast, Any, Iterable, Mapping, Optional

from .routes import Route
from .state import AppState, ServerRecord, SetupDraft
from .strings import Text
from .version import APPLICATION_VERSION
from .help_content import LOCAL_HELP_TOPICS, local_help_topic
from .layout import card_text_pages
from .native_settings_metadata import AUTOMATIC_LOCALE, LOCALE_LABEL_IDS
from .option_specs import (
    CONFIGURATION_CHOICES,
    DIRECTIVE_CHOICES,
    DIRECTIVE_NUMBERS,
    PREDICATE_CHOICES,
    PREDICATE_NUMBERS,
    SENSITIVITY_VALUES,
    encode_option,
    format_number,
)
from .protocol.validation import (
    ACTIVE_CARD_LIFECYCLE,
    ANONYMOUS_REVEAL_MODE,
    AWAITING_REPLACEMENT_HOST_STATE,
    CONNECTED_HOST_STATE,
    CONNECTED_PARTICIPANT_STATUS,
    CONNECTING_HOST_STATE,
    NAMED_REVEAL_MODE,
    NEVER_HAVE_I_EVER_REVEAL_MODE_ORDER,
    NO_VOTE,
    PENDING_VOTE_STATUS,
    RECONNECTING_HOST_STATE,
    RETIRED_CARD_LIFECYCLE,
    VOTED_VOTE_STATUS,
    YES_VOTE,
)
from . import strings


PREDICATE_NUMBER_PREFIX = "predicate-number:"
BACK_ACTION = 'nav:back'
END_COUCH_ACTION = 'couch:end'


COLLECTION_PAGE_SIZE = 4
PROFILE_PAGE_SIZE = 3
SETTINGS_PAGE_SIZE = 6
LOBBY_ROSTER_PAGE_SIZE = 8
GAME_ROSTER_PAGE_SIZE = 5
COUCH_VOTER_PAGE_SIZE = 4
NAMED_RESULT_COLUMN_PAGE_SIZE = 5
HELP_LINE_WIDTH = 82
# Kodi's Estuary ``font20`` consumes roughly 40 px per rendered line. The Help
# article has 414 px of usable height, so ten modeled lines are the safe measured
# limit; allowing twelve causes the final sentence to render below the paper.
HELP_PAGE_LINES = 10


@dataclass(frozen=True)
class ViewItem:
    key: str
    label: Text
    secondary: Text = Text.raw("")
    detail: Text = Text.raw("")
    badge: Text = Text.raw("")
    kind: str = "row"
    enabled: bool = True
    selected: bool = False
    danger: bool = False


@dataclass(frozen=True)
class ViewFact:
    label: Text
    value: Text


@dataclass(frozen=True)
class Pagination:
    previous_key: str
    next_key: str
    status: Text
    previous_enabled: bool
    next_enabled: bool


@dataclass(frozen=True)
class ViewModel:
    eyebrow: Text
    heading: Text
    body: Text = Text.raw("")
    items: tuple[ViewItem, ...] = ()
    actions: tuple[ViewItem, ...] = ()
    pagination: Optional[Pagination] = None
    facts: tuple[ViewFact, ...] = ()
    roster: tuple[ViewItem, ...] = ()
    voters: tuple[ViewItem, ...] = ()
    view_mode: str = "rows"
    card_eyebrow: Text = Text.raw("")
    card_classification: Text = Text.raw("")
    card_text: Text = Text.raw("")
    card_footer: Text = Text.raw("")
    card_intensity: Text = Text.raw("")
    game_intensity: Text = Text.raw("")
    current_player: Text = Text.raw("")
    server_pill: Text = Text.raw("")
    footer: Text = Text.message(strings.FOCUS_HELP)
    qr_path: str = ""
    preferred_focus: Optional[str] = None
    atmosphere: str = "NEUTRAL"
    result_yes: Text = Text.raw("")
    result_no: Text = Text.raw("")
    result_yes_names: Text = Text.raw("")
    result_no_names: Text = Text.raw("")
    result_yes_players: tuple[ViewItem, ...] = ()
    result_no_players: tuple[ViewItem, ...] = ()
    progress: Text = Text.raw("")
    room_code: Text = Text.raw("")
    join_urls: Text = Text.raw("")
    join_url_status: Text = Text.raw("")
    result_status: Text = Text.raw("")
    card_page_status: Text = Text.raw("")
    card_page_count: int = 1
    card_page_previous_enabled: bool = False
    card_page_next_enabled: bool = False
    alert: Text = Text.raw("")
    private_vote_choice: bool = False
    voting_stage_label: Text = Text.raw("")
    voting_player: Text = Text.raw("")
    voting_hint: Text = Text.raw("")


def msg(message_id: int, *arguments: object) -> Text:
    return Text.message(message_id, *arguments)


def raw(value: object) -> Text:
    return Text.raw(value)


def item(
    key: str,
    message_id: int,
    *arguments: object,
    secondary: Text = Text.raw(""),
    detail: Text = Text.raw(""),
    badge: Text = Text.raw(""),
    kind: str = "row",
    enabled: bool = True,
    selected: bool = False,
    danger: bool = False,
) -> ViewItem:
    return ViewItem(
        key=key,
        label=msg(message_id, *arguments),
        secondary=secondary,
        detail=detail,
        badge=badge,
        kind=kind,
        enabled=enabled,
        selected=selected,
        danger=danger,
    )


def _selected_server(state: AppState) -> Optional[ServerRecord]:
    return next(
        (server for server in state.servers if server.server_id == state.selected_server_id),
        None,
    )


def _pill(state: AppState) -> Text:
    server = _selected_server(state)
    if not server:
        return Text.raw("")
    message_id = strings.SERVER_PILL_LOCAL if server.deployment_mode == "local" else strings.SERVER_PILL_GLOBAL
    return msg(message_id, _wrapped_identifier(server.display_name, width=54))


def _on(value: bool) -> Text:
    return msg(strings.ON if value else strings.OFF)


def _mode_name(mode: str) -> int:
    return {
        "CLASSIC_TRUTH_OR_DARE": strings.MODE_CLASSIC,
        "RANDOM_TRUTH_OR_DARE": strings.MODE_RANDOM,
        "NEVER_HAVE_I_EVER": strings.MODE_NEVER,
        "LETS_TALK": strings.MODE_TALK,
    }.get(mode, strings.MODE_CLASSIC)


def _generated_atmosphere_mappings() -> tuple[Mapping[str, str], Mapping[str, str]]:
    source = Path(__file__).resolve().parents[1] / "data" / "design-tokens.json"
    with source.open("r", encoding="utf-8") as handle:
        presentation = json.load(handle)["presentation"]
    return (
        presentation["questionFamilyByCategoryId"],
        presentation["dareFamilyByTypeId"],
    )


QUESTION_ATMOSPHERES, DARE_ATMOSPHERES = _generated_atmosphere_mappings()


def _atmosphere(card: Optional[Mapping[str, Any]]) -> str:
    if not card:
        return "NEUTRAL"
    card_type = card.get("cardType")
    if card_type == "CONVERSATION_META":
        family = "CONVERSATION_META"
        return f"{family}_{_intensity_value(card.get('intensity'))}"
    if card_type == "QUESTION":
        family = QUESTION_ATMOSPHERES.get(str(card.get("questionCategoryId")), "CURIOSITY")
        return f"{family}_{_intensity_value(card.get('intensity'))}"
    if card_type == "DARE":
        family = DARE_ATMOSPHERES.get(str(card.get("dareTypeId")), "GENERIC_DARE")
        return f"{family}_{_intensity_value(card.get('intensity'))}"
    return "NEUTRAL"


def _intensity_value(value: object) -> int:
    try:
        return max(1, min(5, int(value)))
    except (TypeError, ValueError):
        return 1


def _intensity_marks(value: object) -> Text:
    return raw(_intensity_value(value))


def _card_classification(state: AppState, card: Optional[Mapping[str, Any]]) -> Text:
    if not card:
        return Text.raw("")
    card_type = str(card.get("cardType", ""))
    identifier = (
        card.get("questionCategoryId")
        if card_type == "QUESTION"
        else card.get("dareTypeId")
    )
    if not identifier:
        return Text.raw("")
    collection_name = "questionCategories" if card_type == "QUESTION" else "dareTypes"
    entry = next(
        (
            value
            for value in (state.taxonomy or {}).get(collection_name, ())
            if value.get("id") == identifier
        ),
        None,
    )
    label = entry.get("label", identifier) if entry else identifier
    return raw(label)


def _card_type_label(card_type: object) -> int:
    return {
        "QUESTION": strings.TRUTH,
        "DARE": strings.DARE,
        "CONVERSATION_META": strings.CONVERSATION_META,
    }.get(str(card_type), strings.GAME)


def present(state: AppState) -> ViewModel:
    presenter = _ROUTE_PRESENTERS.get(state.route)
    if presenter is not None:
        return presenter(state)
    return ViewModel(msg(strings.APP_NAME), raw(state.route.value), server_pill=_pill(state))


def _present_bootstrap(state: AppState) -> ViewModel:
    return ViewModel(msg(strings.APP_NAME), msg(strings.LOADING), server_pill=_pill(state))


def _present_manual_server(state: AppState) -> ViewModel:
    return ViewModel(
        msg(strings.SERVERS),
        msg(strings.MANUAL_SERVER_TITLE),
        msg(strings.MANUAL_ADDRESS_HINT),
        actions=(item("server:manual-input", strings.SERVER_ADDRESS),),
        server_pill=_pill(state),
    )


def _present_setup_categories(state: AppState) -> ViewModel:
    return _taxonomy_toggle(state, "question")


def _present_setup_dares(state: AppState) -> ViewModel:
    return _taxonomy_toggle(state, "dare")


def _present_setup_policy_default(state: AppState) -> ViewModel:
    return _policy_directives(state, strings.DEFAULT_POLICY)


def _present_setup_policy_directives(state: AppState) -> ViewModel:
    return _policy_directives(state, strings.RULE_DIRECTIVE)


def _present_setup_exact_card(state: AppState) -> ViewModel:
    return _policy_directives(state, strings.EXACT_CARD_OVERRIDE)


def _present_room_code_entry(state: AppState) -> ViewModel:
    return ViewModel(
        msg(strings.DISPLAY_ROOM),
        msg(strings.ENTER_ROOM_CODE),
        msg(strings.ROOM_CODE_HINT),
        actions=(item("room:code-input", strings.ROOM_CODE),),
        server_pill=_pill(state),
    )


def _present_room_creating(state: AppState) -> ViewModel:
    actions = ()
    if state.busy_operation is None:
        actions = (
            item("setup:start", strings.RETRY),
            item(BACK_ACTION, strings.BACK),
        )
    return ViewModel(
        msg(strings.HOST_ROOM),
        msg(strings.CREATING_ROOM),
        actions=actions,
        server_pill=_pill(state),
    )


def _present_room_lobby_display(state: AppState) -> ViewModel:
    return _with_card_page(state, _room_display(state))


def _present_couch_game(state: AppState) -> ViewModel:
    return _with_card_page(state, _couch_game(state))


def _present_group_create(state: AppState) -> ViewModel:
    group_items: list[ViewItem] = [
        item(
            "group:name",
            strings.GROUP_NAME,
            secondary=raw(state.group_draft_name),
        )
    ]
    member_page_size = COLLECTION_PAGE_SIZE - 1
    members, member_page, member_pages = _page_slice(
        state.group_draft_members,
        state.collection_page,
        member_page_size,
    )
    member_start = member_page * member_page_size
    group_items.extend(
        item(
            f"group:member-open:{index}",
            strings.PLAYER_OPTIONS,
            secondary=raw(name),
            kind="person",
        )
        for index, name in enumerate(members, start=member_start)
    )
    group_actions = (
        item("group:add-member", strings.ADD_PLAYER),
        item(
            "group:save",
            strings.UPDATE_GROUP if state.group_draft_id else strings.SAVE,
            enabled=bool(state.group_draft_name.strip()),
        ),
    )
    return ViewModel(
        msg(strings.GROUP),
        msg(strings.EDIT_GROUP if state.group_draft_id else strings.CREATE_GROUP),
        items=tuple(group_items),
        actions=group_actions,
        pagination=_pagination("group:member", member_page, member_pages),
        server_pill=_pill(state),
    )


def _has_text(value: Text) -> bool:
    return bool(value.literal or value.message_id)


def _with_card_page(state: AppState, view: ViewModel) -> ViewModel:
    if view.card_text.literal is None:
        return view
    # A Room display is an unattended public stage. It has no card-page
    # controls, so the complete authoritative text stays in one textbox and
    # the skin advances overflowing lines automatically. Couch retains its
    # explicit, remote-controlled emergency pages.
    if state.route in {Route.ROOM_LOBBY_DISPLAY, Route.ROOM_GAME_DISPLAY}:
        return view
    result_layout = _has_text(view.result_yes) or _has_text(view.result_no)
    pages = card_text_pages(view.card_text.literal, result_layout=result_layout)
    page = min(max(0, state.card_page), len(pages) - 1)
    if len(pages) <= 1:
        return cast(ViewModel, replace(view, card_text=raw(pages[0])))
    return cast(ViewModel, replace(
        view,
        card_text=raw(pages[page]),
        card_page_status=msg(strings.CARD_PAGE_STATUS, page + 1, len(pages)),
        card_page_count=len(pages),
        card_page_previous_enabled=page > 0,
        card_page_next_enabled=page + 1 < len(pages),
    ))


SERVER_PAGE_SIZE = COLLECTION_PAGE_SIZE


def _page_slice(values: tuple[Any, ...], page: int, page_size: int) -> tuple[tuple[Any, ...], int, int]:
    total_pages = max(1, (len(values) + page_size - 1) // page_size)
    bounded_page = min(page, total_pages - 1)
    start = bounded_page * page_size
    return values[start : start + page_size], bounded_page, total_pages


def _auto_page_slice(
    values: tuple[Any, ...], page: int, page_size: int
) -> tuple[tuple[Any, ...], int, int]:
    """Cycle unattended TV pages instead of becoming stuck on the last page."""
    total_pages = max(1, (len(values) + page_size - 1) // page_size)
    wrapped_page = page % total_pages
    start = wrapped_page * page_size
    return values[start : start + page_size], wrapped_page, total_pages


def _pagination(prefix: str, page: int, total_pages: int) -> Optional[Pagination]:
    if total_pages <= 1:
        return None
    return Pagination(
        previous_key=f"{prefix}:page-previous",
        next_key=f"{prefix}:page-next",
        status=msg(strings.PAGE_STATUS, page + 1, total_pages),
        previous_enabled=page > 0,
        next_enabled=page + 1 < total_pages,
    )


def _server_list(state: AppState) -> ViewModel:
    entries: list[ViewItem] = []
    visible, page, total_pages = _page_slice(state.servers, state.collection_page, SERVER_PAGE_SIZE)
    local_servers = [server for server in visible if server.deployment_mode == "local"]
    global_servers = [server for server in visible if server.deployment_mode != "local"]
    if local_servers:
        entries.extend(_server_item(server, state) for server in local_servers)
    if global_servers:
        entries.extend(_server_item(server, state) for server in global_servers)
    if state.transport_state == "DISCOVERING":
        body = msg(strings.DISCOVERING)
    else:
        body = msg(strings.NO_SERVERS if not state.servers else strings.SAVED_DISCOVERED)
    return ViewModel(
        msg(strings.APP_NAME),
        msg(strings.CHOOSE_SERVER),
        body,
        tuple(entries),
        actions=(
            item("server:manual", strings.MANUAL_SERVER),
            item("server:refresh", strings.REFRESH),
        ),
        pagination=_pagination("server", page, total_pages),
        view_mode="servers",
        server_pill=_pill(state),
        preferred_focus=next((entry.key for entry in entries if entry.enabled), "server:manual"),
    )


def _server_item(server: ServerRecord, state: AppState) -> ViewItem:
    deployment = strings.LOCAL if server.deployment_mode == "local" else strings.GLOBAL
    status = strings.READY if server.available else strings.SERVER_UNAVAILABLE
    return ViewItem(
        key=f"server:select:{server.server_id}",
        label=raw(server.display_name),
        secondary=raw(_wrapped_identifier(server.origin, width=38)),
        detail=msg(status),
        badge=msg(deployment),
        kind="server",
        enabled=True,
        selected=server.server_id == state.selected_server_id,
    )


def _wrapped_identifier(value: object, width: int = 54) -> str:
    """Give Kodi explicit wrap opportunities in URL/UUID-like text."""
    return "\n".join(
        textwrap.wrap(
            str(value),
            width=width,
            break_long_words=True,
            break_on_hyphens=False,
        )
    )


def _server_details(state: AppState) -> ViewModel:
    details_id = state.server_details_id or state.selected_server_id
    server = next((entry for entry in state.servers if entry.server_id == details_id), None)
    if not server:
        return ViewModel(msg(strings.SERVERS), msg(strings.CONNECTING))
    security = "HTTP" if server.origin.startswith("http://") else "HTTPS"
    return ViewModel(
        msg(strings.SERVERS),
        raw(server.display_name),
        msg(strings.SERVER_SECURITY, security),
        actions=(
            item("server:use", strings.USE_SERVER),
            item("server:forget", strings.FORGET_SERVER, danger=True),
        ),
        facts=(
            ViewFact(
                msg(strings.SERVER_ADDRESS),
                raw(_wrapped_identifier(server.origin, width=30)),
            ),
            ViewFact(
                msg(strings.CONNECTION),
                msg(strings.CONNECTED if server.available else strings.OFFLINE),
            ),
            ViewFact(
                msg(strings.AVAILABILITY),
                msg(strings.LOCAL if server.deployment_mode == "local" else strings.GLOBAL),
            ),
        ),
            view_mode="summary",
        server_pill=_pill(state),
        preferred_focus="server:use",
    )


def _home(state: AppState) -> ViewModel:
    entries = [
        item("home:couch", strings.COUCH_PLAY, secondary=msg(strings.COUCH_PLAY_HINT)),
        item(
            "home:host",
            strings.HOST_ROOM,
            secondary=msg(strings.HOST_ROOM_HINT),
            enabled=bool(
                (state.server_info or {})
                .get("capabilities", {})
                .get("displayBootstrapRoomCreation")
            ),
        ),
        item("home:display", strings.DISPLAY_ROOM, secondary=msg(strings.DISPLAY_ROOM_HINT)),
    ]
    entries.extend(
        [
            item("home:servers", strings.SERVERS, secondary=msg(strings.SERVERS_HINT)),
            item(
                "home:preferences",
                strings.PREFERENCES_HELP,
                secondary=msg(strings.PREFERENCES_HINT),
            ),
        ]
    )
    if state.recovery:
        entries.extend(
            (
                item(
                    "home:recover",
                    strings.RECOVER_SESSION,
                    secondary=msg(strings.RECOVER_SESSION_HINT),
                ),
                item(
                    "home:discard-recovery",
                    strings.DISCARD_RECOVERY,
                    secondary=msg(strings.DISCARD_RECOVERY_HINT),
                    danger=True,
                ),
            )
        )
    return ViewModel(
        msg(strings.APP_NAME),
        msg(strings.HOME),
        items=tuple(entries),
        view_mode="home",
        server_pill=_pill(state),
        preferred_focus="home:couch",
    )


GROUP_PAGE_SIZE = COLLECTION_PAGE_SIZE


def _group_page(
    state: AppState,
    page_size: int = GROUP_PAGE_SIZE,
) -> tuple[tuple[Mapping[str, Any], ...], int, int]:
    values = tuple(state.groups)
    page_values, page, total_pages = _page_slice(values, state.collection_page, page_size)
    return page_values, page, total_pages


def _member_preview(members: Iterable[object]) -> str:
    names = [str(name) for name in members if str(name).strip()]
    preview = "\n".join(_wrapped_identifier(name, width=30) for name in names[:3])
    if len(names) > 3:
        return f"{preview}\n· +{len(names) - 3}"
    return preview


def _setup_groups(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    entries = (
        item(
            "setup:group:quick",
            strings.QUICK_GROUP,
            secondary=msg(strings.QUICK_GROUP_BODY),
            kind="group",
            selected=setup.group_choice == "QUICK",
        ),
        item(
            "setup:group:browse",
            strings.CHOOSE_SAVED_GROUP,
            secondary=msg(strings.SAVED_GROUP_BODY),
            badge=raw(len(state.groups)),
            kind="group",
            selected=setup.group_choice == "SAVED" and bool(setup.group_id),
            enabled=bool(state.groups),
        ),
        item(
            "setup:group:create",
            strings.CREATE_GROUP,
            secondary=msg(strings.CREATE_GROUP_BODY),
            detail=msg(strings.PERSISTENT),
            kind="group",
            enabled=state.game_settings is not None,
        ),
    )
    return _setup_view(
        state,
        strings.GROUP,
        entries,
        view_mode="choices",
    )


def _setup_group_select(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    groups, page, total_pages = _group_page(state)
    entries = tuple(
        ViewItem(
            f"setup:group:select:{group['id']}",
            raw(group.get("name", group["id"])),
            raw(_member_preview(group.get("members", ()))),
            detail=msg(strings.GROUP_SAVED),
            badge=raw(len(group.get("members", ()))),
            kind="group",
            selected=setup.group_id == group["id"],
        )
        for group in groups
    )
    return _setup_view(
        state,
        strings.CHOOSE_SAVED_GROUP,
        entries,
        msg(strings.SELECT_GROUP_FIRST) if not entries else Text.raw(""),
        pagination=_pagination("setup:group", page, total_pages),
        view_mode="groups",
    )


def _setup_modes(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    modes = (
        ("CLASSIC_TRUTH_OR_DARE", strings.MODE_CLASSIC, strings.MODE_CLASSIC_HINT),
        ("RANDOM_TRUTH_OR_DARE", strings.MODE_RANDOM, strings.MODE_RANDOM_HINT),
        ("NEVER_HAVE_I_EVER", strings.MODE_NEVER, strings.MODE_NEVER_HINT),
        ("LETS_TALK", strings.MODE_TALK, strings.MODE_TALK_HINT),
    )
    entries = tuple(
        item(
            f"setup:mode:{mode}",
            label,
            secondary=msg(hint),
            kind="choice",
            selected=setup.mode == mode,
        )
        for mode, label, hint in modes
    )
    return _setup_view(
        state,
        strings.MODE,
        entries,
        view_mode="choices",
    )


def _setup_profiles(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    profiles, page, total_pages = _page_slice(
        state.profiles, state.collection_page, PROFILE_PAGE_SIZE
    )
    entries = tuple(
        ViewItem(
            f"setup:profile:{profile['id']}",
            raw(profile.get("name", profile["id"])),
            raw(profile.get("description", "")),
            kind="profile",
            selected=setup.profile_id == profile["id"],
        )
        for profile in profiles
    )
    selected_profile = next(
        (profile for profile in state.profiles if profile.get("id") == setup.profile_id),
        None,
    )
    requires_adult = bool(selected_profile and selected_profile.get("requiresAdultConfirmation"))
    actions = ()
    body = Text.raw("")
    if requires_adult and not setup.adult_content_confirmed:
        body = msg(strings.CONFIRM_ADULT_BODY)
        actions = (item("setup:adult:confirm", strings.CONFIRM_ADULT),)
    return _setup_view(
        state,
        strings.PROFILE,
        entries,
        body,
        actions=actions,
        pagination=_pagination("setup:profile", page, total_pages),
        view_mode="profiles",
    )


def _setup_players(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    page_size = COLLECTION_PAGE_SIZE
    players, page, total_pages = _page_slice(
        setup.players, state.collection_page, page_size
    )
    start = page * page_size
    normalized_names = [name.strip().casefold() for name in setup.players]
    entries = tuple(
        ViewItem(
            f"setup:player:open:{index}",
            raw(name),
            msg(strings.PLAYER_OPTIONS),
            detail=(
                msg(strings.DUPLICATE_NAME)
                if normalized_names[index]
                and normalized_names.count(normalized_names[index]) > 1
                else Text.raw("")
            ),
            badge=raw(index + 1),
            kind="person",
            danger=bool(
                normalized_names[index]
                and normalized_names.count(normalized_names[index]) > 1
            ),
        )
        for index, name in enumerate(players, start=start)
    )
    valid_names = (
        len(normalized_names) >= 2
        and all(normalized_names)
        and len(set(normalized_names)) == len(normalized_names)
    )
    actions = (
        item("setup:player:add", strings.ADD_PLAYER, enabled=len(setup.players) < 20),
        item(
            "setup:player:continue",
            strings.CONTINUE,
            enabled=valid_names,
        ),
    )
    alert = Text.raw("")
    if len(set(normalized_names)) < len(normalized_names):
        alert = msg(strings.PLAYER_NAMES_UNIQUE_ALERT)
    elif len(normalized_names) < 2 or any(not name for name in normalized_names):
        alert = msg(strings.PLAYER_MINIMUM_ALERT)
    return _setup_view(
        state,
        strings.PLAYERS,
        entries,
        actions=actions,
        pagination=_pagination("setup:player", page, total_pages),
        view_mode="people",
        alert=alert,
    )


def _setup_player(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    index = setup.selected_player_index
    if index is None or not 0 <= index < len(setup.players):
        return _setup_view(
            state,
            strings.PLAYER_OPTIONS,
            (),
            actions=(item(BACK_ACTION, strings.DONE),),
            view_mode="summary",
        )
    name = setup.players[index]
    return _setup_view(
        state,
        strings.PLAYER_OPTIONS,
        (),
        msg(strings.PLAYER_PROFILE_POSITION, index + 1, len(setup.players)),
        actions=(
            item(f"setup:player:edit:{index}", strings.EDIT_PLAYER),
            item(
                f"setup:player:remove:{index}",
                strings.REMOVE_PLAYER,
                danger=True,
            ),
            item(BACK_ACTION, strings.DONE),
        ),
        facts=(
            ViewFact(msg(strings.NAME), raw(name)),
            ViewFact(Text.raw(""), raw(index + 1)),
        ),
        view_mode="player-profile",
    )


def _customize(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    eligibility = setup.eligibility
    if eligibility:
        preview = msg(strings.ELIGIBLE_CARDS, eligibility.get("total", 0))
    else:
        preview = msg(strings.LOADING_PREVIEW)
    entries = [
        item("setup:custom:categories", strings.CATEGORIES),
        item("setup:custom:flags", strings.CONTENT_FLAGS),
        item("setup:custom:intensity", strings.INTENSITY),
        item("setup:custom:language", strings.CARD_LANGUAGE),
        item("setup:custom:policy", strings.CARD_POLICY),
    ]
    if setup.mode in {"CLASSIC_TRUTH_OR_DARE", "RANDOM_TRUTH_OR_DARE"}:
        entries.insert(1, item("setup:custom:dares", strings.DARE_TYPES))
    if setup.mode in {"RANDOM_TRUTH_OR_DARE", "NEVER_HAVE_I_EVER", "LETS_TALK"}:
        entries.insert(4, item("setup:custom:mode", strings.MODE_OPTIONS))
    return _setup_view(
        state,
        strings.CUSTOMIZE,
        tuple(entries),
        preview,
        actions=(item("setup:custom:continue", strings.CONTINUE),),
        view_mode="settings",
    )


def _taxonomy_toggle(state: AppState, kind: str) -> ViewModel:
    setup = _required_setup(state)
    taxonomy = state.taxonomy or {}
    if kind == "question":
        collection = taxonomy.get("questionCategories", ())
        selected = set(setup.configuration.get("enabledQuestionCategoryIds", ()))
        title = strings.CATEGORIES
    else:
        collection = taxonomy.get("dareTypes", ())
        selected = set(setup.configuration.get("enabledDareTypeIds", ()))
        title = strings.DARE_TYPES
    entries = tuple(
        ViewItem(
            f"setup:{kind}:toggle:{entry['id']}",
            raw(entry.get("label", entry["id"])),
            msg(strings.ENABLED if entry["id"] in selected else strings.DISABLED),
            selected=entry["id"] in selected,
        )
        for entry in collection
    )
    return _setup_view(
        state,
        title,
        entries,
        actions=(
            item(f"setup:{kind}:all", strings.ALL),
            item(f"setup:{kind}:none", strings.NONE),
            item(BACK_ACTION, strings.DONE),
        ),
        view_mode="settings",
    )


OPERATIONAL_FLAG_LABELS = {
    "REQUIRES_TARGET_PLAYER": strings.FLAG_TARGET_PLAYER,
    "INVOLVES_THIRD_PARTY": strings.FLAG_THIRD_PARTY,
    "REQUIRES_PHYSICAL_CONTACT": strings.FLAG_PHYSICAL_CONTACT,
    "REMOVES_CLOTHING": strings.FLAG_CLOTHING,
    "REQUIRES_NUDITY": strings.FLAG_NUDITY,
    "INVOLVES_ALCOHOL": strings.FLAG_ALCOHOL,
    "INVOLVES_RECREATIONAL_SUBSTANCES": strings.FLAG_SUBSTANCES,
}
SENSITIVITY_LABELS = {
    "GENERAL": strings.SENSITIVITY_GENERAL,
    "PERSONAL": strings.SENSITIVITY_PERSONAL,
    "CLOSE_PERSONAL": strings.SENSITIVITY_CLOSE,
    "DEEP_PERSONAL": strings.SENSITIVITY_DEEP,
    "INTIMATE": strings.SENSITIVITY_INTIMATE,
    "EXPLICIT": strings.SENSITIVITY_EXPLICIT,
}


def _flags(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    blocked = set(setup.configuration.get("blockedOperationalFlags", ()))
    entries = tuple(
        item(
            f"setup:flag:toggle:{flag}",
            label,
            secondary=msg(strings.DISABLED if flag in blocked else strings.ENABLED),
            selected=flag not in blocked,
        )
        for flag, label in OPERATIONAL_FLAG_LABELS.items()
    )
    return _setup_view(
        state,
        strings.CONTENT_FLAGS,
        entries,
        actions=(
            item("setup:flag:all", strings.ALL),
            item("setup:flag:none", strings.NONE),
            item(BACK_ACTION, strings.DONE),
        ),
        view_mode="settings",
    )


def _intensity(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    config = setup.configuration
    sensitivity = str(config.get("maximumSocialSensitivity", "GENERAL"))
    entries = (
        item(
            "setup:option:open:config:startingIntensity",
            strings.START_INTENSITY,
            secondary=raw(config.get("startingIntensity", 1)),
        ),
        item(
            "setup:option:open:config:maximumIntensity",
            strings.MAX_INTENSITY,
            secondary=raw(config.get("maximumIntensity", 1)),
        ),
        item(
            "setup:option:open:config:maximumSocialSensitivity",
            strings.SENSITIVITY,
            secondary=msg(SENSITIVITY_LABELS.get(sensitivity, strings.SENSITIVITY)),
        ),
        item(
            "setup:option:open:config:intensityProgressionUnit",
            strings.PROGRESSION_UNIT,
            secondary=msg(
                strings.PROGRESSION_ROUNDS
                if config.get("intensityProgressionUnit") == "ROUNDS"
                else strings.PROGRESSION_CARDS
            ),
        ),
        item(
            "setup:value:intensityProgressionInterval",
            strings.PROGRESSION_INTERVAL,
            secondary=raw(config.get("intensityProgressionInterval", 2)),
            detail=msg(strings.NUMBER_RANGE, 1, 100),
        ),
        item(
            "setup:option:open:config:intensityProgressionIncrement",
            strings.PROGRESSION_INCREMENT,
            secondary=raw(config.get("intensityProgressionIncrement", 1)),
        ),
    )
    return _setup_view(
        state,
        strings.INTENSITY,
        entries,
        actions=(item(BACK_ACTION, strings.DONE),),
        view_mode="settings",
    )


def _mode_options(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    config = setup.configuration
    entries: list[ViewItem] = []
    if setup.mode == "RANDOM_TRUTH_OR_DARE":
        entries.extend(
            (
                item(
                    "setup:option:open:config:randomQuestionRatio",
                    strings.QUESTION_RATIO,
                    secondary=raw(
                        f"{round(float(config.get('randomQuestionRatio', 0.5)) * 100)}%"
                    ),
                ),
                item(
                    "setup:value:maximumTypeStreak",
                    strings.TYPE_STREAK,
                    secondary=raw(config.get("maximumTypeStreak", 3)),
                    detail=msg(strings.NUMBER_RANGE, 1, 10),
                ),
            )
        )
    elif setup.mode == "LETS_TALK":
        entries.append(
            item(
                "setup:value:letsTalkMetaInterval",
                strings.META_INTERVAL,
                secondary=raw(config.get("letsTalkMetaInterval", 5)),
                detail=msg(strings.NUMBER_RANGE, 1, 100),
            )
        )
    if setup.mode == "NEVER_HAVE_I_EVER":
        entries.append(
            item(
                "setup:option:open:setup:neverRevealMode",
                strings.REVEAL_MODE,
                secondary=msg(
                    strings.NAMED
                    if setup.never_reveal_mode == NAMED_REVEAL_MODE
                    else strings.ANONYMOUS
                ),
            )
        )
    body = msg(strings.CLASSIC_MODE_NOTE) if setup.mode == "CLASSIC_TRUTH_OR_DARE" else Text.raw("")
    return _setup_view(
        state,
        strings.MODE_OPTIONS,
        tuple(entries),
        body,
        actions=(item(BACK_ACTION, strings.DONE),),
        view_mode="settings",
    )


def _option_heading(context: str) -> int:
    field = context.split(":", maxsplit=1)[-1]
    labels = {
        "startingIntensity": strings.START_INTENSITY,
        "maximumIntensity": strings.MAX_INTENSITY,
        "maximumSocialSensitivity": strings.SENSITIVITY,
        "intensityProgressionUnit": strings.PROGRESSION_UNIT,
        "intensityProgressionIncrement": strings.PROGRESSION_INCREMENT,
        "randomQuestionRatio": strings.QUESTION_RATIO,
        "neverRevealMode": strings.REVEAL_MODE,
        "yesNoAnswerPossible": strings.YES_NO_POSSIBLE,
        "alwaysEligible": strings.ALWAYS_ELIGIBLE,
        "repeatableInSession": strings.REPEATABLE,
        "lifecycle": strings.LIFECYCLE,
        "availability": strings.AVAILABILITY,
        "repeatCooldown": strings.REPEAT_COOLDOWN,
        "intensity": strings.INTENSITY,
        "weight": strings.WEIGHT,
        "socialSensitivity": strings.SENSITIVITY,
        "playerCount": strings.PLAYER_COUNT,
    }
    return labels.get(field, strings.CHOOSE_VALUE)


def _option_label(context: str, value: object) -> Text:
    if value is None:
        return msg(strings.INHERIT)
    if value is True:
        return msg(strings.YES)
    if value is False:
        return msg(strings.NO)
    if value == "EDIT":
        return msg(strings.SET_VALUE)
    labels = {
        "CARDS": strings.PROGRESSION_CARDS,
        "ROUNDS": strings.PROGRESSION_ROUNDS,
        ANONYMOUS_REVEAL_MODE: strings.ANONYMOUS,
        NAMED_REVEAL_MODE: strings.NAMED,
        ACTIVE_CARD_LIFECYCLE: strings.ACTIVE,
        RETIRED_CARD_LIFECYCLE: strings.RETIRED,
        "INCLUDE": strings.INCLUDE,
        "EXCLUDE": strings.EXCLUDE,
        "ENABLE": strings.ENABLED,
        "DISABLE": strings.DISABLED,
        "CATALOG": strings.CATALOG_VALUE,
        "SET": strings.SET_VALUE,
    }
    if value in SENSITIVITY_VALUES:
        return msg(SENSITIVITY_LABELS.get(str(value), strings.SENSITIVITY))
    if value in labels:
        return msg(labels[value])
    if context == "config:randomQuestionRatio":
        return raw(f"{round(float(value) * 100)}%")
    return raw(value)


def _setup_options(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    context = setup.option_editor or ""
    choices, current = _setup_option_choices(context, setup)

    entries: list[ViewItem] = []
    body = Text.raw("")
    body = _setup_option_entries(choices, context, setup, entries, current, body)
    return _setup_view(
        state,
        _option_heading(context),
        tuple(entries),
        body,
        actions=(item(BACK_ACTION, strings.DONE),),
        view_mode="choices",
    )

def _setup_option_entries(choices, context, setup, entries, current, body):
    for value in choices:
        body = _append_setup_option(value, setup, context, current, entries, body)
    return body


def _append_setup_option(value, setup, context, current, entries, body):
    enabled = True
    detail = Text.raw("")
    secondary = Text.raw("")
    if context == "config:startingIntensity" and int(value) > int(
        setup.configuration.get("maximumIntensity", 1)
    ):
        enabled = False
        detail = msg(strings.START_NOT_ABOVE_MAXIMUM)
    elif context == "config:maximumIntensity" and int(value) < int(
        setup.configuration.get("startingIntensity", 1)
    ):
        enabled = False
        detail = msg(strings.MAXIMUM_NOT_BELOW_START)
    elif context.startswith(PREDICATE_NUMBER_PREFIX) and value == "EDIT":
        field = context.split(":", maxsplit=1)[1]
        specification = PREDICATE_NUMBERS.get(field)
        rule = _active_rule(setup)
        predicate = rule.get("predicate", {}) if rule else {}
        if field in predicate:
            secondary = msg(strings.CURRENT_VALUE, predicate[field])
        if specification:
            body = msg(
                strings.NUMBER_RANGE,
                format_number(specification.minimum),
                format_number(specification.maximum),
            )
            detail = msg(
                strings.NUMBER_RANGE,
                format_number(specification.minimum),
                format_number(specification.maximum),
            )
    entries.append(
        ViewItem(
            f"setup:option:set:{encode_option(value)}",
            _option_label(context, value),
            secondary=secondary,
            detail=detail,
            kind="choice",
            enabled=enabled,
            selected=value == current,
        )
    )
    return body


def _setup_option_choices(context, setup):
    current: object = None
    choices: tuple[object, ...] = ()
    if context.startswith("config:"):
        field = context.split(":", maxsplit=1)[1]
        choices = tuple(CONFIGURATION_CHOICES.get(field, ()))
        current = setup.configuration.get(field)
    elif context == "setup:neverRevealMode":
        choices = NEVER_HAVE_I_EVER_REVEAL_MODE_ORDER
        current = setup.never_reveal_mode
    elif context.startswith((PREDICATE_NUMBER_PREFIX, "predicate:")):
        choices, current = _predicate_option_choices(context, setup)
    elif context.startswith("directive-value:"):
        field = context.split(":", maxsplit=1)[1]
        directive = _active_directives(setup).get(field)
        choices = SENSITIVITY_VALUES if field == "socialSensitivity" else ()
        current = directive.get("value") if isinstance(directive, Mapping) else None
    elif context.startswith("directive:"):
        field = context.split(":", maxsplit=1)[1]
        directive = _active_directives(setup).get(field)
        choices = tuple(DIRECTIVE_CHOICES.get(field, ()))
        current = directive.get("mode") if isinstance(directive, Mapping) else directive
    return choices, current


def _predicate_option_choices(context: str, setup: SetupDraft):
    field = context.split(":", maxsplit=1)[1]
    rule = _active_rule(setup)
    predicate = rule.get("predicate", {}) if rule else {}
    if context.startswith(PREDICATE_NUMBER_PREFIX):
        return (None, "EDIT"), "EDIT" if field in predicate else None
    return tuple(PREDICATE_CHOICES.get(field, ())), predicate.get(field)


def _locale_name(state: AppState, locale_id: str) -> str:
    locale = next(
        (entry for entry in state.locales if str(entry.get("id")) == locale_id),
        None,
    )
    return str(locale.get("nativeName", locale_id)) if locale else locale_id


def _card_language(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    fallback_enabled = setup.card_fallback_enabled and bool(
        setup.card_fallback_locales
    )
    fallback_summary = (
        msg(strings.SELECTED_COUNT, len(setup.card_fallback_locales))
        if setup.card_fallback_locales
        else msg(strings.NO_FALLBACK_SELECTED)
    )
    entries = (
        item(
            "setup:language:primary",
            strings.PRIMARY_CARD_LANGUAGE,
            secondary=raw(_locale_name(state, setup.card_locale)),
            detail=raw(setup.card_locale),
        ),
        item(
            "setup:language:fallback-off",
            strings.NO_LANGUAGE_FALLBACK,
            selected=not fallback_enabled,
            kind="choice",
        ),
        item(
            "setup:language:fallback-on",
            strings.USE_LANGUAGE_FALLBACK,
            selected=fallback_enabled,
            kind="choice",
        ),
        item(
            "setup:language:fallbacks",
            strings.FALLBACK_ORDER,
            secondary=fallback_summary,
            badge=raw(len(setup.card_fallback_locales)),
        ),
    )
    return _setup_view(
        state,
        strings.CARD_LANGUAGE,
        entries,
        actions=(item(BACK_ACTION, strings.DONE),),
        view_mode="choices",
    )


def _primary_card_language(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    locales, page, total_pages = _page_slice(
        state.locales, state.collection_page, COLLECTION_PAGE_SIZE
    )
    entries = tuple(
        ViewItem(
            f"setup:language:primary-set:{locale['id']}",
            raw(locale.get("nativeName", locale["id"])),
            raw(locale["id"]),
            selected=setup.card_locale == locale["id"],
            kind="choice",
        )
        for locale in locales
    )
    return _setup_view(
        state,
        strings.PRIMARY_CARD_LANGUAGE,
        entries,
        actions=(item(BACK_ACTION, strings.DONE),),
        pagination=_pagination("setup:language:primary", page, total_pages),
        view_mode="choices",
    )


def _fallback_languages(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    values, page, total_pages = _page_slice(
        setup.card_fallback_locales,
        state.collection_page,
        COLLECTION_PAGE_SIZE,
    )
    start = page * COLLECTION_PAGE_SIZE
    entries = tuple(
        ViewItem(
            f"setup:language:fallback-open:{locale_id}",
            raw(_locale_name(state, locale_id)),
            msg(strings.LANGUAGE_POSITION, index + 1, len(setup.card_fallback_locales)),
            detail=raw(locale_id),
            badge=raw(index + 1),
            kind="choice",
        )
        for index, locale_id in enumerate(values, start=start)
    )
    return _setup_view(
        state,
        strings.FALLBACK_ORDER,
        entries,
        msg(strings.NO_FALLBACK_SELECTED) if not entries else Text.raw(""),
        actions=(
            item("setup:language:fallback-add", strings.ADD_LANGUAGE),
            item(BACK_ACTION, strings.DONE),
        ),
        pagination=_pagination("setup:language:fallback", page, total_pages),
        view_mode="choices",
    )


def _add_fallback_language(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    available = tuple(
        locale
        for locale in state.locales
        if locale.get("id") != setup.card_locale
        and locale.get("id") not in setup.card_fallback_locales
    )
    locales, page, total_pages = _page_slice(
        available, state.collection_page, COLLECTION_PAGE_SIZE
    )
    entries = tuple(
        ViewItem(
            f"setup:language:fallback-add-set:{locale['id']}",
            raw(locale.get("nativeName", locale["id"])),
            raw(locale["id"]),
            kind="choice",
        )
        for locale in locales
    )
    return _setup_view(
        state,
        strings.ADD_LANGUAGE,
        entries,
        actions=(item(BACK_ACTION, strings.DONE),),
        pagination=_pagination("setup:language:fallback-add", page, total_pages),
        view_mode="choices",
    )


def _fallback_language(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    locale_id = setup.selected_fallback_locale
    if not locale_id or locale_id not in setup.card_fallback_locales:
        return _setup_view(
            state,
            strings.FALLBACK_ORDER,
            (),
            actions=(item(BACK_ACTION, strings.DONE),),
            view_mode="summary",
        )
    index = setup.card_fallback_locales.index(locale_id)
    return _setup_view(
        state,
        strings.FALLBACK_ORDER,
        (),
        msg(strings.LANGUAGE_POSITION, index + 1, len(setup.card_fallback_locales)),
        actions=(
            item(
                f"setup:language:fallback-up:{locale_id}",
                strings.MOVE_UP,
                enabled=index > 0,
            ),
            item(
                f"setup:language:fallback-down:{locale_id}",
                strings.MOVE_DOWN,
                enabled=index + 1 < len(setup.card_fallback_locales),
            ),
            item(
                f"setup:language:fallback-remove:{locale_id}",
                strings.REMOVE_FALLBACK,
                danger=True,
            ),
        ),
        view_mode="summary",
    )


def _card_policy(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    policy = setup.card_policy
    availability = policy.get("scopeDefault", {}).get("availability", "INHERIT")
    label_id = {
        "INCLUDE": strings.INCLUDE,
        "EXCLUDE": strings.EXCLUDE,
    }.get(availability, strings.INHERIT)
    entries = (
        item(
            "setup:policy:default",
            strings.DEFAULT_POLICY,
            secondary=msg(strings.DEFAULT_POLICY_HELP),
            badge=msg(label_id),
        ),
        item(
            "setup:policy:rules",
            strings.CONDITIONAL_RULES,
            secondary=msg(strings.CONDITIONAL_RULES_HELP),
            badge=raw(len(policy.get("conditionalRules", ()))),
        ),
        item(
            "setup:policy:exact",
            strings.EXACT_CARDS,
            secondary=msg(strings.EXACT_CARDS_HELP),
            badge=raw(len(policy.get("exactCards", ()))),
        ),
    )
    return _setup_view(
        state,
        strings.CARD_POLICY,
        entries,
        msg(strings.CARD_RULES_HELP),
        actions=(item(BACK_ACTION, strings.DONE),),
    )


def _policy_rules(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    all_rules = tuple(setup.card_policy.get("conditionalRules", ()))
    rules, page, total_pages = _page_slice(
        all_rules, state.collection_page, COLLECTION_PAGE_SIZE
    )
    entries = [
        ViewItem(
            f"setup:rule:edit:{rule['id']}",
            raw(rule.get("name", rule["id"])),
            msg(strings.ENABLED if rule.get("enabled", True) else strings.DISABLED),
            selected=bool(rule.get("enabled", True)),
        )
        for rule in rules
    ]
    return _setup_view(
        state,
        strings.CONDITIONAL_RULES,
        tuple(entries),
        msg(strings.CONDITIONAL_RULES_HELP),
        actions=(
            item("setup:rule:add", strings.ADD_RULE),
            item(BACK_ACTION, strings.DONE),
        ),
        pagination=_pagination("setup:rule", page, total_pages),
    )


def _policy_rule(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    rules = setup.card_policy.get("conditionalRules", ())
    rule = next((entry for entry in rules if entry["id"] == setup.selected_rule_id), None)
    if not rule:
        return _setup_view(state, strings.EDIT_RULE, (item(BACK_ACTION, strings.BACK),))
    availability = rule.get("directives", {}).get("availability", "INHERIT")
    entries = (
        ViewItem("setup:rule:name", raw(rule.get("name", "")), msg(strings.EDIT)),
        item(
            "setup:rule:enabled",
            strings.ENABLED,
            secondary=_on(bool(rule.get("enabled", True))),
        ),
        item(
            "setup:rule:predicate",
            strings.RULE_PREDICATE,
            secondary=msg(strings.FILTER_COUNT, len(rule.get("predicate", {}))),
        ),
        item(
            "setup:rule:directive",
            strings.RULE_DIRECTIVE,
            secondary=_directive_mode(availability),
        ),
        item("setup:rule:up", strings.MOVE_UP),
        item("setup:rule:down", strings.MOVE_DOWN),
    )
    return _setup_view(
        state,
        strings.EDIT_RULE,
        entries,
        msg(strings.RULE_PREDICATE_HELP),
        actions=(
            item("setup:rule:delete", strings.DELETE, danger=True),
            item(BACK_ACTION, strings.DONE),
        ),
    )


PREDICATE_ARRAY_LABELS = {
    "cardTypes": strings.CARD_TYPES,
    "questionCategoryIds": strings.CATEGORIES,
    "dareTypeIds": strings.DARE_TYPES,
    "dareAffinityCategoryIds": strings.DARE_AFFINITY,
    "socialSensitivities": strings.SENSITIVITY,
    "operationalFlagsAll": strings.FLAGS_ALL,
    "operationalFlagsAny": strings.FLAGS_ANY,
    "operationalFlagsNone": strings.FLAGS_NONE,
}


PREDICATE_SCALAR_LABELS = {
    "yesNoAnswerPossible": strings.YES_NO_POSSIBLE,
    "minimumIntensity": strings.MIN_INTENSITY,
    "maximumIntensity": strings.MAX_INTENSITY,
    "alwaysEligible": strings.ALWAYS_ELIGIBLE,
    "repeatableInSession": strings.REPEATABLE,
    "minimumRepeatCooldown": strings.MIN_REPEAT_COOLDOWN,
    "maximumRepeatCooldown": strings.MAX_REPEAT_COOLDOWN,
    "minimumWeight": strings.MIN_WEIGHT,
    "maximumWeight": strings.MAX_WEIGHT,
    "minimumPlayerCountAtLeast": strings.MIN_PLAYER_COUNT,
    "maximumPlayerCountAtMost": strings.MAX_PLAYER_COUNT,
    "lifecycle": strings.LIFECYCLE,
}


def _policy_predicate(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    rule = _active_rule(setup)
    predicate = rule.get("predicate", {}) if rule else {}
    entries: list[ViewItem] = []
    for field, label in PREDICATE_ARRAY_LABELS.items():
        entries.append(
            item(
                f"setup:facet:{field}",
                label,
                secondary=msg(strings.SELECTED_COUNT, len(predicate.get(field, ()))),
                kind="filter",
            )
        )
    for field, label in PREDICATE_SCALAR_LABELS.items():
        editor = "predicate" if field in PREDICATE_CHOICES else "predicate-number"
        specification = PREDICATE_NUMBERS.get(field)
        detail = Text.raw("")
        if specification:
            detail = msg(
                strings.NUMBER_RANGE,
                format_number(specification.minimum),
                format_number(specification.maximum),
            )
        entries.append(
            item(
                f"setup:option:open:{editor}:{field}",
                label,
                secondary=_predicate_value(predicate.get(field)),
                detail=detail,
                kind="filter",
            )
        )
    return _setup_view(
        state,
        strings.RULE_PREDICATE,
        tuple(entries),
        msg(strings.RULE_PREDICATE_HELP),
        actions=(item(BACK_ACTION, strings.DONE),),
    )


def _policy_values(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    rule = _active_rule(setup)
    predicate = rule.get("predicate", {}) if rule else {}
    facet = setup.policy_facet or "cardTypes"
    selected = set(predicate.get(facet, ()))
    options = policy_facet_options(state, facet)
    entries = tuple(
        ViewItem(
            f"setup:predicate:toggle:{value}",
            label,
            msg(strings.ENABLED if value in selected else strings.DISABLED),
            selected=value in selected,
        )
        for value, label in options
    )
    return _setup_view(
        state,
        PREDICATE_ARRAY_LABELS.get(facet, strings.RULE_PREDICATE),
        entries,
        actions=(
            item("setup:predicate:all", strings.ALL),
            item("setup:predicate:none", strings.NONE),
            item(BACK_ACTION, strings.DONE),
        ),
    )


def policy_facet_options(
    state: AppState,
    facet: str,
) -> tuple[tuple[str, Text], ...]:
    taxonomy = state.taxonomy or {}
    if facet == "cardTypes":
        return (
            ("QUESTION", msg(strings.TRUTH)),
            ("DARE", msg(strings.DARE)),
            ("CONVERSATION_META", msg(strings.CONVERSATION_META)),
        )
    if facet in {"questionCategoryIds", "dareAffinityCategoryIds"}:
        return tuple(
            (str(entry["id"]), raw(entry.get("label", entry["id"])))
            for entry in taxonomy.get("questionCategories", ())
        )
    if facet == "dareTypeIds":
        return tuple(
            (str(entry["id"]), raw(entry.get("label", entry["id"])))
            for entry in taxonomy.get("dareTypes", ())
        )
    if facet == "socialSensitivities":
        return tuple((value, msg(label)) for value, label in SENSITIVITY_LABELS.items())
    return tuple(
        (value, msg(label)) for value, label in OPERATIONAL_FLAG_LABELS.items()
    )


def _active_rule(setup: SetupDraft) -> Optional[Mapping[str, Any]]:
    return next(
        (
            entry
            for entry in setup.card_policy.get("conditionalRules", ())
            if entry.get("id") == setup.selected_rule_id
        ),
        None,
    )


def _predicate_value(value: Any) -> Text:
    if value is None:
        return msg(strings.INHERIT)
    if value is True:
        return msg(strings.YES)
    if value is False:
        return msg(strings.NO)
    if value == ACTIVE_CARD_LIFECYCLE:
        return msg(strings.ACTIVE)
    if value == RETIRED_CARD_LIFECYCLE:
        return msg(strings.RETIRED)
    return raw(value)


def _directive_mode(value: Any) -> Text:
    labels = {
        "INCLUDE": strings.INCLUDE,
        "EXCLUDE": strings.EXCLUDE,
        "ENABLE": strings.ENABLED,
        "DISABLE": strings.DISABLED,
        "CATALOG": strings.CATALOG_VALUE,
        "SET": strings.SET_VALUE,
    }
    if isinstance(value, Mapping):
        value = value.get("mode")
    return msg(labels.get(value, strings.INHERIT))


def _policy_directives(state: AppState, heading_id: int) -> ViewModel:
    setup = _required_setup(state)
    directives = _active_directives(setup)
    entries: list[ViewItem] = [
        item(
            "setup:option:open:directive:availability",
            strings.AVAILABILITY,
            secondary=_directive_mode(directives.get("availability")),
        ),
        item(
            "setup:option:open:directive:alwaysEligible",
            strings.ALWAYS_ELIGIBLE,
            secondary=_directive_mode(directives.get("alwaysEligible")),
        ),
        item(
            "setup:option:open:directive:repeatableInSession",
            strings.REPEATABLE,
            secondary=_directive_mode(directives.get("repeatableInSession")),
        ),
    ]
    scalar_fields = (
        ("repeatCooldown", strings.REPEAT_COOLDOWN),
        ("intensity", strings.INTENSITY),
        ("weight", strings.WEIGHT),
        ("socialSensitivity", strings.SENSITIVITY),
        ("playerCount", strings.PLAYER_COUNT),
    )
    for field, label in scalar_fields:
        current = directives.get(field)
        entries.append(
            item(
                f"setup:option:open:directive:{field}",
                label,
                secondary=_directive_mode(current),
            )
        )
        if isinstance(current, Mapping) and current.get("mode") == "SET":
            _policy_directives_set_mode(field, current, entries)
    if setup.selected_card_id:
        entries.append(item("setup:directive:reset", strings.RESET_CARD, danger=True))
    return _setup_view(
        state,
        heading_id,
        tuple(entries),
        msg(strings.RULE_DIRECTIVE_HELP),
        actions=(item(BACK_ACTION, strings.DONE),),
    )

def _policy_directives_set_mode(field, current, entries):
    if field == "playerCount":
        value = current.get("value", {})
        entries.extend(
            (
                item(
                    "setup:directive:value:playerMinimum",
                    strings.MIN_PLAYER_COUNT,
                    secondary=raw(value.get("minimum", 2)),
                    detail=msg(strings.NUMBER_RANGE, 2, 100),
                ),
                item(
                    "setup:directive:value:playerMaximum",
                    strings.MAX_PLAYER_COUNT,
                    secondary=_predicate_value(value.get("maximum")),
                    detail=msg(strings.NUMBER_RANGE, 2, 100),
                ),
            )
        )
    else:
        value = current.get("value")
        secondary = (
            msg(SENSITIVITY_LABELS.get(str(value), strings.SENSITIVITY))
            if field == "socialSensitivity"
            else raw(value)
        )
        entries.append(
            item(
                (
                    "setup:option:open:directive-value:socialSensitivity"
                    if field == "socialSensitivity"
                    else f"setup:directive:value:{field}"
                ),
                strings.EDIT_VALUE,
                secondary=secondary,
                detail=(
                    msg(
                        strings.NUMBER_RANGE,
                        format_number(DIRECTIVE_NUMBERS[field].minimum),
                        format_number(DIRECTIVE_NUMBERS[field].maximum),
                    )
                    if field in DIRECTIVE_NUMBERS
                    else Text.raw("")
                ),
            )
        )


def _active_directives(setup: SetupDraft) -> Mapping[str, Any]:
    if setup.selected_rule_id:
        rule = _active_rule(setup)
        return rule.get("directives", {}) if rule else {}
    if setup.selected_card_id:
        entry = next(
            (
                current
                for current in setup.card_policy.get("exactCards", ())
                if current.get("cardId") == setup.selected_card_id
            ),
            None,
        )
        return entry.get("directives", {}) if entry else {}
    return setup.card_policy.get("scopeDefault", {})


def _exact_cards(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    exact = {
        entry["cardId"]: entry.get("directives", {})
        for entry in setup.card_policy.get("exactCards", ())
    }
    entries: list[ViewItem] = []
    for card in setup.card_search_results:
        directives = exact.get(card["id"], {})
        availability = directives.get("availability", "INHERIT")
        entries.append(
            ViewItem(
                f"setup:card:edit:{card['id']}",
                raw(card.get("text", card["id"])),
                _directive_mode(availability),
                kind="card-result",
                selected=bool(directives),
            )
        )
    pagination = None
    if setup.card_search_cursor_history or setup.card_search_next_cursor:
        total_pages = max(
            1,
            (setup.card_search_total + COLLECTION_PAGE_SIZE - 1)
            // COLLECTION_PAGE_SIZE,
        )
        page = len(setup.card_search_cursor_history)
        pagination = Pagination(
            previous_key="setup:cards:page-previous",
            next_key="setup:cards:page-next",
            status=msg(strings.PAGE_STATUS, page + 1, total_pages),
            previous_enabled=bool(setup.card_search_cursor_history),
            next_enabled=bool(setup.card_search_next_cursor),
        )
    return _setup_view(
        state,
        strings.EXACT_CARDS,
        tuple(entries),
        msg(strings.SEARCH_RESULT_COUNT, setup.card_search_total),
        actions=(
            item(
                "setup:cards:search",
                strings.SEARCH_CARDS,
                secondary=raw(setup.card_search_query),
            ),
            item(BACK_ACTION, strings.DONE),
        ),
        pagination=pagination,
    )


def _exact_card_preview(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    card = next(
        (
            entry
            for entry in setup.card_search_results
            if entry.get("id") == setup.selected_card_id
        ),
        None,
    )
    if card is None:
        return ViewModel(
            msg(strings.EXACT_CARDS),
            msg(strings.EXACT_CARD_OVERRIDE),
            msg(strings.NO_CURRENT_CARD),
            actions=(item(BACK_ACTION, strings.BACK),),
            server_pill=_pill(state),
            preferred_focus=BACK_ACTION,
        )
    preview = ViewModel(
        eyebrow=msg(strings.EXACT_CARDS),
        heading=msg(strings.EXACT_CARD_OVERRIDE),
        facts=(
            ViewFact(msg(strings.EXACT_CARDS), raw(1)),
            ViewFact(msg(strings.CARD_LANGUAGE), raw(setup.card_locale)),
            ViewFact(msg(strings.SEARCH_CARDS), raw(setup.card_search_total)),
        ),
        actions=(
            item("setup:card:configure", strings.EDIT),
            item(BACK_ACTION, strings.BACK),
        ),
        view_mode="card",
        card_eyebrow=msg(strings.EXACT_CARD_OVERRIDE),
        card_classification=raw(card.get("taxonomyLabel", "")),
        card_text=raw(card.get("text", card.get("id", ""))),
        server_pill=_pill(state),
        preferred_focus="setup:card:configure",
        atmosphere=_atmosphere(card),
    )
    return _with_card_page(state, preview)


def _review(state: AppState) -> ViewModel:
    setup = _required_setup(state)
    profile = next(
        (entry for entry in state.profiles if entry.get("id") == setup.profile_id),
        None,
    )
    profile_name = profile.get("name", setup.profile_id) if profile else setup.profile_id
    eligibility = setup.eligibility or {}
    if setup.topology == "HOST":
        body = msg(strings.HOST_HANDOFF_BODY)
    elif setup.mode == "NEVER_HAVE_I_EVER":
        body = msg(strings.SHARED_ANONYMITY_NOTE)
    else:
        body = msg(strings.REVIEW_READY_BODY)
    group = next(
        (entry for entry in state.groups if entry.get("id") == setup.group_id),
        None,
    )
    group_name = group.get("name", "") if group else ""
    facts: list[ViewFact] = [
        ViewFact(msg(strings.MODE_LABEL), msg(_mode_name(setup.mode))),
        ViewFact(msg(strings.PROFILE_LABEL), raw(profile_name)),
        ViewFact(
            msg(strings.GROUP_LABEL),
            raw(group_name) if group_name else msg(strings.NO_GROUP),
        ),
        ViewFact(msg(strings.CARD_LANGUAGE), raw(setup.card_locale)),
        ViewFact(
            msg(strings.INTENSITY),
            raw(
                f"{setup.configuration.get('startingIntensity', 1)} → "
                f"{setup.configuration.get('maximumIntensity', 1)}"
            ),
        ),
        ViewFact(msg(strings.CARDS), raw(eligibility.get("total", "…"))),
    ]
    if setup.topology == "COUCH":
        facts.insert(3, ViewFact(msg(strings.PLAYERS), raw(len(setup.players))))
    requires_adult = bool(profile and profile.get("requiresAdultConfirmation"))
    can_start = (not requires_adult or setup.adult_content_confirmed) and int(
        eligibility.get("total", 1)
    ) > 0
    actions = (
        item(
            "setup:start",
            strings.START_GAME if setup.topology == "COUCH" else strings.CREATE_ROOM,
            enabled=can_start,
        ),
    )
    return _setup_view(
        state,
        strings.READY_TO_PLAY,
        (),
        body,
        actions=actions,
        facts=tuple(facts),
        view_mode="summary",
    )


def _setup_view(
    state: AppState,
    heading_id: int,
    items: tuple[ViewItem, ...],
    body: Text = Text.raw(""),
    *,
    actions: tuple[ViewItem, ...] = (),
    pagination: Optional[Pagination] = None,
    facts: tuple[ViewFact, ...] = (),
    view_mode: str = "rows",
    alert: Text = Text.raw(""),
) -> ViewModel:
    setup = _required_setup(state)
    command_items = tuple(entry for entry in items if entry.key == BACK_ACTION)
    visible_items = tuple(entry for entry in items if entry.key != BACK_ACTION)
    visible_actions = actions
    if command_items:
        visible_actions = (*visible_actions, *command_items)
    visible_pagination = pagination
    page_size = SETTINGS_PAGE_SIZE if view_mode == "settings" else COLLECTION_PAGE_SIZE
    if visible_pagination is None and len(visible_items) > page_size:
        visible_items, page, total_pages = _page_slice(
            visible_items,
            state.collection_page,
            page_size,
        )
        visible_pagination = _pagination("collection", page, total_pages)
    eyebrow = strings.COUCH_PLAY if setup.topology == "COUCH" else strings.HOST_ROOM
    return ViewModel(
        msg(eyebrow),
        msg(heading_id),
        body,
        visible_items,
        actions=visible_actions,
        pagination=visible_pagination,
        facts=facts,
        view_mode=view_mode,
        server_pill=_pill(state),
        preferred_focus=next(
            (entry.key for entry in (*visible_items, *visible_actions) if entry.enabled),
            None,
        ),
        progress=_setup_progress(state),
        alert=alert,
    )


def _setup_progress(state: AppState) -> Text:
    setup = _required_setup(state)
    if setup.topology == "COUCH":
        steps = (
            Route.SETUP_GROUP,
            Route.SETUP_MODE,
            Route.SETUP_PROFILE,
            Route.SETUP_PLAYERS,
            Route.SETUP_CUSTOMIZE,
            Route.SETUP_REVIEW,
        )
    else:
        steps = (
            Route.SETUP_GROUP,
            Route.SETUP_MODE,
            Route.SETUP_PROFILE,
            Route.SETUP_CUSTOMIZE,
            Route.SETUP_REVIEW,
        )
    route = state.route
    if route == Route.SETUP_GROUP_SELECT:
        route = Route.SETUP_GROUP
    elif route == Route.SETUP_PLAYER:
        route = Route.SETUP_PLAYERS
    elif route in {
        Route.SETUP_OPTIONS,
        Route.SETUP_CARD_LANGUAGE_PRIMARY,
        Route.SETUP_CARD_LANGUAGE_FALLBACKS,
        Route.SETUP_CARD_LANGUAGE_FALLBACK_ADD,
        Route.SETUP_CARD_LANGUAGE_FALLBACK,
    }:
        route = Route.SETUP_CUSTOMIZE
    if route not in steps:
        route = Route.SETUP_CUSTOMIZE
    return msg(strings.SETUP_PROGRESS, steps.index(route) + 1, len(steps))


def _required_setup(state: AppState) -> SetupDraft:
    if not state.setup:
        raise ValueError("Setup route requires a pending setup")
    return state.setup


def _couch_game(state: AppState) -> ViewModel:
    snapshot = state.couch_snapshot or {}
    card = snapshot.get("currentCard")
    waiting_for_card = snapshot.get("state") in {
        "WAITING_FOR_PLAYER",
        "NEXT_PLAYER",
        "TRANSITION",
    }
    active = snapshot.get("activePlayer") or {}
    selected_player = next(
        (
            player
            for player in snapshot.get("players", ())
            if player.get("id") == state.couch_vote_player_id
        ),
        None,
    )
    card_text = _couch_card_text(waiting_for_card, snapshot, card)
    visible_card = None if waiting_for_card else card
    card_label = _couch_card_label(waiting_for_card, card)
    body = _voting_result(state, snapshot)
    result_yes, result_no = _voting_result_values(state, snapshot)
    result_yes_names, result_no_names = _voting_result_names(state, snapshot)
    result_yes_players, result_no_players = _voting_result_players(state, snapshot)
    result_status = _voting_result_status(state, snapshot)
    if result_yes.literal or result_yes.message_id or result_no.literal or result_no.message_id:
        body = Text.raw("")
    entries = _couch_actions(state, snapshot)
    voters, voter_pagination = _couch_voters(state, snapshot)
    voting_stage_label, voting_player, voting_hint = _couch_vote_labels(selected_player, state, voters)
    if state.couch_sync_required:
        body = msg(strings.COUCH_SYNC_BODY)
        result_yes, result_no = Text.raw(""), Text.raw("")
        result_yes_names, result_no_names = Text.raw(""), Text.raw("")
        result_yes_players, result_no_players = (), ()
        voters, voter_pagination = (), None
        voting_stage_label, voting_player, voting_hint = Text.raw(""), Text.raw(""), Text.raw("")
        entries = (
            item("couch:resync", strings.REFRESH_STATE),
            item(END_COUCH_ACTION, strings.END_GAME, danger=True),
        )
    elif state.couch_pool_exhausted:
        card_label = msg(strings.POOL_EXHAUSTED)
        card_text = msg(strings.POOL_EXHAUSTED_BODY)
        body = Text.raw("")
        result_yes, result_no = Text.raw(""), Text.raw("")
        result_yes_names, result_no_names = Text.raw(""), Text.raw("")
        result_yes_players, result_no_players = (), ()
        voters, voter_pagination = (), None
        voting_stage_label, voting_player, voting_hint = Text.raw(""), Text.raw(""), Text.raw("")
        entries = (
            item("couch:adjust", strings.ADJUST_SETUP, kind="wrap-action"),
            item(END_COUCH_ACTION, strings.END_GAME, danger=True),
        )
    if state.busy_operation and state.busy_operation.startswith("couch."):
        entries = tuple(replace(entry, enabled=False) for entry in entries)
        voters = tuple(replace(entry, enabled=False) for entry in voters)
    preferred_focus = None
    if not state.busy_operation:
        preferred_focus = _couch_game_busy_operation(voters, voter_pagination, entries, preferred_focus)
    return ViewModel(
        msg(strings.COUCH_PLAY),
        msg(strings.GAME),
        body,
        actions=entries,
        pagination=voter_pagination,
        facts=(
            ViewFact(msg(strings.ROUND_LABEL), raw(snapshot.get("roundNumber", 0))),
            ViewFact(msg(strings.CARDS), raw(snapshot.get("cardsShown", 0))),
            ViewFact(msg(strings.REMAINING), raw(snapshot.get("remainingCardCount", 0))),
        ),
        voters=voters,
        view_mode="card",
        card_eyebrow=card_label,
        card_classification=_card_classification(state, visible_card),
        card_text=card_text,
        **_couch_card_details(state, visible_card, active),
        card_footer=Text.raw(""),
        server_pill=Text.raw(""),
        footer=Text.raw(""),
        preferred_focus=preferred_focus,
        atmosphere=_atmosphere(visible_card),
        result_yes=result_yes,
        result_no=result_no,
        result_yes_names=result_yes_names,
        result_no_names=result_no_names,
        result_yes_players=result_yes_players,
        result_no_players=result_no_players,
        result_status=result_status,
        private_vote_choice=bool(
            selected_player and state.couch_vote_phase == "CHOICE"
        ),
        voting_stage_label=voting_stage_label,
        voting_player=voting_player,
        voting_hint=voting_hint,
    )

def _couch_vote_labels(selected_player, state, voters):
    voting_stage_label = Text.raw("")
    voting_player = Text.raw("")
    voting_hint = Text.raw("")
    if selected_player:
        voting_player = raw(selected_player.get("name", ""))
        if state.couch_vote_phase == "CHOICE":
            voting_stage_label = msg(strings.CASTING_VOTE)
            voting_hint = msg(strings.PRIVATE_VOTE_HINT)
        elif state.couch_vote_phase == "SUBMITTING":
            voting_stage_label = msg(strings.SUBMITTING_VOTE)
    elif voters:
        voting_stage_label = msg(strings.CHOOSE_VOTER)
    return voting_stage_label, voting_player, voting_hint

def _couch_card_text(waiting_for_card, snapshot, card):
    if waiting_for_card:
        card_text = msg(strings.READY_NEXT_CARD)
    elif snapshot.get("state") == "CHOOSING_CARD_TYPE":
        card_text = msg(strings.CHOOSE_TRUTH_OR_DARE)
    else:
        card_text = raw(card.get("cardText", "")) if card else msg(strings.NO_CURRENT_CARD)
    return card_text

def _couch_card_label(waiting_for_card: bool, card) -> Text:
    if waiting_for_card or not card:
        return Text.raw("")
    return msg(_card_type_label(card.get("cardType", "")))


def _couch_card_details(state: AppState, visible_card, active) -> dict[str, Text]:
    return {
        'card_intensity': _intensity_marks(visible_card.get('cardIntensity')) if visible_card and (not state.couch_sync_required) else Text.raw(''),
        'game_intensity': _intensity_marks(visible_card.get('intensity')) if visible_card and (not state.couch_sync_required) else Text.raw(''),
        'current_player': raw(active.get('name', '')) if active and (not state.couch_sync_required) else Text.raw('')
    }


def _couch_game_busy_operation(voters, voter_pagination, entries, preferred_focus):
    current_voter_page_complete = bool(voters) and not any(
        voter.enabled for voter in voters
    )
    if (
        current_voter_page_complete
        and voter_pagination
        and voter_pagination.next_enabled
    ):
        preferred_focus = voter_pagination.next_key
    else:
        preferred_voter = next((voter for voter in voters if voter.enabled), None)
        preferred_action = next((entry for entry in entries if entry.enabled), None)
        if preferred_voter:
            preferred_focus = preferred_voter.key
        elif preferred_action:
            preferred_focus = preferred_action.key
    return preferred_focus


def _couch_menu(state: AppState) -> ViewModel:
    return ViewModel(
        msg(strings.COUCH_PLAY),
        msg(strings.COUCH_OPTIONS),
        msg(strings.CONTENT_LOCKED),
        actions=(
            item("couch:resume", strings.RESUME_GAME),
            item("couch:menu-help", strings.HELP),
            item(END_COUCH_ACTION, strings.END_GAME, danger=True),
            item(
                "app:exit",
                strings.EXIT_ADDON,
                danger=True,
            ),
        ),
        view_mode="active-menu",
        server_pill=_pill(state),
        preferred_focus="couch:resume",
    )


def _voting_result(_state: AppState, snapshot: Mapping[str, Any]) -> Text:
    voting = snapshot.get("neverHaveIEverVoting")
    if not isinstance(voting, Mapping):
        return Text.raw("")
    result = voting.get("result")
    if not isinstance(result, Mapping):
        return Text.raw("")
    named = result.get("namedAnswers")
    if voting.get("revealMode") != NAMED_REVEAL_MODE or not isinstance(named, list):
        return msg(strings.RESULT, result.get("yes", 0), result.get("no", 0))
    # Named answers have their own two-column projection. The regular body is
    # intentionally empty so a second comma-joined representation cannot fight
    # the stable rows in those columns.
    return Text.raw("")


def _voting_result_values(
    _state: AppState, snapshot: Mapping[str, Any]
) -> tuple[Text, Text]:
    voting = snapshot.get("neverHaveIEverVoting")
    if not isinstance(voting, Mapping):
        return Text.raw(""), Text.raw("")
    result = voting.get("result")
    if not isinstance(result, Mapping):
        return Text.raw(""), Text.raw("")
    named = result.get("namedAnswers")
    if voting.get("revealMode") != NAMED_REVEAL_MODE or not isinstance(named, list):
        return (
            msg(strings.RESULT_YES, result.get("yes", 0)),
            msg(strings.RESULT_NO, result.get("no", 0)),
        )
    return (
        msg(strings.RESULT_YES, result.get("yes", 0)),
        msg(strings.RESULT_NO, result.get("no", 0)),
    )


def _voting_result_names(
    state: AppState, snapshot: Mapping[str, Any]
) -> tuple[Text, Text]:
    columns = _named_result_columns(state, snapshot)
    if columns is None:
        return Text.raw(""), Text.raw("")
    yes_names, no_names, _, _ = columns
    return raw(_result_name_rows(yes_names)), raw(_result_name_rows(no_names))


def _voting_result_players(
    state: AppState, snapshot: Mapping[str, Any]
) -> tuple[tuple[ViewItem, ...], tuple[ViewItem, ...]]:
    columns = _named_result_columns(state, snapshot)
    if columns is None:
        return (), ()
    yes_names, no_names, _, _ = columns
    yes_players = tuple(
        ViewItem(
            key=f"result:yes:{index}",
            label=raw(name),
            kind="result-name",
            enabled=False,
        )
        for index, name in enumerate(yes_names)
    )
    no_players = tuple(
        ViewItem(
            key=f"result:no:{index}",
            label=raw(name),
            kind="result-name",
            enabled=False,
        )
        for index, name in enumerate(no_names)
    )
    return yes_players, no_players


def _named_result_columns(
    state: AppState, snapshot: Mapping[str, Any]
) -> Optional[tuple[tuple[str, ...], tuple[str, ...], int, int]]:
    voting = snapshot.get("neverHaveIEverVoting")
    if not isinstance(voting, Mapping):
        return None
    result = voting.get("result")
    named = result.get("namedAnswers") if isinstance(result, Mapping) else None
    if voting.get("revealMode") != NAMED_REVEAL_MODE or not isinstance(named, list):
        return None
    yes = tuple(
        str(entry.get("displayName", ""))
        for entry in named
        if entry.get("vote") == YES_VOTE
    )
    no = tuple(
        str(entry.get("displayName", ""))
        for entry in named
        if entry.get("vote") == NO_VOTE
    )
    total_pages = max(
        1,
        (len(yes) + NAMED_RESULT_COLUMN_PAGE_SIZE - 1)
        // NAMED_RESULT_COLUMN_PAGE_SIZE,
        (len(no) + NAMED_RESULT_COLUMN_PAGE_SIZE - 1)
        // NAMED_RESULT_COLUMN_PAGE_SIZE,
    )
    page = state.auto_page % total_pages
    start = page * NAMED_RESULT_COLUMN_PAGE_SIZE
    end = start + NAMED_RESULT_COLUMN_PAGE_SIZE
    return yes[start:end], no[start:end], page, total_pages


def _result_name_rows(names: tuple[str, ...]) -> str:
    if not names:
        return "—"
    return "\n".join(names)


def _voting_result_status(state: AppState, snapshot: Mapping[str, Any]) -> Text:
    voting = snapshot.get("neverHaveIEverVoting")
    if not isinstance(voting, Mapping):
        return Text.raw("")
    result = voting.get("result")
    named = result.get("namedAnswers") if isinstance(result, Mapping) else None
    if voting.get("revealMode") != NAMED_REVEAL_MODE or not isinstance(named, list):
        return Text.raw("")
    columns = _named_result_columns(state, snapshot)
    if columns is None:
        return Text.raw("")
    _, _, page, total_pages = columns
    if total_pages <= 1:
        return Text.raw("")
    return msg(strings.RESULT_AUTO_PAGE_STATUS, page + 1, total_pages)


def _couch_voters(
    app_state: AppState, snapshot: Mapping[str, Any]
) -> tuple[tuple[ViewItem, ...], Optional[Pagination]]:
    if snapshot.get("state") != "COLLECTING_ANSWERS":
        return (), None
    if app_state.couch_vote_player_id:
        return (), None
    voted = set(snapshot.get("votedPlayerIds", ()))
    players = tuple(snapshot.get("players", ()))
    page_values, page, total_pages = _page_slice(
        players,
        app_state.collection_page,
        COUCH_VOTER_PAGE_SIZE,
    )
    voters = tuple(
        ViewItem(
            key=f"couch:vote-player:{player.get('id', '')}",
            label=raw(player.get("name", "")),
            secondary=msg(
                strings.VOTED_STATUS
                if player.get("id") in voted
                else strings.PENDING
            ),
            kind="voter",
            enabled=player.get("id") not in voted,
        )
        for player in page_values
    )
    if total_pages <= 1:
        return voters, None
    return voters, Pagination(
        previous_key="couch:voters:page-previous",
        next_key="couch:voters:page-next",
        status=msg(strings.VOTER_PAGE_STATUS, page + 1, total_pages),
        previous_enabled=page > 0,
        next_enabled=page + 1 < total_pages,
    )


def _couch_actions(app_state: AppState, snapshot: Mapping[str, Any]) -> tuple[ViewItem, ...]:
    session_state = snapshot.get("state")
    entries: list[ViewItem] = []
    if session_state in ("WAITING_FOR_PLAYER", "NEXT_PLAYER", "TRANSITION"):
        entries.append(item("couch:start", strings.REVEAL_CARD))
    elif session_state == "CHOOSING_CARD_TYPE":
        entries.extend((item("couch:choose:QUESTION", strings.TRUTH), item("couch:choose:DARE", strings.DARE)))
    elif session_state == "COLLECTING_ANSWERS":
        selected = app_state.couch_vote_player_id
        if not selected:
            entries.append(item("couch:skip", strings.SKIP))
    elif session_state == "SHOWING_RESULTS":
        entries.append(item("couch:advance", strings.ADVANCE))
    elif session_state not in ("SELECTING_CARD", "ENDED"):
        entries.append(item("couch:advance", strings.ADVANCE))
        if snapshot.get("currentCard"):
            entries.append(item("couch:skip", strings.SKIP))
    return tuple(entries)


def _couch_summary(state: AppState) -> ViewModel:
    snapshot = state.couch_snapshot or {}
    return ViewModel(
        msg(strings.COUCH_PLAY),
        msg(strings.SUMMARY_TITLE),
        msg(strings.SUMMARY_BODY),
        actions=(
            item("summary:again", strings.PLAY_AGAIN),
            item("summary:new", strings.NEW_GAME),
            item("summary:home", strings.RETURN_HOME),
        ),
        facts=(
            ViewFact(msg(strings.CARDS), raw(snapshot.get("cardsShown", 0))),
            ViewFact(msg(strings.ROUND_LABEL), raw(snapshot.get("roundNumber", 0))),
            ViewFact(msg(strings.PLAYERS), raw(len(snapshot.get("players", ())))),
        ),
        view_mode="summary",
        server_pill=_pill(state),
        preferred_focus="summary:again",
    )


def _host_status(snapshot: Mapping[str, Any]) -> Text:
    status = snapshot.get("hostStatus", {})
    host_state = status.get("state")
    name = status.get("displayName", "")
    if host_state == CONNECTED_HOST_STATE:
        return msg(strings.HOST_CONNECTED, name)
    if host_state in (RECONNECTING_HOST_STATE, CONNECTING_HOST_STATE):
        return msg(strings.HOST_RECONNECTING, name)
    if host_state == AWAITING_REPLACEMENT_HOST_STATE:
        return msg(strings.AWAITING_REPLACEMENT)
    return msg(strings.AWAITING_FIRST_HOST)


def _room_display(state: AppState) -> ViewModel:
    room = state.active_room
    snapshot = state.room_snapshot or {}
    session = snapshot.get("session")
    code = room.room_code if room else ""
    roster, roster_status, represented_count = _room_roster_view(state, snapshot, session)
    capacity = snapshot.get("capacity", {}).get("maximumPlayers", "—")
    if session:
        return _room_display_session(session, state, snapshot, code, roster, roster_status)
    settings = snapshot.get("settings", {})
    configuration = settings.get("configuration", {})
    profile = next(
        (entry for entry in state.profiles if entry.get("id") == settings.get("profileId")),
        None,
    )
    group = next(
        (entry for entry in state.groups if entry.get("id") == settings.get("groupId")),
        None,
    )
    locale = next(
        (entry for entry in state.locales if entry.get("id") == settings.get("cardLocale")),
        None,
    )
    sensitivity = SENSITIVITY_LABELS.get(
        str(configuration.get("maximumSocialSensitivity")),
        strings.SENSITIVITY,
    )
    eligible = (state.room_eligibility or {}).get("total", "…")
    content_count = msg(
        strings.CONTENT_COUNT,
        len(configuration.get("enabledQuestionCategoryIds", ())),
        len(configuration.get("enabledDareTypeIds", ())),
    )
    lobby_facts: list[ViewFact] = [
        ViewFact(
            msg(strings.MODE_LABEL),
            msg(_mode_name(str(settings.get("mode", "")))),
        ),
        ViewFact(
            msg(strings.PROFILE_LABEL),
            raw(profile.get("name", settings.get("profileId", "")))
            if profile
            else raw(settings.get("profileId", "")),
        ),
        ViewFact(
            msg(strings.GROUP_LABEL),
            raw(group.get("name", "")) if group else msg(strings.NO_GROUP),
        ),
        ViewFact(
            msg(strings.CARD_LANGUAGE),
            raw(locale.get("nativeName", settings.get("cardLocale", "")))
            if locale
            else raw(settings.get("cardLocale", "")),
        ),
        ViewFact(
            msg(strings.INTENSITY),
            raw(
                f"{configuration.get('startingIntensity', 1)} → "
                f"{configuration.get('maximumIntensity', 1)}"
            ),
        ),
        ViewFact(msg(strings.SENSITIVITY), msg(sensitivity)),
        ViewFact(msg(strings.CONTENT_FLAGS), content_count),
    ]
    if settings.get("mode") == "NEVER_HAVE_I_EVER":
        lobby_facts.append(
            ViewFact(
                msg(strings.REVEAL_MODE),
                msg(
                    strings.NAMED
                    if settings.get("neverHaveIEverRevealMode") == NAMED_REVEAL_MODE
                    else strings.ANONYMOUS
                ),
            )
        )
    lobby_facts.append(ViewFact(msg(strings.CARDS), raw(eligible)))
    join_urls, join_url_status = _room_join_urls(state, code)
    return ViewModel(
        msg(strings.DISPLAY_ROOM),
        msg(strings.ROOM_LOBBY),
        msg(strings.RECONNECTING_BODY)
        if state.transport_state == "RECONNECTING"
        else _host_status(snapshot),
        facts=tuple(lobby_facts),
        roster=roster,
        view_mode="lobby",
        server_pill=_pill(state),
        footer=_player_capacity_status(roster_status, represented_count, capacity),
        qr_path=state.qr_path or "",
        preferred_focus=None,
        room_code=raw(code),
        join_urls=join_urls,
        join_url_status=join_url_status,
    )

def _room_display_session(session, state, snapshot, code, roster, roster_status):
    session_state = session.get("state")
    waiting_for_card = session_state in {
        "WAITING_FOR_PLAYER",
        "NEXT_PLAYER",
        "TRANSITION",
    }
    card = None if waiting_for_card else session.get("currentCard")
    body = _room_stage_body(state, snapshot, session)
    result_yes, result_no = _voting_result_values(state, session)
    result_yes_names, result_no_names = _voting_result_names(state, session)
    result_yes_players, result_no_players = _voting_result_players(state, session)
    active = session.get("activePlayer") or {}
    if session.get("remainingCardCount") == 0 and not card:
        card_label = msg(strings.POOL_EXHAUSTED)
        card_text = msg(strings.POOL_EXHAUSTED_BODY)
    elif waiting_for_card:
        card_label = Text.raw("")
        card_text = msg(strings.READY_NEXT_CARD)
    elif session_state == "CHOOSING_CARD_TYPE" and not card:
        card_label = Text.raw("")
        card_text = msg(strings.TRUTH_DARE_DEVICE_CHOICE)
    else:
        card_label = msg(_card_type_label(card.get("cardType"))) if card else Text.raw("")
        card_text = raw(card.get("cardText", "")) if card else msg(strings.NO_CURRENT_CARD)
    return ViewModel(
        eyebrow=msg(strings.DISPLAY_ROOM),
        heading=msg(strings.ROOM_GAME),
        body=body,
        facts=(
            ViewFact(msg(strings.ROUND_LABEL), raw(session.get("roundNumber", 0))),
            ViewFact(msg(strings.CARDS), raw(session.get("cardsShown", 0))),
            ViewFact(msg(strings.REMAINING), raw(session.get("remainingCardCount", 0))),
            ViewFact(Text.raw(""), msg(strings.LIVE)),
            ViewFact(msg(strings.ROOM_CODE), raw(code)),
        ),
        roster=roster,
        view_mode="card",
        card_eyebrow=card_label,
        card_classification=_card_classification(state, card),
        card_text=card_text,
        card_intensity=_intensity_marks(card.get("cardIntensity")) if card else Text.raw(""),
        game_intensity=_intensity_marks(card.get("intensity")) if card else Text.raw(""),
        current_player=raw(active.get("name", "")) if active else Text.raw(""),
        card_footer=Text.raw(""),
        server_pill=Text.raw(""),
        footer=roster_status,
        preferred_focus=None,
        atmosphere=_atmosphere(card),
        result_yes=result_yes,
        result_no=result_no,
        result_yes_names=result_yes_names,
        result_no_names=result_no_names,
        result_yes_players=result_yes_players,
        result_no_players=result_no_players,
        result_status=_voting_result_status(state, session),
        room_code=raw(code),
    )


def _player_capacity_status(status: Text, represented: int, capacity: object) -> Text:
    if status.message_id == strings.PAGE_STATUS and len(status.arguments) == 2:
        return msg(
            strings.PLAYER_CAPACITY_PAGE,
            represented,
            capacity,
            status.arguments[0],
            status.arguments[1],
        )
    return msg(strings.PLAYER_CAPACITY, represented, capacity)


def _room_join_urls(state: AppState, code: str) -> tuple[Text, Text]:
    info = state.server_info or {}
    access = info.get("roomAccess", {})
    bases = list(dict.fromkeys(access.get("availableBaseUrls", ())))
    configured = access.get("configuredBaseUrl")
    if configured and configured not in bases:
        bases.insert(0, configured)
    template = info.get("endpoints", {}).get("roomJoinPathTemplate", "/play/?room={roomCode}")
    path = str(template).replace("{roomCode}", code)
    urls = [f"{str(base).rstrip('/')}/{path.lstrip('/')}" for base in bases]
    if not urls:
        return Text.raw(""), Text.raw("")
    page = state.auto_page % len(urls)
    status = (
        msg(strings.JOIN_ADDRESS_STATUS, page + 1, len(urls))
        if len(urls) > 1
        else Text.raw("")
    )
    # The VID requires one complete address to be readable at a time. Explicit
    # break opportunities avoid a marquee ever showing only the middle of it.
    return raw(_wrapped_identifier(urls[page], width=42)), status


def _room_roster(
    snapshot: Mapping[str, Any], session: Optional[Mapping[str, Any]]
) -> tuple[Mapping[str, Any], ...]:
    result: list[Mapping[str, Any]] = []
    for participant in snapshot.get("participants", ()):
        if participant.get("role") == "DISPLAY":
            continue
        result.append(
            {
                "id": participant.get("id"),
                "name": participant.get("displayName", ""),
                "role": participant.get("role", "PLAYER"),
                "connected": participant.get("connectionStatus")
                == CONNECTED_PARTICIPANT_STATUS,
            }
        )
        result.extend(
            {
                "id": player.get("id"),
                "name": player.get("name", ""),
                "role": "DEVICE_PLAYER",
                "owner": participant.get("displayName", ""),
                "connected": participant.get("connectionStatus")
                == CONNECTED_PARTICIPANT_STATUS,
            }
            for player in participant.get("devicePlayers", ())
        )
    if not result and session and isinstance(session.get("players"), list):
        result.extend(
            {
                "id": player.get("id"),
                "name": player.get("name", ""),
                "role": "PLAYER",
                "connected": True,
            }
            for player in session["players"]
        )
    return tuple(result)


def _room_roster_view(
    state: AppState,
    snapshot: Mapping[str, Any],
    session: Optional[Mapping[str, Any]],
) -> tuple[tuple[ViewItem, ...], Text, int]:
    players = _room_roster(snapshot, session)
    if state.route == Route.ROOM_LOBBY_DISPLAY:
        page_size = LOBBY_ROSTER_PAGE_SIZE
    else:
        page_size = GAME_ROSTER_PAGE_SIZE
    page_values, page, total_pages = _auto_page_slice(
        players,
        state.auto_page,
        page_size,
    )
    active_id = (session.get("activePlayer") or {}).get("id") if session else None
    voting_progress = {
        entry.get("playerId"): entry.get("status")
        for entry in ((session or {}).get("neverHaveIEverVoting") or {}).get("progress", ())
    }
    entries: list[ViewItem] = []
    for player in page_values:
        _append_room_roster_player(player, voting_progress, active_id, entries)
    status = Text.raw("")
    if total_pages > 1:
        status = msg(strings.PAGE_STATUS, page + 1, total_pages)
    return tuple(entries), status, len(players)


def _append_room_roster_player(player, voting_progress, active_id, entries):
    role = player.get("role")
    if role == "HOST":
        secondary = msg(strings.HOST_ROLE)
    elif role == "DEVICE_PLAYER":
        secondary = msg(
            strings.ON_DEVICE,
            player.get("owner", ""),
        )
    else:
        secondary = msg(strings.PLAYER_ROLE)
    vote_status = voting_progress.get(player.get("id"))
    badge = msg(strings.CONNECTED if player.get("connected") else strings.OFFLINE)
    if vote_status == VOTED_VOTE_STATUS:
        badge = msg(strings.VOTED_STATUS)
    elif vote_status == PENDING_VOTE_STATUS:
        badge = msg(strings.PENDING)
    entries.append(
        ViewItem(
            key=f"roster:{player.get('id', '')}",
            # Preserve names exactly. Dedicated Room roster labels use
            # Kodi's horizontal marquee only when their width is exceeded,
            # keeping ordinary names still and compact.
            label=raw(player.get("name", "")),
            secondary=secondary,
            badge=badge,
            kind="person",
            enabled=False,
            selected=player.get("id") == active_id,
        )
    )


def _room_stage_body(
    state: AppState, _snapshot: Mapping[str, Any], session: Mapping[str, Any]
) -> Text:
    if state.transport_state == "RECONNECTING":
        return msg(strings.RECONNECTING_BODY)
    voting = session.get("neverHaveIEverVoting")
    if isinstance(voting, Mapping):
        result = voting.get("result")
        if isinstance(result, Mapping):
            return Text.raw("")
        progress = voting.get("progress", ())
        voted = sum(
            1 for entry in progress if entry.get("status") == VOTED_VOTE_STATUS
        )
        return msg(strings.VOTED, voted, len(progress))
    return Text.raw("")


def _display_menu(state: AppState) -> ViewModel:
    preferences = state.preferences
    return ViewModel(
        msg(strings.DISPLAY_ROOM),
        msg(strings.DISPLAY_OPTIONS),
        items=(
            item(
                "display:auto-page",
                strings.AUTO_PAGE_SECONDS,
                secondary=msg(strings.SECONDS, preferences.auto_page_seconds),
            ),
        ),
        actions=(
            item("display:diagnostics", strings.DIAGNOSTICS),
            item("display:leave", strings.LEAVE_DISPLAY, danger=True),
            item(
                "app:exit",
                strings.EXIT_ADDON,
                danger=True,
            ),
        ),
        server_pill=_pill(state),
    )


def _room_summary(state: AppState) -> ViewModel:
    session = (state.room_snapshot or {}).get("session") or {}
    return ViewModel(
        msg(strings.DISPLAY_ROOM),
        msg(strings.SUMMARY_TITLE),
        msg(strings.ROOM_ENDED_OPEN_BODY),
        facts=(
            ViewFact(msg(strings.CARDS), raw(session.get("cardsShown", 0))),
            ViewFact(msg(strings.ROUND_LABEL), raw(session.get("roundNumber", 0))),
            ViewFact(msg(strings.PLAYERS), raw(len(session.get("players", ())))),
        ),
        view_mode="summary",
        server_pill=_pill(state),
    )


def _group_list(state: AppState) -> ViewModel:
    groups, page, total_pages = _group_page(state, COLLECTION_PAGE_SIZE)
    entries = tuple(
        ViewItem(
            f"group:continue:{group['id']}",
            raw(group["name"]),
            raw(_member_preview(group.get("members", ()))),
            badge=raw(len(group.get("members", ()))),
            kind="group",
        )
        for group in groups
    )
    return ViewModel(
        msg(strings.APP_NAME),
        msg(strings.GROUP),
        msg(strings.GROUP_LIST_HINT),
        items=entries,
        actions=(item("group:create", strings.CREATE_GROUP),),
        pagination=_pagination("group", page, total_pages),
        view_mode="groups",
        server_pill=_pill(state),
        preferred_focus=entries[0].key if entries else "group:create",
    )


def _group_member(state: AppState) -> ViewModel:
    index = state.group_draft_member_index
    if index is None or not 0 <= index < len(state.group_draft_members):
        return ViewModel(
            msg(strings.GROUP),
            msg(strings.PLAYER_OPTIONS),
            actions=(item(BACK_ACTION, strings.DONE),),
            view_mode="summary",
            server_pill=_pill(state),
        )
    name = state.group_draft_members[index]
    return ViewModel(
        msg(strings.GROUP),
        msg(strings.PLAYER_OPTIONS),
        msg(strings.PLAYER_PROFILE_POSITION, index + 1, len(state.group_draft_members)),
        actions=(
            item(f"group:edit-member:{index}", strings.EDIT_PLAYER),
            item(f"group:remove-member:{index}", strings.REMOVE_PLAYER, danger=True),
            item(BACK_ACTION, strings.DONE),
        ),
        facts=(
            ViewFact(msg(strings.NAME), raw(name)),
            ViewFact(Text.raw(""), raw(index + 1)),
        ),
        view_mode="player-profile",
        server_pill=_pill(state),
        preferred_focus=f"group:edit-member:{index}",
    )


def _help(state: AppState) -> ViewModel:
    if not state.server_info:
        selected = local_help_topic(str(state.help_slug or "")) or LOCAL_HELP_TOPICS[0]
        topics = tuple(
            ViewItem(
                key=f"help:topic:{slug}",
                label=msg(title_id),
                kind="topic",
            )
            for slug, title_id, _ in LOCAL_HELP_TOPICS
        )
        return ViewModel(
            msg(strings.HELP),
            msg(selected[1]),
            msg(selected[2]),
            items=topics,
            view_mode="help",
            preferred_focus=f"help:topic:{selected[0]}",
        )
    topics = tuple(
        ViewItem(
            key=f"help:topic:{topic.get('slug', '')}",
            label=raw(topic.get("title", "")),
            kind="topic",
        )
        for topic in state.help_topics
    )
    body = state.help_body.strip()
    if body and state.help_title and body.splitlines()[0].strip() == state.help_title.strip():
        body = "\n".join(body.splitlines()[1:]).strip()
    pages = _text_pages(body)
    page = min(state.help_page, len(pages) - 1)
    pagination = _pagination("help", page, len(pages))
    if state.busy_operation and state.busy_operation.startswith("help"):
        help_body = msg(strings.LOADING)
    elif body:
        help_body = raw(pages[page])
    else:
        help_body = msg(strings.HELP_BODY)
    preferred_focus = None
    if state.help_slug:
        preferred_focus = f"help:topic:{state.help_slug}"
    elif topics:
        preferred_focus = topics[0].key
    return ViewModel(
        msg(strings.HELP),
        raw(state.help_title) if state.help_title else msg(strings.HELP),
        help_body,
        items=topics,
        pagination=pagination,
        view_mode="help",
        server_pill=_pill(state),
        preferred_focus=preferred_focus,
    )


def _text_pages(
    value: str,
    line_width: int = HELP_LINE_WIDTH,
    maximum_lines: int = HELP_PAGE_LINES,
) -> tuple[str, ...]:
    if not value:
        return ("",)
    normalized = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n\s*\n", normalized) if paragraph.strip()]
    units: list[tuple[tuple[str, ...], bool]] = []
    _wrap_help_paragraphs(paragraphs, line_width, units)
    pages: list[str] = []
    current: list[str] = []
    current = _paginate_help_units(units, current, maximum_lines, pages)
    if current:
        pages.append("\n".join(current).rstrip())
    return tuple(page for page in pages if page) or ("",)

def _paginate_help_units(units, current, maximum_lines, pages):
    for unit, paragraph_break in units:
        current = _paginate_help_unit(unit, paragraph_break, current, maximum_lines, pages)
    return current


def _paginate_help_unit(unit, paragraph_break, current, maximum_lines, pages):
    remaining = list(unit)
    while remaining:
        separator = 1 if paragraph_break and current and current[-1] != "" else 0
        room = maximum_lines - len(current) - separator
        if room <= 0:
            pages.append("\n".join(current).rstrip())
            current = []
            continue
        if len(remaining) <= room:
            if separator:
                current.append("")
            current.extend(remaining)
            remaining = []
            paragraph_break = False
        elif current:
            pages.append("\n".join(current).rstrip())
            current = []
        else:
            current.extend(remaining[:maximum_lines])
            pages.append("\n".join(current).rstrip())
            current = []
            remaining = remaining[maximum_lines:]
            paragraph_break = False
    return current


def _wrap_help_paragraphs(paragraphs, line_width, units):
    for paragraph_index, paragraph in enumerate(paragraphs):
        logical_lines = tuple(line.strip() for line in paragraph.splitlines() if line.strip())
        structured = len(logical_lines) > 1 and any(
            re.match(r"^(?:#{1,6}\s|[-*+•]\s|\d+[.)]\s|>\s)", line)
            for line in logical_lines
        )
        if structured:
            sentences = logical_lines
        else:
            collapsed = " ".join(logical_lines)
            sentences = tuple(
                sentence.strip()
                for sentence in re.split(r"(?<=[.!?])\s+(?=\S)", collapsed)
                if sentence.strip()
            ) or (collapsed,)
        for sentence_index, sentence in enumerate(sentences):
            wrapped = tuple(
                textwrap.wrap(
                    sentence,
                    width=line_width,
                    break_long_words=True,
                    break_on_hyphens=False,
                    replace_whitespace=False,
                )
            ) or ("",)
            units.append(
                (
                    wrapped,
                    paragraph_index > 0 and sentence_index == 0,
                )
            )


def _preferences(state: AppState) -> ViewModel:
    preferences = state.preferences
    locale_label = LOCALE_LABEL_IDS.get(
        preferences.locale, LOCALE_LABEL_IDS[AUTOMATIC_LOCALE]
    )
    entries: list[ViewItem] = [
        item("prefs:locale", strings.UI_LANGUAGE, secondary=msg(locale_label)),
        item(
            "prefs:auto-page",
            strings.AUTO_PAGE_SECONDS,
            secondary=msg(strings.SECONDS, preferences.auto_page_seconds),
        ),
        item("prefs:name", strings.DISPLAY_NAME, secondary=raw(preferences.display_name)),
    ]
    link_supported = bool(
        (state.server_info or {}).get("capabilities", {}).get("nativeDeviceAuthorization")
    )
    if link_supported:
        entries.append(
            item(
                "prefs:link",
                strings.UNLINK_DEVICE
                if (state.authorization or {}).get("status") == "LINKED"
                else strings.LINK_DEVICE,
            )
        )
    visible, page, total_pages = _page_slice(
        tuple(entries), state.collection_page, SETTINGS_PAGE_SIZE
    )
    server = _selected_server(state)
    body = (
        msg(strings.LOCAL_DATASPACE)
        if server and server.deployment_mode == "local"
        else msg(strings.PREFERENCES_BODY)
    )
    return ViewModel(
        msg(strings.APP_NAME),
        msg(strings.PREFERENCES),
        body,
        items=visible,
        actions=(
            item("prefs:diagnostics", strings.DIAGNOSTICS),
            item("prefs:help", strings.HELP),
            item("prefs:clear-servers", strings.CLEAR_RECENT_SERVERS, danger=True),
        ),
        pagination=_pagination("prefs", page, total_pages),
        view_mode="settings",
        server_pill=_pill(state),
    )


def _diagnostics(state: AppState) -> ViewModel:
    server = _selected_server(state)
    entries = [
        item(
            "diagnostics:version",
            strings.VERSION,
            secondary=raw(APPLICATION_VERSION),
            enabled=False,
        ),
        item("diagnostics:protocol", strings.PROTOCOL, secondary=raw("2"), enabled=False),
        item(
            "diagnostics:connection",
            strings.CONNECTION,
            secondary=raw(state.transport_state),
            enabled=False,
        ),
        ViewItem("diagnostics:route", msg(strings.CURRENT_ROUTE), raw(state.route.value), enabled=False),
    ]
    if server:
        entries.insert(
            0,
            ViewItem(
                "diagnostics:server",
                raw(server.display_name),
                raw(server.origin),
                kind="server-identifier",
                enabled=False,
            ),
        )
        entries.insert(
            1,
            ViewItem(
                "diagnostics:server-id",
                msg(strings.SERVER_ID),
                raw(server.server_id),
                enabled=False,
            ),
        )
    for index, event in enumerate(state.diagnostics[-10:]):
        event_name = str(event.get("event", "diagnostic"))
        if event_name == "discovery.candidate_rejected":
            label = msg(strings.DIAGNOSTIC_DISCOVERY_REJECTED)
            secondary = msg(
                strings.DIAGNOSTIC_SOURCE_ERROR,
                event.get("source", ""),
                event.get("error_type", ""),
            )
        elif event_name == "server.validated":
            label = msg(strings.DIAGNOSTIC_SERVER_VALIDATED)
            secondary = raw(
                _wrapped_identifier(
                    event.get("origin")
                    or event.get("deployment_mode")
                    or event.get("server_id", ""),
                    width=60,
                )
            )
        else:
            label = raw(event_name)
            secondary = raw(event.get("code") or event.get("error_type") or "")
        entries.append(
            ViewItem(
                f"diagnostics:event:{index}",
                label,
                secondary,
                kind="diagnostic-event",
                enabled=False,
            )
        )
    visible, page, total_pages = _page_slice(
        tuple(entries), state.collection_page, SETTINGS_PAGE_SIZE
    )
    return ViewModel(
        msg(strings.PREFERENCES),
        msg(strings.DIAGNOSTICS),
        msg(strings.DIAGNOSTICS_BODY),
        visible,
        actions=(
            item("diagnostics:refresh", strings.REFRESH),
            item("diagnostics:clear", strings.CLEAR_DATA, danger=True),
        ),
        pagination=_pagination("diagnostics", page, total_pages),
        view_mode="settings",
        server_pill=_pill(state),
    )


def _device_link(state: AppState) -> ViewModel:
    capabilities = (state.server_info or {}).get("capabilities", {})
    supported = bool(capabilities.get("nativeDeviceAuthorization"))
    authorization = state.authorization or {}
    if not supported:
        return ViewModel(
            msg(strings.PREFERENCES),
            msg(strings.LINK_DEVICE),
            msg(strings.LINK_NOT_SUPPORTED),
            server_pill=_pill(state),
        )
    if authorization.get("status") == "LINKED":
        label = authorization.get("label") or ""
        suffix = f" · {label}" if label else ""
        return ViewModel(
            msg(strings.PREFERENCES),
            msg(strings.AUTHORIZATION_COMPLETE),
            msg(strings.LINKED_DEVICE, suffix),
            actions=(item("auth:unlink", strings.UNLINK_DEVICE, danger=True),),
            server_pill=_pill(state),
        )
    if authorization.get("user_code"):
        return ViewModel(
            msg(strings.LINK_DEVICE),
            msg(strings.DEVICE_CODE, authorization["user_code"]),
            msg(strings.DEVICE_INSTRUCTIONS),
            actions=(item("auth:cancel", strings.CANCEL),),
            view_mode="device-link",
            server_pill=_pill(state),
            footer=raw(authorization.get("verification_uri", "")),
            qr_path=state.qr_path or "",
        )
    return ViewModel(
        msg(strings.PREFERENCES),
        msg(strings.LINK_DEVICE),
        actions=(item("auth:start", strings.LINK_DEVICE),),
        server_pill=_pill(state),
    )


_ROUTE_PRESENTERS = {
    Route.BOOTSTRAP: _present_bootstrap,
    Route.SERVER_LIST: _server_list,
    Route.SERVER_DETAILS: _server_details,
    Route.MANUAL_SERVER: _present_manual_server,
    Route.HOME: _home,
    Route.SETUP_GROUP: _setup_groups,
    Route.SETUP_GROUP_SELECT: _setup_group_select,
    Route.SETUP_MODE: _setup_modes,
    Route.SETUP_PROFILE: _setup_profiles,
    Route.SETUP_PLAYERS: _setup_players,
    Route.SETUP_PLAYER: _setup_player,
    Route.SETUP_CUSTOMIZE: _customize,
    Route.SETUP_CATEGORIES: _present_setup_categories,
    Route.SETUP_DARES: _present_setup_dares,
    Route.SETUP_FLAGS: _flags,
    Route.SETUP_INTENSITY: _intensity,
    Route.SETUP_MODE_OPTIONS: _mode_options,
    Route.SETUP_OPTIONS: _setup_options,
    Route.SETUP_CARD_LANGUAGE: _card_language,
    Route.SETUP_CARD_LANGUAGE_PRIMARY: _primary_card_language,
    Route.SETUP_CARD_LANGUAGE_FALLBACKS: _fallback_languages,
    Route.SETUP_CARD_LANGUAGE_FALLBACK_ADD: _add_fallback_language,
    Route.SETUP_CARD_LANGUAGE_FALLBACK: _fallback_language,
    Route.SETUP_CARD_POLICY: _card_policy,
    Route.SETUP_POLICY_DEFAULT: _present_setup_policy_default,
    Route.SETUP_POLICY_RULES: _policy_rules,
    Route.SETUP_POLICY_RULE: _policy_rule,
    Route.SETUP_POLICY_PREDICATE: _policy_predicate,
    Route.SETUP_POLICY_VALUES: _policy_values,
    Route.SETUP_POLICY_DIRECTIVES: _present_setup_policy_directives,
    Route.SETUP_EXACT_CARDS: _exact_cards,
    Route.SETUP_EXACT_CARD_PREVIEW: _exact_card_preview,
    Route.SETUP_EXACT_CARD: _present_setup_exact_card,
    Route.SETUP_REVIEW: _review,
    Route.ROOM_CODE_ENTRY: _present_room_code_entry,
    Route.ROOM_CREATING: _present_room_creating,
    Route.ROOM_LOBBY_DISPLAY: _present_room_lobby_display,
    Route.ROOM_GAME_DISPLAY: _present_room_lobby_display,
    Route.ROOM_DISPLAY_MENU: _display_menu,
    Route.ROOM_SUMMARY_DISPLAY: _room_summary,
    Route.COUCH_GAME: _present_couch_game,
    Route.COUCH_MENU: _couch_menu,
    Route.COUCH_SUMMARY: _couch_summary,
    Route.GROUP_LIST: _group_list,
    Route.GROUP_CREATE: _present_group_create,
    Route.GROUP_MEMBER: _group_member,
    Route.PREFERENCES: _preferences,
    Route.HELP: _help,
    Route.DIAGNOSTICS: _diagnostics,
    Route.DEVICE_LINK: _device_link,
}
