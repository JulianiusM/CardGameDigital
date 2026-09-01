from __future__ import annotations

import unittest
import xml.etree.ElementTree as ET
from dataclasses import replace

from support import RESOURCES_ROOT
from lib.focus import FocusCoordinator
from lib.layout import adaptive_tone, card_text_fit, result_card_text_fit
from lib.presentation import COLLECTION_PAGE_SIZE, present
from lib.routes import Route
from lib.state import AppState, Preferences, ServerRecord, initial_setup
from lib import strings


PROFILE = {
    "id": "PROFILE_FRIENDS",
    "name": "Friends",
    "description": "Friendly",
    "requiresAdultConfirmation": False,
    "enabledQuestionCategoryIds": ["CAT_EVERYDAY"],
    "enabledDareTypeIds": ["DARE_SILLY"],
    "blockedOperationalFlags": [],
    "maximumSocialSensitivity": "PERSONAL",
    "startingIntensity": 1,
    "maximumIntensity": 3,
    "intensityProgressionUnit": "CARDS",
    "intensityProgressionInterval": 2,
    "intensityProgressionIncrement": 1,
    "randomQuestionRatio": 0.6,
    "maximumTypeStreak": 3,
    "letsTalkMetaInterval": 5,
}
SERVER = ServerRecord("server", "http://192.168.1.2:3000", "Party", "local", "manual", 1)


