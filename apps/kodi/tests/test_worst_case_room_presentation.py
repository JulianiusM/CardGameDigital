from __future__ import annotations

import unittest

from support import RESOURCES_ROOT  # noqa: F401 - installs the Kodi resource import path
from lib import strings
from lib.presentation import (
    GAME_ROSTER_PAGE_SIZE,
    LOBBY_ROSTER_PAGE_SIZE,
    present,
)
from lib.routes import Route
from lib.state import ActiveRoom, AppState, ServerRecord


ROOM_CODE = "ABC234"
DISPLAY_ROOM = ActiveRoom(
    "00000000-0000-4000-8000-000000000001",
    ROOM_CODE,
    "00000000-0000-4000-8000-000000000002",
    "secret-reference",
    "DISPLAY",
    "DISPLAY_WAITING_FOR_HOST",
)


def maximum_w_name(index: int) -> str:
    stem = f"W{index:04d}"
    return stem + ("W" * (40 - len(stem)))


def maximum_roster() -> tuple[list[dict], list[dict]]:
    participants: list[dict] = []
    flattened: list[dict] = []
    for index in range(500):
        owner_name = maximum_w_name(index)
        player_name = maximum_w_name(index + 500)
        participant_id = f"participant-{index}"
        player_id = f"device-player-{index}"
        participants.append(
            {
                "id": participant_id,
                "role": "HOST" if index == 0 else "PLAYER",
                "displayName": owner_name,
                "connectionStatus": "CONNECTED",
                "devicePlayers": [{"id": player_id, "name": player_name}],
            }
        )
        flattened.extend(
            (
                {"id": participant_id, "name": owner_name, "owner": None},
                {"id": player_id, "name": player_name, "owner": owner_name},
            )
        )
    return participants, flattened


class WorstCaseRoomPresentationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.participants, cls.flattened = maximum_roster()
        names = [entry["name"] for entry in cls.flattened]
        if len(names) != 1_000 or len(set(names)) != 1_000:
            raise AssertionError("Worst-case fixture must contain 1,000 unique names")
        if any(len(name) != 40 or any(character.isspace() for character in name) for name in names):
            raise AssertionError("Every worst-case name must be 40 characters without spaces")
        if any(name.count("W") < 36 for name in names):
            raise AssertionError("Worst-case names must use the widest fixture glyph")

    def lobby_snapshot(self) -> dict:
        return {
            "participants": self.participants,
            "capacity": {"maximumParticipants": 1_000, "maximumPlayers": 1_000},
            "hostStatus": {
                "state": "CONNECTED",
                "participantId": self.participants[0]["id"],
                "displayName": self.participants[0]["displayName"],
                "deadline": None,
            },
            "settings": {
                "revision": 1,
                "updatedByParticipantId": self.participants[0]["id"],
                "configuration": {},
            },
            "session": None,
        }

    def game_snapshot(self) -> dict:
        snapshot = self.lobby_snapshot()
        snapshot["session"] = {
            "state": "SHOWING_CARD",
            "players": [],
            "activePlayer": {
                "id": self.flattened[0]["id"],
                "name": self.flattened[0]["name"],
            },
            "roundNumber": 1_000,
            "cardsShown": 1_000,
            "remainingCardCount": 1_000,
            "currentCard": {
                "id": "00000000-0000-4000-8000-000000000003",
                "cardText": "Worst-case roster projection",
                "cardType": "QUESTION",
                "questionCategoryId": "CAT_EVERYDAY",
                "dareTypeId": None,
                "cardIntensity": 3,
                "intensity": 3,
            },
            "neverHaveIEverVoting": None,
        }
        return snapshot

    def test_normal_names_use_dense_pages_without_changing_their_text(self) -> None:
        participants = [
            {
                "id": f"normal-{index}",
                "role": "HOST" if index == 0 else "PLAYER",
                "displayName": f"Player {index + 1}",
                "connectionStatus": "CONNECTED",
                "devicePlayers": [],
            }
            for index in range(9)
        ]
        lobby_snapshot = {
            "participants": participants,
            "capacity": {"maximumPlayers": 20},
            "hostStatus": {"state": "CONNECTED", "displayName": "Player 1"},
            "settings": {"configuration": {}},
            "session": None,
        }
        first = present(
            AppState(
                route=Route.ROOM_LOBBY_DISPLAY,
                active_room=DISPLAY_ROOM,
                room_snapshot=lobby_snapshot,
            )
        )
        second = present(
            AppState(
                route=Route.ROOM_LOBBY_DISPLAY,
                active_room=DISPLAY_ROOM,
                room_snapshot=lobby_snapshot,
                auto_page=1,
            )
        )
        self.assertEqual(
            [entry.label.literal for entry in first.roster],
            [f"Player {index}" for index in range(1, 9)],
        )
        self.assertEqual([entry.label.literal for entry in second.roster], ["Player 9"])
        self.assertTrue(
            all("\n" not in (entry.label.literal or "") for entry in first.roster)
        )

    def assert_roster_page(
        self,
        view,
        page_index: int,
        page_size: int,
        total_pages: int,
    ) -> None:
        start = page_index * page_size
        expected = self.flattened[start : start + page_size]
        self.assertEqual(len(view.roster), len(expected))
        for rendered, source in zip(view.roster, expected):
            with self.subTest(page=page_index, player=source["id"]):
                self.assertEqual(rendered.key, f"roster:{source['id']}")
                self.assertIsNotNone(rendered.label.literal)
                self.assertEqual(rendered.label.literal, source["name"])
                self.assertNotIn("\n", rendered.label.literal)
                if source["owner"] is not None:
                    self.assertEqual(rendered.secondary.message_id, strings.ON_DEVICE)
                    self.assertEqual(len(rendered.secondary.arguments), 1)
                    self.assertEqual(rendered.secondary.arguments[0], source["owner"])
                    self.assertNotIn("\n", str(rendered.secondary.arguments[0]))
        self.assertGreaterEqual(total_pages, 100)

    def test_lobby_first_middle_and_last_pages_preserve_maximum_names(self) -> None:
        self.assertEqual(LOBBY_ROSTER_PAGE_SIZE, 8)
        total_pages = 125
        for page_index in (0, total_pages // 2, total_pages - 1):
            with self.subTest(page=page_index):
                view = present(
                    AppState(
                        route=Route.ROOM_LOBBY_DISPLAY,
                        active_room=DISPLAY_ROOM,
                        room_snapshot=self.lobby_snapshot(),
                        auto_page=page_index,
                    )
                )
                self.assertEqual(view.view_mode, "lobby")
                self.assertEqual(view.actions, ())
                self.assertIsNone(view.pagination)
                self.assertIsNone(view.preferred_focus)
                self.assert_roster_page(
                    view,
                    page_index,
                    LOBBY_ROSTER_PAGE_SIZE,
                    total_pages,
                )
                self.assertEqual(view.footer.message_id, strings.PLAYER_CAPACITY_PAGE)
                self.assertEqual(
                    view.footer.arguments,
                    (1_000, 1_000, page_index + 1, total_pages),
                )

    def test_game_first_middle_and_last_pages_preserve_maximum_names(self) -> None:
        self.assertEqual(GAME_ROSTER_PAGE_SIZE, 5)
        total_pages = 200
        for page_index in (0, total_pages // 2, total_pages - 1):
            with self.subTest(page=page_index):
                view = present(
                    AppState(
                        route=Route.ROOM_GAME_DISPLAY,
                        active_room=DISPLAY_ROOM,
                        room_snapshot=self.game_snapshot(),
                        auto_page=page_index,
                    )
                )
                self.assertEqual(view.view_mode, "card")
                self.assertEqual(view.actions, ())
                self.assertIsNone(view.pagination)
                self.assertIsNone(view.preferred_focus)
                self.assert_roster_page(
                    view,
                    page_index,
                    GAME_ROSTER_PAGE_SIZE,
                    total_pages,
                )
                self.assertEqual(view.footer.message_id, strings.PAGE_STATUS)
                self.assertEqual(view.footer.arguments, (page_index + 1, total_pages))

    def test_every_normal_and_exceptional_player_is_reached_once_per_cycle(self) -> None:
        for route, page_size in (
            (Route.ROOM_LOBBY_DISPLAY, LOBBY_ROSTER_PAGE_SIZE),
            (Route.ROOM_GAME_DISPLAY, GAME_ROSTER_PAGE_SIZE),
        ):
            if route == Route.ROOM_LOBBY_DISPLAY:
                snapshot = self.lobby_snapshot()
            else:
                snapshot = self.game_snapshot()
            total_pages = (len(self.flattened) + page_size - 1) // page_size
            reached: list[str] = []
            for page in range(total_pages):
                view = present(
                    AppState(
                        route=route,
                        active_room=DISPLAY_ROOM,
                        room_snapshot=snapshot,
                        auto_page=page,
                    )
                )
                reached.extend(entry.key for entry in view.roster)
            with self.subTest(route=route):
                self.assertEqual(len(reached), len(self.flattened))
                self.assertEqual(len(set(reached)), len(self.flattened))

    def test_every_advertised_join_address_page_is_reachable_and_complete(self) -> None:
        long_hostname = ("h" * 63) + ".example.test"
        bases = (
            "http://10.0.0.10:3000",
            f"https://{long_hostname}",
            "http://192.168.100.200:3000",
            "https://party.example.test",
            "http://[fd00::1234]:3000",
        )
        expected_urls = [f"{base}/play/?room={ROOM_CODE}" for base in bases]
        reached: list[str] = []
        for page_index, expected_url in enumerate(expected_urls):
            with self.subTest(page=page_index):
                view = present(
                    AppState(
                        route=Route.ROOM_LOBBY_DISPLAY,
                        active_room=DISPLAY_ROOM,
                        room_snapshot=self.lobby_snapshot(),
                        server_info={
                            "roomAccess": {
                                "configuredBaseUrl": None,
                                "availableBaseUrls": list(bases),
                            },
                            "endpoints": {
                                "roomJoinPathTemplate": "/play/?room={roomCode}",
                            },
                        },
                        auto_page=page_index,
                    )
                )
                self.assertIsNotNone(view.join_urls.literal)
                reconstructed = view.join_urls.literal.replace("\n", "")
                reached.append(reconstructed)
                self.assertEqual(reconstructed, expected_url)
                self.assertEqual(view.join_url_status.message_id, strings.JOIN_ADDRESS_STATUS)
                self.assertEqual(
                    view.join_url_status.arguments,
                    (page_index + 1, len(expected_urls)),
                )
                if long_hostname in expected_url:
                    self.assertIn("\n", view.join_urls.literal)
        self.assertEqual(reached, expected_urls)

    def test_diagnostics_preserves_the_complete_server_uuid_on_one_line(self) -> None:
        server_id = "12345678-1234-4234-8234-123456789abc"
        server = ServerRecord(
            server_id,
            "http://127.0.0.1:3000",
            "Worst-case diagnostics server",
            "local",
            "manual",
            1.0,
        )
        view = present(
            AppState(
                route=Route.DIAGNOSTICS,
                servers=(server,),
                selected_server_id=server_id,
            )
        )
        identifier = next(
            entry for entry in view.items if entry.key == "diagnostics:server-id"
        )
        self.assertIsNotNone(identifier.secondary.literal)
        self.assertNotIn("\n", identifier.secondary.literal)
        self.assertEqual(identifier.secondary.literal, server_id)


if __name__ == "__main__":
    unittest.main()
