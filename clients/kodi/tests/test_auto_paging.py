from __future__ import annotations

import copy
import tempfile
import unittest
from dataclasses import replace
from unittest.mock import patch

from support import RESOURCES_ROOT
from lib.app import (
    GAME_ROSTER_LABEL_WIDTH,
    MARQUEE_FINAL_HOLD_SECONDS,
    MARQUEE_INITIAL_HOLD_SECONDS,
    MARQUEE_SCROLL_PIXELS_PER_SECOND,
    RESULT_NAME_LABEL_WIDTH,
    RESULT_NAME_MAX_GLYPH_WIDTH,
    ROSTER_NAME_MAX_GLYPH_WIDTH,
    ROSTER_SECONDARY_MAX_GLYPH_WIDTH,
    Application,
    _display_width_units,
    auto_page_interval_seconds,
)
from lib.routes import Route
from lib.state import ActiveRoom, AppState, Preferences


MAXIMUM_PLAYER_COUNT = 1_000
MAXIMUM_NAME_LENGTH = 40
ROOM = ActiveRoom(
    "00000000-0000-4000-8000-000000000001",
    "ABC234",
    "00000000-0000-4000-8000-000000000002",
    "fixture-reference",
    "DISPLAY",
    "DISPLAY_WAITING_FOR_HOST",
)


def _maximum_name(index: int) -> str:
    prefix = f"W{index:04d}"
    return prefix + ("W" * (MAXIMUM_NAME_LENGTH - len(prefix)))


def _room_game_state(auto_page: int = 0) -> AppState:
    players = [
        {"id": f"player-{index}", "name": _maximum_name(index)}
        for index in range(MAXIMUM_PLAYER_COUNT)
    ]
    return AppState(
        route=Route.ROOM_GAME_DISPLAY,
        preferences=Preferences(locale="de-DE", auto_page_seconds=5),
        active_room=ROOM,
        room_snapshot={
            "participants": [],
            "session": {
                "state": "COLLECTING_ANSWERS",
                "players": players,
                "activePlayer": players[-1],
                "neverHaveIEverVoting": {"progress": [], "result": None},
            },
        },
        auto_page=auto_page,
    )


def _snapshot_with_uniform_name(state: AppState, name: str) -> dict:
    snapshot = copy.deepcopy(state.room_snapshot)
    players = snapshot["session"]["players"]
    for player in players:
        player["name"] = name
    snapshot["session"]["activePlayer"] = players[-1]
    return snapshot