class FocusAndPresentationTests(unittest.TestCase):
    def test_card_rule_selectors_expose_all_and_none_outside_the_item_page(self) -> None:
        taxonomy = {
            "questionCategories": [
                {"id": f"CAT_{index}", "label": f"Category {index}"}
                for index in range(8)
            ],
            "dareTypes": [
                {"id": f"DARE_{index}", "label": f"Dare {index}"}
                for index in range(8)
            ],
        }
        setup = initial_setup("COUCH", (PROFILE,), "en-GB", True)
        for route, expected_prefix in (
            (Route.SETUP_CATEGORIES, "setup:question"),
            (Route.SETUP_DARES, "setup:dare"),
            (Route.SETUP_FLAGS, "setup:flag"),
        ):
            with self.subTest(route=route):
                view = present(AppState(route=route, setup=setup, taxonomy=taxonomy))
                self.assertEqual(
                    [entry.key for entry in view.actions],
                    [f"{expected_prefix}:all", f"{expected_prefix}:none", "nav:back"],
                )

        rule_id = "00000000-0000-4000-8000-000000000001"
        rule_setup = replace(
            setup,
            card_policy={
                "scopeDefault": {},
                "conditionalRules": [
                    {
                        "id": rule_id,
                        "name": "Every topic",
                        "order": 0,
                        "enabled": True,
                        "predicate": {},
                        "directives": {},
                    }
                ],
                "exactCards": [],
            },
            selected_rule_id=rule_id,
            policy_facet="questionCategoryIds",
        )
        facet = present(
            AppState(
                route=Route.SETUP_POLICY_VALUES,
                setup=rule_setup,
                taxonomy=taxonomy,
            )
        )
        self.assertEqual(len(facet.items), COLLECTION_PAGE_SIZE)
        self.assertIsNotNone(facet.pagination)
        self.assertEqual(
            [entry.key for entry in facet.actions],
            ["setup:predicate:all", "setup:predicate:none", "nav:back"],
        )

    def test_exact_card_search_keeps_the_complete_page_count_on_every_cursor_page(self) -> None:
        setup = initial_setup("COUCH", (PROFILE,), "en-GB", True)
        cards = tuple(
            {
                "id": f"00000000-0000-4000-8000-{index:012d}",
                "text": f"Search result {index}",
            }
            for index in range(COLLECTION_PAGE_SIZE)
        )
        complete_total = COLLECTION_PAGE_SIZE * 3 + 1
        cursors = tuple(
            f"10000000-0000-4000-8000-{index:012d}" for index in range(3)
        )
        for page in range(4):
            current = replace(
                setup,
                card_search_results=cards[:1] if page == 3 else cards,
                card_search_cursor_history=(None, *cursors[: max(0, page - 1)])
                if page
                else (),
                card_search_next_cursor=cursors[page] if page < 3 else None,
                card_search_total=complete_total,
            )
            view = present(AppState(route=Route.SETUP_EXACT_CARDS, setup=current))
            self.assertIsNotNone(view.pagination)
            self.assertEqual(view.pagination.status.message_id, strings.PAGE_STATUS)
            self.assertEqual(view.pagination.status.arguments, (page + 1, 4))

    def test_intensity_numeric_card_uses_the_compact_range_hint(self) -> None:
        setup = initial_setup("COUCH", (PROFILE,), "en-GB", True)
        view = present(AppState(route=Route.SETUP_INTENSITY, setup=setup))
        interval = next(
            entry
            for entry in view.items
            if entry.key == "setup:value:intensityProgressionInterval"
        )
        self.assertEqual(interval.detail.message_id, strings.NUMBER_RANGE)
        self.assertEqual(interval.detail.arguments, (1, 100))

    def test_skin_distinguishes_focus_from_selection_and_uses_one_neutral_home_surface(self) -> None:
        skin = ET.parse(
            RESOURCES_ROOT / "skins" / "Default" / "1080i" / "script-partycard-tv-main.xml"
        ).getroot()
        couch = skin.find(".//control[@id='100']/texturenofocus")
        host = skin.find(".//control[@id='101']/texturenofocus")
        self.assertEqual(couch.text, "partycard-tv-button.png")
        self.assertEqual(host.text, "partycard-tv-button.png")
        collection = skin.find(".//control[@id='53']")
        focused_visibility = [
            value.text or ""
            for value in collection.findall("./focusedlayout//visible")
        ]
        self.assertIn("Control.HasFocus(53)", focused_visibility)
        self.assertTrue(
            any(
                (texture.text or "") == "partycard-tv-selected.png"
                for texture in collection.findall(".//texture")
            )
        )

    def test_focus_restores_semantic_item_after_live_list_reorder(self) -> None:
        focus = FocusCoordinator()
        focus.remember("servers", "server:b")
        self.assertEqual(focus.target("servers", ("server:c", "server:b", "server:a")), "server:b")
        self.assertEqual(focus.target("servers", ("server:c", "server:a"), "server:a"), "server:a")
        self.assertEqual(focus.nearest(8, 3), 2)
        focus.remember("servers", "server:b")
        self.assertEqual(
            focus.target(
                "servers",
                ("server:a", "server:c"),
                "server:a",
                ("server:a", "server:b", "server:c"),
            ),
            "server:c",
        )

    def test_every_setup_route_has_unique_remote_actions(self) -> None:
        setup = initial_setup("COUCH", (PROFILE,), "de-DE", True)
        taxonomy = {
            "questionCategories": [{"id": "CAT_EVERYDAY", "label": "Everyday"}],
            "dareTypes": [{"id": "DARE_SILLY", "label": "Silly"}],
        }
        routes = [
            Route.SETUP_GROUP,
            Route.SETUP_MODE,
            Route.SETUP_PROFILE,
            Route.SETUP_PLAYERS,
            Route.SETUP_CUSTOMIZE,
            Route.SETUP_CATEGORIES,
            Route.SETUP_DARES,
            Route.SETUP_FLAGS,
            Route.SETUP_INTENSITY,
            Route.SETUP_MODE_OPTIONS,
            Route.SETUP_OPTIONS,
            Route.SETUP_CARD_LANGUAGE,
            Route.SETUP_CARD_LANGUAGE_PRIMARY,
            Route.SETUP_CARD_LANGUAGE_FALLBACKS,
            Route.SETUP_CARD_LANGUAGE_FALLBACK_ADD,
            Route.SETUP_CARD_LANGUAGE_FALLBACK,
            Route.SETUP_CARD_POLICY,
            Route.SETUP_POLICY_DEFAULT,
            Route.SETUP_POLICY_RULES,
            Route.SETUP_REVIEW,
        ]
        for route in routes:
            with self.subTest(route=route):
                view = present(
                    AppState(
                        route=route,
                        setup=setup,
                        profiles=(PROFILE,),
                        locales=({"id": "de-DE", "nativeName": "Deutsch"},),
                        taxonomy=taxonomy,
                        servers=(SERVER,),
                        selected_server_id=SERVER.server_id,
                    )
                )
                interactive = (*view.items, *view.actions)
                keys = [entry.key for entry in interactive]
                self.assertEqual(len(keys), len(set(keys)))
                self.assertTrue(any(entry.enabled for entry in interactive))

        rule = {
            "id": "00000000-0000-4000-8000-000000000001",
            "name": "Questions",
            "order": 0,
            "enabled": True,
            "predicate": {"cardTypes": ["QUESTION"]},
            "directives": {"availability": "INCLUDE"},
        }
        policy_setup = replace(
            setup,
            card_policy={
                "scopeDefault": {},
                "conditionalRules": [rule],
                "exactCards": [],
            },
            selected_rule_id=rule["id"],
            policy_facet="cardTypes",
            card_search_results=(
                {
                    "id": "00000000-0000-4000-8000-000000000002",
                    "text": "Question",
                },
            ),
        )
        policy_routes = (
            Route.SETUP_POLICY_RULE,
            Route.SETUP_POLICY_PREDICATE,
            Route.SETUP_POLICY_VALUES,
            Route.SETUP_POLICY_DIRECTIVES,
            Route.SETUP_EXACT_CARDS,
        )
        for route in policy_routes:
            with self.subTest(route=route):
                view = present(
                    AppState(route=route, setup=policy_setup, taxonomy=taxonomy)
                )
                keys = [entry.key for entry in view.items]
                self.assertEqual(len(keys), len(set(keys)))
                self.assertTrue(any(entry.enabled for entry in view.items))
                if route == Route.SETUP_EXACT_CARDS:
                    card = next(entry for entry in view.items if entry.key.startswith("setup:card:edit:"))
                    self.assertEqual(card.label.literal, "Question")

    def test_hosted_display_has_no_gameplay_action_even_with_active_card(self) -> None:
        room = type(
            "Room",
            (),
            {"room_code": "ABC234"},
        )()
        snapshot = {
            "hostStatus": {"state": "CONNECTED", "displayName": "Alex"},
            "participants": [{"displayName": "Alex"}, {"displayName": "TV"}],
            "session": {
                "state": "SHOWING_CARD",
                "currentCard": {"cardText": "A public Card", "cardType": "QUESTION"},
                "remainingCardCount": 12,
            },
        }
        state = AppState(
            route=Route.ROOM_GAME_DISPLAY,
            active_room=room,
            room_snapshot=snapshot,
        )
        view = present(state)
        self.assertEqual(view.items, ())
        self.assertEqual(view.view_mode, "card")

    def test_group_lists_are_bounded_and_remotely_paged(self) -> None:
        groups = tuple(
            {
                "id": f"00000000-0000-4000-8000-{index:012d}",
                "name": f"Group {index}",
                "members": [],
            }
            for index in range(14)
        )
        view = present(
            AppState(
                route=Route.GROUP_LIST,
                groups=groups,
                collection_page=1,
            )
        )
        group_entries = [entry for entry in view.items if entry.key.startswith("group:continue:")]
        self.assertEqual(len(group_entries), COLLECTION_PAGE_SIZE)
        self.assertTrue(all(entry.kind == "group" for entry in group_entries))
        self.assertIsNotNone(view.pagination)
        self.assertEqual(view.pagination.previous_key, "group:page-previous")
        self.assertEqual(view.pagination.next_key, "group:page-next")
        self.assertFalse(
            any(entry.key.startswith("group:page-") for entry in view.items)
        )

    def test_group_editor_pages_members_and_identifies_updates(self) -> None:
        view = present(
            AppState(
                route=Route.GROUP_CREATE,
                group_draft_id="00000000-0000-4000-8000-000000000001",
                group_draft_name="Friends",
                group_draft_members=tuple(f"Player {index}" for index in range(12)),
                collection_page=1,
            )
        )
        self.assertEqual(view.heading.message_id, strings.EDIT_GROUP)
        member_rows = [
            entry for entry in view.items if entry.key.startswith("group:member-open:")
        ]
        self.assertEqual(len(member_rows), COLLECTION_PAGE_SIZE - 1)
        self.assertEqual(member_rows[0].key, "group:member-open:3")
        self.assertIsNotNone(view.pagination)
        self.assertEqual(view.pagination.next_key, "group:member:page-next")
        self.assertFalse(
            any(entry.key.startswith("group:member:page-") for entry in view.items)
        )
        save = next(entry for entry in view.actions if entry.key == "group:save")
        self.assertEqual(save.label.message_id, strings.UPDATE_GROUP)

    def test_server_rules_and_players_render_only_one_remote_page(self) -> None:
        servers = tuple(
            ServerRecord(str(index), f"https://server-{index}.example", f"Server {index}", "public", "saved", 1)
            for index in range(14)
        )
        server_view = present(
            AppState(route=Route.SERVER_LIST, servers=servers, collection_page=1)
        )
        self.assertEqual(
            len([entry for entry in server_view.items if entry.key.startswith("server:select:")]),
            COLLECTION_PAGE_SIZE,
        )

        setup = initial_setup("COUCH", (PROFILE,), "en-GB", True)
        rules = [
            {
                "id": f"00000000-0000-4000-8000-{index:012d}",
                "name": f"Rule {index}",
                "order": index,
                "enabled": True,
                "predicate": {},
                "directives": {},
            }
            for index in range(14)
        ]
        setup = replace(
            setup,
            players=tuple(f"Player {index}" for index in range(10)),
            card_policy={
                "scopeDefault": {},
                "conditionalRules": rules,
                "exactCards": [],
            },
        )
        rule_view = present(
            AppState(route=Route.SETUP_POLICY_RULES, setup=setup, collection_page=1)
        )
        player_view = present(
            AppState(route=Route.SETUP_PLAYERS, setup=setup, collection_page=1)
        )
        self.assertEqual(
            len([entry for entry in rule_view.items if entry.key.startswith("setup:rule:edit:")]),
            COLLECTION_PAGE_SIZE,
        )
        self.assertEqual(
            len([entry for entry in player_view.items if entry.key.startswith("setup:player:open:")]),
            4,
        )

    def test_named_results_and_room_rosters_auto_page_without_overlap(self) -> None:
        answers = [
            {
                "playerId": f"00000000-0000-4000-8000-{index:012d}",
                "displayName": f"Player {index}",
                "vote": "YES" if index % 2 == 0 else "NO",
            }
            for index in range(12)
        ]
        couch_view = present(
            AppState(
                route=Route.COUCH_GAME,
                auto_page=1,
                couch_snapshot={
                    "state": "SHOWING_RESULTS",
                    "players": [],
                    "neverHaveIEverVoting": {
                        "revealMode": "NAMED_ANSWERS",
                        "progress": [],
                        "result": {
                            "yes": 6,
                            "no": 6,
                            "total": 12,
                            "namedAnswers": answers,
                        },
                    },
                },
            )
        )
        self.assertEqual(couch_view.body.literal, "")
        self.assertEqual(couch_view.result_yes.arguments, (6,))
        self.assertIn("Player 10", couch_view.result_yes_names.literal)
        self.assertNotIn("Player 0", couch_view.result_yes_names.literal)

        players = [
            {"id": str(index), "name": f"Player {index}"}
            for index in range(8)
        ]
        room = type("Room", (), {"room_code": "ABC234"})()
        room_view = present(
            AppState(
                route=Route.ROOM_GAME_DISPLAY,
                auto_page=1,
                active_room=room,
                room_snapshot={
                    "participants": [],
                    "hostStatus": {"state": "CONNECTED", "displayName": "Host"},
                    "session": {
                        "state": "SHOWING_CARD",
                        "players": players,
                        "activePlayer": players[0],
                        "roundNumber": 2,
                        "cardsShown": 3,
                        "remainingCardCount": 10,
                        "currentCard": {"cardText": "Card", "cardType": "QUESTION"},
                        "neverHaveIEverVoting": None,
                    },
                },
            )
        )
        roster_names = [entry.label.literal for entry in room_view.roster]
        self.assertEqual(roster_names, ["Player 5", "Player 6", "Player 7"])
        self.assertNotIn("Player 4", roster_names)
        self.assertEqual(room_view.footer.arguments, (2, 2))

    def test_card_taxonomy_selects_atmosphere_and_revealed_votes_use_result_colors(self) -> None:
        view = present(
            AppState(
                route=Route.COUCH_GAME,
                couch_snapshot={
                    "state": "SHOWING_RESULTS",
                    "players": [],
                    "activePlayer": None,
                    "remainingCardCount": 4,
                    "roundNumber": 2,
                    "currentCard": {
                        "cardText": "A daring Card",
                        "cardType": "QUESTION",
                        "questionCategoryId": "CAT_SEX_TENSION",
                        "cardIntensity": 2,
                        "intensity": 4,
                    },
                    "neverHaveIEverVoting": {
                        "revealMode": "ANONYMOUS_AGGREGATE",
                        "progress": [],
                        "result": {"yes": 3, "no": 2, "total": 5},
                    },
                },
            )
        )
        self.assertEqual(view.atmosphere, "DESIRE_STORIES_4")
        self.assertEqual(view.facts[0].label.message_id, strings.ROUND_LABEL)
        self.assertEqual(view.result_yes.message_id, strings.RESULT_YES)
        self.assertEqual(view.result_no.message_id, strings.RESULT_NO)

        exhausted = present(
            AppState(
                route=Route.COUCH_GAME,
                couch_pool_exhausted=True,
                couch_snapshot={
                    "state": "SELECTING_CARD",
                    "players": [],
                    "activePlayer": None,
                    "remainingCardCount": 0,
                    "roundNumber": 3,
                    "currentCard": None,
                },
            )
        )
        self.assertEqual(exhausted.card_eyebrow.message_id, strings.POOL_EXHAUSTED)
        self.assertEqual(
            [entry.key for entry in exhausted.actions],
            ["couch:adjust", "couch:end"],
        )

    def test_help_is_a_navigable_two_pane_reader_with_external_pagination(self) -> None:
        state = AppState(
            route=Route.HELP,
            server_info={"version": 1},
            help_topics=(
                {"slug": "readme", "title": "Overview"},
                {"slug": "rooms", "title": "Rooms"},
            ),
            help_slug="rooms",
            help_title="Rooms",
            help_body="First paragraph.\n\n" + ("Long help text. " * 100),
        )
        view = present(state)
        self.assertEqual(view.view_mode, "help")
        self.assertEqual(
            [entry.key for entry in view.items],
            ["help:topic:readme", "help:topic:rooms"],
        )
        self.assertFalse(any(entry.selected for entry in view.items))
        self.assertEqual(view.preferred_focus, "help:topic:rooms")
        self.assertIsNotNone(view.pagination)
        self.assertEqual(view.pagination.next_key, "help:page-next")
        self.assertLessEqual(len(view.body.literal), 700)

    def test_active_option_menus_offer_exit_without_replacing_session_actions(self) -> None:
        couch = present(AppState(route=Route.COUCH_MENU))
        self.assertEqual(
            [entry.key for entry in couch.actions],
            ["couch:resume", "couch:menu-help", "couch:end", "app:exit"],
        )
        self.assertEqual(couch.view_mode, "active-menu")
        self.assertTrue(couch.actions[2].danger)
        self.assertTrue(couch.actions[3].danger)
        self.assertEqual(couch.actions[3].secondary.literal, "")
        self.assertIsNone(couch.actions[3].secondary.message_id)

        display = present(AppState(route=Route.ROOM_DISPLAY_MENU))
        self.assertEqual(
            [entry.key for entry in display.actions],
            ["display:diagnostics", "display:leave", "app:exit"],
        )
        self.assertTrue(display.actions[1].danger)
        self.assertTrue(display.actions[2].danger)
        self.assertEqual(display.actions[2].secondary.literal, "")
        self.assertIsNone(display.actions[2].secondary.message_id)

    def test_diagnostics_explain_discovery_and_validation_events(self) -> None:
        view = present(
            AppState(
                route=Route.DIAGNOSTICS,
                diagnostics=(
                    {
                        "event": "discovery.candidate_rejected",
                        "source": "same-machine",
                        "error_type": "ConnectionRefusedError",
                    },
                    {
                        "event": "server.validated",
                        "origin": "http://127.0.0.1:3000",
                    },
                ),
            )
        )
        rejected = next(entry for entry in view.items if entry.key == "diagnostics:event:0")
        validated = next(entry for entry in view.items if entry.key == "diagnostics:event:1")
        self.assertEqual(rejected.label.message_id, strings.DIAGNOSTIC_DISCOVERY_REJECTED)
        self.assertEqual(rejected.secondary.message_id, strings.DIAGNOSTIC_SOURCE_ERROR)
        self.assertEqual(validated.label.message_id, strings.DIAGNOSTIC_SERVER_VALIDATED)
        self.assertEqual(validated.secondary.literal, "http://127.0.0.1:3000")

    def test_help_before_server_selection_uses_built_in_topics_and_copy(self) -> None:
        view = present(AppState(route=Route.HELP, help_slug="navigation"))
        self.assertEqual(view.view_mode, "help")
        self.assertEqual(len(view.items), 4)
        self.assertEqual(view.heading.message_id, strings.HELP_NAVIGATION)
        self.assertEqual(view.body.message_id, strings.HELP_NAVIGATION_BODY)
        self.assertFalse(any(entry.selected for entry in view.items))
        self.assertEqual(view.preferred_focus, "help:topic:navigation")

    def test_players_are_cards_with_a_separate_edit_remove_submenu(self) -> None:
        setup = replace(
            initial_setup("COUCH", (PROFILE,), "en-GB", True),
            players=("Alex", "Sam", "Jo"),
            selected_player_index=1,
        )
        players = present(AppState(route=Route.SETUP_PLAYERS, setup=setup))
        self.assertEqual(players.view_mode, "people")
        self.assertEqual(
            [entry.key for entry in players.items],
            ["setup:player:open:0", "setup:player:open:1", "setup:player:open:2"],
        )
        self.assertFalse(any("remove" in entry.key or "edit" in entry.key for entry in players.items))
        submenu = present(AppState(route=Route.SETUP_PLAYER, setup=setup))
        self.assertEqual(submenu.body.message_id, strings.PLAYER_PROFILE_POSITION)
        self.assertEqual(submenu.facts[0].value.literal, "Sam")
        self.assertEqual(
            [entry.key for entry in submenu.actions],
            ["setup:player:edit:1", "setup:player:remove:1", "nav:back"],
        )

    def test_local_preferences_hide_device_link_and_keep_services_separate(self) -> None:
        view = present(
            AppState(
                route=Route.PREFERENCES,
                servers=(SERVER,),
                selected_server_id=SERVER.server_id,
                server_info={"capabilities": {"nativeDeviceAuthorization": False}},
            )
        )
        self.assertLessEqual(len(view.items), 6)
        self.assertEqual(view.view_mode, "settings")
        self.assertFalse(any(entry.key == "prefs:link" for entry in view.items))
        self.assertFalse(
            any(
                entry.key in {"prefs:motion", "prefs:hardware", "prefs:sound"}
                for entry in view.items
            )
        )
        self.assertEqual(view.body.message_id, strings.LOCAL_DATASPACE)
        self.assertEqual(
            [entry.key for entry in view.actions],
            ["prefs:diagnostics", "prefs:help", "prefs:clear-servers"],
        )

    def test_game_card_exposes_web_card_information_and_explicit_current_player(self) -> None:
        card = {
            "cardText": "Tell us a story.",
            "cardType": "QUESTION",
            "questionCategoryId": "CAT_EVERYDAY",
            "cardIntensity": 2,
            "intensity": 4,
        }
        view = present(
            AppState(
                route=Route.COUCH_GAME,
                taxonomy={
                    "questionCategories": [{"id": "CAT_EVERYDAY", "label": "Everyday"}],
                    "dareTypes": [],
                },
                couch_snapshot={
                    "state": "SHOWING_CARD",
                    "players": [{"id": "alex", "name": "Alex"}],
                    "activePlayer": {"id": "alex", "name": "Alex"},
                    "roundNumber": 3,
                    "cardsShown": 4,
                    "remainingCardCount": 12,
                    "currentCard": card,
                },
            )
        )
        self.assertEqual(view.current_player.literal, "Alex")
        self.assertEqual(view.card_eyebrow.message_id, strings.TRUTH)
        self.assertEqual(view.card_classification.literal, "Everyday")
        self.assertEqual(view.card_text.literal, "Tell us a story.")
        self.assertEqual(view.card_intensity.literal, "2")
        self.assertEqual(view.game_intensity.literal, "4")
        self.assertEqual(view.atmosphere, "CURIOSITY_4")

    def test_waiting_stage_matches_web_reveal_copy_and_hides_card_metadata(self) -> None:
        view = present(
            AppState(
                route=Route.COUCH_GAME,
                couch_snapshot={
                    "state": "WAITING_FOR_PLAYER",
                    "currentCard": {
                        "cardText": "Stale Card",
                        "cardType": "QUESTION",
                        "cardIntensity": 4,
                        "intensity": 5,
                    },
                    "activePlayer": {"id": "alex", "name": "Alex"},
                },
            )
        )
        self.assertEqual(view.card_text.message_id, strings.READY_NEXT_CARD)
        self.assertEqual(view.actions[0].label.message_id, strings.REVEAL_CARD)
        self.assertEqual(view.card_intensity.literal, "")
        self.assertEqual(view.game_intensity.literal, "")
        self.assertEqual(view.card_classification.literal, "")

    def test_card_type_choice_uses_an_instruction_instead_of_missing_card_error(self) -> None:
        view = present(
            AppState(
                route=Route.COUCH_GAME,
                couch_snapshot={
                    "state": "CHOOSING_CARD_TYPE",
                    "currentCard": None,
                    "activePlayer": {"id": "alex", "name": "Alex"},
                },
            )
        )
        self.assertEqual(view.card_text.message_id, strings.CHOOSE_TRUTH_OR_DARE)
        self.assertEqual(
            [entry.label.message_id for entry in view.actions],
            [strings.TRUTH, strings.DARE],
        )
        self.assertEqual(view.card_intensity.literal, "")
        self.assertEqual(view.game_intensity.literal, "")

    def test_private_couch_ballot_keeps_the_card_and_identifies_the_voter(self) -> None:
        snapshot = {
            "state": "COLLECTING_ANSWERS",
            "players": [{"id": "alex", "name": "Alex"}],
            "activePlayer": {"id": "alex", "name": "Alex"},
            "votedPlayerIds": [],
            "currentCard": {
                "cardText": "Never have I ever kept the remote.",
                "cardType": "QUESTION",
                "cardIntensity": 4,
                "intensity": 5,
            },
        }
        view = present(
            AppState(
                route=Route.COUCH_GAME,
                couch_snapshot=snapshot,
                couch_vote_player_id="alex",
                couch_vote_phase="CHOICE",
            )
        )

        self.assertTrue(view.private_vote_choice)
        self.assertEqual(view.actions, ())
        self.assertEqual(view.card_text.literal, "Never have I ever kept the remote.")
        self.assertEqual(view.voting_player.literal, "Alex")
        self.assertEqual(view.voting_stage_label.message_id, strings.CASTING_VOTE)
        self.assertEqual(view.voting_hint.message_id, strings.PRIVATE_VOTE_HINT)
        self.assertEqual(view.card_intensity.literal, "4")
        self.assertEqual(view.game_intensity.literal, "5")

        submitting = present(
            AppState(
                route=Route.COUCH_GAME,
                couch_snapshot=snapshot,
                couch_vote_player_id="alex",
                couch_vote_phase="SUBMITTING",
                busy_operation="couch.vote",
            )
        )
        self.assertFalse(submitting.private_vote_choice)
        self.assertEqual(submitting.actions, ())
        self.assertEqual(
            submitting.card_text.literal,
            "Never have I ever kept the remote.",
        )
        self.assertEqual(submitting.voting_player.literal, "Alex")
        self.assertEqual(
            submitting.voting_stage_label.message_id,
            strings.SUBMITTING_VOTE,
        )

    def test_setup_choice_steps_advance_from_cards_without_continue_actions(self) -> None:
        setup = initial_setup("COUCH", (PROFILE,), "en-GB", True)
        self.assertEqual(setup.mode, "")
        self.assertEqual(setup.profile_id, "")
        for route in (Route.SETUP_GROUP, Route.SETUP_MODE, Route.SETUP_PROFILE):
            with self.subTest(route=route):
                view = present(
                    AppState(route=route, setup=setup, profiles=(PROFILE,))
                )
                self.assertFalse(
                    any(entry.label.message_id == strings.CONTINUE for entry in view.actions)
                )
                if route == Route.SETUP_PROFILE:
                    self.assertFalse(any(entry.selected for entry in view.items))

    def test_customize_hides_mode_specific_controls_that_do_not_apply(self) -> None:
        base = initial_setup("COUCH", (PROFILE,), "en-GB", True)
        never = present(
            AppState(
                route=Route.SETUP_CUSTOMIZE,
                setup=replace(base, mode="NEVER_HAVE_I_EVER"),
            )
        )
        keys = {entry.key for entry in never.items}
        self.assertNotIn("setup:custom:dares", keys)
        self.assertIn("setup:custom:mode", keys)

        classic = present(
            AppState(
                route=Route.SETUP_CUSTOMIZE,
                setup=replace(base, mode="CLASSIC_TRUTH_OR_DARE"),
            )
        )
        classic_keys = {entry.key for entry in classic.items}
        self.assertIn("setup:custom:dares", classic_keys)
        self.assertNotIn("setup:custom:mode", classic_keys)

    def test_named_results_include_counts_and_auto_scroll_status(self) -> None:
        named = [
            {"playerId": f"p{index}", "displayName": f"Player {index}", "vote": "YES" if index < 4 else "NO"}
            for index in range(14)
        ]
        view = present(
            AppState(
                route=Route.COUCH_GAME,
                couch_snapshot={
                    "state": "SHOWING_RESULTS",
                    "players": [],
                    "activePlayer": None,
                    "currentCard": {"cardText": "Never have I ever…", "cardType": "QUESTION"},
                    "neverHaveIEverVoting": {
                        "revealMode": "NAMED_ANSWERS",
                        "progress": [],
                        "result": {"yes": 4, "no": 10, "total": 14, "namedAnswers": named},
                    },
                },
            )
        )
        self.assertEqual(view.result_yes.arguments, (4,))
        self.assertEqual(view.result_no.arguments, (10,))
        self.assertIn("Player 0", view.result_yes_names.literal)
        self.assertIn("Player 4", view.result_no_names.literal)
        self.assertEqual(
            view.result_status.message_id,
            strings.RESULT_AUTO_PAGE_STATUS,
        )
        self.assertEqual(len(view.result_no_players), 5)
        self.assertEqual([entry.key for entry in view.actions], ["couch:advance"])

    def test_hosted_truth_or_dare_choice_uses_device_instruction(self) -> None:
        room = type("Room", (), {"room_code": "ABC234"})()
        view = present(
            AppState(
                route=Route.ROOM_GAME_DISPLAY,
                active_room=room,
                room_snapshot={
                    "participants": [],
                    "session": {
                        "state": "CHOOSING_CARD_TYPE",
                        "activePlayer": {"id": "alex", "name": "Alex"},
                        "currentCard": None,
                    },
                },
            )
        )
        self.assertEqual(view.card_text.message_id, strings.TRUTH_DARE_DEVICE_CHOICE)

    def test_single_text_scale_keeps_overflow_fallback_and_removes_large_mode(self) -> None:
        self.assertEqual(card_text_fit("x" * 120), "medium")
        self.assertEqual(result_card_text_fit("x" * 120), "long")
        skin_path = RESOURCES_ROOT / "skins" / "Default" / "1080i" / "script-partycard-tv-main.xml"
        source = skin_path.read_text(encoding="utf-8")
        self.assertNotIn("LargeText", source)
        self.assertNotIn("large-overflow", source)
        self.assertIn('type="panel" id="59"', source)
        self.assertIn('type="scrollbar" id="95"', source)

    def test_card_language_uses_bounded_primary_and_ordered_fallback_screens(self) -> None:
        locales = tuple(
            {"id": f"lang-{index}", "nativeName": f"Language {index}"}
            for index in range(15)
        )
        setup = replace(
            initial_setup("COUCH", (PROFILE,), "lang-0", True),
            card_fallback_enabled=True,
            card_fallback_locales=(),
        )
        overview = present(
            AppState(route=Route.SETUP_CARD_LANGUAGE, setup=setup, locales=locales)
        )
        self.assertEqual(len(overview.items), 4)
        self.assertTrue(any(entry.key == "setup:language:fallbacks" for entry in overview.items))
        primary = present(
            AppState(
                route=Route.SETUP_CARD_LANGUAGE_PRIMARY,
                setup=setup,
                locales=locales,
            )
        )
        self.assertEqual(len(primary.items), COLLECTION_PAGE_SIZE)
        self.assertIsNotNone(primary.pagination)
        fallbacks = present(
            AppState(
                route=Route.SETUP_CARD_LANGUAGE_FALLBACKS,
                setup=setup,
                locales=locales,
            )
        )
        self.assertEqual(fallbacks.body.message_id, strings.NO_FALLBACK_SELECTED)
        self.assertEqual(fallbacks.actions[0].key, "setup:language:fallback-add")

    def test_player_validation_is_prominent_and_remove_is_never_fake_disabled(self) -> None:
        setup = replace(
            initial_setup("COUCH", (PROFILE,), "en-GB", True),
            players=("Alex", "Alex"),
            selected_player_index=0,
        )
        players = present(AppState(route=Route.SETUP_PLAYERS, setup=setup))
        self.assertEqual(players.alert.message_id, strings.PLAYER_NAMES_UNIQUE_ALERT)
        duplicate_cards = [entry for entry in players.items if entry.danger]
        self.assertEqual(len(duplicate_cards), 2)
        self.assertTrue(
            all(entry.detail.message_id == strings.DUPLICATE_NAME for entry in duplicate_cards)
        )
        submenu = present(AppState(route=Route.SETUP_PLAYER, setup=setup))
        remove = next(entry for entry in submenu.actions if "remove" in entry.key)
        self.assertTrue(remove.enabled)
        self.assertEqual(remove.secondary.literal, "")

    def test_card_text_fit_keeps_catalog_length_cards_static_and_has_overflow_fallback(self) -> None:
        self.assertEqual(card_text_fit("x" * 100), "short")
        self.assertEqual(card_text_fit("x" * 256), "medium")
        self.assertEqual(card_text_fit("x" * 600), "long")
        self.assertEqual(card_text_fit("x" * 601), "overflow")
        self.assertEqual(result_card_text_fit("x" * 256), "long")
        self.assertEqual(result_card_text_fit("x" * 321), "overflow")

    def test_high_intensity_dark_atmospheres_use_web_style_light_indicator_text(self) -> None:
        self.assertEqual(adaptive_tone("HEAT_5"), "light")
        self.assertEqual(adaptive_tone("CURIOSITY_5"), "dark")

    def test_skin_uses_raster_selection_and_intensity_marks_without_font_symbols(self) -> None:
        skin_path = (
            RESOURCES_ROOT
            / "skins"
            / "Default"
            / "1080i"
            / "script-partycard-tv-main.xml"
        )
        source = skin_path.read_text(encoding="utf-8")
        self.assertIn("partycard-tv-selected-mark.png", source)
        media = RESOURCES_ROOT / "skins" / "Default" / "media"
        self.assertTrue((media / "partycard-tv-dot-on.png").is_file())
        self.assertTrue((media / "partycard-tv-dot-off.png").is_file())
        for unsupported in ("✓", "✦", "▣", "◆", "●", "○", "⚙"):
            self.assertNotIn(unsupported, source)

    def test_home_has_one_couch_entry_and_no_redundant_continue_group(self) -> None:
        view = present(
            AppState(
                route=Route.HOME,
                groups=({"id": "group", "name": "Friends", "members": []},),
            )
        )
        self.assertEqual([entry.key for entry in view.items].count("home:couch"), 1)
        self.assertFalse(any(entry.key == "home:groups" for entry in view.items))

    def test_customize_uses_a_separate_continue_command_not_review(self) -> None:
        setup = initial_setup("COUCH", (PROFILE,), "en-GB", True)
        view = present(AppState(route=Route.SETUP_CUSTOMIZE, setup=setup))
        self.assertLessEqual(len(view.items), 6)
        self.assertEqual(view.view_mode, "settings")
        self.assertFalse(any(entry.key == "setup:custom:review" for entry in view.items))
        self.assertEqual(view.actions[0].key, "setup:custom:continue")
        self.assertEqual(view.actions[0].label.message_id, strings.CONTINUE)

    def test_lobby_projects_settings_capacity_and_every_represented_player(self) -> None:
        room = type("Room", (), {"room_code": "ABC234"})()
        state = AppState(
            route=Route.ROOM_LOBBY_DISPLAY,
            active_room=room,
            profiles=({"id": "PROFILE_FRIENDS", "name": "Friends"},),
            locales=({"id": "en-GB", "nativeName": "English"},),
            room_eligibility={"total": 321},
            room_snapshot={
                "capacity": {"maximumPlayers": 20},
                "hostStatus": {"state": "CONNECTED", "displayName": "Alex"},
                "participants": [
                    {
                        "id": "host",
                        "displayName": "Alex",
                        "role": "HOST",
                        "connectionStatus": "CONNECTED",
                        "devicePlayers": [{"id": "guest", "name": "Sam"}],
                    },
                    {
                        "id": "display",
                        "displayName": "TV",
                        "role": "DISPLAY",
                        "connectionStatus": "CONNECTED",
                        "devicePlayers": [],
                    },
                ],
                "settings": {
                    "mode": "CLASSIC_TRUTH_OR_DARE",
                    "profileId": "PROFILE_FRIENDS",
                    "groupId": None,
                    "cardLocale": "en-GB",
                    "configuration": {
                        "startingIntensity": 1,
                        "maximumIntensity": 3,
                        "maximumSocialSensitivity": "PERSONAL",
                        "enabledQuestionCategoryIds": ["CAT_EVERYDAY"],
                        "enabledDareTypeIds": ["DARE_SILLY"],
                    },
                },
                "session": None,
            },
        )
        view = present(state)
        self.assertEqual(view.view_mode, "lobby")
        self.assertEqual(len(view.facts), 8)
        self.assertEqual(
            [fact.label.message_id for fact in view.facts[:3]],
            [strings.MODE_LABEL, strings.PROFILE_LABEL, strings.GROUP_LABEL],
        )
        self.assertEqual([entry.label.literal for entry in view.roster], ["Alex", "Sam"])
        self.assertEqual(view.room_code.literal, "ABC234")
        self.assertEqual(view.roster[0].secondary.message_id, strings.HOST_ROLE)
        self.assertEqual(view.roster[1].secondary.message_id, strings.ON_DEVICE)

    def test_lobby_pages_join_addresses_in_a_fixed_region(self) -> None:
        room = type("Room", (), {"room_code": "ABC234"})()
        state = AppState(
            route=Route.ROOM_LOBBY_DISPLAY,
            active_room=room,
            auto_page=1,
            server_info={
                "roomAccess": {
                    "availableBaseUrls": (
                        "http://192.168.1.50:3000",
                        "https://party.example.test",
                    )
                },
                "endpoints": {"roomJoinPathTemplate": "/play/?room={roomCode}"},
            },
            room_snapshot={
                "participants": [],
                "hostStatus": {"state": "CONNECTED", "displayName": "Alex"},
                "settings": {"configuration": {}},
            },
        )
        view = present(state)
        self.assertIn("party.example.test", view.join_urls.literal)
        self.assertEqual(
            view.join_urls.literal.replace("\n", ""),
            "https://party.example.test/play/?room=ABC234",
        )
        self.assertEqual(view.join_url_status.message_id, strings.JOIN_ADDRESS_STATUS)

    def test_ended_open_room_summary_stays_attached_without_terminal_actions(self) -> None:
        view = present(
            AppState(
                route=Route.ROOM_SUMMARY_DISPLAY,
                active_room=object(),
                room_snapshot={
                    "session": {
                        "state": "ENDED",
                        "cardsShown": 29,
                        "roundNumber": 4,
                        "players": [
                            {"id": "one", "name": "One"},
                            {"id": "two", "name": "Two"},
                        ],
                    }
                },
            )
        )

        self.assertEqual(view.view_mode, "summary")
        self.assertEqual(view.body.message_id, strings.ROOM_ENDED_OPEN_BODY)
        self.assertEqual(view.actions, ())
        self.assertIsNone(view.preferred_focus)
        self.assertEqual([fact.value.literal for fact in view.facts], ["29", "4", "2"])


if __name__ == "__main__":
    unittest.main()
