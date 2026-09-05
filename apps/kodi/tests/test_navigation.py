from __future__ import annotations

import unittest
import xml.etree.ElementTree as ET

from support import RESOURCES_ROOT
from lib.navigation import (
    ACTION_LIST,
    BACK_BUTTON,
    CARD_ACTION_LIST,
    COLLECTION_LIST,
    COUCH_MENU_ACTION_LIST,
    CONFIRM_ACCEPT,
    CONFIRM_CANCEL,
    HELP_BUTTON,
    HELP_TOPIC_LIST,
    HOME_CONTROLS,
    GAME_SETTINGS,
    PAGE_NEXT,
    PAGE_PREVIOUS,
    PROFILE_LIST,
    PRIVATE_VOTE_CANCEL,
    PRIVATE_VOTE_NO,
    PRIVATE_VOTE_YES,
    SETTINGS_LIST,
    VOTER_LIST,
    MOVE_DOWN_ACTION,
    MOVE_UP_ACTION,
    Neighbors,
    focus_graph,
    section_focus_repair_target,
)


def graph_for(**overrides):
    arguments = {
        "route": "SETUP_CUSTOMIZE",
        "view_mode": "collection",
        "can_go_back": True,
        "help_visible": True,
        "has_items": True,
        "has_actions": True,
        "previous_enabled": True,
        "next_enabled": True,
        "active_stage": False,
        "confirmation_visible": False,
    }
    arguments.update(overrides)
    return focus_graph(**arguments)