class AutoPageTimingTests(unittest.TestCase):
    def test_thousand_player_late_page_waits_for_its_longest_visible_name(self) -> None:
        state = _room_game_state(auto_page=199)

        interval = auto_page_interval_seconds(state)
        expected = (
            MARQUEE_INITIAL_HOLD_SECONDS
            + (
                MAXIMUM_NAME_LENGTH * ROSTER_NAME_MAX_GLYPH_WIDTH
                - GAME_ROSTER_LABEL_WIDTH
            )
            / MARQUEE_SCROLL_PIXELS_PER_SECOND
            + MARQUEE_FINAL_HOLD_SECONDS
        )

        self.assertEqual(interval, expected)
        self.assertGreater(interval, state.preferences.auto_page_seconds)
        self.assertAlmostEqual(interval, 21.0333333333)

    def test_german_device_owner_affix_finishes_before_room_page_advance(self) -> None:
        owner = "W" * MAXIMUM_NAME_LENGTH
        participants = [
            {
                "id": f"participant-{index}",
                "role": "PLAYER",
                "displayName": f"P{index}",
                "connectionStatus": "CONNECTED",
                "devicePlayers": [
                    {"id": f"device-player-{index}", "name": f"Spieler {index}"}
                ],
            }
            for index in range(6)
        ]
        # Five entries fit. Page two starts with participant two's represented
        # player, so the long German owner is visible only in the secondary
        # "Auf dem Gerät von ..." marquee, not as a name tile on this page.
        participants[2]["displayName"] = owner
        state = AppState(
            route=Route.ROOM_GAME_DISPLAY,
            preferences=Preferences(locale="de-DE", auto_page_seconds=5),
            active_room=ROOM,
            room_snapshot={
                "participants": participants,
                "session": {
                    "state": "COLLECTING_ANSWERS",
                    "players": [],
                    "neverHaveIEverVoting": {"progress": [], "result": None},
                },
            },
            auto_page=1,
        )

        interval = auto_page_interval_seconds(state)
        exact_german_secondary = f"Auf dem Gerät von {owner}"
        required_for_german = (
            MARQUEE_INITIAL_HOLD_SECONDS
            + (
                _display_width_units(exact_german_secondary)
                * ROSTER_SECONDARY_MAX_GLYPH_WIDTH
                - GAME_ROSTER_LABEL_WIDTH
            )
            / MARQUEE_SCROLL_PIXELS_PER_SECOND
            + MARQUEE_FINAL_HOLD_SECONDS
        )

        self.assertGreaterEqual(interval, required_for_german)

    def test_named_result_uses_its_current_late_page_names(self) -> None:
        players = [
            {"id": f"player-{index}", "name": _maximum_name(index)}
            for index in range(MAXIMUM_PLAYER_COUNT)
        ]
        answers = [
            {
                "playerId": player["id"],
                "displayName": player["name"],
                "vote": "YES" if index % 2 == 0 else "NO",
            }
            for index, player in enumerate(players)
        ]
        state = AppState(
            route=Route.COUCH_GAME,
            preferences=Preferences(locale="de-DE", auto_page_seconds=5),
            couch_snapshot={
                "state": "SHOWING_RESULTS",
                "players": players,
                "neverHaveIEverVoting": {
                    "revealMode": "NAMED_ANSWERS",
                    "result": {
                        "yes": 500,
                        "no": 500,
                        "total": 1_000,
                        "namedAnswers": answers,
                    },
                },
            },
            auto_page=99,
        )

        interval = auto_page_interval_seconds(state)
        expected = (
            MARQUEE_INITIAL_HOLD_SECONDS
            + (
                MAXIMUM_NAME_LENGTH * RESULT_NAME_MAX_GLYPH_WIDTH
                - RESULT_NAME_LABEL_WIDTH
            )
            / MARQUEE_SCROLL_PIXELS_PER_SECOND
            + MARQUEE_FINAL_HOLD_SECONDS
        )

        self.assertEqual(interval, expected)
        self.assertGreater(interval, state.preferences.auto_page_seconds)

    def test_application_cannot_advance_before_computed_page_dwell(self) -> None:
        state = _room_game_state(auto_page=199)
        expected = auto_page_interval_seconds(state)
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            application.state = state
            application._last_auto_page = 0.0
            try:
                with patch("lib.app.time.monotonic", return_value=expected - 0.001):
                    application.tick()
                self.assertEqual(application.state.auto_page, 199)

                with patch("lib.app.time.monotonic", return_value=expected + 0.001):
                    application.tick()
                self.assertEqual(application.state.auto_page, 200)
            finally:
                application.effects.shutdown()

    def test_longer_name_from_same_page_snapshot_restarts_the_page_clock(self) -> None:
        long_state = _room_game_state()
        short_state = replace(
            long_state,
            room_snapshot=_snapshot_with_uniform_name(long_state, "A"),
            revision=1,
        )
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            application.state = short_state
            application._last_auto_page = 100.0
            try:
                with patch("lib.app.time.monotonic", return_value=100.0):
                    application.tick()
                self.assertEqual(application._last_auto_page, 100.0)

                application.state = replace(
                    application.state,
                    room_snapshot=copy.deepcopy(long_state.room_snapshot),
                    revision=2,
                )
                with patch("lib.app.time.monotonic", return_value=104.0):
                    application.tick()

                self.assertEqual(application.state.auto_page, 0)
                self.assertEqual(application._last_auto_page, 104.0)
            finally:
                application.effects.shutdown()

    def test_equal_same_page_updates_do_not_perpetually_postpone_advancement(self) -> None:
        state = _room_game_state()
        required = auto_page_interval_seconds(state)
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            application.state = state
            application._last_auto_page = 100.0
            try:
                with patch("lib.app.time.monotonic", return_value=100.0):
                    application.tick()
                for revision, now in ((1, 110.0), (2, 120.0)):
                    application.state = replace(
                        application.state,
                        room_snapshot=copy.deepcopy(state.room_snapshot),
                        revision=revision,
                    )
                    with patch("lib.app.time.monotonic", return_value=now):
                        application.tick()
                    self.assertEqual(application._last_auto_page, 100.0)

                finished_at = 100.0 + required + 0.001
                application.state = replace(
                    application.state,
                    room_snapshot=copy.deepcopy(state.room_snapshot),
                    revision=3,
                )
                with patch("lib.app.time.monotonic", return_value=finished_at):
                    application.tick()

                self.assertEqual(application.state.auto_page, 1)
                self.assertEqual(application._last_auto_page, finished_at)
            finally:
                application.effects.shutdown()

    def test_shorter_same_page_updates_do_not_restart_the_existing_clock(self) -> None:
        state = _room_game_state()
        short_snapshot = _snapshot_with_uniform_name(state, "A")
        short_interval = auto_page_interval_seconds(
            replace(state, room_snapshot=short_snapshot)
        )
        with tempfile.TemporaryDirectory() as directory:
            application = Application(directory)
            application.state = state
            application._last_auto_page = 100.0
            try:
                with patch("lib.app.time.monotonic", return_value=100.0):
                    application.tick()
                application.state = replace(
                    application.state,
                    room_snapshot=short_snapshot,
                    revision=1,
                )
                with patch("lib.app.time.monotonic", return_value=104.0):
                    application.tick()
                self.assertEqual(application.state.auto_page, 0)
                self.assertEqual(application._last_auto_page, 100.0)

                application.state = replace(
                    application.state,
                    room_snapshot=copy.deepcopy(short_snapshot),
                    revision=2,
                )
                finished_at = 100.0 + short_interval + 0.001
                with patch("lib.app.time.monotonic", return_value=finished_at):
                    application.tick()

                self.assertEqual(application.state.auto_page, 1)
                self.assertEqual(application._last_auto_page, finished_at)
            finally:
                application.effects.shutdown()

    def test_measured_skin_labels_pin_the_modeled_scroll_speed(self) -> None:
        skin = (
            RESOURCES_ROOT
            / "skins"
            / "Default"
            / "1080i"
            / "script-partycard-tv-main.xml"
        ).read_text(encoding="utf-8")

        self.assertGreaterEqual(skin.count("<scrollspeed>60</scrollspeed>"), 20)


if __name__ == "__main__":
    unittest.main()
