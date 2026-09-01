"""Application controller: input becomes actions; reducer effects run out of process state."""

from __future__ import annotations

import copy
import queue
import re
import time
import unicodedata
import uuid
from dataclasses import replace
from typing import Callable, Mapping, Optional, Protocol

from .actions import Action, action
from .effects import EffectRunner
from .presentation import (
    COLLECTION_PAGE_SIZE,
    GAME_ROSTER_PAGE_SIZE,
    LOBBY_ROSTER_PAGE_SIZE,
    NAMED_RESULT_COLUMN_PAGE_SIZE,
    OPERATIONAL_FLAG_LABELS,
    ViewModel,
    policy_facet_options,
    present,
)
from .reducer import reduce
from .routes import Route
from .state import AppState, Preferences, SetupDraft, configuration_from_profile
from .option_specs import (
    CONFIGURATION_CHOICES,
    CONFIGURATION_NUMBERS,
    DIRECTIVE_CHOICES,
    DIRECTIVE_DEFAULTS,
    DIRECTIVE_NUMBERS,
    PREDICATE_CHOICES,
    PREDICATE_NUMBERS,
    SENSITIVITY_VALUES,
    decode_option,
    format_number,
)
from . import strings


ROOM_CODE = re.compile(r"^[A-Z2-9]{6}$")

# Kodi label marquees move at 60 pixels per second by default. The matching
# skin controls set that speed explicitly so unattended page timing can be
# derived from the content that is actually on screen. Width estimates use a
# conservative maximum glyph width for each Estuary font rather than assuming
# that a character is one average-width Latin glyph.
MARQUEE_SCROLL_PIXELS_PER_SECOND = 60.0
MARQUEE_INITIAL_HOLD_SECONDS = 3.0
MARQUEE_FINAL_HOLD_SECONDS = 2.0
LOCALIZED_MESSAGE_AFFIX_UNITS = 24
LOBBY_ROSTER_LABEL_WIDTH = 244
GAME_ROSTER_LABEL_WIDTH = 238
RESULT_NAME_LABEL_WIDTH = 318
CURRENT_PLAYER_LABEL_WIDTH = 1060
ROSTER_NAME_MAX_GLYPH_WIDTH = 30.0
ROSTER_SECONDARY_MAX_GLYPH_WIDTH = 18.0
ROSTER_BADGE_MAX_GLYPH_WIDTH = 20.0
RESULT_NAME_MAX_GLYPH_WIDTH = 24.0
CURRENT_PLAYER_MAX_GLYPH_WIDTH = 34.0


def _display_width_units(value: object) -> int:
    """Return conservative terminal-like units without splitting Unicode."""

    units = 0
    for character in str(value):
        if unicodedata.combining(character):
            continue
        units += 2 if unicodedata.east_asian_width(character) in {"F", "W"} else 1
    return units


def _text_width_units(value: strings.Text) -> int:
    if value.literal is not None:
        return _display_width_units(value.literal)
    if value.message_id is None:
        return 0
    # The timer intentionally does not duplicate or partially resolve locale
    # catalogs. Twenty-four extra units cover the longest supported German
    # roster affix (for example "Auf dem Gerät von %s") plus future wording
    # growth; arguments retain their exact server-provided width.
    units = LOCALIZED_MESSAGE_AFFIX_UNITS
    for argument in value.arguments:
        if isinstance(argument, strings.Text):
            units += _text_width_units(argument)
        else:
            units += _display_width_units(argument)
    return units


def _marquee_completion_seconds(
    value: strings.Text,
    *,
    label_width: int,
    maximum_glyph_width: float,
) -> float:
    estimated_width = _text_width_units(value) * maximum_glyph_width
    overflow = estimated_width - float(label_width)
    if overflow <= 0:
        return 0.0
    return (
        MARQUEE_INITIAL_HOLD_SECONDS
        + overflow / MARQUEE_SCROLL_PIXELS_PER_SECOND
        + MARQUEE_FINAL_HOLD_SECONDS
    )


def auto_page_interval_seconds(state: AppState) -> float:
    """Return a dwell long enough to reveal every marquee on this page.

    The preference remains the minimum. Only the currently projected Room or
    named-result page contributes overflow, so an ordinary short-name page
    keeps the chosen pace while a worst-case later page receives enough time
    for its own longest name and localized owner/status text.
    """

    interval = float(state.preferences.auto_page_seconds)
    view = present(state)
    if state.route in {Route.ROOM_LOBBY_DISPLAY, Route.ROOM_GAME_DISPLAY}:
        roster_width = (
            LOBBY_ROSTER_LABEL_WIDTH
            if state.route == Route.ROOM_LOBBY_DISPLAY
            else GAME_ROSTER_LABEL_WIDTH
        )
        for entry in view.roster:
            interval = max(
                interval,
                _marquee_completion_seconds(
                    entry.label,
                    label_width=roster_width,
                    maximum_glyph_width=ROSTER_NAME_MAX_GLYPH_WIDTH,
                ),
                _marquee_completion_seconds(
                    entry.secondary,
                    label_width=roster_width,
                    maximum_glyph_width=ROSTER_SECONDARY_MAX_GLYPH_WIDTH,
                ),
                _marquee_completion_seconds(
                    entry.badge,
                    label_width=roster_width,
                    maximum_glyph_width=ROSTER_BADGE_MAX_GLYPH_WIDTH,
                ),
            )
        interval = max(
            interval,
            _marquee_completion_seconds(
                view.current_player,
                label_width=CURRENT_PLAYER_LABEL_WIDTH,
                maximum_glyph_width=CURRENT_PLAYER_MAX_GLYPH_WIDTH,
            ),
        )
    for entry in (*view.result_yes_players, *view.result_no_players):
        interval = max(
            interval,
            _marquee_completion_seconds(
                entry.label,
                label_width=RESULT_NAME_LABEL_WIDTH,
                maximum_glyph_width=RESULT_NAME_MAX_GLYPH_WIDTH,
            ),
        )
    return interval


def _named_result_needs_auto_page(
    voting: Mapping[str, object], named: object
) -> bool:
    if voting.get("revealMode") != "NAMED_ANSWERS" or not isinstance(named, list):
        return False
    yes_count = sum(1 for entry in named if entry.get("vote") == "YES")
    no_count = sum(1 for entry in named if entry.get("vote") == "NO")
    return max(yes_count, no_count) > NAMED_RESULT_COLUMN_PAGE_SIZE


class UiPort(Protocol):
    def request_text(self, heading_id: int, default: str = "", hidden: bool = False) -> Optional[str]: ...

    def request_number(self, heading_id: int, default: str = "") -> Optional[str]: ...

    def request_choice(
        self,
        heading_id: int,
        options: tuple[strings.Text, ...],
        selected: int = 0,
    ) -> Optional[int]: ...


