"""Single WindowXMLDialog shell. Every mutation remains on Kodi's add-on thread."""

from __future__ import annotations

import time

import xbmc
import xbmcaddon
import xbmcgui

from ..layout import adaptive_tone, card_text_fit, result_card_text_fit
from ..navigation import (
    ACTION_LIST,
    BACK_BUTTON,
    CARD_ACTION_LIST,
    CHOICE_LIST,
    COLLECTION_LIST,
    COUCH_MENU_ACTION_LIST,
    CONFIRM_ACCEPT,
    CONFIRM_CANCEL,
    GAME_SETTINGS,
    HELP_BUTTON,
    HELP_TOPIC_LIST,
    HOME_CONTROLS,
    LOBBY_ROSTER_LIST,
    MOVE_DOWN_ACTION,
    MOVE_UP_ACTION,
    PAGE_NEXT,
    PAGE_PREVIOUS,
    PROFILE_LIST,
    RESULT_NO_LIST,
    RESULT_YES_LIST,
    ROSTER_LIST,
    ROW_LIST,
    SETTINGS_LIST,
    SUMMARY_ITEM_LIST,
    VOTER_LIST,
    focus_graph,
    section_focus_repair_target,
)
INTERACTIVE_LISTS = (
    ROW_LIST,
    CARD_ACTION_LIST,
    CHOICE_LIST,
    COLLECTION_LIST,
    HELP_TOPIC_LIST,
    ACTION_LIST,
    COUCH_MENU_ACTION_LIST,
    SUMMARY_ITEM_LIST,
)
INTERACTIVE_LISTS = (*INTERACTIVE_LISTS, SETTINGS_LIST, PROFILE_LIST, VOTER_LIST)
ALL_LISTS = (
    *INTERACTIVE_LISTS,
    ROSTER_LIST,
    LOBBY_ROSTER_LIST,
    RESULT_YES_LIST,
    RESULT_NO_LIST,
)
REPAINT_CONTROL = 48
REPAINT_PASSES = 2
REPAINT_PASS_INTERVAL_SECONDS = 0.04
FOCUS_STABILITY_SECONDS = 0.75
BACK_ACTIONS = {9, 10, 92, 247}
CONTEXT_ACTIONS = {117}
INFO_ACTIONS = {11}
SELECT_ACTIONS = {7}
LOADING_MESSAGE = 32001
BACK_MESSAGE = 32090
HELP_MESSAGE = 32091
ADDON_ID = "script.partycard.tv"
PRIVATE_VOTE_YES_BUTTON = 96
PRIVATE_VOTE_NO_BUTTON = 97
PRIVATE_VOTE_CANCEL_BUTTON = 98


