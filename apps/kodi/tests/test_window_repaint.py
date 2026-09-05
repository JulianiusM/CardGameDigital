from __future__ import annotations

import importlib
import sys
import types
import unittest
import xml.etree.ElementTree as ET
from enum import Enum
from types import SimpleNamespace
from unittest.mock import patch

from support import RESOURCES_ROOT  # noqa: F401 - also adds resources to sys.path


class _FakeControl:
    def __init__(self) -> None:
        self.animation_calls = []
        self.position = None
        self.width = None
        self.height = None

    def setAnimations(self, animations) -> None:  # noqa: N802 - Kodi API name
        self.animation_calls.append(tuple(animations))

    def setPosition(self, left: int, top: int) -> None:  # noqa: N802 - Kodi API name
        self.position = (left, top)

    def setWidth(self, width: int) -> None:  # noqa: N802 - Kodi API name
        self.width = width

    def setHeight(self, height: int) -> None:  # noqa: N802 - Kodi API name
        self.height = height


class _FakeWindowXML:
    def __init__(self, *args, **kwargs) -> None:
        del args, kwargs
        self._fake_properties = {}
        self._fake_controls = {}
        self._fake_focus_id = 0
        self.close_calls = 0

    def setProperty(self, name: str, value: str) -> None:  # noqa: N802 - Kodi API name
        self._fake_properties[name] = value

    def getProperty(self, name: str) -> str:  # noqa: N802 - Kodi API name
        return self._fake_properties.get(name, "")

    def getControl(self, control_id: int):  # noqa: N802 - Kodi API name
        return self._fake_controls.setdefault(control_id, _FakeControl())

    def setFocusId(self, control_id: int) -> None:  # noqa: N802 - Kodi API name
        self._fake_focus_id = control_id

    def getFocusId(self) -> int:  # noqa: N802 - Kodi API name
        return self._fake_focus_id

    def close(self) -> None:
        self.close_calls += 1


class _FakeWindowXMLDialog(_FakeWindowXML):
    pass


class _FakeAddon:
    def __init__(self, addon_id: str) -> None:
        self.addon_id = addon_id

    def getAddonInfo(self, key: str) -> str:  # noqa: N802 - Kodi API name
        return "Party Game TV" if key == "name" else ""

    def getLocalizedString(self, message_id: int) -> str:  # noqa: N802 - Kodi API name
        return "message-%s" % message_id


_BUILTIN_CALLS = []
_JSON_RPC_CALLS = []
_XBMC = types.ModuleType("xbmc")
_XBMC.executebuiltin = _BUILTIN_CALLS.append
_XBMC.executeJSONRPC = _JSON_RPC_CALLS.append
_XBMC.Keyboard = object
_XBMCADDON = types.ModuleType("xbmcaddon")
_XBMCADDON.Addon = _FakeAddon
_XBMCGUI = types.ModuleType("xbmcgui")
_XBMCGUI.WindowXML = _FakeWindowXML
_XBMCGUI.WindowXMLDialog = _FakeWindowXMLDialog
_XBMCGUI.Action = object
_XBMCGUI.INPUT_NUMERIC = 0

with patch.dict(
    sys.modules,
    {"xbmc": _XBMC, "xbmcaddon": _XBMCADDON, "xbmcgui": _XBMCGUI},
):
    main_window = importlib.import_module("lib.screens.main_window")


class _Route(Enum):
    BOOTSTRAP = "bootstrap"
    HOME = "home"
    HELP = "help"
    COUCH_GAME = "couch-game"
    ROOM_LOBBY_DISPLAY = "room-lobby-display"
    ROOM_GAME_DISPLAY = "room-game-display"
    ROOM_SUMMARY_DISPLAY = "room-summary-display"
    ROOM_DISPLAY_MENU = "room-display-menu"


class _Text:
    @staticmethod
    def message(message_id: int) -> int:
        return message_id


class _Focus:
    @staticmethod
    def target(*args, **kwargs) -> str:
        del args, kwargs
        return ""


