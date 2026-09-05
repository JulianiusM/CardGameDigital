from __future__ import annotations

import tempfile
import unittest
from dataclasses import replace
from unittest.mock import patch

from support import RESOURCES_ROOT
from lib.actions import action
from lib.app import Application
from lib.presentation import OPERATIONAL_FLAG_LABELS, present
from lib.reducer import reduce
from lib.routes import Route
from lib.state import (
    ActiveRoom,
    AppState,
    Preferences,
    RecoveryEnvelope,
    ServerRecord,
    configuration_from_profile,
    initial_setup,
)
from lib import strings


SERVER = ServerRecord(
    "00000000-0000-4000-8000-000000000099",
    "http://192.168.1.20:3000",
    "Party Game",
    "local",
    "manual",
    1.0,
)
SERVER_INFO = {
    "version": 1,
    "serverId": SERVER.server_id,
    "displayName": SERVER.display_name,
    "deploymentMode": "local",
    "capabilities": {"displayBootstrapRoomCreation": True},
    "endpoints": {"apiBasePath": "/api/v1", "webSocketPath": "/ws"},
    "roomAccess": {"configuredBaseUrl": None, "availableBaseUrls": [SERVER.origin]},
}
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
DISPLAY_PARTICIPANT_ID = "00000000-0000-4000-8000-000000000010"
HOST_PARTICIPANT_ID = "00000000-0000-4000-8000-000000000011"
DISPLAY_ROOM = ActiveRoom(
    "00000000-0000-4000-8000-000000000012",
    "ABC234",
    DISPLAY_PARTICIPANT_ID,
    "secret-reference",
    "DISPLAY",
    "DISPLAY_WAITING_FOR_HOST",
)


def room_lobby_snapshot(revision: int, updated_by: str | None) -> dict:
    return {
        "participants": [],
        "hostStatus": {"state": "CONNECTED", "displayName": "Host"},
        "settings": {
            "revision": revision,
            "updatedByParticipantId": updated_by,
        },
        "session": None,
    }


class StubUi:
    def __init__(self, text: str | None = None, number: str | None = None) -> None:
        self.text = text
        self.number = number
        self.number_requests: list[tuple[int, str]] = []

    def request_text(self, _heading_id: int, _default: str = "", _hidden: bool = False):
        return self.text

    def request_number(self, heading_id: int, default: str = ""):
        self.number_requests.append((heading_id, default))
        return self.number

    def request_choice(self, _heading_id: int, _options: tuple, selected: int = 0):
        return selected