class MainWindow(xbmcgui.WindowXMLDialog):
    def __init__(
        self,
        *args,
        application=None,
        addon_root: str,
        **kwargs,
    ) -> None:
        super().__init__(*args, **kwargs)
        self.application = application
        # The Window is also exercised through a non-release RunScript fixture.
        # Resolving the explicit stable id keeps localization available even when
        # Kodi did not establish an implicit current-add-on context.
        self.addon = xbmcaddon.Addon(ADDON_ID)
        self.addon_root = addon_root
        self.localizer = None
        self.focus = None
        self.Route = None
        self.strings = None
        self.Text = None
        self._items = {control_id: () for control_id in ALL_LISTS}
        self._item_signatures = {control_id: () for control_id in ALL_LISTS}
        self._home_actions = {}
        self._pagination_actions = {}
        self._navigation_graph = {}
        self._last_route = ""
        self._last_couch_focus_context = None
        self._couch_command_pending = False
        self._focused_control_id = 0
        self._pending_focus_control = 0
        self._pending_focus_semantic = ""
        self._pending_focus_attempts = 0
        self._focus_not_before = 0.0
        self._focus_guard_control = 0
        self._focus_guard_until = 0.0
        self._initialized = False
        self._screensaver_inhibited = False
        self._repaint_passes_remaining = 0
        self._repaint_not_before = 0.0
        self._render_loading()
        if self.application is not None:
            self.attach_application(self.application)

    def onInit(self) -> None:  # noqa: N802 - Kodi callback name
        self._initialized = True
        self._render_loading()
        if self.application is not None:
            self.render_if_changed()

    def attach_application(self, application) -> None:
        from ..focus import FocusCoordinator
        from ..localization import CatalogLocalizer
        from ..routes import Route
        from .. import strings
        from ..strings import Text

        self.application = application
        self.localizer = CatalogLocalizer(self.addon_root)
        self.focus = FocusCoordinator()
        self.Route = Route
        self.strings = strings
        self.Text = Text
        self.application.attach_ui(self)

    def render_if_changed(self) -> None:
        if not self._initialized or self.application is None:
            return
        now = time.monotonic()
        if self._repaint_passes_remaining and now >= self._repaint_not_before:
            # Run this on the add-on thread one tick after property mutation. Kodi's
            # GUI thread can then observe the complete snapshot before the transparent
            # full-window control marks its parent surface dirty. A second bounded
            # pass accounts for list-item GUI messages applied after the first pass.
            self.getControl(REPAINT_CONTROL).setAnimations([])
            self._repaint_passes_remaining -= 1
            self._repaint_not_before = now + REPAINT_PASS_INTERVAL_SECONDS
        self._repair_recent_focus_loss(now)
        self._apply_pending_focus()
        view = self.application.take_view()
        if view is not None:
            self._render(view)

    def request_text(
        self,
        heading_id: int,
        default: str = "",
        hidden: bool = False,
    ):
        if self.Text is None:
            return None
        keyboard = xbmc.Keyboard(default, self._resolve(self.Text.message(heading_id)), hidden)
        keyboard.doModal()
        if not keyboard.isConfirmed():
            return None
        return keyboard.getText()

    def request_number(self, heading_id: int, default: str = ""):
        if self.Text is None:
            return None
        heading = self._resolve(self.Text.message(heading_id))
        value = xbmcgui.Dialog().input(
            heading,
            defaultt=default,
            type=getattr(xbmcgui, "INPUT_NUMERIC", 0),
        )
        return value if value else None

    def request_choice(self, heading_id: int, options: tuple, selected: int = 0):
        if self.Text is None:
            return None
        result = xbmcgui.Dialog().select(
            self._resolve(self.Text.message(heading_id)),
            [self._resolve(option) for option in options],
            preselect=selected,
            useDetails=False,
        )
        return result if result >= 0 else None

    def onClick(self, control_id: int) -> None:  # noqa: N802 - Kodi callback name
        if self.application is None:
            return
        if control_id == PRIVATE_VOTE_CANCEL_BUTTON:
            self.application.activate("couch:vote-cancel")
            return
        if control_id in {PRIVATE_VOTE_YES_BUTTON, PRIVATE_VOTE_NO_BUTTON}:
            vote = "YES" if control_id == PRIVATE_VOTE_YES_BUTTON else "NO"
            if self.application.private_vote_shortcut(vote):
                self.setFocusId(49)
                self._focused_control_id = 49
                self._schedule_repaint()
            return
        if control_id in INTERACTIVE_LISTS:
            selected = self.getControl(control_id).getSelectedItem()
            if not selected or selected.getProperty("Enabled") != "true":
                return
            self.application.activate(selected.getProperty("ActionId"))
            return
        if control_id in HOME_CONTROLS:
            action_data = self._home_actions.get(control_id)
            if action_data and action_data[1]:
                self.application.activate(action_data[0])
            return
        if control_id in {PAGE_PREVIOUS, PAGE_NEXT}:
            action_data = self._pagination_actions.get(control_id)
            if action_data and action_data[1]:
                self.application.activate(action_data[0])
            return
        if control_id == GAME_SETTINGS:
            self._open_game_settings()
            return
        if control_id == CONFIRM_CANCEL:
            self.application.cancel_confirmation()
        elif control_id == CONFIRM_ACCEPT:
            self.application.confirm()
        elif control_id == BACK_BUTTON:
            self.application.back()
        elif control_id == HELP_BUTTON:
            self._open_help()

    def onAction(self, incoming: xbmcgui.Action) -> None:  # noqa: N802 - Kodi callback name
        if self.application is None:
            return
        action_id = incoming.getId()
        if action_id not in {MOVE_UP_ACTION, MOVE_DOWN_ACTION}:
            self._clear_focus_guard()
        if action_id in {5, 59, 215} and self.application.private_vote_shortcut("YES"):
            self.setFocusId(49)
            self._focused_control_id = 49
            return
        if action_id in {6, 60, 216} and self.application.private_vote_shortcut("NO"):
            self.setFocusId(49)
            self._focused_control_id = 49
            return
        if action_id in {5, 59, 215} and self.application.change_card_page(-1):
            return
        if action_id in {6, 60, 216} and self.application.change_card_page(1):
            return
        # Kodi 21 does not consistently deliver onClick for horizontal-list items
        # that have a secondary label. Those are the public voter selectors.
        # Handle only this idempotent selection here; ordinary list clicks remain
        # in onClick and vote submission can never be sent twice.
        if action_id in SELECT_ACTIONS and self._activate_focused_voter():
            return
        if action_id in BACK_ACTIONS:
            self.application.back()
        elif action_id in INFO_ACTIONS:
            self._open_help()
        elif action_id in CONTEXT_ACTIONS:
            if self.application.state.route == self.Route.GROUP_LIST:
                selected = self.getControl(COLLECTION_LIST).getSelectedItem()
                if selected:
                    key = selected.getProperty("ActionId")
                    if key.startswith("group:continue:"):
                        self.application.activate(key.replace("group:continue:", "group:edit:", 1))
                        return
            self._open_game_settings()
        self._repair_native_directional_focus(action_id)

    def _repair_native_directional_focus(self, action_id: int) -> None:
        """Recover a fixed-control graph move when Kodi leaves no usable focus."""

        if action_id not in {MOVE_UP_ACTION, MOVE_DOWN_ACTION}:
            return
        try:
            current_control = self.getFocusId()
        except RuntimeError:
            current_control = 0
        if current_control:
            # Kodi can report the expected destination here and discard it a few
            # frames later while a repopulated list settles. Observe that exact
            # control briefly; do not redirect a valid native move.
            self._arm_focus_guard(current_control)
            return
        target = section_focus_repair_target(
            self._navigation_graph,
            last_control=self._focused_control_id,
            current_control=current_control,
            action_id=action_id,
            internal_controls=INTERACTIVE_LISTS,
        )
        if target is None:
            return
        self._arm_focus_guard(target)
        semantic = self._semantic_for_control(target)
        if semantic:
            self._queue_focus_semantic(semantic)
        else:
            self._queue_focus_control(target)

    def _arm_focus_guard(self, control_id: int) -> None:
        self._focus_guard_control = control_id
        self._focus_guard_until = time.monotonic() + FOCUS_STABILITY_SECONDS

    def _clear_focus_guard(self) -> None:
        self._focus_guard_control = 0
        self._focus_guard_until = 0.0

    def _repair_recent_focus_loss(self, now: float) -> None:
        target = self._focus_guard_control
        if not target:
            return
        if now > self._focus_guard_until:
            self._clear_focus_guard()
            return
        try:
            current_control = self.getFocusId()
        except RuntimeError:
            current_control = 0
        if current_control:
            return
        self._clear_focus_guard()
        semantic = self._semantic_for_control(target)
        if semantic:
            self._queue_focus_semantic(semantic)
        else:
            self._queue_focus_control(target)

    def _activate_focused_voter(self) -> bool:
        if self._focused_control_id != VOTER_LIST:
            return False
        selected = self.getControl(VOTER_LIST).getSelectedItem()
        if not selected or selected.getProperty("Enabled") != "true":
            return False
        semantic = selected.getProperty("ActionId")
        if not semantic.startswith("couch:vote-player:"):
            return False
        self.application.activate(semantic)
        return True

    def onFocus(self, control_id: int) -> None:  # noqa: N802 - Kodi callback name
        if not control_id:
            return
        self._focused_control_id = control_id
        # Control.HasFocus conditions are cached by Kodi's smart-redraw path just
        # like Window properties, so native D-pad focus changes need the same
        # bounded surface invalidation as a rendered view snapshot.
        self._schedule_repaint()
        if self.application is None or self.focus is None:
            return
        semantic = self._semantic_for_control(control_id)
        if self._pending_focus_control == control_id or (
            self._pending_focus_semantic
            and semantic == self._pending_focus_semantic
        ):
            self._clear_pending_focus()
        if semantic:
            self.focus.remember(self.application.state.route.value, semantic)

    def _open_help(self) -> None:
        if self.application.state.route == self.Route.HELP:
            return
        from ..actions import action

        self.application.dispatch(action("NAVIGATE", route=self.Route.HELP))

    def _open_game_settings(self) -> None:
        if self.application.state.route == self.Route.COUCH_GAME:
            self.application.back()
            return
        if self.application.state.route not in {
            self.Route.ROOM_LOBBY_DISPLAY,
            self.Route.ROOM_GAME_DISPLAY,
            self.Route.ROOM_SUMMARY_DISPLAY,
        }:
            return
        from ..actions import action

        self.application.dispatch(action("NAVIGATE", route=self.Route.ROOM_DISPLAY_MENU))

    def _render(self, view) -> None:
        route = self.application.state.route.value
        route_changed = route != self._last_route
        previous_keys = self._enabled_keys()
        previous_focus = self._semantic_for_control(self._focused_control_id)
        force_couch_focus = self._should_force_couch_focus(view)
        active_stage = self.application.state.route in {
            self.Route.COUCH_GAME,
            self.Route.ROOM_LOBBY_DISPLAY,
            self.Route.ROOM_GAME_DISPLAY,
            self.Route.ROOM_SUMMARY_DISPLAY,
        }
        self._set_screensaver_inhibited(active_stage)
        self.setProperty("ClientReady", "true")
        self.setProperty("Eyebrow", self._resolve(view.eyebrow))
        self.setProperty("Heading", self._resolve(view.heading))
        body = self._resolve(view.body)
        self.setProperty("Body", body)
        self.setProperty("Alert", self._resolve(view.alert))
        self.setProperty("ViewMode", view.view_mode)
        self.setProperty(
            "PassiveRoomStage",
            "true"
            if self.application.state.route
            in {
                self.Route.ROOM_LOBBY_DISPLAY,
                self.Route.ROOM_GAME_DISPLAY,
                self.Route.ROOM_SUMMARY_DISPLAY,
            }
            else "false",
        )
        self.setProperty("CardEyebrow", self._resolve(view.card_eyebrow))
        self.setProperty("CardClassification", self._resolve(view.card_classification))
        card_text = self._resolve(view.card_text)
        self.setProperty("CardText", card_text)
        self.setProperty("CardTextFit", card_text_fit(card_text))
        self.setProperty("ResultCardTextFit", result_card_text_fit(card_text))
        self.setProperty("CardFooter", self._resolve(view.card_footer))
        card_intensity = self._resolve(view.card_intensity)
        game_intensity = self._resolve(view.game_intensity)
        self.setProperty("CardIntensity", card_intensity)
        self.setProperty("GameIntensity", game_intensity)
        self._render_intensity("CardIntensity", card_intensity)
        self._render_intensity("GameIntensity", game_intensity)
        current_player = self._resolve(view.current_player)
        self.setProperty("CurrentPlayer", current_player)
        current_player_body_visible = bool(
            current_player
            and body
            and not view.roster
            and not view.private_vote_choice
            and self.application.state.route
            not in {
                self.Route.ROOM_LOBBY_DISPLAY,
                self.Route.ROOM_GAME_DISPLAY,
                self.Route.ROOM_SUMMARY_DISPLAY,
            }
        )
        self.setProperty(
            "CurrentPlayerBodyVisible",
            "true" if current_player_body_visible else "false",
        )
        self.setProperty("Atmosphere", view.atmosphere)
        self.setProperty(
            "AdaptiveTone",
            adaptive_tone(view.atmosphere),
        )
        atmosphere_texture = ""
        if view.atmosphere != "NEUTRAL":
            atmosphere_texture = (
                "partycard-tv-atmosphere-"
                + view.atmosphere.lower().replace("_", "-")
                + ".png"
            )
        self.setProperty("AtmosphereTexture", atmosphere_texture)
        result_yes = self._resolve(view.result_yes)
        result_no = self._resolve(view.result_no)
        self.setProperty("ResultYes", result_yes)
        self.setProperty("ResultNo", result_no)
        self.setProperty("ResultYesNames", self._resolve(view.result_yes_names))
        self.setProperty("ResultNoNames", self._resolve(view.result_no_names))
        self.setProperty(
            "HasNamedResults",
            "true" if view.result_yes_players or view.result_no_players else "false",
        )
        self.setProperty("ResultVisible", "true" if result_yes or result_no else "false")
        self.setProperty("ServerPill", self._resolve(view.server_pill))
        self.setProperty("Footer", self._resolve(view.footer))
        self.setProperty("Progress", self._resolve(view.progress))
        self.setProperty("RoomCode", self._resolve(view.room_code))
        self.setProperty("JoinUrls", self._resolve(view.join_urls))
        self.setProperty("JoinUrlStatus", self._resolve(view.join_url_status))
        self.setProperty("ResultStatus", self._resolve(view.result_status))
        self.setProperty("CardPageStatus", self._resolve(view.card_page_status))
        self.setProperty(
            "PrivateVoteChoice",
            "true" if view.private_vote_choice else "false",
        )
        self.setProperty("HasVoters", "true" if view.voters else "false")
        self.setProperty("VotingStageLabel", self._resolve(view.voting_stage_label))
        self.setProperty("VotingPlayer", self._resolve(view.voting_player))
        self.setProperty("VotingHint", self._resolve(view.voting_hint))
        self.setProperty(
            "PrivateVoteYesLabel",
            self._resolve(self.Text.message(self.strings.YES)),
        )
        self.setProperty(
            "PrivateVoteNoLabel",
            self._resolve(self.Text.message(self.strings.NO)),
        )
        self.setProperty(
            "PrivateVoteCancelLabel",
            self._resolve(self.Text.message(self.strings.CANCEL_VOTE)),
        )
        self.setProperty("HasCardPages", "true" if view.card_page_count > 1 else "false")
        self.setProperty(
            "CardPagePreviousEnabled",
            "true" if view.card_page_previous_enabled else "false",
        )
        self.setProperty(
            "CardPageNextEnabled",
            "true" if view.card_page_next_enabled else "false",
        )
        self.setProperty("QrPath", view.qr_path)
        self.setProperty("BackLabel", self._resolve(self.Text.message(self.strings.BACK)))
        self.setProperty("HelpLabel", self._resolve(self.Text.message(self.strings.HELP)))
        self.setProperty("CancelLabel", self._resolve(self.Text.message(self.strings.CANCEL)))
        self.setProperty("PlayersLabel", self._resolve(self.Text.message(self.strings.PLAYERS)))
        self.setProperty(
            "NowPlayingLabel",
            self._resolve(self.Text.message(self.strings.NOW_PLAYING)),
        )
        self.setProperty(
            "CardIntensityLabel",
            self._resolve(self.Text.message(self.strings.CARD_INTENSITY)),
        )
        self.setProperty(
            "GameIntensityLabel",
            self._resolve(self.Text.message(self.strings.GLOBAL_INTENSITY)),
        )
        self.setProperty(
            "SettingsLabel",
            self._resolve(self.Text.message(self.strings.SETTINGS)),
        )
        self.setProperty(
            "JoinRoomLabel",
            self._resolve(self.Text.message(self.strings.ROOM_JOIN_PROMPT)),
        )
        self.setProperty(
            "RoomCodeLabel",
            self._resolve(self.Text.message(self.strings.ROOM_CODE)),
        )
        can_go_back = self.application.state.route not in {
            self.Route.BOOTSTRAP,
            self.Route.HOME,
        }
        self.setProperty("CanGoBack", "true" if can_go_back and not active_stage else "false")
        self.setProperty(
            "HelpVisible",
            "true"
            if not active_stage
            and self.application.state.route not in {self.Route.BOOTSTRAP, self.Route.HELP}
            else "false",
        )
        self.setProperty("ActiveStage", "true" if active_stage else "false")
        self._render_facts(view.facts)
        self._render_home(view)
        self._render_pagination(view.pagination)
        self._render_lists(view)
        self._render_notification_and_confirmation()
        self._configure_navigation(view, can_go_back, active_stage)
        self._clear_pending_focus()

        if self.application.state.confirmation:
            self._queue_focus_control(CONFIRM_CANCEL)
        elif view.private_vote_choice:
            self._queue_focus_control(PRIVATE_VOTE_YES_BUTTON)
        elif force_couch_focus:
            self._queue_focus_semantic(view.preferred_focus)
        elif not route_changed and self._header_focus_still_visible(self._focused_control_id):
            pass
        else:
            keys = self._enabled_keys()
            preferred = (
                previous_focus
                if not route_changed and previous_focus in keys
                else view.preferred_focus
            )
            if not route_changed and previous_focus in keys:
                semantic = previous_focus
            else:
                semantic = self.focus.target(
                    route,
                    keys,
                    preferred,
                    previous_keys if not route_changed else (),
                )
            if semantic:
                self._queue_focus_semantic(semantic)
            elif self.application.state.busy_operation:
                self._queue_focus_control(49)
            elif self.getProperty("CanGoBack") == "true":
                self._queue_focus_control(BACK_BUTTON)
            elif self.getProperty("HelpVisible") == "true":
                self._queue_focus_control(HELP_BUTTON)
            elif active_stage:
                self._queue_focus_control(GAME_SETTINGS)
        self._last_route = route
        # Window properties do not themselves dirty a Python WindowXML on Kodi 21.
        # Defer the full-surface invalidation until the next add-on loop iteration so
        # Kodi's GUI thread never paints a partially applied property snapshot.
        self._schedule_repaint()

    def _should_force_couch_focus(self, view) -> bool:
        """Apply the Couch stage's semantic target after each completed action.

        Kodi can move focus to an enabled pager while an HTTP command temporarily
        disables the voter/action lists. Once the authoritative snapshot arrives,
        focus must follow the new game state rather than that incidental control.
        """

        state = self.application.state
        if state.route != self.Route.COUCH_GAME:
            self._last_couch_focus_context = None
            self._couch_command_pending = False
            return False
        snapshot = getattr(state, "couch_snapshot", None) or {}
        card = snapshot.get("currentCard") or {}
        context = (
            snapshot.get("revision"),
            snapshot.get("state"),
            card.get("id") or card.get("cardId"),
            tuple(snapshot.get("votedPlayerIds") or ()),
            getattr(state, "collection_page", 0),
            getattr(state, "couch_vote_player_id", None),
            getattr(state, "couch_vote_phase", "SELECT"),
        )
        busy_operation = getattr(state, "busy_operation", None)
        if busy_operation and busy_operation.startswith("couch."):
            self._couch_command_pending = True
            return False
        changed = context != self._last_couch_focus_context
        force = bool(view.preferred_focus) and (
            changed or self._couch_command_pending
        )
        self._last_couch_focus_context = context
        self._couch_command_pending = False
        return force

    def _configure_navigation(self, view, can_go_back: bool, active_stage: bool) -> None:
        pagination = view.pagination
        graph = focus_graph(
            route=self.application.state.route.value,
            view_mode=view.view_mode,
            can_go_back=can_go_back and not active_stage,
            help_visible=(
                not active_stage
                and self.application.state.route
                not in {self.Route.BOOTSTRAP, self.Route.HELP}
            ),
            has_items=bool(view.items),
            has_actions=bool(view.actions),
            previous_enabled=bool(pagination and pagination.previous_enabled),
            next_enabled=bool(pagination and pagination.next_enabled),
            active_stage=active_stage,
            confirmation_visible=bool(self.application.state.confirmation),
            has_voters=bool(view.voters),
            private_vote_choice=view.private_vote_choice,
        )
        self._navigation_graph = graph
        for control_id, neighbors in graph.items():
            control = self.getControl(control_id)
            control.setNavigation(
                self.getControl(neighbors.up),
                self.getControl(neighbors.down),
                self.getControl(neighbors.left),
                self.getControl(neighbors.right),
            )

    def _render_intensity(self, prefix: str, value: str) -> None:
        try:
            intensity = max(1, min(5, int(value)))
        except (TypeError, ValueError):
            intensity = 0
        for index in range(1, 6):
            texture = ""
            if intensity:
                texture = (
                    "partycard-tv-dot-on.png"
                    if index <= intensity
                    else "partycard-tv-dot-off.png"
                )
            self.setProperty(f"{prefix}Dot{index}", texture)

    def _render_facts(self, facts) -> None:
        self.setProperty("HasFacts", "true" if facts else "false")
        for index in range(10):
            current = facts[index] if index < len(facts) else None
            self.setProperty(
                f"Fact{index + 1}Label",
                self._resolve(current.label) if current else "",
            )
            self.setProperty(
                f"Fact{index + 1}Value",
                self._resolve(current.value) if current else "",
            )
            self.setProperty(f"Fact{index + 1}Visible", "true" if current else "false")

    def _render_home(self, view) -> None:
        self._home_actions = {}
        home_items = view.items if view.view_mode == "home" else ()
        for index, control_id in enumerate(HOME_CONTROLS):
            current = home_items[index] if index < len(home_items) else None
            suffix = index + 1
            self.setProperty(f"Home{suffix}Visible", "true" if current else "false")
            self.setProperty(f"Home{suffix}Label", self._resolve(current.label) if current else "")
            self.setProperty(
                f"Home{suffix}Secondary",
                self._resolve(current.secondary) if current else "",
            )
            self.setProperty(
                f"Home{suffix}Enabled",
                "true" if current and current.enabled else "false",
            )
            self.setProperty(
                f"Home{suffix}Danger",
                "true" if current and current.danger else "false",
            )
            if current:
                self._home_actions[control_id] = (current.key, current.enabled)

    def _render_pagination(self, pagination) -> None:
        self._pagination_actions = {}
        voter_pagination = bool(
            pagination and pagination.next_key.startswith("couch:voters:")
        )
        self.setProperty("VoterPagination", "true" if voter_pagination else "false")
        self.setProperty("HasPagination", "true" if pagination else "false")
        self.setProperty("PageStatus", self._resolve(pagination.status) if pagination else "")
        self.setProperty(
            "PagePreviousLabel",
            self._resolve(
                self.Text.message(
                    self.strings.PREVIOUS_VOTERS
                    if voter_pagination
                    else self.strings.PREVIOUS_PAGE
                )
            ),
        )
        self.setProperty(
            "PageNextLabel",
            self._resolve(
                self.Text.message(
                    self.strings.NEXT_VOTERS
                    if voter_pagination
                    else self.strings.NEXT_PAGE
                )
            ),
        )
        previous_enabled = bool(pagination and pagination.previous_enabled)
        next_enabled = bool(pagination and pagination.next_enabled)
        self.setProperty("PagePreviousEnabled", "true" if previous_enabled else "false")
        self.setProperty("PageNextEnabled", "true" if next_enabled else "false")
        if pagination:
            self._pagination_actions = {
                PAGE_PREVIOUS: (pagination.previous_key, previous_enabled),
                PAGE_NEXT: (pagination.next_key, next_enabled),
            }

    def _render_lists(self, view) -> None:
        item_control = {
            "choices": COLLECTION_LIST,
            "servers": COLLECTION_LIST,
            "groups": COLLECTION_LIST,
            "people": COLLECTION_LIST,
            "cards": COLLECTION_LIST,
            "profiles": PROFILE_LIST,
            "help": HELP_TOPIC_LIST,
            "summary": SUMMARY_ITEM_LIST,
            "settings": SETTINGS_LIST,
        }.get(view.view_mode)
        if item_control is None and view.view_mode not in {
            "home",
            "card",
            "lobby",
            "active-menu",
        }:
            item_control = COLLECTION_LIST
        if view.view_mode == "card":
            action_control = CARD_ACTION_LIST
        elif view.view_mode == "active-menu":
            action_control = COUCH_MENU_ACTION_LIST
        else:
            action_control = ACTION_LIST
        self._layout_action_control(
            action_control,
            len(view.actions),
            has_voters=bool(view.voters),
        )
        for control_id in ALL_LISTS:
            values = ()
            if control_id == item_control:
                values = view.items
            elif control_id == action_control:
                values = view.actions
            elif control_id == ROSTER_LIST:
                values = view.roster if view.view_mode == "card" else ()
            elif control_id == LOBBY_ROSTER_LIST:
                values = view.roster if view.view_mode == "lobby" else ()
            elif control_id == VOTER_LIST:
                values = view.voters
            elif control_id == RESULT_YES_LIST:
                values = view.result_yes_players
            elif control_id == RESULT_NO_LIST:
                values = view.result_no_players
            self._replace_items(control_id, values)
        self.setProperty("HasItems", "true" if view.items and item_control else "false")
        self.setProperty("HasActions", "true" if view.actions else "false")
        self.setProperty("HasRoster", "true" if view.roster else "false")

    def _layout_action_control(
        self,
        control_id: int,
        item_count: int,
        has_voters: bool = False,
    ) -> None:
        if control_id == CARD_ACTION_LIST:
            item_width = 440
            maximum = 4
            top = 872
            height = 112
        elif control_id == COUCH_MENU_ACTION_LIST:
            item_width = 410
            maximum = 4
            top = 872
            height = 106
        else:
            item_width = 550
            maximum = 3
            top = 872
            height = 106
        visible_count = max(1, min(item_count, maximum))
        width = item_width * visible_count
        control = self.getControl(control_id)
        left = (1920 - width) // 2
        if control_id == CARD_ACTION_LIST and has_voters:
            left = 1380
        control.setPosition(left, top)
        control.setWidth(width)
        control.setHeight(height)

    def _render_notification_and_confirmation(self) -> None:
        notification = self.application.state.notification
        self.setProperty("Notification", self._resolve(notification) if notification else "")
        confirmation = self.application.state.confirmation
        self.setProperty("ConfirmVisible", "true" if confirmation else "false")
        if confirmation:
            self.setProperty("ConfirmTitle", self._resolve(self.Text.message(confirmation.title_id)))
            self.setProperty("ConfirmBody", self._resolve(self.Text.message(confirmation.body_id)))
            self.setProperty("ConfirmAction", self._resolve(self.Text.message(confirmation.action_id)))
        else:
            self.setProperty("ConfirmTitle", "")
            self.setProperty("ConfirmBody", "")
            self.setProperty("ConfirmAction", "")

    def _replace_items(self, control_id: int, items: tuple) -> None:
        signatures = tuple(self._item_signature(current) for current in items)
        if signatures == self._item_signatures[control_id]:
            self._items[control_id] = items
            return
        control = self.getControl(control_id)
        control.reset()
        rows = []
        for current in items:
            row = xbmcgui.ListItem(
                label=self._resolve(current.label),
                label2=self._resolve(current.secondary),
            )
            row.setProperty("ActionId", current.key)
            row.setProperty("Enabled", "true" if current.enabled else "false")
            row.setProperty("Selected", "true" if current.selected else "false")
            row.setProperty("Danger", "true" if current.danger else "false")
            row.setProperty("Kind", current.kind)
            row.setProperty("Detail", self._resolve(current.detail))
            row.setProperty("Badge", self._resolve(current.badge))
            row.setProperty("Tint", "FFFFFFFF" if current.enabled else "66FFFFFF")
            row.setProperty("FocusTint", "FFE84769" if current.danger else "FFFFFFFF")
            rows.append(row)
        if rows:
            control.addItems(rows)
        self._items[control_id] = items
        self._item_signatures[control_id] = signatures

    def _item_signature(self, current) -> tuple:
        return (
            current.key,
            self._resolve(current.label),
            self._resolve(current.secondary),
            self._resolve(current.detail),
            self._resolve(current.badge),
            current.kind,
            current.enabled,
            current.selected,
            current.danger,
        )

    def _enabled_keys(self) -> tuple[str, ...]:
        keys = []
        for control_id in INTERACTIVE_LISTS:
            keys.extend(current.key for current in self._items[control_id] if current.enabled)
        keys.extend(key for key, enabled in self._home_actions.values() if enabled)
        keys.extend(key for key, enabled in self._pagination_actions.values() if enabled)
        return tuple(keys)

    def _semantic_for_control(self, control_id: int) -> str:
        if control_id in INTERACTIVE_LISTS:
            selected = self.getControl(control_id).getSelectedItem()
            return selected.getProperty("ActionId") if selected else ""
        if control_id in self._home_actions:
            return self._home_actions[control_id][0]
        if control_id in self._pagination_actions:
            return self._pagination_actions[control_id][0]
        return ""

    def _queue_focus_control(self, control_id: int) -> None:
        self._pending_focus_control = control_id
        self._pending_focus_semantic = ""
        self._pending_focus_attempts = 0
        self._focus_not_before = time.monotonic() + 0.04

    def _queue_focus_semantic(self, semantic: str) -> None:
        self._pending_focus_control = 0
        self._pending_focus_semantic = semantic or ""
        self._pending_focus_attempts = 0
        self._focus_not_before = time.monotonic() + 0.04

    def _apply_pending_focus(self) -> None:
        if time.monotonic() < self._focus_not_before:
            return
        control_id = self._pending_focus_control
        semantic = self._pending_focus_semantic
        if not control_id and not semantic:
            return
        if self._pending_focus_attempts >= 20:
            self._clear_pending_focus()
            return
        self._pending_focus_attempts += 1
        if control_id:
            self.setFocusId(control_id)
            self._focused_control_id = control_id
            self._schedule_repaint()
        elif not self._focus_semantic_now(semantic):
            self._clear_pending_focus()
            return
        if self._pending_focus_control or self._pending_focus_semantic:
            self._focus_not_before = time.monotonic() + 0.1

    def _focus_semantic_now(self, semantic: str) -> bool:
        if not semantic:
            if self.getProperty("HelpVisible") == "true":
                self.setFocusId(HELP_BUTTON)
                self._focused_control_id = HELP_BUTTON
                return True
            return False
        for control_id in INTERACTIVE_LISTS:
            for index, current in enumerate(self._items[control_id]):
                if current.key == semantic and current.enabled:
                    control = self.getControl(control_id)
                    self.setFocusId(control_id)
                    control.selectItem(index)
                    self._focused_control_id = control_id
                    self._schedule_repaint()
                    selected = control.getSelectedItem()
                    if selected and selected.getProperty("ActionId") == semantic:
                        self._clear_pending_focus()
                    return True
        for control_id, action_data in self._home_actions.items():
            if action_data[0] == semantic and action_data[1]:
                self.setFocusId(control_id)
                self._focused_control_id = control_id
                self._schedule_repaint()
                return True
        for control_id, action_data in self._pagination_actions.items():
            if action_data[0] == semantic and action_data[1]:
                self.setFocusId(control_id)
                self._focused_control_id = control_id
                self._schedule_repaint()
                return True
        return False

    def _schedule_repaint(self) -> None:
        self._repaint_passes_remaining = REPAINT_PASSES
        self._repaint_not_before = time.monotonic() + 0.02

    def _clear_pending_focus(self) -> None:
        self._pending_focus_control = 0
        self._pending_focus_semantic = ""
        self._pending_focus_attempts = 0

    def _header_focus_still_visible(self, control_id: int) -> bool:
        if control_id == BACK_BUTTON:
            return self.getProperty("CanGoBack") == "true"
        if control_id == HELP_BUTTON:
            return self.getProperty("HelpVisible") == "true"
        if control_id == PAGE_PREVIOUS:
            return self.getProperty("PagePreviousEnabled") == "true"
        if control_id == PAGE_NEXT:
            return self.getProperty("PageNextEnabled") == "true"
        if control_id == GAME_SETTINGS:
            return self.getProperty("ActiveStage") == "true"
        return False

    def _render_loading(self) -> None:
        self.setProperty("ClientReady", "false")
        self.setProperty("Eyebrow", self.addon.getAddonInfo("name"))
        self.setProperty("Heading", self.addon.getLocalizedString(LOADING_MESSAGE))
        for name in (
            "Body",
            "Alert",
            "ServerPill",
            "Footer",
            "Progress",
            "RoomCode",
            "JoinUrls",
            "JoinUrlStatus",
            "ResultStatus",
            "ResultYesNames",
            "ResultNoNames",
            "VotingStageLabel",
            "VotingPlayer",
            "VotingHint",
            "CardPageStatus",
            "QrPath",
            "Notification",
        ):
            self.setProperty(name, "")
        self.setProperty("ViewMode", "rows")
        self.setProperty("BackLabel", self.addon.getLocalizedString(BACK_MESSAGE))
        self.setProperty("HelpLabel", self.addon.getLocalizedString(HELP_MESSAGE))
        self.setProperty("CanGoBack", "false")
        self.setProperty("HelpVisible", "false")
        self.setProperty("ActiveStage", "false")
        self.setProperty("PassiveRoomStage", "false")
        self.setProperty("CurrentPlayerBodyVisible", "false")
        self.setProperty("ConfirmVisible", "false")
        self.setProperty("ResultVisible", "false")
        self.setProperty("HasNamedResults", "false")
        self.setProperty("HasItems", "false")
        self.setProperty("HasActions", "false")
        self.setProperty("HasFacts", "false")
        self.setProperty("HasRoster", "false")
        self.setProperty("HasVoters", "false")
        self.setProperty("HasPagination", "false")
        self.setProperty("VoterPagination", "false")
        self.setProperty("HasCardPages", "false")
        self.setProperty("CardPagePreviousEnabled", "false")
        self.setProperty("CardPageNextEnabled", "false")
        self.setProperty("CardTextFit", "short")
        self.setProperty("ResultCardTextFit", "short")
        self.setProperty("AdaptiveTone", "dark")
        self.setProperty("AtmosphereTexture", "")

    def release_runtime_inhibitors(self) -> None:
        self._set_screensaver_inhibited(False)

    def _set_screensaver_inhibited(self, inhibited: bool) -> None:
        if inhibited == self._screensaver_inhibited:
            return
        xbmc.executebuiltin(f"InhibitScreensaver({'true' if inhibited else 'false'})")
        self._screensaver_inhibited = inhibited

    def _resolve(self, value) -> str:
        if value.literal is not None:
            result = value.literal
        elif value.message_id is None:
            result = ""
        elif self.application is None or self.localizer is None:
            result = self.addon.getLocalizedString(value.message_id)
        else:
            template = self.localizer.template(
                value.message_id,
                self.application.state.preferences.locale,
                self.addon.getLocalizedString,
            )
            if not value.arguments:
                result = template
            else:
                arguments = tuple(
                    self._resolve(argument)
                    if hasattr(argument, "message_id") and hasattr(argument, "literal")
                    else argument
                    for argument in value.arguments
                )
                try:
                    result = template % arguments
                except (TypeError, ValueError):
                    result = template
        return str(result).replace("\r\n", "\n").replace("\n", "[CR]")