class NavigationGraphTests(unittest.TestCase):
    def test_general_pages_follow_content_pagination_actions_and_header(self) -> None:
        graph = graph_for()

        self.assertEqual(
            graph[BACK_BUTTON],
            Neighbors(ACTION_LIST, COLLECTION_LIST, HELP_BUTTON, HELP_BUTTON),
        )
        self.assertEqual(
            graph[HELP_BUTTON],
            Neighbors(ACTION_LIST, COLLECTION_LIST, BACK_BUTTON, BACK_BUTTON),
        )
        self.assertEqual(
            graph[COLLECTION_LIST],
            Neighbors(BACK_BUTTON, PAGE_NEXT, COLLECTION_LIST, COLLECTION_LIST),
        )
        self.assertEqual(
            graph[PAGE_NEXT],
            Neighbors(COLLECTION_LIST, ACTION_LIST, PAGE_PREVIOUS, PAGE_PREVIOUS),
        )
        self.assertEqual(
            graph[PAGE_PREVIOUS],
            Neighbors(COLLECTION_LIST, ACTION_LIST, PAGE_NEXT, PAGE_NEXT),
        )
        self.assertEqual(
            graph[ACTION_LIST],
            Neighbors(PAGE_NEXT, BACK_BUTTON, ACTION_LIST, ACTION_LIST),
        )

    def test_last_settings_page_uses_previous_as_its_pagination_row(self) -> None:
        graph = graph_for(
            route="PREFERENCES",
            view_mode="settings",
            next_enabled=False,
        )

        self.assertEqual(graph[SETTINGS_LIST].down, PAGE_PREVIOUS)
        self.assertEqual(graph[PAGE_PREVIOUS].up, SETTINGS_LIST)
        self.assertEqual(graph[PAGE_PREVIOUS].down, ACTION_LIST)
        self.assertEqual(graph[ACTION_LIST].up, PAGE_PREVIOUS)

    def test_profile_cards_use_their_full_width_content_control(self) -> None:
        graph = graph_for(view_mode="profiles", has_actions=False)

        self.assertEqual(graph[PROFILE_LIST].up, BACK_BUTTON)
        self.assertEqual(graph[PROFILE_LIST].down, PAGE_NEXT)
        self.assertEqual(graph[PAGE_NEXT].up, PROFILE_LIST)

    def test_lost_focus_from_next_page_repairs_to_profile_cards(self) -> None:
        graph = graph_for(view_mode="profiles", has_actions=False)

        self.assertEqual(
            section_focus_repair_target(
                graph,
                last_control=PAGE_NEXT,
                current_control=0,
                action_id=MOVE_UP_ACTION,
                internal_controls=(COLLECTION_LIST, PROFILE_LIST),
            ),
            PROFILE_LIST,
        )

    def test_existing_native_focus_is_never_redirected(self) -> None:
        graph = graph_for(view_mode="profiles", has_actions=False)

        self.assertIsNone(
            section_focus_repair_target(
                graph,
                last_control=PAGE_NEXT,
                current_control=BACK_BUTTON,
                action_id=MOVE_UP_ACTION,
                internal_controls=(COLLECTION_LIST, PROFILE_LIST),
            )
        )

    def test_successful_fixed_transition_and_native_list_movement_are_preserved(self) -> None:
        graph = graph_for(view_mode="profiles", has_actions=False)

        self.assertIsNone(
            section_focus_repair_target(
                graph,
                last_control=PAGE_NEXT,
                current_control=PROFILE_LIST,
                action_id=MOVE_UP_ACTION,
                internal_controls=(COLLECTION_LIST, PROFILE_LIST),
            )
        )
        self.assertIsNone(
            section_focus_repair_target(
                graph,
                last_control=COLLECTION_LIST,
                current_control=COLLECTION_LIST,
                action_id=MOVE_DOWN_ACTION,
                internal_controls=(COLLECTION_LIST, PROFILE_LIST),
            )
        )

    def test_page_without_pagination_moves_directly_between_content_and_actions(self) -> None:
        graph = graph_for(previous_enabled=False, next_enabled=False)

        self.assertEqual(graph[COLLECTION_LIST].down, ACTION_LIST)
        self.assertEqual(graph[ACTION_LIST].up, COLLECTION_LIST)

    def test_couch_menu_uses_its_four_action_bar_without_hidden_paging(self) -> None:
        graph = graph_for(
            route="COUCH_MENU",
            view_mode="active-menu",
            has_items=False,
            previous_enabled=False,
            next_enabled=False,
        )

        self.assertEqual(
            graph[BACK_BUTTON],
            Neighbors(
                COUCH_MENU_ACTION_LIST,
                COUCH_MENU_ACTION_LIST,
                HELP_BUTTON,
                HELP_BUTTON,
            ),
        )
        self.assertEqual(
            graph[COUCH_MENU_ACTION_LIST],
            Neighbors(
                BACK_BUTTON,
                BACK_BUTTON,
                COUCH_MENU_ACTION_LIST,
                COUCH_MENU_ACTION_LIST,
            ),
        )

    def test_home_help_header_returns_focus_to_the_main_menu_grid(self) -> None:
        graph = graph_for(
            route="HOME",
            view_mode="home",
            can_go_back=False,
            has_actions=False,
            previous_enabled=False,
            next_enabled=False,
        )

        self.assertEqual(
            graph[HELP_BUTTON],
            Neighbors(HOME_CONTROLS[0], HOME_CONTROLS[0], HELP_BUTTON, HELP_BUTTON),
        )

    def test_help_uses_horizontal_page_access_and_visual_vertical_neighbors(self) -> None:
        graph = graph_for(route="HELP", view_mode="help")

        self.assertEqual(graph[BACK_BUTTON].down, HELP_TOPIC_LIST)
        self.assertEqual(graph[HELP_TOPIC_LIST].up, BACK_BUTTON)
        self.assertEqual(graph[HELP_TOPIC_LIST].left, PAGE_PREVIOUS)
        self.assertEqual(graph[HELP_TOPIC_LIST].right, PAGE_NEXT)
        self.assertEqual(graph[PAGE_PREVIOUS].up, HELP_TOPIC_LIST)
        self.assertEqual(graph[PAGE_PREVIOUS].down, BACK_BUTTON)
        self.assertEqual(graph[PAGE_PREVIOUS].right, HELP_TOPIC_LIST)
        self.assertEqual(graph[PAGE_NEXT].up, HELP_TOPIC_LIST)
        self.assertEqual(graph[PAGE_NEXT].down, BACK_BUTTON)
        self.assertEqual(graph[PAGE_NEXT].left, HELP_TOPIC_LIST)

    def test_first_help_page_reaches_back_with_one_left_press(self) -> None:
        graph = graph_for(
            route="HELP",
            view_mode="help",
            previous_enabled=False,
            next_enabled=True,
        )

        self.assertEqual(graph[HELP_TOPIC_LIST].left, BACK_BUTTON)
        self.assertEqual(graph[HELP_TOPIC_LIST].right, PAGE_NEXT)

    def test_confirmation_keeps_cancel_as_a_separate_default_focus_target(self) -> None:
        graph = graph_for(confirmation_visible=True)

        self.assertEqual(set(graph), {CONFIRM_CANCEL, CONFIRM_ACCEPT})
        self.assertEqual(graph[CONFIRM_CANCEL].right, CONFIRM_ACCEPT)
        self.assertEqual(graph[CONFIRM_ACCEPT].left, CONFIRM_CANCEL)

    def test_couch_stage_places_pagination_between_settings_and_actions(self) -> None:
        graph = graph_for(
            route="COUCH_GAME",
            view_mode="card",
            can_go_back=False,
            help_visible=False,
            has_items=False,
            active_stage=True,
        )

        self.assertEqual(graph[GAME_SETTINGS].down, PAGE_NEXT)
        self.assertEqual(graph[PAGE_NEXT].up, GAME_SETTINGS)
        self.assertEqual(graph[PAGE_NEXT].down, CARD_ACTION_LIST)
        self.assertEqual(graph[CARD_ACTION_LIST].up, PAGE_NEXT)
        self.assertEqual(graph[CARD_ACTION_LIST].down, GAME_SETTINGS)

    def test_couch_voter_stage_keeps_voters_and_skip_in_one_dpad_row(self) -> None:
        graph = graph_for(
            route="COUCH_GAME",
            view_mode="card",
            can_go_back=False,
            help_visible=False,
            has_items=False,
            active_stage=True,
            has_voters=True,
        )

        self.assertEqual(graph[GAME_SETTINGS].down, PAGE_NEXT)
        self.assertEqual(graph[PAGE_NEXT].down, VOTER_LIST)
        self.assertEqual(graph[VOTER_LIST].up, PAGE_NEXT)
        self.assertEqual(graph[VOTER_LIST].right, CARD_ACTION_LIST)
        self.assertEqual(graph[VOTER_LIST].left, CARD_ACTION_LIST)
        self.assertEqual(graph[CARD_ACTION_LIST].left, VOTER_LIST)
        self.assertEqual(graph[CARD_ACTION_LIST].right, VOTER_LIST)
        self.assertEqual(graph[VOTER_LIST].down, GAME_SETTINGS)
        self.assertEqual(graph[CARD_ACTION_LIST].up, PAGE_NEXT)
        self.assertEqual(graph[CARD_ACTION_LIST].down, GAME_SETTINGS)

    def test_single_voter_page_flows_directly_to_voters_and_skip(self) -> None:
        graph = graph_for(
            route="COUCH_GAME",
            view_mode="card",
            can_go_back=False,
            help_visible=False,
            has_items=False,
            active_stage=True,
            has_voters=True,
            previous_enabled=False,
            next_enabled=False,
        )

        self.assertEqual(graph[GAME_SETTINGS].down, VOTER_LIST)
        self.assertEqual(graph[VOTER_LIST].up, GAME_SETTINGS)
        self.assertEqual(graph[VOTER_LIST].right, CARD_ACTION_LIST)
        self.assertEqual(graph[CARD_ACTION_LIST].left, VOTER_LIST)
        self.assertEqual(graph[VOTER_LIST].down, GAME_SETTINGS)
        self.assertEqual(graph[CARD_ACTION_LIST].up, GAME_SETTINGS)

    def test_private_vote_buttons_are_a_complete_dpad_loop(self) -> None:
        graph = graph_for(
            route="COUCH_GAME",
            view_mode="card",
            can_go_back=False,
            help_visible=False,
            has_items=False,
            has_actions=False,
            active_stage=True,
            previous_enabled=False,
            next_enabled=False,
            private_vote_choice=True,
        )

        self.assertEqual(
            set(graph),
            {
                GAME_SETTINGS,
                PRIVATE_VOTE_CANCEL,
                PRIVATE_VOTE_YES,
                PRIVATE_VOTE_NO,
            },
        )
        self.assertEqual(graph[GAME_SETTINGS].down, PRIVATE_VOTE_YES)
        self.assertEqual(graph[PRIVATE_VOTE_YES].left, PRIVATE_VOTE_CANCEL)
        self.assertEqual(graph[PRIVATE_VOTE_YES].right, PRIVATE_VOTE_NO)
        self.assertEqual(graph[PRIVATE_VOTE_CANCEL].right, PRIVATE_VOTE_YES)
        self.assertEqual(graph[PRIVATE_VOTE_NO].left, PRIVATE_VOTE_YES)

    def test_xml_fallback_keeps_pagination_between_content_and_actions(self) -> None:
        skin = ET.parse(
            RESOURCES_ROOT
            / "skins"
            / "Default"
            / "1080i"
            / "script-partycard-tv-main.xml"
        ).getroot()

        def direction(control_id: int, name: str) -> str:
            control = skin.find(f".//control[@id='{control_id}']")
            self.assertIsNotNone(control)
            element = control.find(name)
            self.assertIsNotNone(element)
            return element.text or ""

        self.assertEqual(direction(COLLECTION_LIST, "ondown"), str(PAGE_NEXT))
        self.assertEqual(direction(SETTINGS_LIST, "ondown"), str(PAGE_NEXT))
        self.assertEqual(direction(PROFILE_LIST, "ondown"), str(PAGE_NEXT))
        self.assertEqual(direction(PAGE_PREVIOUS, "onup"), str(COLLECTION_LIST))
        self.assertEqual(direction(PAGE_NEXT, "onup"), str(COLLECTION_LIST))
        self.assertEqual(direction(PAGE_PREVIOUS, "ondown"), str(ACTION_LIST))
        self.assertEqual(direction(PAGE_NEXT, "ondown"), str(ACTION_LIST))
        self.assertEqual(direction(VOTER_LIST, "onleft"), str(CARD_ACTION_LIST))
        self.assertEqual(direction(VOTER_LIST, "onright"), str(CARD_ACTION_LIST))
        self.assertEqual(direction(CARD_ACTION_LIST, "onleft"), str(VOTER_LIST))
        self.assertEqual(direction(CARD_ACTION_LIST, "onright"), str(VOTER_LIST))
        self.assertEqual(direction(VOTER_LIST, "ondown"), str(GAME_SETTINGS))
        self.assertEqual(direction(CARD_ACTION_LIST, "ondown"), str(GAME_SETTINGS))

        couch_menu = skin.find(f".//control[@id='{COUCH_MENU_ACTION_LIST}']")
        self.assertIsNotNone(couch_menu)
        self.assertEqual(couch_menu.find("itemlayout").attrib["width"], "410")
        self.assertIn(
            "String.IsEqual(Window.Property(ViewMode),active-menu)",
            couch_menu.findtext("visible", default=""),
        )

    def test_window_uses_native_navigation_with_scoped_section_repair(self) -> None:
        source = (
            RESOURCES_ROOT / "lib" / "screens" / "main_window.py"
        ).read_text(encoding="utf-8")

        self.assertIn("control.setNavigation(", source)
        self.assertIn("section_focus_repair_target(", source)
        self.assertIn("_repair_native_directional_focus(action_id)", source)
        self.assertNotIn("_previous_focused_control_id", source)
        self.assertNotIn("_redirect_content_exit_to_pagination", source)
        self.assertNotIn("_focus_help_pagination", source)


if __name__ == "__main__":
    unittest.main()