class ReducerTests(unittest.TestCase):
    def test_mode_choice_does_not_preview_before_required_profile_selection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            submitted_effects = []
            application.effects.submit = submitted_effects.append
            application.state = AppState(
                route=Route.SETUP_MODE,
                setup=initial_setup("COUCH", "en-GB", True),
                profiles=(PROFILE,),
                servers=(SERVER,),
                selected_server_id=SERVER.server_id,
                server_info=SERVER_INFO,
            )

            application.activate("setup:mode:NEVER_HAVE_I_EVER")

            self.assertEqual(application.state.route, Route.SETUP_PROFILE)
            self.assertEqual(application.state.setup.profile_id, "")
            self.assertFalse(
                any(effect.kind == "ELIGIBILITY_PREVIEW" for effect in submitted_effects)
            )

            application.activate("setup:profile:PROFILE_FRIENDS")

            previews = [
                effect
                for effect in submitted_effects
                if effect.kind == "ELIGIBILITY_PREVIEW"
            ]
            self.assertEqual(len(previews), 1)
            self.assertEqual(
                previews[0].payload["settings"]["profileId"],
                "PROFILE_FRIENDS",
            )
            self.assertEqual(application.state.route, Route.SETUP_PLAYERS)
            application.stop()

    def test_adult_profile_previews_only_after_confirmation(self) -> None:
        adult_profile = {
            **PROFILE,
            "id": "PROFILE_SPICY",
            "requiresAdultConfirmation": True,
        }
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            submitted_effects = []
            application.effects.submit = submitted_effects.append
            application.state = AppState(
                route=Route.SETUP_PROFILE,
                setup=replace(
                    initial_setup("COUCH", "en-GB", True),
                    mode="NEVER_HAVE_I_EVER",
                ),
                profiles=(adult_profile,),
                servers=(SERVER,),
                selected_server_id=SERVER.server_id,
                server_info=SERVER_INFO,
            )

            application.activate("setup:profile:PROFILE_SPICY")

            self.assertFalse(
                any(effect.kind == "ELIGIBILITY_PREVIEW" for effect in submitted_effects)
            )
            self.assertEqual(application.state.route, Route.SETUP_PROFILE)

            application.activate("setup:adult:confirm")

            previews = [
                effect
                for effect in submitted_effects
                if effect.kind == "ELIGIBILITY_PREVIEW"
            ]
            self.assertEqual(len(previews), 1)
            self.assertTrue(
                previews[0].payload["settings"]["adultContentConfirmed"]
            )
            self.assertEqual(application.state.route, Route.SETUP_PLAYERS)
            application.stop()

    def test_both_couch_reveal_modes_open_the_same_direct_private_ballot(self) -> None:
        for reveal_mode in ("ANONYMOUS_AGGREGATE", "NAMED_ANSWERS"):
            with self.subTest(reveal_mode=reveal_mode):
                snapshot = {
                    "state": "COLLECTING_ANSWERS",
                    "settings": {"neverHaveIEverRevealMode": reveal_mode},
                    "players": [{"id": "alex", "name": "Alex"}],
                    "votedPlayerIds": [],
                    "currentCard": {"cardText": "Never have I ever tested this."},
                }
                state, effects = reduce(
                    AppState(route=Route.COUCH_GAME, couch_snapshot=snapshot),
                    action("COUCH_VOTE_PLAYER_SELECTED", player_id="alex"),
                )

                self.assertEqual(effects, ())
                self.assertEqual(state.couch_vote_player_id, "alex")
                self.assertEqual(state.couch_vote_phase, "CHOICE")
                view = present(state)
                self.assertTrue(view.private_vote_choice)
                self.assertEqual(view.voting_stage_label.message_id, strings.CASTING_VOTE)
                self.assertEqual(view.actions, ())

    def test_couch_back_opens_options_and_second_back_resumes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            application.state = AppState(
                route=Route.COUCH_GAME,
                couch_snapshot={"id": "session", "revision": 1},
            )
            application.back()
            self.assertEqual(application.state.route, Route.COUCH_MENU)
            self.assertIsNone(application.state.confirmation)
            application.back()
            self.assertEqual(application.state.route, Route.COUCH_GAME)
            application.stop()

    def test_couch_back_aborts_a_pending_private_vote_before_opening_options(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            application.state = AppState(
                route=Route.COUCH_GAME,
                couch_vote_player_id="alex",
                couch_vote_phase="CHOICE",
                couch_snapshot={"id": "session", "revision": 1},
            )

            application.back()

            self.assertEqual(application.state.route, Route.COUCH_GAME)
            self.assertIsNone(application.state.couch_vote_player_id)
            self.assertEqual(application.state.couch_vote_phase, "SELECT")
            application.stop()

    def test_startup_without_saved_server_opens_server_list_and_discovers(self) -> None:
        state, effects = reduce(AppState(), action("START"))
        self.assertEqual({entry.kind for entry in effects}, {"LOAD_STORAGE", "DISCOVER_SERVERS"})
        state, _ = reduce(state, action("STORAGE_LOADED", preferences=Preferences(), servers=(), recovery=None))
        self.assertEqual(state.route, Route.SERVER_LIST)

    def test_storage_load_preserves_a_server_found_during_startup(self) -> None:
        discovered = replace(SERVER, server_id="live", source="same-machine")
        state = AppState(route=Route.BOOTSTRAP, servers=(discovered,))
        state, _ = reduce(
            state,
            action(
                "STORAGE_LOADED",
                preferences=Preferences(),
                servers=(),
                recovery=None,
                configured_server_origin=None,
            ),
        )
        self.assertIn(discovered, state.servers)

    def test_room_event_notices_survive_the_following_snapshot(self) -> None:
        state = AppState(route=Route.ROOM_GAME_DISPLAY, room_snapshot={"session": {}})
        state, _ = reduce(
            state,
            action(
                "WS_ENVELOPE",
                envelope={
                    "type": "room.participantLeft",
                    "payload": {"displayName": "Alex", "reason": "LEFT"},
                },
            ),
        )
        self.assertEqual(state.notification.message_id, strings.PARTICIPANT_LEFT)
        state, _ = reduce(
            state,
            action(
                "WS_ENVELOPE",
                envelope={
                    "type": "room.snapshot",
                    "payload": {
                        "participants": [],
                        "hostStatus": {"state": "CONNECTED", "displayName": "Host"},
                        "session": None,
                    },
                },
            ),
        )
        self.assertEqual(state.notification.message_id, strings.PARTICIPANT_LEFT)

    def test_first_room_snapshot_does_not_report_a_settings_change(self) -> None:
        state = AppState(route=Route.ROOM_LOBBY_DISPLAY, active_room=DISPLAY_ROOM)
        state, _ = reduce(
            state,
            action(
                "WS_ENVELOPE",
                envelope={
                    "type": "room.snapshot",
                    "payload": room_lobby_snapshot(1, HOST_PARTICIPANT_ID),
                },
            ),
        )
        self.assertIsNone(state.notification)

    def test_unchanged_room_settings_revision_does_not_notify(self) -> None:
        previous = room_lobby_snapshot(4, HOST_PARTICIPANT_ID)
        state = AppState(
            route=Route.ROOM_LOBBY_DISPLAY,
            active_room=DISPLAY_ROOM,
            room_snapshot=previous,
        )
        state, _ = reduce(
            state,
            action(
                "WS_ENVELOPE",
                envelope={
                    "type": "room.snapshot",
                    "payload": room_lobby_snapshot(4, HOST_PARTICIPANT_ID),
                },
            ),
        )
        self.assertIsNone(state.notification)

    def test_own_room_settings_revision_increment_does_not_notify(self) -> None:
        state = AppState(
            route=Route.ROOM_LOBBY_DISPLAY,
            active_room=DISPLAY_ROOM,
            room_snapshot=room_lobby_snapshot(4, HOST_PARTICIPANT_ID),
        )
        state, _ = reduce(
            state,
            action(
                "WS_ENVELOPE",
                envelope={
                    "type": "room.snapshot",
                    "payload": room_lobby_snapshot(5, DISPLAY_PARTICIPANT_ID),
                },
            ),
        )
        self.assertIsNone(state.notification)

    def test_other_participant_room_settings_increment_notifies(self) -> None:
        state = AppState(
            route=Route.ROOM_LOBBY_DISPLAY,
            active_room=DISPLAY_ROOM,
            room_snapshot=room_lobby_snapshot(4, HOST_PARTICIPANT_ID),
        )
        state, _ = reduce(
            state,
            action(
                "WS_ENVELOPE",
                envelope={
                    "type": "room.snapshot",
                    "payload": room_lobby_snapshot(5, HOST_PARTICIPANT_ID),
                },
            ),
        )
        self.assertIsNotNone(state.notification)
        self.assertEqual(state.notification.message_id, strings.ROOM_SETTINGS_CHANGED)

    def test_new_game_returns_to_unselected_mode_and_preserves_players(self) -> None:
        setup = replace(
            initial_setup("COUCH", "en-GB", True),
            mode="NEVER_HAVE_I_EVER",
            players=("Alex", "Sam"),
            profile_id="PROFILE_FRIENDS",
            adult_content_confirmed=True,
        )
        state, _ = reduce(
            AppState(route=Route.COUCH_SUMMARY, setup=setup),
            action("RESTART_SETUP"),
        )
        self.assertEqual(state.route, Route.SETUP_MODE)
        self.assertEqual(state.route_stack, (Route.HOME, Route.SETUP_GROUP))
        self.assertEqual(state.setup.players, ("Alex", "Sam"))
        self.assertEqual(state.setup.mode, "")
        self.assertEqual(state.setup.profile_id, "")
        self.assertFalse(state.setup.adult_content_confirmed)

    def test_saved_group_configuration_does_not_preselect_its_preferred_profile(self) -> None:
        group = {
            "id": "00000000-0000-4000-8000-000000000020",
            "name": "Friends",
            "members": ["Alex", "Sam"],
            "preferredProfileId": "PROFILE_FRIENDS",
            "customConfiguration": None,
            "cardLanguageSettings": None,
        }
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            application.state = AppState(
                route=Route.SETUP_GROUP_SELECT,
                setup=replace(
                    initial_setup("COUCH", "en-GB", True),
                    profile_id="PROFILE_FRIENDS",
                    adult_content_confirmed=True,
                ),
                profiles=(PROFILE,),
                groups=(group,),
            )

            application.activate(f"setup:group:select:{group['id']}")

            self.assertEqual(application.state.route, Route.SETUP_MODE)
            self.assertEqual(application.state.setup.players, ("Alex", "Sam"))
            self.assertEqual(application.state.setup.profile_id, "")
            self.assertFalse(application.state.setup.adult_content_confirmed)
            self.assertEqual(
                application.state.setup.configuration["startingIntensity"],
                PROFILE["startingIntensity"],
            )
            application.stop()

    def test_main_menu_continue_loads_saved_group_into_neutral_setup(self) -> None:
        custom_profile = {
            **PROFILE,
            "id": "PROFILE_CUSTOM",
            "name": "Custom",
        }
        custom_configuration = {
            **configuration_from_profile(custom_profile),
            "startingIntensity": 2,
            "maximumIntensity": 5,
            "maximumSocialSensitivity": "INTIMATE",
        }
        group = {
            "id": "00000000-0000-4000-8000-000000000021",
            "name": "Long-running group",
            "members": ["Alex", "Sam", "Taylor"],
            "preferredProfileId": "PROFILE_CUSTOM",
            "customConfiguration": custom_configuration,
            "cardLanguageSettings": None,
        }
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            application.state = AppState(
                route=Route.HOME,
                setup=replace(
                    initial_setup("COUCH", "en-GB", True),
                    profile_id="PROFILE_CUSTOM",
                    adult_content_confirmed=True,
                    players=("Previous player",),
                ),
                profiles=(custom_profile,),
                groups=(group,),
                game_settings={"preferredProfileId": "PROFILE_CUSTOM"},
            )

            application.activate(f"group:continue:{group['id']}")

            setup = application.state.setup
            self.assertIsNotNone(setup)
            self.assertEqual(application.state.route, Route.SETUP_MODE)
            self.assertEqual(
                application.state.route_stack,
                (Route.HOME, Route.SETUP_GROUP),
            )
            self.assertEqual(setup.group_choice, "SAVED")
            self.assertEqual(setup.group_id, group["id"])
            self.assertEqual(setup.persistence, "DATASPACE")
            self.assertEqual(setup.players, tuple(group["members"]))
            self.assertEqual(setup.configuration, custom_configuration)
            self.assertEqual(setup.profile_id, "")
            self.assertFalse(setup.adult_content_confirmed)
            application.stop()

    def test_active_game_can_exit_addon_without_ending_or_leaving_session(self) -> None:
        couch_snapshot = {"id": "session", "revision": 4, "state": "SHOWING_CARD"}
        recovery = RecoveryEnvelope(
            1,
            SERVER.server_id,
            SERVER.origin,
            "COUCH",
            1,
            1,
            couch_session_id="session",
        )
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            submitted_effects = []
            application.effects.submit = submitted_effects.append
            application.state = AppState(
                route=Route.COUCH_MENU,
                couch_snapshot=couch_snapshot,
                recovery=recovery,
            )

            application.activate("app:exit")
            self.assertEqual(application.state.confirmation.confirm_action, "exit-addon")
            self.assertEqual(submitted_effects, [])
            application.confirm()
            application.stop()
            application.stop()

            self.assertEqual(application.state.lifecycle, "STOPPING")
            self.assertEqual(application.state.couch_snapshot, couch_snapshot)
            self.assertEqual(application.state.recovery, recovery)
            self.assertIsNone(application.state.active_room)
            self.assertEqual(
                [(entry.kind, entry.owner) for entry in submitted_effects],
                [("SHUTDOWN", "lifecycle")],
            )

    def test_couch_end_game_remains_distinct_from_exit_to_kodi(self) -> None:
        couch_snapshot = {"id": "session", "revision": 4, "state": "SHOWING_CARD"}
        recovery = RecoveryEnvelope(
            1,
            SERVER.server_id,
            SERVER.origin,
            "COUCH",
            1,
            1,
            couch_session_id="session",
        )
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            submitted_effects = []
            application.effects.submit = submitted_effects.append
            application.state = AppState(
                lifecycle="RUNNING",
                route=Route.COUCH_MENU,
                couch_snapshot=couch_snapshot,
                recovery=recovery,
                servers=(SERVER,),
                selected_server_id=SERVER.server_id,
                server_info=SERVER_INFO,
            )

            application.activate("couch:end")
            self.assertEqual(
                application.state.confirmation.confirm_action,
                "leave-active",
            )
            self.assertEqual(application.state.confirmation.title_id, strings.END_GAME)
            self.assertEqual(application.state.confirmation.action_id, strings.END_GAME)
            self.assertEqual(submitted_effects, [])

            application.confirm()

            self.assertEqual(application.state.lifecycle, "RUNNING")
            self.assertEqual(application.state.couch_snapshot, couch_snapshot)
            self.assertEqual(application.state.recovery, recovery)
            self.assertEqual(len(submitted_effects), 1)
            self.assertEqual(submitted_effects[0].kind, "COUCH_COMMAND")
            self.assertEqual(submitted_effects[0].payload["command"], "end")

    def test_active_room_can_exit_addon_without_leaving_room(self) -> None:
        room_snapshot = {"session": {"state": "SHOWING_CARD"}}
        recovery = RecoveryEnvelope(
            1,
            SERVER.server_id,
            SERVER.origin,
            "ROOM",
            1,
            1,
            room_code=DISPLAY_ROOM.room_code,
        )
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            submitted_effects = []
            application.effects.submit = submitted_effects.append
            application.state = AppState(
                route=Route.ROOM_DISPLAY_MENU,
                active_room=DISPLAY_ROOM,
                room_snapshot=room_snapshot,
                recovery=recovery,
            )

            application.activate("app:exit")
            self.assertEqual(application.state.confirmation.confirm_action, "exit-addon")
            self.assertEqual(submitted_effects, [])
            application.confirm()

            self.assertEqual(application.state.lifecycle, "STOPPING")
            self.assertEqual(application.state.active_room, DISPLAY_ROOM)
            self.assertEqual(application.state.room_snapshot, room_snapshot)
            self.assertEqual(application.state.recovery, recovery)
            self.assertEqual(
                [(entry.kind, entry.owner) for entry in submitted_effects],
                [("SHUTDOWN", "lifecycle")],
            )

    def test_configured_server_is_validated_automatically_after_storage_load(self) -> None:
        state = AppState(route=Route.BOOTSTRAP)
        state, effects = reduce(
            state,
            action(
                "STORAGE_LOADED",
                preferences=Preferences(),
                servers=(),
                recovery=None,
                configured_server_origin="http://192.168.1.20:3000",
            ),
        )
        self.assertEqual(state.route, Route.BOOTSTRAP)
        self.assertEqual(effects[0].kind, "VALIDATE_SERVER")
        self.assertEqual(effects[0].payload["origin"], "http://192.168.1.20:3000")

    def test_back_from_a_root_screen_requests_cancel_default_exit_confirmation(self) -> None:
        state, effects = reduce(AppState(route=Route.SERVER_LIST), action("BACK"))
        self.assertEqual(state.lifecycle, "CREATED")
        self.assertEqual(effects, ())
        self.assertIsNotNone(state.confirmation)
        self.assertEqual(state.confirmation.confirm_action, "exit-addon")
        self.assertEqual(state.confirmation.action_id, strings.EXIT_ADDON)

    def test_back_from_home_ignores_stale_history_and_requests_exit(self) -> None:
        state, effects = reduce(
            AppState(
                route=Route.HOME,
                route_stack=(Route.SERVER_LIST, Route.PREFERENCES),
                server_info=SERVER_INFO,
            ),
            action("BACK"),
        )

        self.assertEqual(state.route, Route.HOME)
        self.assertEqual(state.route_stack, ())
        self.assertEqual(effects, ())
        self.assertEqual(state.confirmation.confirm_action, "exit-addon")

    def test_navigating_home_clears_stale_history_even_without_push(self) -> None:
        state, _ = reduce(
            AppState(
                route=Route.PREFERENCES,
                route_stack=(Route.HOME, Route.SERVER_LIST),
            ),
            action("NAVIGATE", route=Route.HOME, push=False),
        )

        self.assertEqual(state.route, Route.HOME)
        self.assertEqual(state.route_stack, ())

    def test_confirming_exit_stops_application_only_after_confirmation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            application.state = AppState(route=Route.HOME)

            application.back()
            self.assertEqual(application.state.lifecycle, "CREATED")
            self.assertEqual(application.state.confirmation.confirm_action, "exit-addon")

            application.confirm()
            self.assertEqual(application.state.lifecycle, "STOPPING")

    def test_saved_servers_are_probed_without_blocking_server_selection(self) -> None:
        state, effects = reduce(
            AppState(),
            action("STORAGE_LOADED", preferences=Preferences(), servers=(SERVER,), recovery=None),
        )
        self.assertEqual(state.route, Route.SERVER_LIST)
        self.assertEqual([entry.kind for entry in effects], ["PROBE_SAVED_SERVERS"])

        state, _ = reduce(state, action("SERVER_UNAVAILABLE", server_id=SERVER.server_id))
        self.assertFalse(state.servers[0].available)

    def test_mdns_cannot_replace_a_higher_priority_origin_for_the_same_server(self) -> None:
        mdns = ServerRecord(
            SERVER.server_id,
            "http://[fe80::1234]:3000",
            SERVER.display_name,
            SERVER.deployment_mode,
            "mdns",
            20.0,
        )

        state, _ = reduce(
            AppState(route=Route.SERVER_LIST, servers=(SERVER,)),
            action("SERVER_DISCOVERED", server=mdns),
        )

        self.assertEqual(state.servers[0].origin, SERVER.origin)
        self.assertEqual(state.servers[0].source, "manual")

    def test_validated_server_becomes_authoritative_and_loads_metadata(self) -> None:
        state = AppState(route=Route.SERVER_DETAILS, servers=(SERVER,), selected_server_id=SERVER.server_id)
        state, effects = reduce(state, action("SERVER_VALIDATED", server=SERVER, server_info=SERVER_INFO))
        self.assertEqual(state.route, Route.HOME)
        self.assertEqual(state.server_info, SERVER_INFO)
        self.assertEqual({entry.kind for entry in effects}, {"LOAD_METADATA", "SAVE_STORAGE"})

    def test_server_cards_open_details_and_removal_clears_an_active_selection(self) -> None:
        state = AppState(
            route=Route.SERVER_LIST,
            servers=(SERVER,),
            selected_server_id=SERVER.server_id,
            server_info=SERVER_INFO,
        )
        state, effects = reduce(
            state,
            action("SERVER_DETAILS_OPENED", server_id=SERVER.server_id),
        )
        self.assertEqual(state.route, Route.SERVER_DETAILS)
        self.assertEqual(state.server_details_id, SERVER.server_id)
        self.assertEqual(effects, ())

        state, effects = reduce(state, action("SERVERS_REPLACED", servers=()))
        self.assertIsNone(state.selected_server_id)
        self.assertIsNone(state.server_details_id)
        self.assertIsNone(state.server_info)
        self.assertEqual(effects[0].kind, "SAVE_STORAGE")

    def test_server_refresh_really_starts_discovery(self) -> None:
        state, effects = reduce(
            AppState(route=Route.SERVER_LIST),
            action("DISCOVERY_REQUESTED"),
        )
        self.assertEqual(state.transport_state, "DISCOVERING")
        self.assertEqual(effects[0].kind, "DISCOVER_SERVERS")

    def test_help_navigation_loads_index_document_and_topic_changes(self) -> None:
        state = AppState(
            route=Route.HOME,
            servers=(SERVER,),
            selected_server_id=SERVER.server_id,
            server_info=SERVER_INFO,
        )
        state, effects = reduce(state, action("NAVIGATE", route=Route.HELP))
        self.assertEqual(state.route, Route.HELP)
        self.assertEqual(effects[0].kind, "LOAD_HELP")
        state, _ = reduce(
            state,
            action(
                "HELP_LOADED",
                topics=(
                    {"slug": "readme", "title": "Overview"},
                    {"slug": "rooms", "title": "Rooms"},
                ),
                document={"slug": "readme", "title": "Overview", "body": "Help"},
            ),
        )
        self.assertEqual(state.help_slug, "readme")
        state, effects = reduce(state, action("HELP_TOPIC_SELECTED", slug="rooms"))
        self.assertEqual(state.help_slug, "rooms")
        self.assertEqual(effects[0].kind, "LOAD_HELP_DOCUMENT")
        self.assertEqual(effects[0].payload["slug"], "rooms")

    def test_help_opened_from_home_returns_to_home_without_exit_confirmation(self) -> None:
        state = AppState(
            route=Route.HOME,
            servers=(SERVER,),
            selected_server_id=SERVER.server_id,
            server_info=SERVER_INFO,
        )

        state, _ = reduce(state, action("NAVIGATE", route=Route.HELP))
        self.assertEqual(state.route_stack, (Route.HOME,))

        state, effects = reduce(state, action("BACK"))
        self.assertEqual(state.route, Route.HOME)
        self.assertEqual(state.route_stack, ())
        self.assertIsNone(state.confirmation)
        self.assertEqual(effects, ())

    def test_help_next_page_action_changes_the_document_page(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            application.state = AppState(
                route=Route.HELP,
                server_info=SERVER_INFO,
                help_page=0,
            )
            application.activate("help:page-next")
            self.assertEqual(application.state.help_page, 1)
            application.activate("help:page-previous")
            self.assertEqual(application.state.help_page, 0)
            application.stop()

    def test_private_vote_shortcuts_submit_only_during_the_visible_choice(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            application.state = AppState(
                route=Route.COUCH_GAME,
                couch_vote_player_id="alex",
                couch_vote_phase="CHOICE",
                couch_snapshot={
                    "id": "00000000-0000-4000-8000-000000000001",
                    "revision": 4,
                    "state": "COLLECTING_ANSWERS",
                },
            )
            self.assertTrue(application.private_vote_shortcut("YES"))
            self.assertEqual(application.state.busy_operation, "couch.vote")
            self.assertEqual(application.state.couch_vote_phase, "SUBMITTING")
            self.assertFalse(application.private_vote_shortcut("NO"))
            self.assertFalse(application.private_vote_shortcut("MAYBE"))
            application.stop()

    def test_private_vote_returns_to_choice_after_a_definite_failure(self) -> None:
        state = AppState(
            route=Route.COUCH_GAME,
            couch_vote_player_id="alex",
            couch_vote_phase="CHOICE",
            couch_snapshot={"id": "session", "revision": 4},
        )
        state, effects = reduce(
            state,
            action(
                "COUCH_COMMAND_REQUESTED",
                command="vote",
                extra={"playerId": "alex", "answer": "YES"},
            ),
        )
        self.assertEqual(state.couch_vote_phase, "SUBMITTING")
        self.assertEqual(effects[0].kind, "COUCH_COMMAND")

        state, _ = reduce(state, action("OPERATION_FAILED", code="INVALID_COMMAND"))
        self.assertEqual(state.couch_vote_phase, "CHOICE")

    def test_private_vote_cancel_returns_to_neutral_card_state(self) -> None:
        state = AppState(
            route=Route.COUCH_GAME,
            couch_vote_player_id="alex",
            couch_vote_phase="CHOICE",
            couch_snapshot={"id": "session", "revision": 4},
        )

        state, effects = reduce(state, action("COUCH_VOTE_CANCELLED"))

        self.assertIsNone(state.couch_vote_player_id)
        self.assertEqual(state.couch_vote_phase, "SELECT")
        self.assertEqual(effects, ())

    def test_recorded_private_vote_returns_to_neutral_player_selection(self) -> None:
        state = AppState(
            route=Route.COUCH_GAME,
            couch_vote_player_id="alex",
            couch_vote_phase="SUBMITTING",
            busy_operation="couch.vote",
            couch_snapshot={"id": "session", "revision": 4, "votedPlayerIds": []},
        )
        state, _ = reduce(
            state,
            action(
                "COUCH_UPDATED",
                snapshot={
                    "id": "session",
                    "revision": 5,
                    "state": "COLLECTING_ANSWERS",
                    "votedPlayerIds": ["alex"],
                },
            ),
        )
        self.assertIsNone(state.couch_vote_player_id)
        self.assertEqual(state.couch_vote_phase, "SELECT")

    def test_new_couch_session_and_voting_round_start_on_first_voter_page(self) -> None:
        state, _ = reduce(
            AppState(collection_page=73),
            action(
                "COUCH_CREATED",
                snapshot={"id": "session", "revision": 1, "state": "WAITING"},
                recovery=None,
            ),
        )
        self.assertEqual(state.collection_page, 0)

        card = {"id": "card", "cardText": "Never have I ever…"}
        state = replace(
            state,
            collection_page=2,
            couch_snapshot={
                "id": "session",
                "revision": 4,
                "state": "SHOWING_CARD",
                "currentCard": card,
            },
        )
        state, _ = reduce(
            state,
            action(
                "COUCH_UPDATED",
                snapshot={
                    "id": "session",
                    "revision": 5,
                    "state": "COLLECTING_ANSWERS",
                    "currentCard": card,
                    "votedPlayerIds": [],
                },
            ),
        )
        self.assertEqual(state.collection_page, 0)

    def test_recorded_vote_keeps_the_current_stable_voter_page(self) -> None:
        snapshot = {
            "id": "session",
            "revision": 4,
            "state": "COLLECTING_ANSWERS",
            "currentCard": {"id": "card"},
            "votedPlayerIds": [],
        }
        state = AppState(
            route=Route.COUCH_GAME,
            collection_page=2,
            couch_snapshot=snapshot,
        )

        state, _ = reduce(
            state,
            action(
                "COUCH_UPDATED",
                snapshot={
                    **snapshot,
                    "revision": 5,
                    "votedPlayerIds": ["alex"],
                },
            ),
        )

        self.assertEqual(state.collection_page, 2)

    def test_new_named_couch_result_starts_on_first_page_once(self) -> None:
        result = {
            "yes": 1,
            "no": 0,
            "total": 1,
            "namedAnswers": [{"playerId": "alex", "vote": "YES"}],
        }
        previous = {
            "id": "session",
            "revision": 4,
            "roundNumber": 2,
            "currentCard": {"id": "card"},
            "neverHaveIEverVoting": {
                "revealMode": "NAMED_ANSWERS",
                "result": None,
            },
        }
        revealed = {
            **previous,
            "revision": 5,
            "state": "SHOWING_RESULTS",
            "neverHaveIEverVoting": {
                "revealMode": "NAMED_ANSWERS",
                "result": result,
            },
        }
        state = AppState(route=Route.COUCH_GAME, couch_snapshot=previous, auto_page=99)

        state, _ = reduce(state, action("COUCH_UPDATED", snapshot=revealed))
        self.assertEqual(state.auto_page, 0)
        self.assertEqual(state.auto_page_epoch, 1)

        state = replace(state, auto_page=4)
        repeated = {**revealed, "revision": 6}
        state, _ = reduce(state, action("COUCH_UPDATED", snapshot=repeated))
        self.assertEqual(state.auto_page, 4)
        self.assertEqual(state.auto_page_epoch, 1)

    def test_new_named_result_restarts_the_auto_page_clock_on_page_zero(self) -> None:
        answers = [
            {
                "playerId": f"p{index}",
                "displayName": f"Player {index}",
                "vote": "YES",
            }
            for index in range(8)
        ]
        previous = {
            "id": "session",
            "revision": 4,
            "currentCard": {"id": "card"},
            "neverHaveIEverVoting": {
                "revealMode": "NAMED_ANSWERS",
                "result": None,
            },
        }
        revealed = {
            **previous,
            "revision": 5,
            "state": "SHOWING_RESULTS",
            "neverHaveIEverVoting": {
                "revealMode": "NAMED_ANSWERS",
                "result": {
                    "yes": 8,
                    "no": 0,
                    "total": 8,
                    "namedAnswers": answers,
                },
            },
        }
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            application.state = AppState(
                route=Route.COUCH_GAME,
                couch_snapshot=previous,
                auto_page=0,
            )
            application._last_auto_page = 0.0

            with patch("lib.app.time.monotonic", return_value=100.0):
                application.dispatch(action("COUCH_UPDATED", snapshot=revealed))
                application.tick()

            self.assertEqual(application.state.auto_page, 0)
            self.assertEqual(application._last_auto_page, 100.0)
            application.stop()

    def test_new_named_room_result_starts_on_first_page_once(self) -> None:
        before_session = {
            "roundNumber": 7,
            "currentCard": {"id": "card"},
            "neverHaveIEverVoting": {
                "revealMode": "NAMED_ANSWERS",
                "result": None,
            },
        }
        result_session = {
            **before_session,
            "state": "SHOWING_RESULTS",
            "neverHaveIEverVoting": {
                "revealMode": "NAMED_ANSWERS",
                "result": {
                    "yes": 0,
                    "no": 1,
                    "total": 1,
                    "namedAnswers": [{"playerId": "sam", "vote": "NO"}],
                },
            },
        }
        state = AppState(
            route=Route.ROOM_GAME_DISPLAY,
            active_room=DISPLAY_ROOM,
            room_snapshot={"session": before_session},
            auto_page=73,
        )
        snapshot = {
            "participants": [],
            "hostStatus": {"state": "CONNECTED", "displayName": "Host"},
            "settings": {"revision": 1},
            "session": result_session,
        }

        state, _ = reduce(
            state,
            action("WS_ENVELOPE", envelope={"type": "room.snapshot", "payload": snapshot}),
        )
        self.assertEqual(state.auto_page, 0)
        self.assertEqual(state.auto_page_epoch, 1)

        state = replace(state, auto_page=8)
        state, _ = reduce(
            state,
            action("WS_ENVELOPE", envelope={"type": "room.snapshot", "payload": snapshot}),
        )
        self.assertEqual(state.auto_page, 8)
        self.assertEqual(state.auto_page_epoch, 1)

    def test_display_room_join_connects_ws_saves_recovery_and_generates_safe_qr(self) -> None:
        room = ActiveRoom("room", "ABC234", "participant", "secret-ref", "DISPLAY", "DISPLAY_WAITING_FOR_HOST")
        recovery = RecoveryEnvelope(1, SERVER.server_id, SERVER.origin, "ROOM", 1, 1, room_code="ABC234")
        state = AppState(
            route=Route.ROOM_CREATING,
            servers=(SERVER,),
            selected_server_id=SERVER.server_id,
            server_info=SERVER_INFO,
        )
        state, effects = reduce(state, action("ROOM_JOINED", room=room, recovery=recovery))
        self.assertEqual(state.route, Route.ROOM_LOBBY_DISPLAY)
        self.assertEqual(state.transport_state, "CONNECTING")
        self.assertEqual({entry.kind for entry in effects}, {"WS_CONNECT", "GENERATE_ROOM_QR"})

    def test_display_room_join_restarts_a_stale_auto_page_clock(self) -> None:
        recovery = RecoveryEnvelope(
            1,
            SERVER.server_id,
            SERVER.origin,
            "ROOM",
            1,
            1,
            room_code=DISPLAY_ROOM.room_code,
        )
        state = AppState(
            route=Route.ROOM_CREATING,
            servers=(SERVER,),
            selected_server_id=SERVER.server_id,
            server_info=SERVER_INFO,
            auto_page=73,
            auto_page_epoch=4,
        )

        state, _ = reduce(
            state,
            action("ROOM_JOINED", room=DISPLAY_ROOM, recovery=recovery),
        )

        self.assertEqual(state.route, Route.ROOM_LOBBY_DISPLAY)
        self.assertEqual(state.auto_page, 0)
        self.assertEqual(state.auto_page_epoch, 5)

    def test_room_close_removes_qr_and_ignores_a_late_generation_result(self) -> None:
        room = ActiveRoom("room", "ABC234", "participant", "secret-ref", "DISPLAY", "DISPLAY_WAITING_FOR_HOST")
        state = AppState(route=Route.ROOM_LOBBY_DISPLAY, active_room=room, qr_path="room-join.png")
        state, effects = reduce(state, action("ROOM_CLOSED"))
        self.assertEqual({entry.kind for entry in effects}, {"CLEAR_RECOVERY", "CLEAR_ROOM_QR"})
        self.assertEqual(state.route, Route.HOME)
        self.assertIsNone(state.active_room)
        self.assertIsNone(state.room_snapshot)
        self.assertEqual(state.notification.message_id, strings.ROOM_CLOSED)
        self.assertIsNone(state.qr_path)

        state, _ = reduce(state, action("QR_READY", path="late-room-join.png"))
        self.assertIsNone(state.qr_path)

    def test_authoritative_snapshots_drive_host_wait_and_active_game_routes(self) -> None:
        state = AppState(route=Route.ROOM_LOBBY_DISPLAY)
        waiting = {
            "type": "room.snapshot",
            "payload": {"hostStatus": {"state": "AWAITING_FIRST_HOST"}, "session": None},
        }
        state, _ = reduce(state, action("WS_ENVELOPE", envelope=waiting))
        self.assertEqual(state.route, Route.ROOM_LOBBY_DISPLAY)
        active = {
            "type": "room.snapshot",
            "payload": {"hostStatus": {"state": "CONNECTED"}, "session": {"state": "SHOWING_CARD"}},
        }
        state, _ = reduce(state, action("WS_ENVELOPE", envelope=active))
        self.assertEqual(state.route, Route.ROOM_GAME_DISPLAY)
        ended = {"type": "room.snapshot", "payload": {"session": {"state": "ENDED"}}}
        state, _ = reduce(state, action("WS_ENVELOPE", envelope=ended))
        self.assertEqual(state.route, Route.ROOM_SUMMARY_DISPLAY)
        self.assertIs(state.room_snapshot, ended["payload"])
        state = replace(state, auto_page=199, auto_page_epoch=5)
        lobby = {
            "type": "room.snapshot",
            "payload": {
                "hostStatus": {"state": "CONNECTED"},
                "settings": {},
                "participants": [],
                "session": None,
            },
        }
        state, _ = reduce(state, action("WS_ENVELOPE", envelope=lobby))
        self.assertEqual(state.route, Route.ROOM_LOBBY_DISPLAY)
        self.assertIs(state.room_snapshot, lobby["payload"])
        self.assertEqual(state.auto_page, 0)
        self.assertEqual(state.auto_page_epoch, 6)

    def test_first_lobby_to_game_snapshot_restarts_a_stale_auto_page_clock(self) -> None:
        lobby_snapshot = {
            "hostStatus": {"state": "CONNECTED", "displayName": "Host"},
            "participants": [],
            "session": None,
        }
        game_snapshot = {
            **lobby_snapshot,
            "session": {"state": "SHOWING_CARD", "revision": 1},
        }
        state = AppState(
            route=Route.ROOM_LOBBY_DISPLAY,
            active_room=DISPLAY_ROOM,
            room_snapshot=lobby_snapshot,
            auto_page=73,
            auto_page_epoch=4,
        )

        state, _ = reduce(
            state,
            action(
                "WS_ENVELOPE",
                envelope={"type": "room.snapshot", "payload": game_snapshot},
            ),
        )

        self.assertEqual(state.route, Route.ROOM_GAME_DISPLAY)
        self.assertEqual(state.auto_page, 0)
        self.assertEqual(state.auto_page_epoch, 5)

        state = replace(state, auto_page=7)
        state, _ = reduce(
            state,
            action(
                "WS_ENVELOPE",
                envelope={"type": "room.snapshot", "payload": game_snapshot},
            ),
        )
        self.assertEqual(state.auto_page, 7)
        self.assertEqual(state.auto_page_epoch, 5)

    def test_lobby_snapshot_requests_authoritative_eligibility_for_all_players(self) -> None:
        state = AppState(
            route=Route.ROOM_LOBBY_DISPLAY,
            servers=(SERVER,),
            selected_server_id=SERVER.server_id,
            server_info=SERVER_INFO,
        )
        snapshot = {
            "hostStatus": {"state": "CONNECTED"},
            "participants": [
                {
                    "role": "HOST",
                    "devicePlayers": [{"id": "one", "name": "Sam"}],
                }
            ],
            "settings": {"revision": 4, "mode": "CLASSIC_TRUTH_OR_DARE"},
            "session": None,
        }
        state, effects = reduce(
            state,
            action(
                "WS_ENVELOPE",
                envelope={"type": "room.snapshot", "payload": snapshot},
            ),
        )
        self.assertEqual(effects[0].kind, "ELIGIBILITY_PREVIEW")
        self.assertEqual(effects[0].payload["target"], "room")
        self.assertEqual(effects[0].payload["player_count"], 2)
        self.assertNotIn("revision", effects[0].payload["settings"])

    def test_tv_rejects_any_role_change_and_back_uses_safe_confirmation(self) -> None:
        state = AppState(route=Route.ROOM_GAME_DISPLAY)
        state, effects = reduce(
            state,
            action("WS_ENVELOPE", envelope={"type": "room.roleChanged", "payload": {"role": "HOST"}}),
        )
        self.assertEqual(effects[0].kind, "WS_DISCONNECT")
        state, _ = reduce(state, action("BACK"))
        self.assertIsNotNone(state.confirmation)
        self.assertEqual(state.confirmation.confirm_action, "leave-active")

    def test_device_link_is_capability_scoped_and_reloads_private_metadata(self) -> None:
        linked_info = {
            **SERVER_INFO,
            "capabilities": {
                **SERVER_INFO["capabilities"],
                "nativeDeviceAuthorization": True,
            },
        }
        state = AppState(
            route=Route.DEVICE_LINK,
            servers=(SERVER,),
            selected_server_id=SERVER.server_id,
            server_info=linked_info,
        )
        state, effects = reduce(state, action("AUTH_LINK_REQUESTED"))
        self.assertEqual(effects[0].kind, "AUTHORIZE_DEVICE")
        state, _ = reduce(
            state,
            action(
                "AUTHORIZATION_PENDING",
                authorization={"status": "PENDING", "user_code": "ABCD-EFGH"},
                qr_path="device-link.png",
            ),
        )
        self.assertEqual(state.authorization["status"], "PENDING")
        state, effects = reduce(
            state,
            action("AUTHORIZATION_COMPLETE", authorization={"status": "LINKED"}),
        )
        self.assertEqual(state.authorization["status"], "LINKED")
        self.assertEqual(effects[0].kind, "LOAD_METADATA")

    def test_couch_pool_and_ambiguous_commands_require_explicit_recovery(self) -> None:
        snapshot = {
            "id": "00000000-0000-4000-8000-000000000010",
            "revision": 4,
            "state": "SELECTING_CARD",
        }
        state = AppState(
            route=Route.COUCH_GAME,
            couch_snapshot=snapshot,
            servers=(SERVER,),
            selected_server_id=SERVER.server_id,
            server_info=SERVER_INFO,
        )
        state, _ = reduce(
            state,
            action("OPERATION_FAILED", code="CARD_POOL_EXHAUSTED"),
        )
        self.assertTrue(state.couch_pool_exhausted)
        state, _ = reduce(
            state,
            action("OPERATION_FAILED", code="COUCH_STATE_UNRESOLVED"),
        )
        self.assertTrue(state.couch_sync_required)
        self.assertEqual(state.transport_state, "RECONNECTING")
        state, effects = reduce(state, action("COUCH_RESYNC_REQUESTED"))
        self.assertEqual(effects[0].kind, "RESYNC_COUCH")
        self.assertEqual(effects[0].payload["session_id"], snapshot["id"])

    def test_pool_exhaustion_can_end_into_the_existing_setup_editor(self) -> None:
        snapshot = {
            "id": "00000000-0000-4000-8000-000000000010",
            "revision": 4,
            "state": "SELECTING_CARD",
        }
        state = AppState(
            route=Route.COUCH_GAME,
            couch_snapshot=snapshot,
            setup=initial_setup("COUCH", "en-GB", False),
            recovery=RecoveryEnvelope(
                1,
                SERVER.server_id,
                SERVER.origin,
                "COUCH",
                1,
                1,
                couch_session_id=snapshot["id"],
            ),
            servers=(SERVER,),
            selected_server_id=SERVER.server_id,
            server_info=SERVER_INFO,
        )
        state, effects = reduce(state, action("END_COUCH_FOR_SETUP"))
        self.assertEqual(state.couch_end_destination, Route.SETUP_CUSTOMIZE)
        self.assertEqual(effects[0].payload["command"], "end")
        state, effects = reduce(
            state,
            action("COUCH_UPDATED", snapshot={**snapshot, "revision": 5, "state": "ENDED"}),
        )
        self.assertEqual(state.route, Route.SETUP_CUSTOMIZE)
        self.assertIsNone(state.couch_snapshot)
        self.assertIsNone(state.recovery)
        self.assertEqual(effects[0].kind, "CLEAR_RECOVERY")

    def test_ended_couch_clears_history_and_escape_returns_home(self) -> None:
        state = AppState(
            route=Route.COUCH_MENU,
            route_stack=(Route.HOME, Route.COUCH_GAME),
            couch_snapshot={
                "id": "00000000-0000-4000-8000-000000000010",
                "revision": 4,
                "state": "SHOWING_CARD",
            },
            server_info=SERVER_INFO,
        )
        state, _ = reduce(
            state,
            action(
                "COUCH_UPDATED",
                snapshot={
                    "id": "00000000-0000-4000-8000-000000000010",
                    "revision": 5,
                    "state": "ENDED",
                },
            ),
        )
        self.assertEqual(state.route, Route.COUCH_SUMMARY)
        self.assertEqual(state.route_stack, ())
        state, _ = reduce(state, action("BACK"))
        self.assertEqual(state.route, Route.HOME)
        self.assertIsNone(state.couch_snapshot)

    def test_escape_from_ended_open_room_requires_confirmation_and_never_reopens_card(self) -> None:
        room = ActiveRoom(
            "room",
            "ABC234",
            "participant",
            "secret-ref",
            "DISPLAY",
            "DISPLAY_WAITING_FOR_HOST",
        )
        state = AppState(
            route=Route.ROOM_SUMMARY_DISPLAY,
            route_stack=(Route.ROOM_GAME_DISPLAY,),
            active_room=room,
            room_snapshot={"session": {"state": "ENDED"}},
            server_info=SERVER_INFO,
        )
        state, effects = reduce(state, action("BACK"))
        self.assertEqual(state.route, Route.ROOM_SUMMARY_DISPLAY)
        self.assertEqual(state.route_stack, ())
        self.assertEqual(effects, ())
        self.assertIsNotNone(state.confirmation)
        self.assertEqual(
            state.confirmation.title_id,
            strings.ROOM_DISPLAY_LEAVE_TITLE,
        )
        self.assertEqual(
            state.confirmation.body_id,
            strings.ROOM_DISPLAY_LEAVE_BODY,
        )
        self.assertEqual(state.confirmation.confirm_action, "leave-active")
        state, effects = reduce(state, action("LEAVE_ACTIVE", destination=Route.HOME))
        self.assertEqual(effects[0].kind, "WS_LEAVE")
        state, _ = reduce(state, action("LEAVE_COMPLETED"))
        self.assertEqual(state.route, Route.HOME)
        self.assertIsNone(state.active_room)
        self.assertIsNone(state.room_snapshot)

    def test_host_profile_continues_to_customize_without_expected_player_step(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            application.state = AppState(
                route=Route.SETUP_PROFILE,
                setup=initial_setup("HOST", "en-GB", False),
                profiles=(PROFILE,),
            )
            application.activate("setup:profile:PROFILE_FRIENDS")
            self.assertEqual(application.state.route, Route.SETUP_CUSTOMIZE)
            self.assertFalse(hasattr(Route, "SETUP_EXPECTED_PLAYERS"))
            application.stop()

    def test_adult_profile_requires_explicit_confirmation_before_advancing(self) -> None:
        adult_profile = {
            **PROFILE,
            "id": "PROFILE_SPICY",
            "name": "Spicy",
            "requiresAdultConfirmation": True,
        }
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            application.state = AppState(
                route=Route.SETUP_PROFILE,
                setup=initial_setup("HOST", "en-GB", False),
                profiles=(adult_profile,),
            )
            application.activate("setup:profile:PROFILE_SPICY")
            self.assertEqual(application.state.route, Route.SETUP_PROFILE)
            application.activate("setup:adult:confirm")
            self.assertTrue(application.state.setup.adult_content_confirmed)
            self.assertEqual(application.state.route, Route.SETUP_CUSTOMIZE)
            application.stop()

    def test_back_resets_collection_page_between_paginated_setup_screens(self) -> None:
        state = AppState(
            route=Route.SETUP_FLAGS,
            route_stack=(Route.SETUP_CUSTOMIZE,),
            collection_page=1,
        )
        state, _ = reduce(state, action("BACK"))
        self.assertEqual(state.route, Route.SETUP_CUSTOMIZE)
        self.assertEqual(state.collection_page, 0)

    def test_intensity_choices_do_not_mutate_the_other_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            setup = initial_setup("COUCH", "en-GB", True)
            application.state = AppState(route=Route.SETUP_INTENSITY, setup=setup)
            application.activate("setup:option:open:config:maximumIntensity")
            application.activate("setup:option:set:2")
            self.assertEqual(application.state.setup.configuration["startingIntensity"], 1)
            self.assertEqual(application.state.setup.configuration["maximumIntensity"], 2)
            application.activate("setup:option:open:config:startingIntensity")
            application.activate("setup:option:set:3")
            self.assertEqual(application.state.setup.configuration["startingIntensity"], 1)
            self.assertEqual(application.state.setup.configuration["maximumIntensity"], 2)
            self.assertEqual(
                application.state.notification.message_id,
                strings.START_NOT_ABOVE_MAXIMUM,
            )
            application.stop()

    def test_numeric_editor_rejects_out_of_range_values_without_clamping(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            ui = StubUi(number="999")
            application.attach_ui(ui)
            setup = initial_setup("COUCH", "en-GB", True)
            application.state = AppState(route=Route.SETUP_INTENSITY, setup=setup)
            original = setup.configuration["intensityProgressionInterval"]
            application.activate("setup:value:intensityProgressionInterval")
            self.assertEqual(
                application.state.setup.configuration["intensityProgressionInterval"],
                original,
            )
            self.assertEqual(application.state.notification.message_id, strings.NUMBER_RANGE)
            self.assertEqual(ui.number_requests[0][0], strings.PROGRESSION_INTERVAL)
            application.stop()

    def test_fallback_language_can_be_added_while_enabled_list_is_empty(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            setup = replace(
                initial_setup("COUCH", "en-GB", True),
                card_fallback_enabled=True,
                card_fallback_locales=(),
            )
            application.state = AppState(
                route=Route.SETUP_CARD_LANGUAGE,
                setup=setup,
                locales=(
                    {"id": "en-GB", "nativeName": "English"},
                    {"id": "de-DE", "nativeName": "Deutsch"},
                ),
            )
            application.activate("setup:language:fallbacks")
            application.activate("setup:language:fallback-add")
            application.activate("setup:language:fallback-add-set:de-DE")
            self.assertEqual(application.state.route, Route.SETUP_CARD_LANGUAGE_FALLBACKS)
            self.assertEqual(application.state.setup.card_fallback_locales, ("de-DE",))
            application.stop()

    def test_enabling_empty_fallback_opens_language_choice_without_invalid_preview(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            setup = initial_setup("COUCH", "en-GB", True)
            application.state = AppState(
                route=Route.SETUP_CARD_LANGUAGE,
                setup=setup,
                locales=(
                    {"id": "en-GB", "nativeName": "English"},
                    {"id": "de-DE", "nativeName": "Deutsch"},
                ),
            )
            application.activate("setup:language:fallback-on")
            self.assertEqual(
                application.state.route,
                Route.SETUP_CARD_LANGUAGE_FALLBACK_ADD,
            )
            self.assertFalse(application.state.setup.card_fallback_enabled)
            application.activate("setup:language:fallback-add-set:de-DE")
            self.assertTrue(application.state.setup.card_fallback_enabled)
            self.assertEqual(
                application.state.setup.room_settings()["cardFallbackEnabled"],
                True,
            )
            application.stop()

    def test_card_rule_selection_shortcuts_update_every_available_value(self) -> None:
        rule_id = "00000000-0000-4000-8000-000000000001"
        taxonomy = {
            "questionCategories": [
                {"id": "CAT_EVERYDAY", "label": "Everyday"},
                {"id": "CAT_FRIENDSHIP", "label": "Friendship"},
                {"id": "CAT_RELATIONSHIP", "label": "Relationships"},
            ],
            "dareTypes": [],
        }
        rule = {
            "id": rule_id,
            "name": "Topics",
            "order": 0,
            "enabled": True,
            "predicate": {"questionCategoryIds": ["CAT_EVERYDAY"]},
            "directives": {},
        }
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            setup = replace(
                initial_setup("COUCH", "en-GB", True),
                card_policy={
                    "scopeDefault": {},
                    "conditionalRules": [rule],
                    "exactCards": [],
                },
                selected_rule_id=rule_id,
                policy_facet="questionCategoryIds",
            )
            application.state = AppState(
                route=Route.SETUP_POLICY_VALUES,
                setup=setup,
                taxonomy=taxonomy,
            )

            application.activate("setup:predicate:all")
            predicate = application.state.setup.card_policy["conditionalRules"][0][
                "predicate"
            ]
            self.assertEqual(
                predicate["questionCategoryIds"],
                ["CAT_EVERYDAY", "CAT_FRIENDSHIP", "CAT_RELATIONSHIP"],
            )
            application.activate("setup:predicate:none")
            predicate = application.state.setup.card_policy["conditionalRules"][0][
                "predicate"
            ]
            self.assertNotIn("questionCategoryIds", predicate)

            application.state = replace(
                application.state,
                route=Route.SETUP_FLAGS,
            )
            application.activate("setup:flag:none")
            self.assertEqual(
                set(application.state.setup.configuration["blockedOperationalFlags"]),
                set(OPERATIONAL_FLAG_LABELS),
            )
            application.activate("setup:flag:all")
            self.assertEqual(
                application.state.setup.configuration["blockedOperationalFlags"],
                [],
            )
            application.stop()

    def test_remove_player_waits_for_confirmation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            setup = replace(
                initial_setup("COUCH", "en-GB", True),
                players=("Alex", "Sam", "Jo"),
                selected_player_index=1,
            )
            application.state = AppState(
                route=Route.SETUP_PLAYER,
                route_stack=(Route.SETUP_PLAYERS,),
                setup=setup,
            )
            application.activate("setup:player:remove:1")
            self.assertIsNotNone(application.state.confirmation)
            self.assertEqual(application.state.setup.players, ("Alex", "Sam", "Jo"))
            application.confirm()
            self.assertEqual(application.state.setup.players, ("Alex", "Jo"))
            self.assertEqual(application.state.route, Route.SETUP_PLAYERS)
            application.stop()

    def test_remove_fallback_and_reset_card_wait_for_confirmation(self) -> None:
        card_id = "00000000-0000-4000-8000-000000000002"
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            setup = replace(
                initial_setup("COUCH", "en-GB", True),
                card_fallback_enabled=True,
                card_fallback_locales=("de-DE",),
                selected_fallback_locale="de-DE",
            )
            application.state = AppState(
                route=Route.SETUP_CARD_LANGUAGE_FALLBACK,
                route_stack=(Route.SETUP_CARD_LANGUAGE_FALLBACKS,),
                setup=setup,
            )
            application.activate("setup:language:fallback-remove:de-DE")
            self.assertEqual(application.state.setup.card_fallback_locales, ("de-DE",))
            application.confirm()
            self.assertEqual(application.state.setup.card_fallback_locales, ())
            self.assertFalse(application.state.setup.card_fallback_enabled)

            setup = replace(
                application.state.setup,
                selected_card_id=card_id,
                card_policy={
                    "scopeDefault": {},
                    "conditionalRules": [],
                    "exactCards": [
                        {
                            "cardId": card_id,
                            "directives": {"availability": "EXCLUDE"},
                        }
                    ],
                },
            )
            application.state = replace(
                application.state,
                route=Route.SETUP_EXACT_CARD,
                setup=setup,
            )
            application.activate("setup:directive:reset")
            self.assertEqual(len(application.state.setup.card_policy["exactCards"]), 1)
            application.confirm()
            self.assertEqual(application.state.setup.card_policy["exactCards"], [])
            application.stop()

    def test_conditional_rule_delete_waits_for_confirmation(self) -> None:
        rule = {
            "id": "00000000-0000-4000-8000-000000000001",
            "name": "Questions",
            "order": 0,
            "enabled": True,
            "predicate": {},
            "directives": {},
        }
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            setup = replace(
                initial_setup("COUCH", "en-GB", True),
                card_policy={
                    "scopeDefault": {},
                    "conditionalRules": [rule],
                    "exactCards": [],
                },
                selected_rule_id=rule["id"],
            )
            application.state = AppState(
                route=Route.SETUP_POLICY_RULE,
                route_stack=(Route.SETUP_POLICY_RULES,),
                setup=setup,
            )
            application.activate("setup:rule:delete")
            self.assertIsNotNone(application.state.confirmation)
            self.assertEqual(len(application.state.setup.card_policy["conditionalRules"]), 1)
            application.confirm()
            self.assertEqual(application.state.route, Route.SETUP_POLICY_RULES)
            self.assertEqual(application.state.setup.card_policy["conditionalRules"], [])
            application.stop()

    def test_exact_card_selection_previews_complete_copy_before_configuration(self) -> None:
        card_id = "00000000-0000-4000-8000-000000000002"
        card_text = "START " + ("W" * 9_988) + " END"
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            setup = replace(
                initial_setup("COUCH", "en-GB", True),
                card_search_results=({"id": card_id, "text": card_text},),
                card_search_total=1,
            )
            application.state = AppState(
                route=Route.SETUP_EXACT_CARDS,
                route_stack=(Route.SETUP_CARD_POLICY,),
                setup=setup,
            )

            application.activate(f"setup:card:edit:{card_id}")

            self.assertEqual(application.state.route, Route.SETUP_EXACT_CARD_PREVIEW)
            self.assertEqual(application.state.setup.selected_card_id, card_id)
            self.assertGreater(present(application.state).card_page_count, 1)

            application.activate("setup:card:configure")

            self.assertEqual(application.state.route, Route.SETUP_EXACT_CARD)
            application.back()
            self.assertEqual(application.state.route, Route.SETUP_EXACT_CARD_PREVIEW)
            application.stop()

    def test_back_from_display_settings_resumes_game_without_leave_confirmation(self) -> None:
        room = ActiveRoom(
            "room",
            "ABC234",
            "participant",
            "secret-ref",
            "DISPLAY",
            "DISPLAY_WAITING_FOR_HOST",
        )
        state = AppState(
            route=Route.ROOM_DISPLAY_MENU,
            route_stack=(Route.ROOM_GAME_DISPLAY,),
            active_room=room,
        )
        state, effects = reduce(state, action("BACK"))
        self.assertEqual(state.route, Route.ROOM_GAME_DISPLAY)
        self.assertIsNone(state.confirmation)
        self.assertEqual(effects, ())

    def test_room_snapshot_preserves_roster_auto_page_and_requests_card_locale(self) -> None:
        room = ActiveRoom(
            "room",
            "ABC234",
            "participant",
            "secret-ref",
            "DISPLAY",
            "DISPLAY_WAITING_FOR_HOST",
        )
        state = AppState(
            route=Route.ROOM_LOBBY_DISPLAY,
            active_room=room,
            auto_page=3,
            taxonomy={"questionCategories": [], "dareTypes": []},
            taxonomy_locale="en-GB",
        )
        snapshot = {
            "settings": {
                "revision": 1,
                "cardLocale": "de-DE",
                "mode": "CLASSIC_TRUTH_OR_DARE",
            },
            "participants": [],
            "hostStatus": {"state": "CONNECTED", "displayName": "Alex"},
            "session": None,
        }
        state, effects = reduce(
            state,
            action("WS_ENVELOPE", envelope={"type": "room.snapshot", "payload": snapshot}),
        )
        self.assertEqual(state.auto_page, 3)
        self.assertEqual(state.taxonomy_locale, "de-DE")
        self.assertIsNone(state.taxonomy)
        self.assertIn("LOAD_TAXONOMY", [entry.kind for entry in effects])

    def test_group_update_preserves_private_defaults_and_returns_to_list(self) -> None:
        group = {
            "id": "00000000-0000-4000-8000-000000000010",
            "name": "Friends",
            "members": ["Alex", "Sam"],
            "preferredProfileId": "PROFILE_FRIENDS",
            "customConfiguration": None,
            "cardLanguageSettings": None,
        }
        state = AppState(
            route=Route.GROUP_LIST,
            groups=(group,),
            servers=(SERVER,),
            selected_server_id=SERVER.server_id,
            server_info=SERVER_INFO,
        )
        state, _ = reduce(state, action("GROUP_DRAFT_STARTED", group=group))
        self.assertEqual(state.group_draft_id, group["id"])
        state, effects = reduce(
            state,
            action(
                "UPDATE_GROUP_REQUESTED",
                group_id=group["id"],
                name="Close friends",
                members=("Alex", "Sam", "Jo"),
            ),
        )
        self.assertEqual(effects[0].kind, "UPDATE_GROUP")
        self.assertEqual(effects[0].payload["group"]["preferredProfileId"], "PROFILE_FRIENDS")

    def test_clear_recent_servers_preserves_game_recovery(self) -> None:
        recovery = RecoveryEnvelope(
            1,
            SERVER.server_id,
            SERVER.origin,
            "COUCH",
            1,
            1,
            couch_session_id="00000000-0000-4000-8000-000000000010",
        )
        state = AppState(
            route=Route.PREFERENCES,
            servers=(SERVER,),
            selected_server_id=SERVER.server_id,
            server_info=SERVER_INFO,
            recovery=recovery,
        )
        state, effects = reduce(state, action("CLEAR_RECENT_SERVERS"))
        self.assertEqual(state.servers, ())
        self.assertEqual(state.recovery, recovery)
        self.assertEqual({entry.kind for entry in effects}, {"SAVE_STORAGE", "DISCOVER_SERVERS"})

    def test_card_text_pages_are_bounded_and_consumed_without_changing_game_actions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            application.state = AppState(
                route=Route.COUCH_GAME,
                couch_snapshot={
                    "state": "SHOWING_CARD",
                    "players": [{"id": "player", "name": "Player"}],
                    "activePlayer": {"id": "player", "name": "Player"},
                    "currentCard": {
                        "id": "card-one",
                        "cardText": "W" * 10_000,
                        "cardType": "QUESTION",
                    },
                },
            )
            page_count = present(application.state).card_page_count
            self.assertGreater(page_count, 1)
            self.assertTrue(application.change_card_page(1))
            self.assertEqual(application.state.card_page, 1)
            for _ in range(page_count + 2):
                self.assertTrue(application.change_card_page(1))
            self.assertEqual(application.state.card_page, page_count - 1)
            self.assertTrue(application.change_card_page(-1))
            self.assertEqual(application.state.card_page, page_count - 2)

    def test_new_couch_and_room_cards_reset_card_text_page(self) -> None:
        couch_before = {
            "state": "SHOWING_CARD",
            "currentCard": {"id": "card-one", "cardText": "W" * 1_000},
        }
        couch_state = AppState(
            route=Route.COUCH_GAME,
            couch_snapshot=couch_before,
            card_page=2,
        )
        same_couch, _ = reduce(
            couch_state,
            action("COUCH_UPDATED", snapshot={**couch_before, "revision": 2}),
        )
        self.assertEqual(same_couch.card_page, 2)
        next_couch, _ = reduce(
            couch_state,
            action(
                "COUCH_UPDATED",
                snapshot={
                    **couch_before,
                    "currentCard": {"id": "card-two", "cardText": "W" * 1_000},
                },
            ),
        )
        self.assertEqual(next_couch.card_page, 0)

        room_state = AppState(
            route=Route.ROOM_GAME_DISPLAY,
            room_snapshot={"session": couch_before},
            card_page=3,
        )
        next_room, _ = reduce(
            room_state,
            action(
                "WS_ENVELOPE",
                envelope={
                    "type": "room.snapshot",
                    "payload": {
                        "participants": [],
                        "hostStatus": {"state": "CONNECTED"},
                        "session": {
                            **couch_before,
                            "currentCard": {"id": "card-two", "cardText": "W" * 1_000},
                        },
                    },
                },
            ),
        )
        self.assertEqual(next_room.card_page, 0)


if __name__ == "__main__":
    unittest.main()