class Application:
    def __init__(
        self,
        profile_directory: str,
        locale_provider=lambda: "en-GB",
        native_preferences: Optional[Mapping[str, str]] = None,
        preference_sink: Optional[Callable[[Preferences], None]] = None,
        configured_server_origin: Optional[str] = None,
        discovery_enabled: bool = True,
    ) -> None:
        self.state = AppState()
        self._events: queue.Queue[Action] = queue.Queue(maxsize=256)
        self.effects = EffectRunner(
            profile_directory,
            self.enqueue,
            locale_provider,
            native_preferences=native_preferences,
            configured_server_origin=configured_server_origin,
            discovery_enabled=discovery_enabled,
        )
        self._preference_sink = preference_sink
        self.ui: Optional[UiPort] = None
        self._dirty = True
        self._last_auto_page = time.monotonic()
        self._auto_page_interval_signature = None
        self._auto_page_interval_cache = float(self.state.preferences.auto_page_seconds)
        self._last_notification = 0.0

    def attach_ui(self, ui: UiPort) -> None:
        self.ui = ui

    def start(self) -> None:
        self.dispatch(action("START"))

    def stop(self) -> None:
        self.dispatch(action("STOP"))

    def enqueue(self, incoming: Action) -> None:
        try:
            self._events.put_nowait(incoming)
        except queue.Full:
            # The queue contains only replaceable worker results; preserve the GUI thread.
            pass

    def dispatch(self, incoming: Action) -> None:
        previous_route = self.state.route
        previous_confirmation = bool(self.state.confirmation)
        previous_preferences = self.state.preferences
        previous_auto_page = self.state.auto_page
        previous_auto_page_epoch = self.state.auto_page_epoch
        next_state, effects = reduce(self.state, incoming)
        if next_state != self.state:
            self.state = next_state
            self._dirty = True
            if (
                next_state.route != previous_route
                or bool(next_state.confirmation) != previous_confirmation
                or next_state.auto_page < previous_auto_page
                or next_state.auto_page_epoch != previous_auto_page_epoch
            ):
                self._last_auto_page = time.monotonic()
            if next_state.notification:
                self._last_notification = time.monotonic()
            if next_state.preferences != previous_preferences and self._preference_sink:
                self._preference_sink(next_state.preferences)
        for current in effects:
            self.effects.submit(current)

    def tick(self, maximum_events: int = 32) -> None:
        for _ in range(maximum_events):
            try:
                incoming = self._events.get_nowait()
            except queue.Empty:
                break
            self.dispatch(incoming)
        now = time.monotonic()
        if self._auto_page_needed():
            page_interval, restart_page_clock = self._current_auto_page_interval()
            if restart_page_clock:
                # A same-page authoritative update can introduce a longer name
                # after its old dwell has already begun. Give that newly visible
                # marquee a complete cycle without letting equal, shorter, or
                # unrelated snapshots perpetually postpone page advancement.
                self._last_auto_page = now
            if now - self._last_auto_page >= page_interval:
                self.state = replace(
                    self.state,
                    auto_page=self.state.auto_page + 1,
                    revision=self.state.revision + 1,
                )
                self._dirty = True
                self._last_auto_page = now
        if self.state.notification and now - self._last_notification > 6.0:
            self.dispatch(action("CLEAR_NOTIFICATION"))

    def take_view(self) -> Optional[ViewModel]:
        if not self._dirty:
            return None
        self._dirty = False
        return present(self.state)

    def _auto_page_needed(self) -> bool:
        if self.state.route == Route.COUCH_GAME:
            snapshot = self.state.couch_snapshot or {}
            voting = snapshot.get("neverHaveIEverVoting") or {}
            result = voting.get("result") or {}
            named = result.get("namedAnswers") or ()
            return _named_result_needs_auto_page(voting, named)
        if self.state.route not in {Route.ROOM_LOBBY_DISPLAY, Route.ROOM_GAME_DISPLAY}:
            return False
        if self.state.route == Route.ROOM_LOBBY_DISPLAY:
            page_size = LOBBY_ROSTER_PAGE_SIZE
        else:
            page_size = GAME_ROSTER_PAGE_SIZE
        snapshot = self.state.room_snapshot or {}
        session = snapshot.get("session") or {}
        players = session.get("players")
        if isinstance(players, list) and len(players) > page_size:
            return True
        represented = 0
        for participant in snapshot.get("participants", ()):
            if participant.get("role") == "DISPLAY":
                continue
            represented += 1 + len(participant.get("devicePlayers", ()))
        if represented > page_size:
            return True
        if self.state.route == Route.ROOM_LOBBY_DISPLAY:
            room_access = (self.state.server_info or {}).get("roomAccess", {})
            bases = list(room_access.get("availableBaseUrls", ()))
            configured = room_access.get("configuredBaseUrl")
            if configured and configured not in bases:
                bases.insert(0, configured)
            if len(bases) > 1:
                return True
        voting = session.get("neverHaveIEverVoting") or {}
        result = voting.get("result") or {}
        named = result.get("namedAnswers") or ()
        return _named_result_needs_auto_page(voting, named)

    def _current_auto_page_interval(self) -> tuple[float, bool]:
        signature = (
            self.state.route,
            self.state.revision,
            self.state.auto_page,
            self.state.auto_page_epoch,
            self.state.preferences.auto_page_seconds,
            id(self.state.couch_snapshot),
            id(self.state.room_snapshot),
        )
        if signature == self._auto_page_interval_signature:
            return self._auto_page_interval_cache, False
        previous_signature = self._auto_page_interval_signature
        previous_interval = self._auto_page_interval_cache
        next_interval = auto_page_interval_seconds(self.state)
        same_visible_page = previous_signature is not None and (
            signature[0],
            signature[2],
            signature[3],
        ) == (
            previous_signature[0],
            previous_signature[2],
            previous_signature[3],
        )
        restart_page_clock = same_visible_page and next_interval > previous_interval
        self._auto_page_interval_cache = next_interval
        self._auto_page_interval_signature = signature
        return next_interval, restart_page_clock

    def back(self) -> None:
        if self.state.route == Route.DEVICE_LINK and (self.state.authorization or {}).get("status") == "PENDING":
            self.dispatch(action("AUTH_CANCEL_REQUESTED"))
            return
        if self.state.route == Route.COUCH_GAME:
            if self.state.couch_vote_player_id:
                if self.state.couch_vote_phase != "SUBMITTING":
                    self.dispatch(action("COUCH_VOTE_CANCELLED"))
                return
            self.dispatch(action("NAVIGATE", route=Route.COUCH_MENU))
            return
        self.dispatch(action("BACK"))

    def cancel_confirmation(self) -> None:
        self.dispatch(action("CANCEL_CONFIRMATION"))

    def change_card_page(self, delta: int) -> bool:
        view = present(self.state)
        if view.card_page_count <= 1:
            return False
        maximum = view.card_page_count - 1
        page = max(0, min(maximum, self.state.card_page + delta))
        if page != self.state.card_page:
            self.state = replace(
                self.state,
                card_page=page,
                revision=self.state.revision + 1,
            )
            self._dirty = True
        return True

    def confirm(self) -> None:
        confirmation = self.state.confirmation
        if not confirmation:
            return
        if confirmation.confirm_action == "exit-addon":
            self.dispatch(action("STOP"))
        elif confirmation.confirm_action == "leave-active":
            self.dispatch(action("LEAVE_ACTIVE"))
        elif confirmation.confirm_action == "clear-data":
            self.dispatch(action("CLEAR_DATA_REQUESTED"))
        elif confirmation.confirm_action.startswith("forget-server:"):
            server_id = confirmation.confirm_action.split(":", maxsplit=1)[1]
            servers = tuple(server for server in self.state.servers if server.server_id != server_id)
            self.dispatch(action("CANCEL_CONFIRMATION"))
            self.dispatch(action("SERVERS_REPLACED", servers=servers))
            self.dispatch(action("BACK"))
        elif confirmation.confirm_action == "discard-recovery":
            self.dispatch(action("DISCARD_RECOVERY"))
        elif confirmation.confirm_action == "unlink-device":
            self.dispatch(action("AUTH_UNLINK_REQUESTED"))
        elif confirmation.confirm_action == "clear-servers":
            self.dispatch(action("CLEAR_RECENT_SERVERS"))
        elif confirmation.confirm_action == "adjust-couch":
            self.dispatch(action("END_COUCH_FOR_SETUP"))
        elif confirmation.confirm_action.startswith("delete-rule:"):
            rule_id = confirmation.confirm_action.split(":", maxsplit=1)[1]
            self.dispatch(action("CANCEL_CONFIRMATION"))
            self._delete_rule(rule_id)
        elif confirmation.confirm_action.startswith("remove-setup-player:"):
            index = int(confirmation.confirm_action.rsplit(":", maxsplit=1)[1])
            self.dispatch(action("CANCEL_CONFIRMATION"))
            self._remove_setup_player(index)
        elif confirmation.confirm_action.startswith("remove-group-member:"):
            index = int(confirmation.confirm_action.rsplit(":", maxsplit=1)[1])
            self.dispatch(action("CANCEL_CONFIRMATION"))
            self._remove_group_member(index)
        elif confirmation.confirm_action.startswith("remove-fallback:"):
            locale = confirmation.confirm_action.split(":", maxsplit=1)[1]
            self.dispatch(action("CANCEL_CONFIRMATION"))
            self._remove_fallback_language(locale)
        elif confirmation.confirm_action == "reset-exact-card":
            self.dispatch(action("CANCEL_CONFIRMATION"))
            self._reset_exact_card()

    def activate(self, key: str) -> None:
        if not key:
            return
        if key == "nav:back":
            self.back()
            return
        handler = getattr(self, f"_activate_{key.split(':', maxsplit=1)[0]}", None)
        if handler:
            handler(key)

    def _activate_app(self, key: str) -> None:
        if key.split(":", maxsplit=1)[1] == "exit":
            self._confirm_exit_addon()

    def _confirm_exit_addon(self) -> None:
        self.dispatch(
            action(
                "CONFIRM",
                title_id=strings.EXIT_ADDON_TITLE,
                body_id=strings.EXIT_ADDON_BODY,
                action_id=strings.EXIT_ADDON,
                confirm_action="exit-addon",
            )
        )

    def _activate_home(self, key: str) -> None:
        destination = key.split(":", maxsplit=1)[1]
        if destination == "couch":
            self.dispatch(action("BEGIN_SETUP", topology="COUCH"))
        elif destination == "host":
            capability = (
                (self.state.server_info or {})
                .get("capabilities", {})
                .get("displayBootstrapRoomCreation")
            )
            if capability:
                self.dispatch(action("BEGIN_SETUP", topology="HOST"))
            else:
                self.dispatch(action("NOTIFY", message_id=strings.HOST_ROOM_UNAVAILABLE))
        elif destination == "display":
            self.dispatch(action("NAVIGATE", route=Route.ROOM_CODE_ENTRY))
        elif destination == "groups":
            self.dispatch(action("NAVIGATE", route=Route.GROUP_LIST))
        elif destination == "servers":
            self.dispatch(action("NAVIGATE", route=Route.SERVER_LIST))
        elif destination == "preferences":
            self.dispatch(action("NAVIGATE", route=Route.PREFERENCES))
        elif destination == "recover":
            self.dispatch(action("RECOVER_REQUESTED"))
        elif destination == "discard-recovery":
            self.dispatch(
                action(
                    "CONFIRM",
                    title_id=strings.DISCARD_RECOVERY,
                    body_id=strings.DISCARD_RECOVERY_BODY,
                    action_id=strings.DISCARD_RECOVERY,
                    confirm_action="discard-recovery",
                )
            )

    def _activate_server(self, key: str) -> None:
        parts = key.split(":")
        command = parts[1]
        if command in {"page-previous", "page-next"}:
            self._change_collection_page(
                len(self.state.servers),
                COLLECTION_PAGE_SIZE,
                -1 if command == "page-previous" else 1,
            )
        elif command == "select" and len(parts) == 3:
            server = next(
                (entry for entry in self.state.servers if entry.server_id == parts[2]),
                None,
            )
            if server:
                self.dispatch(action("SERVER_DETAILS_OPENED", server_id=server.server_id))
        elif command == "manual":
            self.dispatch(action("NAVIGATE", route=Route.MANUAL_SERVER))
        elif command == "manual-input":
            address = self._text(strings.SERVER_ADDRESS)
            if address:
                self.dispatch(
                    action(
                        "SELECT_SERVER",
                        str(uuid.uuid4()),
                        server_id=None,
                        origin=address,
                        source="manual",
                    )
                )
        elif command == "refresh":
            self.dispatch(action("DISCOVERY_REQUESTED"))
        elif command == "use":
            server = self._details_server()
            if server:
                self.dispatch(
                    action(
                        "SELECT_SERVER",
                        str(uuid.uuid4()),
                        server_id=server.server_id,
                        origin=server.origin,
                        source=server.source,
                    )
                )
        elif command == "forget":
            server = self._details_server()
            if server:
                self.dispatch(
                    action(
                        "CONFIRM",
                        title_id=strings.FORGET_SERVER,
                        body_id=strings.SERVER_DETAILS,
                        action_id=strings.DELETE,
                        confirm_action=f"forget-server:{server.server_id}",
                    )
                )

    def _activate_setup(self, key: str) -> None:
        setup = self.state.setup
        if not setup:
            return
        parts = key.split(":")
        section = parts[1]
        if section == "group":
            self._setup_group(parts)
        elif section == "mode" and len(parts) == 3:
            # A pending game is not valid for eligibility preview until the
            # next screen supplies its required profile ID.
            self._replace_setup(replace(setup, mode=parts[2]), preview=False)
            self._navigate(Route.SETUP_PROFILE)
        elif section == "profile" and len(parts) == 3:
            if parts[2] in {"page-previous", "page-next"}:
                self._change_collection_page(
                    len(self.state.profiles),
                    COLLECTION_PAGE_SIZE,
                    -1 if parts[2] == "page-previous" else 1,
                )
                return
            profile = next(
                (entry for entry in self.state.profiles if entry.get("id") == parts[2]),
                None,
            )
            if profile:
                updated = replace(
                    setup,
                    profile_id=parts[2],
                    configuration=configuration_from_profile(profile),
                    adult_content_confirmed=(
                        setup.adult_content_confirmed
                        if setup.profile_id == parts[2]
                        else False
                    ),
                )
                requires_confirmation = bool(
                    profile.get("requiresAdultConfirmation")
                    and not updated.adult_content_confirmed
                )
                # Adult profiles are incomplete until the explicit consent
                # action; sending them to eligibility preview early produces
                # a misleading INVALID_INPUT response on the profile screen.
                self._replace_setup(updated, preview=not requires_confirmation)
                if not requires_confirmation:
                    self._navigate(self._route_after_profile(updated))
        elif section == "player":
            self._setup_player(parts)
        elif section == "custom":
            self._setup_custom(parts)
        elif section in {"question", "dare"}:
            self._setup_taxonomy(section, parts)
        elif section == "flag":
            self._setup_flag(parts)
        elif section == "value":
            self._setup_value(parts[2])
        elif section == "option":
            self._setup_option(parts)
        elif section == "language":
            self._setup_language(parts)
        elif section == "policy":
            self._setup_policy(parts)
        elif section == "rule":
            self._setup_rule(parts)
        elif section == "facet":
            self._setup_policy_facet(parts)
        elif section == "predicate":
            self._setup_predicate(parts)
        elif section == "directive":
            self._setup_directive(parts)
        elif section == "cards":
            self._setup_card_search(parts)
        elif section == "card":
            self._open_exact_card(parts[3])
        elif section == "adult" and len(parts) == 3 and parts[2] == "confirm":
            updated = replace(setup, adult_content_confirmed=True)
            self._replace_setup(updated)
            self._navigate(self._route_after_profile(updated))
        elif section == "start":
            if setup.topology == "COUCH":
                normalized_names = [name.strip().casefold() for name in setup.players]
                if len(setup.players) < 2 or any(not name for name in normalized_names):
                    self.dispatch(action("NOTIFY", message_id=strings.AT_LEAST_TWO))
                elif len(set(normalized_names)) != len(normalized_names):
                    self.dispatch(action("NOTIFY", message_id=strings.DUPLICATE_PLAYERS))
                else:
                    self.dispatch(action("CREATE_COUCH_REQUESTED"))
            else:
                self.dispatch(action("CREATE_ROOM_REQUESTED"))

    def _setup_group(self, parts: list[str]) -> None:
        setup = self.state.setup
        if not setup:
            return
        command = parts[2]
        if command in {"page-previous", "page-next"}:
            self._change_group_page(-1 if command == "page-previous" else 1)
        elif command == "quick":
            persistence = "DATASPACE" if self.state.game_settings is not None else "EPHEMERAL"
            self._replace_setup(
                replace(
                    setup,
                    group_choice="QUICK",
                    group_id=None,
                    persistence=persistence,
                    players=(),
                    profile_id="",
                    adult_content_confirmed=False,
                ),
                preview=False,
            )
            self._navigate(Route.SETUP_MODE)
        elif command == "browse":
            self._navigate(Route.SETUP_GROUP_SELECT)
        elif command == "create":
            self.dispatch(action("GROUP_DRAFT_STARTED"))
            self.dispatch(action("NAVIGATE", route=Route.GROUP_CREATE))
        elif command == "select" and len(parts) == 4:
            group_id = parts[3]
            group = next((entry for entry in self.state.groups if entry.get("id") == group_id), None)
            if group:
                updated = replace(
                    setup,
                    group_choice="SAVED",
                    group_id=group_id,
                    persistence="DATASPACE",
                    players=tuple(group.get("members", ())),
                    profile_id="",
                    adult_content_confirmed=False,
                )
                profile_id = group.get("preferredProfileId")
                if profile_id:
                    profile = next(
                        (entry for entry in self.state.profiles if entry.get("id") == profile_id),
                        None,
                    )
                    configuration = group.get("customConfiguration") or (
                        configuration_from_profile(profile) if profile else updated.configuration
                    )
                    updated = replace(updated, configuration=configuration)
                language = group.get("cardLanguageSettings")
                if language:
                    fallback_locales = tuple(language["cardFallbackLocales"])
                    updated = replace(
                        updated,
                        card_locale=language["cardLocale"],
                        card_fallback_enabled=(
                            bool(language["cardFallbackEnabled"])
                            and bool(fallback_locales)
                        ),
                        card_fallback_locales=fallback_locales,
                    )
                self._replace_setup(updated, preview=False)
                self._navigate(Route.SETUP_MODE)

    def _setup_player(self, parts: list[str]) -> None:
        setup = self.state.setup
        if not setup:
            return
        command = parts[2]
        players = list(setup.players)
        if command in {"page-previous", "page-next"}:
            self._change_collection_page(
                len(players),
                COLLECTION_PAGE_SIZE,
                -1 if command == "page-previous" else 1,
            )
            return
        if command == "add":
            name = self._text(strings.ADD_PLAYER)
            if name and len(players) < 20:
                candidate = name.strip()[:40]
                if not candidate:
                    return
                if any(candidate.casefold() == current.strip().casefold() for current in players):
                    self.dispatch(action("NOTIFY", message_id=strings.PLAYER_NAMES_UNIQUE_ALERT))
                    return
                players.append(candidate)
        elif command == "open" and len(parts) == 4:
            index = int(parts[3])
            if 0 <= index < len(players):
                self._replace_setup(
                    replace(setup, selected_player_index=index),
                    preview=False,
                )
                self._navigate(Route.SETUP_PLAYER)
            return
        elif command == "edit" and len(parts) == 4:
            index = int(parts[3])
            name = self._text(strings.EDIT, players[index])
            if name:
                candidate = name.strip()[:40]
                duplicate = any(
                    candidate.casefold() == current.strip().casefold()
                    for current_index, current in enumerate(players)
                    if current_index != index
                )
                if not candidate or duplicate:
                    self.dispatch(action("NOTIFY", message_id=strings.PLAYER_NAMES_UNIQUE_ALERT))
                    return
                players[index] = candidate
        elif command == "remove" and len(parts) == 4:
            index = int(parts[3])
            if 0 <= index < len(players):
                self.dispatch(
                    action(
                        "CONFIRM",
                        title_id=strings.REMOVE_PLAYER_TITLE,
                        body_id=strings.REMOVE_PLAYER_BODY,
                        action_id=strings.REMOVE_PLAYER,
                        confirm_action=f"remove-setup-player:{index}",
                    )
                )
                return
        elif command == "continue":
            normalized = [name.strip().casefold() for name in players]
            if len(players) >= 2 and all(normalized) and len(set(normalized)) == len(normalized):
                self._navigate(Route.SETUP_CUSTOMIZE)
            else:
                message_id = (
                    strings.PLAYER_NAMES_UNIQUE_ALERT
                    if len(set(normalized)) < len(normalized)
                    else strings.PLAYER_MINIMUM_ALERT
                )
                self.dispatch(action("NOTIFY", message_id=message_id))
            return
        self._replace_setup(replace(setup, players=tuple(players)))

    def _setup_custom(self, parts: list[str]) -> None:
        routes = {
            "categories": Route.SETUP_CATEGORIES,
            "dares": Route.SETUP_DARES,
            "flags": Route.SETUP_FLAGS,
            "intensity": Route.SETUP_INTENSITY,
            "mode": Route.SETUP_MODE_OPTIONS,
            "language": Route.SETUP_CARD_LANGUAGE,
            "policy": Route.SETUP_CARD_POLICY,
            "continue": Route.SETUP_REVIEW,
        }
        route = routes.get(parts[2])
        if route:
            self._navigate(route)

    def _remove_setup_player(self, index: int) -> None:
        setup = self.state.setup
        if not setup or not 0 <= index < len(setup.players):
            return
        players = list(setup.players)
        players.pop(index)
        self._replace_setup(
            replace(
                setup,
                players=tuple(players),
                selected_player_index=None,
            )
        )
        if self.state.route == Route.SETUP_PLAYER:
            self.back()

    def _setup_taxonomy(self, section: str, parts: list[str]) -> None:
        setup = self.state.setup
        if not setup:
            return
        key = "enabledQuestionCategoryIds" if section == "question" else "enabledDareTypeIds"
        catalog_key = "questionCategories" if section == "question" else "dareTypes"
        values = list(setup.configuration.get(key, ()))
        command = parts[2]
        available = [entry["id"] for entry in (self.state.taxonomy or {}).get(catalog_key, ())]
        if command == "all":
            values = available
        elif command == "none":
            values = []
        elif command == "toggle":
            value = parts[3]
            values = [entry for entry in values if entry != value] if value in values else [*values, value]
        self._configuration(key, values)

    def _setup_flag(self, parts: list[str]) -> None:
        setup = self.state.setup
        if not setup or len(parts) < 3:
            return
        command = parts[2]
        blocked = list(setup.configuration.get("blockedOperationalFlags", ()))
        if command == "all":
            blocked = []
        elif command == "none":
            blocked = list(OPERATIONAL_FLAG_LABELS)
        elif command == "toggle" and len(parts) == 4:
            value = parts[3]
            if value not in OPERATIONAL_FLAG_LABELS:
                return
            blocked = (
                [entry for entry in blocked if entry != value]
                if value in blocked
                else [*blocked, value]
            )
        else:
            return
        self._configuration("blockedOperationalFlags", blocked)

    def _setup_value(self, name: str) -> None:
        setup = self.state.setup
        if not setup:
            return
        specification = CONFIGURATION_NUMBERS.get(name)
        if not specification:
            return
        config = copy.deepcopy(dict(setup.configuration))
        value = self._number(specification, str(config.get(name, "")))
        if value is None:
            return
        config[name] = value
        self._replace_setup(replace(setup, configuration=config))

    def _setup_option(self, parts: list[str]) -> None:
        setup = self.state.setup
        if not setup or len(parts) < 4:
            return
        command = parts[2]
        if command == "open":
            context = ":".join(parts[3:])
            self._replace_setup(replace(setup, option_editor=context), preview=False)
            self._navigate(Route.SETUP_OPTIONS)
            return
        if command != "set" or not setup.option_editor:
            return
        context = setup.option_editor
        token = parts[3]
        if context.startswith("config:"):
            field = context.split(":", maxsplit=1)[1]
            choices = tuple(CONFIGURATION_CHOICES.get(field, ()))
            value = self._decoded_choice(token, choices)
            if value is None and token != "none":
                return
            config = copy.deepcopy(dict(setup.configuration))
            if field == "startingIntensity" and int(value) > int(
                config.get("maximumIntensity", 1)
            ):
                self.dispatch(action("NOTIFY", message_id=strings.START_NOT_ABOVE_MAXIMUM))
                return
            if field == "maximumIntensity" and int(value) < int(
                config.get("startingIntensity", 1)
            ):
                self.dispatch(action("NOTIFY", message_id=strings.MAXIMUM_NOT_BELOW_START))
                return
            config[field] = value
            self._finish_option(replace(setup, configuration=config))
            return
        if context == "setup:neverRevealMode":
            choices = ("ANONYMOUS_AGGREGATE", "NAMED_ANSWERS")
            value = self._decoded_choice(token, choices)
            if value is not None:
                self._finish_option(replace(setup, never_reveal_mode=str(value)))
            return
        if context.startswith("predicate"):
            self._set_predicate_option(setup, context, token)
            return
        if context.startswith("directive"):
            self._set_directive_option(setup, context, token)

    def _setup_language(self, parts: list[str]) -> None:
        setup = self.state.setup
        if not setup or len(parts) < 3:
            return
        command = parts[2]
        if command == "primary" and len(parts) == 3:
            self._navigate(Route.SETUP_CARD_LANGUAGE_PRIMARY)
        elif command == "primary" and len(parts) == 4:
            self._change_collection_page(
                len(self.state.locales),
                COLLECTION_PAGE_SIZE,
                -1 if parts[3] == "page-previous" else 1,
            )
        elif command == "primary-set" and len(parts) == 4:
            locale = parts[3]
            if not any(entry.get("id") == locale for entry in self.state.locales):
                return
            fallback = tuple(value for value in setup.card_fallback_locales if value != locale)
            self._replace_setup(
                replace(setup, card_locale=locale, card_fallback_locales=fallback)
            )
            self.dispatch(action("TAXONOMY_REQUESTED", locale=locale))
            self.back()
        elif command == "fallback-off":
            self._replace_setup(replace(setup, card_fallback_enabled=False))
        elif command == "fallback-on":
            if setup.card_fallback_locales:
                self._replace_setup(replace(setup, card_fallback_enabled=True))
            else:
                self._navigate(Route.SETUP_CARD_LANGUAGE_FALLBACK_ADD)
        elif command == "fallbacks":
            self._navigate(Route.SETUP_CARD_LANGUAGE_FALLBACKS)
        elif command == "fallback" and len(parts) == 4:
            self._change_collection_page(
                len(setup.card_fallback_locales),
                COLLECTION_PAGE_SIZE,
                -1 if parts[3] == "page-previous" else 1,
            )
        elif command == "fallback-add" and len(parts) == 3:
            self._navigate(Route.SETUP_CARD_LANGUAGE_FALLBACK_ADD)
        elif command == "fallback-add" and len(parts) == 4:
            available = tuple(
                locale
                for locale in self.state.locales
                if locale.get("id") != setup.card_locale
                and locale.get("id") not in setup.card_fallback_locales
            )
            self._change_collection_page(
                len(available),
                COLLECTION_PAGE_SIZE,
                -1 if parts[3] == "page-previous" else 1,
            )
        elif command == "fallback-add-set" and len(parts) == 4:
            locale = parts[3]
            if locale == setup.card_locale or locale in setup.card_fallback_locales:
                return
            if not any(entry.get("id") == locale for entry in self.state.locales):
                return
            self._replace_setup(
                replace(
                    setup,
                    card_fallback_enabled=True,
                    card_fallback_locales=(*setup.card_fallback_locales, locale),
                )
            )
            self.back()
        elif command == "fallback-open" and len(parts) == 4:
            locale = parts[3]
            if locale in setup.card_fallback_locales:
                self._replace_setup(
                    replace(setup, selected_fallback_locale=locale),
                    preview=False,
                )
                self._navigate(Route.SETUP_CARD_LANGUAGE_FALLBACK)
        elif command in {"fallback-up", "fallback-down", "fallback-remove"} and len(parts) == 4:
            locale = parts[3]
            values = list(setup.card_fallback_locales)
            if locale not in values:
                return
            index = values.index(locale)
            if command == "fallback-remove":
                self.dispatch(
                    action(
                        "CONFIRM",
                        title_id=strings.REMOVE_FALLBACK_TITLE,
                        body_id=strings.REMOVE_FALLBACK_BODY,
                        action_id=strings.REMOVE_FALLBACK,
                        confirm_action=f"remove-fallback:{locale}",
                    )
                )
                return
            target = index - 1 if command == "fallback-up" else index + 1
            if 0 <= target < len(values):
                values[index], values[target] = values[target], values[index]
                self._replace_setup(replace(setup, card_fallback_locales=tuple(values)))

    @staticmethod
    def _decoded_choice(token: str, choices: tuple[object, ...]) -> Optional[object]:
        try:
            return decode_option(token, choices)
        except StopIteration:
            return None

    def _finish_option(self, setup: SetupDraft) -> None:
        self._replace_setup(replace(setup, option_editor=None))
        self.back()

    def _set_predicate_option(
        self,
        setup: SetupDraft,
        context: str,
        token: str,
    ) -> None:
        if not setup.selected_rule_id:
            return
        policy = copy.deepcopy(dict(setup.card_policy))
        rules = policy.setdefault("conditionalRules", [])
        rule = next((entry for entry in rules if entry["id"] == setup.selected_rule_id), None)
        if not rule:
            return
        predicate = rule.setdefault("predicate", {})
        if context.startswith("predicate-number:"):
            field = context.split(":", maxsplit=1)[1]
            if token == "none":
                predicate.pop(field, None)
            elif token == "EDIT":
                specification = PREDICATE_NUMBERS.get(field)
                if not specification:
                    return
                current = str(predicate.get(field, ""))
                value = self._number(specification, current)
                if value is None:
                    return
                candidate = dict(predicate)
                candidate[field] = value
                if not self._valid_predicate_bounds(candidate):
                    self.dispatch(action("NOTIFY", message_id=strings.MIN_MAX_ORDER))
                    return
                predicate[field] = value
            else:
                return
        elif context.startswith("predicate:"):
            field = context.split(":", maxsplit=1)[1]
            choices = tuple(PREDICATE_CHOICES.get(field, ()))
            try:
                value = decode_option(token, choices)
            except StopIteration:
                return
            if value is None:
                predicate.pop(field, None)
            else:
                predicate[field] = value
        else:
            return
        self._finish_option(replace(setup, card_policy=policy))

    @staticmethod
    def _valid_predicate_bounds(predicate: Mapping[str, object]) -> bool:
        pairs = (
            ("minimumIntensity", "maximumIntensity"),
            ("minimumRepeatCooldown", "maximumRepeatCooldown"),
            ("minimumWeight", "maximumWeight"),
            ("minimumPlayerCountAtLeast", "maximumPlayerCountAtMost"),
        )
        return all(
            lower not in predicate
            or upper not in predicate
            or float(predicate[lower]) <= float(predicate[upper])
            for lower, upper in pairs
        )

    def _set_directive_option(
        self,
        setup: SetupDraft,
        context: str,
        token: str,
    ) -> None:
        policy = copy.deepcopy(dict(setup.card_policy))
        directives = self._directive_target(policy, setup)
        if directives is None:
            return
        if context == "directive-value:socialSensitivity":
            current = directives.get("socialSensitivity")
            if not isinstance(current, dict) or current.get("mode") != "SET":
                return
            try:
                value = decode_option(token, SENSITIVITY_VALUES)
            except StopIteration:
                return
            current["value"] = value
        elif context.startswith("directive:"):
            field = context.split(":", maxsplit=1)[1]
            choices = tuple(DIRECTIVE_CHOICES.get(field, ()))
            try:
                value = decode_option(token, choices)
            except StopIteration:
                return
            if value is None:
                directives.pop(field, None)
            elif field in {"availability", "alwaysEligible", "repeatableInSession"}:
                directives[field] = value
            elif value == "CATALOG":
                directives[field] = {"mode": "CATALOG"}
            elif value == "SET":
                current = directives.get(field)
                if not isinstance(current, dict) or current.get("mode") != "SET":
                    directives[field] = {
                        "mode": "SET",
                        "value": copy.deepcopy(DIRECTIVE_DEFAULTS[field]),
                    }
            else:
                return
        else:
            return
        updated = replace(setup, option_editor=None)
        self._commit_directive_target(policy, updated, directives)
        self.back()

    def _setup_policy(self, parts: list[str]) -> None:
        setup = self.state.setup
        if not setup:
            return
        command = parts[2]
        if command == "rules":
            self._navigate(Route.SETUP_POLICY_RULES)
        elif command == "exact":
            self._navigate(Route.SETUP_EXACT_CARDS)
        elif command == "default":
            self.dispatch(
                action(
                    "POLICY_EDITOR_TARGET",
                    rule_id=None,
                    card_id=None,
                    facet=None,
                )
            )
            self._navigate(Route.SETUP_POLICY_DEFAULT)

    def _remove_fallback_language(self, locale: str) -> None:
        setup = self.state.setup
        if not setup or locale not in setup.card_fallback_locales:
            return
        values = tuple(
            current for current in setup.card_fallback_locales if current != locale
        )
        self._replace_setup(
            replace(
                setup,
                card_fallback_enabled=(
                    setup.card_fallback_enabled and bool(values)
                ),
                card_fallback_locales=values,
                selected_fallback_locale=None,
            )
        )
        if self.state.route == Route.SETUP_CARD_LANGUAGE_FALLBACK:
            self.back()

    def _setup_rule(self, parts: list[str]) -> None:
        setup = self.state.setup
        if not setup:
            return
        command = parts[2]
        policy = copy.deepcopy(dict(setup.card_policy))
        rules = policy.setdefault("conditionalRules", [])
        if command in {"page-previous", "page-next"}:
            self._change_collection_page(
                len(rules),
                COLLECTION_PAGE_SIZE,
                -1 if command == "page-previous" else 1,
            )
            return
        if command == "add":
            if len(rules) >= 250:
                self.dispatch(action("NOTIFY", message_id=strings.INVALID_CONFIGURATION))
                return
            name = self._text(strings.RULE_NAME)
            if not name or not name.strip():
                return
            rule_id = str(uuid.uuid4())
            rules.append(
                {
                    "id": rule_id,
                    "name": name.strip()[:100],
                    "order": len(rules),
                    "enabled": True,
                    "predicate": {},
                    "directives": {"availability": "INCLUDE"},
                }
            )
            self._replace_setup(replace(setup, card_policy=policy, selected_rule_id=rule_id))
            self._navigate(Route.SETUP_POLICY_RULE)
            return
        if command == "edit":
            self._replace_setup(replace(setup, selected_rule_id=parts[3]), preview=False)
            self._navigate(Route.SETUP_POLICY_RULE)
            return
        selected = next((rule for rule in rules if rule["id"] == setup.selected_rule_id), None)
        if not selected:
            return
        index = rules.index(selected)
        if command == "name":
            value = self._text(strings.RULE_NAME, str(selected.get("name", "")))
            if value:
                selected["name"] = value[:100]
        elif command == "enabled":
            selected["enabled"] = not bool(selected.get("enabled", True))
        elif command == "predicate":
            self._navigate(Route.SETUP_POLICY_PREDICATE)
            return
        elif command == "directive":
            self._navigate(Route.SETUP_POLICY_DIRECTIVES)
            return
        elif command == "up" and index > 0:
            rules[index - 1], rules[index] = rules[index], rules[index - 1]
        elif command == "down" and index + 1 < len(rules):
            rules[index + 1], rules[index] = rules[index], rules[index + 1]
        elif command == "delete":
            self.dispatch(
                action(
                    "CONFIRM",
                    title_id=strings.DELETE_RULE_TITLE,
                    body_id=strings.DELETE_RULE_BODY,
                    action_id=strings.DELETE,
                    confirm_action=f"delete-rule:{selected['id']}",
                )
            )
            return
        for order, rule in enumerate(rules):
            rule["order"] = order
        self._replace_setup(replace(setup, card_policy=policy))

    def _delete_rule(self, rule_id: str) -> None:
        setup = self.state.setup
        if not setup:
            return
        policy = copy.deepcopy(dict(setup.card_policy))
        rules = policy.setdefault("conditionalRules", [])
        retained = [rule for rule in rules if rule.get("id") != rule_id]
        if len(retained) == len(rules):
            return
        for order, rule in enumerate(retained):
            rule["order"] = order
        policy["conditionalRules"] = retained
        self._replace_setup(
            replace(setup, card_policy=policy, selected_rule_id=None)
        )
        self.back()

    def _setup_policy_facet(self, parts: list[str]) -> None:
        if len(parts) != 3 or not self.state.setup:
            return
        self.dispatch(action("POLICY_EDITOR_TARGET", facet=parts[2]))
        self._navigate(Route.SETUP_POLICY_VALUES)

    def _setup_predicate(self, parts: list[str]) -> None:
        setup = self.state.setup
        if not setup or not setup.selected_rule_id or len(parts) < 3:
            return
        policy = copy.deepcopy(dict(setup.card_policy))
        rules = policy.setdefault("conditionalRules", [])
        rule = next((entry for entry in rules if entry["id"] == setup.selected_rule_id), None)
        if not rule:
            return
        predicate = rule.setdefault("predicate", {})
        command = parts[2]
        if setup.policy_facet:
            field = setup.policy_facet
            available = tuple(
                value for value, _label in policy_facet_options(self.state, field)
            )
            if command == "all":
                values = list(available)
            elif command == "none":
                values = []
            elif command == "toggle" and len(parts) == 4:
                value = parts[3]
                if value not in available:
                    return
                values = list(predicate.get(field, ()))
                if value in values:
                    values.remove(value)
                else:
                    values.append(value)
            else:
                return
            if values:
                predicate[field] = values
            else:
                predicate.pop(field, None)
        self._replace_setup(replace(setup, card_policy=policy))

    def _setup_directive(self, parts: list[str]) -> None:
        setup = self.state.setup
        if not setup or len(parts) < 3:
            return
        policy = copy.deepcopy(dict(setup.card_policy))
        directives = self._directive_target(policy, setup)
        if directives is None:
            return
        command = parts[2]
        if command == "reset":
            if not setup.selected_card_id:
                return
            self.dispatch(
                action(
                    "CONFIRM",
                    title_id=strings.RESET_CARD_TITLE,
                    body_id=strings.RESET_CARD_BODY,
                    action_id=strings.RESET_CARD,
                    confirm_action="reset-exact-card",
                )
            )
            return
        elif len(parts) < 4:
            return
        elif command == "value":
            self._edit_directive_value(directives, parts[3])
        else:
            return
        self._commit_directive_target(policy, setup, directives)

    def _reset_exact_card(self) -> None:
        setup = self.state.setup
        if not setup or not setup.selected_card_id:
            return
        policy = copy.deepcopy(dict(setup.card_policy))
        exact = policy.setdefault("exactCards", [])
        exact[:] = [
            entry
            for entry in exact
            if entry.get("cardId") != setup.selected_card_id
        ]
        self._replace_setup(replace(setup, card_policy=policy))

    def _edit_directive_value(self, directives: dict, field: str) -> None:
        if field in {"playerMinimum", "playerMaximum"}:
            player_count = directives.get("playerCount")
            if not isinstance(player_count, dict) or player_count.get("mode") != "SET":
                return
            value = player_count.setdefault("value", {"minimum": 2, "maximum": None})
            key = "minimum" if field == "playerMinimum" else "maximum"
            default = "" if value.get(key) is None else str(value[key])
            specification = DIRECTIVE_NUMBERS[field]
            parsed = self._number(specification, default)
            if parsed is None:
                return
            candidate = dict(value)
            candidate[key] = parsed
            if candidate.get("maximum") is not None and candidate["minimum"] > candidate["maximum"]:
                self.dispatch(action("NOTIFY", message_id=strings.MIN_MAX_ORDER))
                return
            value[key] = parsed
            return
        current = directives.get(field)
        if not isinstance(current, dict) or current.get("mode") != "SET":
            return
        if field == "socialSensitivity":
            return
        specification = DIRECTIVE_NUMBERS.get(field)
        if not specification:
            return
        value = self._number(specification, str(current.get("value", "")))
        if value is None:
            return
        current["value"] = value

    @staticmethod
    def _directive_target(policy: dict, setup: SetupDraft) -> Optional[dict]:
        if setup.selected_rule_id:
            rule = next(
                (
                    entry
                    for entry in policy.setdefault("conditionalRules", [])
                    if entry["id"] == setup.selected_rule_id
                ),
                None,
            )
            return rule.setdefault("directives", {}) if rule else None
        if setup.selected_card_id:
            exact = policy.setdefault("exactCards", [])
            entry = next(
                (item for item in exact if item["cardId"] == setup.selected_card_id),
                None,
            )
            if entry is None:
                entry = {"cardId": setup.selected_card_id, "directives": {}}
                exact.append(entry)
            return entry.setdefault("directives", {})
        return policy.setdefault("scopeDefault", {})

    def _commit_directive_target(self, policy: dict, setup: SetupDraft, directives: dict) -> None:
        if setup.selected_card_id and not directives:
            exact = policy.setdefault("exactCards", [])
            exact[:] = [entry for entry in exact if entry["cardId"] != setup.selected_card_id]
        self._replace_setup(replace(setup, card_policy=policy))

    def _open_exact_card(self, card_id: str) -> None:
        setup = self.state.setup
        if not setup:
            return
        self.dispatch(
            action(
                "POLICY_EDITOR_TARGET",
                rule_id=None,
                card_id=card_id,
                facet=None,
            )
        )
        self._navigate(Route.SETUP_EXACT_CARD)

    def _setup_card_search(self, parts: list[str]) -> None:
        setup = self.state.setup
        if not setup or len(parts) < 3:
            return
        command = parts[2]
        if command == "search":
            query = self._text(strings.SEARCH_CARDS, setup.card_search_query)
            if query is None:
                return
            updated = replace(
                setup,
                card_search_query=query,
                card_search_results=(),
                card_search_cursor=None,
                card_search_next_cursor=None,
                card_search_cursor_history=(),
                card_search_total=0,
            )
        elif command == "page-next" and setup.card_search_next_cursor:
            updated = replace(
                setup,
                card_search_results=(),
                card_search_cursor=setup.card_search_next_cursor,
                card_search_next_cursor=None,
                card_search_cursor_history=(
                    *setup.card_search_cursor_history,
                    setup.card_search_cursor,
                ),
            )
        elif command == "page-previous" and setup.card_search_cursor_history:
            updated = replace(
                setup,
                card_search_results=(),
                card_search_cursor=setup.card_search_cursor_history[-1],
                card_search_next_cursor=None,
                card_search_cursor_history=setup.card_search_cursor_history[:-1],
            )
        else:
            return
        self._replace_setup(updated, preview=False)
        self.dispatch(
            action(
                "SEARCH_CARDS_REQUESTED",
                str(uuid.uuid4()),
                query=updated.card_search_query,
                cursor=updated.card_search_cursor,
            )
        )

    def _activate_room(self, key: str) -> None:
        command = key.split(":")[1]
        if command == "code-input":
            value = self._text(strings.ENTER_ROOM_CODE)
            code = (value or "").strip().upper()
            if ROOM_CODE.fullmatch(code):
                self.dispatch(action("JOIN_ROOM_REQUESTED", room_code=code))
            elif value is not None:
                self.dispatch(action("NOTIFY", message_id=strings.ROOM_CODE_INVALID))
        elif command == "leave":
            self.dispatch(
                action(
                    "CONFIRM",
                    title_id=strings.LEAVE_TITLE,
                    body_id=strings.LEAVE_BODY,
                    action_id=strings.LEAVE,
                    confirm_action="leave-active",
                )
            )

    def _activate_display(self, key: str) -> None:
        command = key.split(":")[1]
        preferences = self.state.preferences
        if command == "auto-page":
            value = self._auto_page_choice(preferences.auto_page_seconds)
            if value is not None:
                self._preferences(replace(preferences, auto_page_seconds=value))
        elif command == "diagnostics":
            self._navigate(Route.DIAGNOSTICS)
        elif command == "leave":
            self.dispatch(
                action(
                    "CONFIRM",
                    title_id=strings.LEAVE_TITLE,
                    body_id=strings.LEAVE_BODY,
                    action_id=strings.LEAVE,
                    confirm_action="leave-active",
                )
            )

    def _activate_couch(self, key: str) -> None:
        parts = key.split(":")
        command = parts[1]
        if command == "resume":
            self.dispatch(action("BACK"))
        elif command == "menu-help":
            self._navigate(Route.HELP)
        elif command == "start":
            self._couch_command("start")
        elif command == "choose":
            self._couch_command("choose", {"cardType": parts[2]})
        elif command == "skip":
            self._couch_command("skip")
        elif command == "advance":
            self._couch_command("advance")
        elif command == "vote":
            self._couch_command("vote", {"playerId": parts[2], "vote": parts[3]})
        elif command == "vote-player":
            self.dispatch(action("COUCH_VOTE_PLAYER_SELECTED", player_id=parts[2]))
        elif command == "voters" and len(parts) == 3:
            delta = -1 if parts[2] == "page-previous" else 1
            self.dispatch(
                action(
                    "COLLECTION_PAGE_CHANGED",
                    page=max(0, self.state.collection_page + delta),
                )
            )
        elif command == "vote-cancel":
            self.dispatch(action("COUCH_VOTE_CANCELLED"))
        elif command == "resync":
            self.dispatch(action("COUCH_RESYNC_REQUESTED"))
        elif command == "adjust":
            self.dispatch(
                action(
                    "CONFIRM",
                    title_id=strings.POOL_EXHAUSTED,
                    body_id=strings.POOL_EXHAUSTED_BODY,
                    action_id=strings.ADJUST_SETUP,
                    confirm_action="adjust-couch",
                )
            )
        elif command == "end":
            self.dispatch(
                action(
                    "CONFIRM",
                    title_id=strings.END_GAME,
                    body_id=strings.END_GAME_BODY,
                    action_id=strings.END_GAME,
                    confirm_action="leave-active",
                )
            )

    def _activate_summary(self, key: str) -> None:
        command = key.split(":")[1]
        if command == "again" and self.state.setup:
            if self.state.setup.topology == "COUCH":
                self.dispatch(action("CREATE_COUCH_REQUESTED"))
            else:
                self.dispatch(action("CREATE_ROOM_REQUESTED"))
        elif command == "new" and self.state.setup:
            self.dispatch(action("RESTART_SETUP"))
        elif command == "code":
            if self.state.active_room:
                self.dispatch(action("LEAVE_ACTIVE", destination=Route.ROOM_CODE_ENTRY))
            else:
                self.dispatch(action("NAVIGATE", route=Route.ROOM_CODE_ENTRY, push=False))
        elif command == "home":
            if self.state.active_room:
                self.dispatch(action("LEAVE_ACTIVE", destination=Route.HOME))
            else:
                self.dispatch(action("NAVIGATE", route=Route.HOME, push=False))

    def _activate_prefs(self, key: str) -> None:
        command = key.split(":")[1]
        preferences = self.state.preferences
        if command in {"page-previous", "page-next"}:
            delta = -1 if command == "page-previous" else 1
            self.dispatch(
                action(
                    "COLLECTION_PAGE_CHANGED",
                    page=max(0, self.state.collection_page + delta),
                )
            )
        elif command == "locale":
            locales = ("auto", "en-GB", "de-DE")
            current = preferences.locale if preferences.locale in locales else "auto"
            selected = self._choice(
                strings.UI_LANGUAGE,
                (
                    strings.Text.message(strings.LANGUAGE_AUTO),
                    strings.Text.message(strings.LANGUAGE_ENGLISH),
                    strings.Text.message(strings.LANGUAGE_GERMAN),
                ),
                locales.index(current),
            )
            if selected is not None:
                self._preferences(replace(preferences, locale=locales[selected]))
        elif command == "auto-page":
            value = self._auto_page_choice(preferences.auto_page_seconds)
            if value is not None:
                self._preferences(replace(preferences, auto_page_seconds=value))
        elif command == "name":
            name = self._text(strings.DISPLAY_NAME, preferences.display_name)
            if name:
                self._preferences(replace(preferences, display_name=name.strip()[:40]))
        elif command == "diagnostics":
            self._navigate(Route.DIAGNOSTICS)
        elif command == "help":
            self._navigate(Route.HELP)
        elif command == "link":
            self._navigate(Route.DEVICE_LINK)
        elif command == "clear-servers":
            self.dispatch(
                action(
                    "CONFIRM",
                    title_id=strings.CLEAR_RECENT_SERVERS,
                    body_id=strings.CLEAR_RECENT_SERVERS_BODY,
                    action_id=strings.DELETE,
                    confirm_action="clear-servers",
                )
            )

    def _activate_diagnostics(self, key: str) -> None:
        command = key.split(":")[1]
        if command in {"page-previous", "page-next"}:
            delta = -1 if command == "page-previous" else 1
            self.dispatch(
                action(
                    "COLLECTION_PAGE_CHANGED",
                    page=max(0, self.state.collection_page + delta),
                )
            )
        elif command == "clear":
            self.dispatch(
                action(
                    "CONFIRM",
                    title_id=strings.CLEAR_DATA,
                    body_id=strings.DIAGNOSTICS_BODY,
                    action_id=strings.DELETE,
                    confirm_action="clear-data",
                )
            )
        elif command == "refresh":
            self.dispatch(action("DISCOVERY_REQUESTED"))

    def _activate_help(self, key: str) -> None:
        parts = key.split(":")
        if len(parts) == 3 and parts[1] == "topic":
            self.dispatch(action("HELP_TOPIC_SELECTED", slug=parts[2]))
        elif len(parts) == 2 and parts[1] in {"page-previous", "page-next"}:
            delta = -1 if parts[1] == "page-previous" else 1
            self.dispatch(action("HELP_PAGE_CHANGED", page=self.state.help_page + delta))

    def private_vote_shortcut(self, vote: str) -> bool:
        snapshot = self.state.couch_snapshot or {}
        player_id = self.state.couch_vote_player_id
        if (
            self.state.route != Route.COUCH_GAME
            or snapshot.get("state") != "COLLECTING_ANSWERS"
            or self.state.couch_vote_phase != "CHOICE"
            or not player_id
            or vote not in {"YES", "NO"}
        ):
            return False
        self._couch_command("vote", {"playerId": player_id, "vote": vote})
        return True

    def _activate_group(self, key: str) -> None:
        parts = key.split(":")
        command = parts[1]
        if command in {"page-previous", "page-next"}:
            self._change_collection_page(
                len(self.state.groups),
                COLLECTION_PAGE_SIZE,
                -1 if command == "page-previous" else 1,
            )
        elif command == "member" and len(parts) == 3 and parts[2] in {
            "page-previous",
            "page-next",
        }:
            self._change_collection_page(
                len(self.state.group_draft_members),
                COLLECTION_PAGE_SIZE - 1,
                -1 if parts[2] == "page-previous" else 1,
            )
        elif command == "create":
            self.dispatch(action("GROUP_DRAFT_STARTED"))
            self._navigate(Route.GROUP_CREATE)
        elif command == "edit" and len(parts) == 3:
            group = next(
                (entry for entry in self.state.groups if entry.get("id") == parts[2]),
                None,
            )
            if group:
                self.dispatch(action("GROUP_DRAFT_STARTED", group=group))
                self._navigate(Route.GROUP_CREATE)
        elif command == "name":
            name = self._text(strings.GROUP_NAME, self.state.group_draft_name)
            if name is not None:
                self.dispatch(action("GROUP_DRAFT_UPDATED", name=name[:80]))
        elif command == "add-member":
            name = self._text(strings.ADD_PLAYER)
            if name and len(self.state.group_draft_members) < 50:
                self.dispatch(
                    action(
                        "GROUP_DRAFT_UPDATED",
                        members=(*self.state.group_draft_members, name.strip()[:40]),
                    )
                )
        elif command == "member-open" and len(parts) == 3:
            index = int(parts[2])
            if 0 <= index < len(self.state.group_draft_members):
                self.dispatch(action("GROUP_DRAFT_UPDATED", member_index=index))
                self._navigate(Route.GROUP_MEMBER)
        elif command == "edit-member" and len(parts) == 3:
            index = int(parts[2])
            if 0 <= index < len(self.state.group_draft_members):
                name = self._text(strings.EDIT_PLAYER, self.state.group_draft_members[index])
                if name:
                    members = list(self.state.group_draft_members)
                    members[index] = name.strip()[:40]
                    self.dispatch(action("GROUP_DRAFT_UPDATED", members=tuple(members)))
        elif command == "remove-member" and len(parts) == 3:
            index = int(parts[2])
            if 0 <= index < len(self.state.group_draft_members):
                self.dispatch(
                    action(
                        "CONFIRM",
                        title_id=strings.REMOVE_PLAYER_TITLE,
                        body_id=strings.REMOVE_PLAYER_BODY,
                        action_id=strings.REMOVE_PLAYER,
                        confirm_action=f"remove-group-member:{index}",
                    )
                )
        elif command == "save" and self.state.group_draft_name.strip():
            request_kind = (
                "UPDATE_GROUP_REQUESTED"
                if self.state.group_draft_id
                else "CREATE_GROUP_REQUESTED"
            )
            self.dispatch(
                action(
                    request_kind,
                    group_id=self.state.group_draft_id,
                    name=self.state.group_draft_name.strip(),
                    members=self.state.group_draft_members,
                )
            )
        elif command == "continue" and len(parts) == 3:
            self.dispatch(action("BEGIN_SETUP", topology="COUCH"))
            setup = self.state.setup
            if setup:
                self._setup_group(["setup", "group", "select", parts[2]])

    def _remove_group_member(self, index: int) -> None:
        if not 0 <= index < len(self.state.group_draft_members):
            return
        members = list(self.state.group_draft_members)
        members.pop(index)
        self.dispatch(
            action(
                "GROUP_DRAFT_UPDATED",
                members=tuple(members),
                member_index=None,
            )
        )
        if self.state.route == Route.GROUP_MEMBER:
            self.back()

    def _activate_auth(self, key: str) -> None:
        command = key.split(":")[1]
        if command == "start":
            capability = bool(
                (self.state.server_info or {})
                .get("capabilities", {})
                .get("nativeDeviceAuthorization")
            )
            if capability:
                self.dispatch(action("AUTH_LINK_REQUESTED"))
            else:
                self.dispatch(action("NOTIFY", message_id=strings.LINK_NOT_SUPPORTED))
        elif command == "cancel":
            self.dispatch(action("AUTH_CANCEL_REQUESTED"))
        elif command == "unlink":
            self.dispatch(
                action(
                    "CONFIRM",
                    title_id=strings.UNLINK_DEVICE,
                    body_id=strings.UNLINK_CONFIRMATION,
                    action_id=strings.UNLINK_DEVICE,
                    confirm_action="unlink-device",
                )
            )

    def _activate_collection(self, key: str) -> None:
        command = key.split(":")[1]
        delta = -1 if command == "page-previous" else 1
        self.dispatch(
            action(
                "COLLECTION_PAGE_CHANGED",
                page=max(0, self.state.collection_page + delta),
            )
        )

    def _replace_setup(self, setup: SetupDraft, preview: bool = True) -> None:
        self.dispatch(
            action(
                "SETUP_REPLACED",
                str(uuid.uuid4()),
                setup=setup,
                preview=preview,
            )
        )

    def _change_group_page(self, delta: int) -> None:
        self._change_collection_page(
            len(self.state.groups), COLLECTION_PAGE_SIZE, delta
        )

    def _change_collection_page(self, count: int, page_size: int, delta: int) -> None:
        maximum = max(0, (count - 1) // page_size)
        page = max(0, min(maximum, self.state.collection_page + delta))
        self.dispatch(action("COLLECTION_PAGE_CHANGED", page=page))

    def _auto_page_choice(self, current: int) -> Optional[int]:
        choices = (5, 6, 8, 10, 12, 15)
        value = current if current in choices else 6
        selected = self._choice(
            strings.AUTO_PAGE_SECONDS,
            tuple(strings.Text.message(strings.SECONDS, choice) for choice in choices),
            choices.index(value),
        )
        return choices[selected] if selected is not None else None

    def _configuration(self, name: str, value: object) -> None:
        setup = self.state.setup
        if not setup:
            return
        configuration = copy.deepcopy(dict(setup.configuration))
        configuration[name] = value
        self._replace_setup(replace(setup, configuration=configuration))

    def _couch_command(self, command: str, extra: Optional[dict] = None) -> None:
        self.dispatch(action("COUCH_COMMAND_REQUESTED", command=command, extra=extra or {}))

    def _preferences(self, preferences: Preferences) -> None:
        self.dispatch(action("PREFERENCES_CHANGED", preferences=preferences))

    def _navigate(self, route: Route) -> None:
        self.dispatch(action("NAVIGATE", route=route))
        if route == Route.DIAGNOSTICS:
            self.dispatch(action("DIAGNOSTICS_REQUESTED"))

    def _text(self, heading_id: int, default: str = "") -> Optional[str]:
        if not self.ui:
            return None
        return self.ui.request_text(heading_id, default)

    def _number(self, specification, default: str = "") -> Optional[object]:
        if not self.ui:
            return None
        entered = self.ui.request_number(specification.heading_id, default)
        if entered is None or not entered.strip():
            return None
        try:
            number = float(entered.replace(",", "."))
        except ValueError:
            self.dispatch(action("NOTIFY", message_id=strings.NUMBER_INVALID))
            return None
        if number < specification.minimum or number > specification.maximum:
            self.dispatch(
                action(
                    "NOTIFY",
                    message_id=strings.NUMBER_RANGE,
                    arguments=(
                        format_number(specification.minimum),
                        format_number(specification.maximum),
                    ),
                )
            )
            return None
        if specification.integer and not number.is_integer():
            self.dispatch(action("NOTIFY", message_id=strings.NUMBER_INVALID))
            return None
        return int(number) if specification.integer else number

    def _choice(
        self,
        heading_id: int,
        options: tuple[strings.Text, ...],
        selected: int,
    ) -> Optional[int]:
        if not self.ui:
            return None
        return self.ui.request_choice(heading_id, options, selected)

    @staticmethod
    def _route_after_profile(setup: SetupDraft) -> Route:
        return Route.SETUP_PLAYERS if setup.topology == "COUCH" else Route.SETUP_CUSTOMIZE

    def _selected_server(self):
        return next(
            (entry for entry in self.state.servers if entry.server_id == self.state.selected_server_id),
            None,
        )

    def _details_server(self):
        details_id = self.state.server_details_id or self.state.selected_server_id
        return next(
            (entry for entry in self.state.servers if entry.server_id == details_id),
            None,
        )