class WindowRepaintTests(unittest.TestCase):
    def setUp(self) -> None:
        _BUILTIN_CALLS.clear()
        _JSON_RPC_CALLS.clear()
        self.now = 100.0
        self.window = main_window.MainWindow(addon_root="test-root")
        self.window._initialized = True
        self.window.Route = _Route
        self.window.Text = _Text
        self.window.strings = SimpleNamespace(
            BACK=1,
            HELP=2,
            CANCEL=3,
            PLAYERS=4,
            NOW_PLAYING=5,
            CARD_INTENSITY=6,
            GLOBAL_INTENSITY=7,
            SETTINGS=8,
            ROOM_JOIN_PROMPT=9,
            ROOM_CODE=10,
            YES=11,
            NO=12,
            CANCEL_VOTE=13,
        )
        self.window.focus = _Focus()
        state = SimpleNamespace(
            route=_Route.BOOTSTRAP,
            confirmation=None,
            busy_operation=None,
        )
        self.window.application = SimpleNamespace(state=state, take_view=lambda: None)
        self.window._resolve = lambda value: str(value)
        self.window._render_intensity = lambda *args: None
        self.window._render_facts = lambda *args: None
        self.window._render_home = lambda *args: None
        self.window._render_pagination = lambda *args: None
        self.window._render_lists = lambda *args: None
        self.window._render_notification_and_confirmation = lambda: None
        self.window._configure_navigation = lambda *args: None
        self.view = SimpleNamespace(
            eyebrow="",
            heading="",
            body="",
            alert="",
            view_mode="rows",
            card_eyebrow="",
            card_classification="",
            card_text="",
            card_footer="",
            card_intensity="",
            game_intensity="",
            current_player="",
            atmosphere="NEUTRAL",
            result_yes="",
            result_no="",
            result_yes_names="",
            result_no_names="",
            result_yes_players=(),
            result_no_players=(),
            server_pill="",
            footer="",
            progress="",
            room_code="",
            join_urls="",
            join_url_status="",
            result_status="",
            card_page_status="",
            card_page_count=1,
            card_page_previous_enabled=False,
            card_page_next_enabled=False,
            private_vote_choice=False,
            voters=(),
            voting_stage_label="",
            voting_player="",
            voting_hint="",
            qr_path="",
            facts=(),
            pagination=None,
            preferred_focus="",
        )

    def test_three_couch_voter_cards_use_the_skin_item_width_without_clipping(self) -> None:
        self.window._layout_action_control(main_window.CARD_ACTION_LIST, 3)

        control = self.window.getControl(main_window.CARD_ACTION_LIST)
        self.assertEqual(control.width, 1320)
        self.assertEqual(control.position, (300, 872))
        self.assertEqual(control.height, 112)

    def test_four_voters_and_skip_have_separate_simultaneous_slots(self) -> None:
        self.window._layout_action_control(
            main_window.CARD_ACTION_LIST,
            1,
            has_voters=True,
        )
        action = self.window.getControl(main_window.CARD_ACTION_LIST)
        skin = ET.parse(
            RESOURCES_ROOT
            / "skins"
            / "Default"
            / "1080i"
            / "script-partycard-tv-main.xml"
        ).getroot()
        voter = skin.find(".//control[@id='63']")
        self.assertIsNotNone(voter)
        if voter is None:
            return
        voter_right = int(voter.findtext("left", "0")) + int(
            voter.findtext("width", "0")
        )

        self.assertEqual(action.position, (1380, 872))
        self.assertEqual(action.width, 440)
        self.assertLessEqual(voter_right, action.position[0])
        self.assertLessEqual(action.position[0] + action.width, 1920)

    def test_all_four_couch_lifecycle_actions_fit_without_scrolling(self) -> None:
        self.window._layout_action_control(main_window.COUCH_MENU_ACTION_LIST, 4)

        control = self.window.getControl(main_window.COUCH_MENU_ACTION_LIST)
        self.assertEqual(control.width, 1640)
        self.assertEqual(control.position, (140, 872))
        self.assertEqual(control.height, 106)

    def test_render_queues_two_delayed_and_bounded_surface_invalidations(self) -> None:
        repaint_control = self.window.getControl(main_window.REPAINT_CONTROL)

        with patch.object(main_window.time, "monotonic", side_effect=lambda: self.now):
            self.window._render(self.view)

            self.assertEqual(
                self.window._repaint_passes_remaining,
                main_window.REPAINT_PASSES,
            )
            self.assertEqual(main_window.REPAINT_PASSES, 2)
            self.assertEqual(repaint_control.animation_calls, [])

            self.now = self.window._repaint_not_before - 0.001
            self.window.render_if_changed()
            self.assertEqual(repaint_control.animation_calls, [])

            self.now = self.window._repaint_not_before
            self.window.render_if_changed()
            self.assertEqual(repaint_control.animation_calls, [()])
            self.assertEqual(self.window._repaint_passes_remaining, 1)

            self.now = self.window._repaint_not_before - 0.001
            self.window.render_if_changed()
            self.assertEqual(repaint_control.animation_calls, [()])

            self.now = self.window._repaint_not_before
            self.window.render_if_changed()
            self.assertEqual(repaint_control.animation_calls, [(), ()])
            self.assertEqual(self.window._repaint_passes_remaining, 0)

            for _ in range(5):
                self.now += main_window.REPAINT_PASS_INTERVAL_SECONDS
                self.window.render_if_changed()

        self.assertEqual(repaint_control.animation_calls, [(), ()])
        self.assertEqual(_BUILTIN_CALLS, [])
        self.assertEqual(_JSON_RPC_CALLS, [])

    def test_render_keeps_every_open_room_route_passive_and_active(self) -> None:
        with patch.object(main_window.time, "monotonic", return_value=self.now):
            for route in (
                _Route.ROOM_LOBBY_DISPLAY,
                _Route.ROOM_GAME_DISPLAY,
                _Route.ROOM_SUMMARY_DISPLAY,
            ):
                with self.subTest(route=route):
                    self.window.application.state.route = route
                    self.window._render(self.view)
                    self.assertEqual(
                        self.window.getProperty("PassiveRoomStage"),
                        "true",
                    )
                    self.assertEqual(self.window.getProperty("ActiveStage"), "true")

            self.window.application.state.route = _Route.COUCH_GAME
            self.window._render(self.view)
            self.assertEqual(self.window.getProperty("PassiveRoomStage"), "false")

    def test_ended_open_room_keeps_settings_as_its_only_stage_control(self) -> None:
        dispatched = []
        self.window.application.state.route = _Route.ROOM_SUMMARY_DISPLAY
        self.window.application.dispatch = dispatched.append

        self.window.onClick(main_window.GAME_SETTINGS)

        self.assertEqual(len(dispatched), 1)
        self.assertEqual(dispatched[0].kind, "NAVIGATE")
        self.assertEqual(dispatched[0].payload["route"], _Route.ROOM_DISPLAY_MENU)

    def test_native_focus_change_schedules_a_bounded_visual_refresh(self) -> None:
        with patch.object(main_window.time, "monotonic", return_value=self.now):
            self.window.onFocus(main_window.PAGE_NEXT)

        self.assertEqual(
            self.window._repaint_passes_remaining,
            main_window.REPAINT_PASSES,
        )
        self.assertEqual(self.window._repaint_not_before, self.now + 0.02)

    def test_exit_select_dispatches_stop_without_closing_inside_callback(self) -> None:
        confirmations = []
        self.window.application.state.confirmation = SimpleNamespace(
            confirm_action="exit-addon"
        )
        self.window.application.confirm = lambda: confirmations.append("shutdown")

        self.window.onClick(main_window.CONFIRM_ACCEPT)

        self.assertEqual(confirmations, ["shutdown"])
        self.assertEqual(self.window.close_calls, 0)
        self.assertIsInstance(self.window, _FakeWindowXMLDialog)

    def test_non_exit_confirmation_remains_immediate(self) -> None:
        confirmations = []
        self.window.application.state.confirmation = SimpleNamespace(
            confirm_action="clear-data"
        )
        self.window.application.confirm = lambda: confirmations.append("confirm")

        self.window.onClick(main_window.CONFIRM_ACCEPT)

        self.assertEqual(confirmations, ["confirm"])

    def test_private_mouse_ballot_submits_and_restores_neutral_focus(self) -> None:
        calls = []
        focused = []
        self.window.application.private_vote_shortcut = (
            lambda vote: calls.append(vote) or True
        )
        self.window.setFocusId = focused.append
        self.window._schedule_repaint = lambda: calls.append("repaint")

        self.window.onClick(main_window.PRIVATE_VOTE_YES_BUTTON)
        self.assertEqual(calls, ["YES", "repaint"])
        self.assertEqual(focused, [49])
        self.assertEqual(self.window._focused_control_id, 49)

        calls.clear()
        focused.clear()
        self.window.onClick(main_window.PRIVATE_VOTE_NO_BUTTON)
        self.assertEqual(calls, ["NO", "repaint"])
        self.assertEqual(focused, [49])

    def test_private_ballot_render_focuses_the_yes_button_for_dpad_voting(self) -> None:
        self.window.application.state.route = _Route.COUCH_GAME
        self.view.private_vote_choice = True
        self.window._focused_control_id = main_window.PRIVATE_VOTE_CANCEL_BUTTON

        with patch.object(main_window.time, "monotonic", return_value=self.now):
            self.window._render(self.view)

        self.assertEqual(self.window.getProperty("PrivateVoteChoice"), "true")
        self.assertEqual(self.window.getProperty("PrivateVoteYesLabel"), "11")
        self.assertEqual(self.window.getProperty("PrivateVoteNoLabel"), "12")
        self.assertEqual(self.window.getProperty("PrivateVoteCancelLabel"), "13")
        self.assertEqual(
            self.window._pending_focus_control,
            main_window.PRIVATE_VOTE_YES_BUTTON,
        )

    def test_completed_couch_action_overrides_incidental_pager_focus(self) -> None:
        state = self.window.application.state
        state.route = _Route.COUCH_GAME
        state.collection_page = 0
        state.couch_vote_player_id = None
        state.couch_vote_phase = "SELECT"
        state.couch_snapshot = {
            "revision": 4,
            "state": "COLLECTING_ANSWERS",
            "currentCard": {"id": "card-one"},
            "votedPlayerIds": [],
        }
        self.view.preferred_focus = "couch:vote-player:alex"

        with patch.object(main_window.time, "monotonic", return_value=self.now):
            self.window._render(self.view)
        self.assertEqual(
            self.window._pending_focus_semantic,
            "couch:vote-player:alex",
        )

        state.busy_operation = "couch.skip"
        self.window._focused_control_id = main_window.PAGE_NEXT
        with patch.object(main_window.time, "monotonic", return_value=self.now):
            self.window._render(self.view)

        state.busy_operation = None
        state.couch_snapshot = {
            **state.couch_snapshot,
            "revision": 5,
            "currentCard": {"id": "card-two"},
        }
        self.view.preferred_focus = "couch:vote-player:bea"
        with patch.object(main_window.time, "monotonic", return_value=self.now):
            self.window._render(self.view)

        self.assertEqual(
            self.window._pending_focus_semantic,
            "couch:vote-player:bea",
        )

    def test_completed_voter_page_moves_focus_to_next_voters(self) -> None:
        state = self.window.application.state
        state.route = _Route.COUCH_GAME
        state.collection_page = 0
        state.couch_vote_player_id = None
        state.couch_vote_phase = "SELECT"
        state.couch_snapshot = {
            "revision": 8,
            "state": "COLLECTING_ANSWERS",
            "currentCard": {"id": "card"},
            "votedPlayerIds": ["alex", "bea", "chris", "devon"],
        }
        self.window._last_couch_focus_context = (
            7,
            "COLLECTING_ANSWERS",
            "card",
            ("alex", "bea", "chris"),
            0,
            None,
            "SELECT",
        )
        self.window._last_route = _Route.COUCH_GAME.value
        self.window._focused_control_id = main_window.PAGE_NEXT
        self.view.preferred_focus = "couch:voters:page-next"

        with patch.object(main_window.time, "monotonic", return_value=self.now):
            self.window._render(self.view)

        self.assertEqual(
            self.window._pending_focus_semantic,
            "couch:voters:page-next",
        )

    def test_private_ballot_cancel_returns_to_the_card(self) -> None:
        calls = []
        self.window.application.activate = calls.append

        self.window.onClick(main_window.PRIVATE_VOTE_CANCEL_BUTTON)

        self.assertEqual(calls, ["couch:vote-cancel"])

    def test_directional_focus_guard_recovers_a_delayed_native_focus_loss(self) -> None:
        target = main_window.PROFILE_LIST
        self.window._focused_control_id = main_window.PAGE_NEXT
        self.window._navigation_graph = {
            main_window.PAGE_NEXT: main_window.focus_graph(
                route="SETUP_PROFILE",
                view_mode="profiles",
                can_go_back=True,
                help_visible=True,
                has_items=True,
                has_actions=False,
                previous_enabled=True,
                next_enabled=True,
                active_stage=False,
                confirmation_visible=False,
            )[main_window.PAGE_NEXT]
        }
        self.window._fake_focus_id = target
        self.window._semantic_for_control = lambda control_id: ""

        with patch.object(main_window.time, "monotonic", side_effect=lambda: self.now):
            self.window._repair_native_directional_focus(main_window.MOVE_UP_ACTION)
            self.assertEqual(self.window._focus_guard_control, target)
            self.assertEqual(self.window._pending_focus_control, 0)

            self.window._fake_focus_id = 0
            self.now += 0.05
            self.window._repair_recent_focus_loss(self.now)

        self.assertEqual(self.window._pending_focus_control, target)
        self.assertEqual(self.window._focus_guard_control, 0)

    def test_directional_focus_guard_expires_without_restoring_focus(self) -> None:
        target = main_window.PROFILE_LIST
        self.window._semantic_for_control = lambda control_id: ""

        with patch.object(main_window.time, "monotonic", side_effect=lambda: self.now):
            self.window._arm_focus_guard(target)
            self.window._fake_focus_id = 0
            self.now += main_window.FOCUS_STABILITY_SECONDS + 0.01
            self.window._repair_recent_focus_loss(self.now)

        self.assertEqual(self.window._pending_focus_control, 0)
        self.assertEqual(self.window._focus_guard_control, 0)


if __name__ == "__main__":
    unittest.main()
