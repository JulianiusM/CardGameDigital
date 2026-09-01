from __future__ import annotations

import unittest
import xml.etree.ElementTree as ET

from support import RESOURCES_ROOT
from lib import strings
from lib.presentation import NAMED_RESULT_COLUMN_PAGE_SIZE, present
from lib.routes import Route
from lib.state import AppState


PLAYER_COUNT = 1_000
PLAYER_NAME_LENGTH = 40


def _player_name(index: int) -> str:
    prefix = f"Player{index:04d}"
    return prefix + ("X" * (PLAYER_NAME_LENGTH - len(prefix)))


def _column_names(items) -> tuple[str, ...]:
    return tuple(item.label.literal or "" for item in items)


def _named_result_view(answers: list[dict[str, str]], auto_page: int):
    yes = sum(1 for answer in answers if answer["vote"] == "YES")
    no = sum(1 for answer in answers if answer["vote"] == "NO")
    return present(
        AppState(
            route=Route.COUCH_GAME,
            auto_page=auto_page,
            couch_snapshot={
                "state": "SHOWING_RESULTS",
                "players": [],
                "activePlayer": None,
                "currentCard": {
                    "cardText": "Never have I ever…",
                    "cardType": "QUESTION",
                },
                "neverHaveIEverVoting": {
                    "revealMode": "NAMED_ANSWERS",
                    "progress": [],
                    "result": {
                        "yes": yes,
                        "no": no,
                        "total": len(answers),
                        "namedAnswers": answers,
                    },
                },
            },
        )
    )


class CouchWorstCaseTests(unittest.TestCase):
    def test_named_results_reach_every_maximum_length_name_in_session_order(self) -> None:
        names = [_player_name(index) for index in range(PLAYER_COUNT)]
        self.assertTrue(all(len(name) == PLAYER_NAME_LENGTH for name in names))
        self.assertTrue(all(" " not in name for name in names))
        self.assertEqual(len(set(names)), PLAYER_COUNT)

        minority_no = {1, 500, 998}
        cases = {
            "all yes": ["YES"] * PLAYER_COUNT,
            "all no": ["NO"] * PLAYER_COUNT,
            "heavily skewed": [
                "NO" if index in minority_no else "YES"
                for index in range(PLAYER_COUNT)
            ],
        }

        for label, votes in cases.items():
            with self.subTest(distribution=label):
                answers = [
                    {
                        "playerId": f"player-{index:04d}",
                        "displayName": name,
                        "vote": votes[index],
                    }
                    for index, name in enumerate(names)
                ]
                expected_yes = tuple(
                    answer["displayName"]
                    for answer in answers
                    if answer["vote"] == "YES"
                )
                expected_no = tuple(
                    answer["displayName"]
                    for answer in answers
                    if answer["vote"] == "NO"
                )
                total_pages = max(
                    1,
                    (len(expected_yes) + NAMED_RESULT_COLUMN_PAGE_SIZE - 1)
                    // NAMED_RESULT_COLUMN_PAGE_SIZE,
                    (len(expected_no) + NAMED_RESULT_COLUMN_PAGE_SIZE - 1)
                    // NAMED_RESULT_COLUMN_PAGE_SIZE,
                )

                first = _named_result_view(answers, auto_page=0)
                self.assertEqual(first.result_yes.message_id, strings.RESULT_YES)
                self.assertEqual(first.result_yes.arguments, (len(expected_yes),))
                self.assertEqual(first.result_no.message_id, strings.RESULT_NO)
                self.assertEqual(first.result_no.arguments, (len(expected_no),))
                self.assertEqual(
                    _column_names(first.result_yes_players),
                    expected_yes[:NAMED_RESULT_COLUMN_PAGE_SIZE],
                )
                self.assertEqual(
                    _column_names(first.result_no_players),
                    expected_no[:NAMED_RESULT_COLUMN_PAGE_SIZE],
                )

                reached_yes: list[str] = []
                reached_no: list[str] = []
                for page in range(total_pages):
                    view = _named_result_view(answers, auto_page=page)
                    page_start = page * NAMED_RESULT_COLUMN_PAGE_SIZE
                    page_end = page_start + NAMED_RESULT_COLUMN_PAGE_SIZE
                    visible_yes = _column_names(view.result_yes_players)
                    visible_no = _column_names(view.result_no_players)

                    self.assertEqual(
                        visible_yes,
                        expected_yes[page_start:page_end],
                        f"YES column lost or reordered a complete name on page {page + 1}",
                    )
                    self.assertEqual(
                        visible_no,
                        expected_no[page_start:page_end],
                        f"NO column lost or reordered a complete name on page {page + 1}",
                    )
                    self.assertEqual(view.result_yes.arguments, (len(expected_yes),))
                    self.assertEqual(view.result_no.arguments, (len(expected_no),))
                    self.assertEqual(
                        view.result_status.message_id,
                        strings.RESULT_AUTO_PAGE_STATUS,
                    )
                    self.assertEqual(view.result_status.arguments, (page + 1, total_pages))
                    reached_yes.extend(visible_yes)
                    reached_no.extend(visible_no)

                self.assertEqual(tuple(reached_yes), expected_yes)
                self.assertEqual(tuple(reached_no), expected_no)

                wrapped = _named_result_view(answers, auto_page=total_pages)
                self.assertEqual(wrapped.result_status.arguments, (1, total_pages))
                self.assertEqual(
                    _column_names(wrapped.result_yes_players),
                    expected_yes[:NAMED_RESULT_COLUMN_PAGE_SIZE],
                )
                self.assertEqual(
                    _column_names(wrapped.result_no_players),
                    expected_no[:NAMED_RESULT_COLUMN_PAGE_SIZE],
                )

    def test_couch_card_pagination_and_actions_do_not_overlap(self) -> None:
        skin = ET.parse(
            RESOURCES_ROOT
            / "skins"
            / "Default"
            / "1080i"
            / "script-partycard-tv-main.xml"
        ).getroot()

        card_group = next(
            control
            for control in skin.findall(".//control[@type='group']")
            if (control.findtext("visible") or "")
            == "String.IsEqual(Window.Property(ViewMode),card) + "
            "!String.IsEqual(Window.Property(ResultVisible),true)"
        )
        card_panel = next(
            control
            for control in card_group.findall("./control[@type='image']")
            if control.findtext("texture") == "partycard-tv-panel.png"
        )
        pagination_controls = tuple(
            skin.find(f".//control[@id='{control_id}']")
            for control_id in (92, 93)
        )
        card_actions = skin.find(".//control[@id='51']")
        self.assertTrue(all(control is not None for control in pagination_controls))
        self.assertIsNotNone(card_actions)

        card_panel_bottom = int(card_panel.findtext("top", "0")) + int(
            card_panel.findtext("height", "0")
        )
        pagination_top = min(
            int(control.findtext("top", "0"))
            for control in pagination_controls
            if control is not None
        )
        pagination_bottom = max(
            int(control.findtext("top", "0"))
            + int(control.findtext("height", "0"))
            for control in pagination_controls
            if control is not None
        )
        card_action_top = int(card_actions.findtext("top", "0"))

        self.assertLessEqual(
            card_panel_bottom,
            pagination_top,
            "Couch Card panel overlaps the pagination row",
        )
        self.assertLessEqual(
            pagination_bottom,
            card_action_top,
            "Couch pagination overlaps the Card action row",
        )


if __name__ == "__main__":
    unittest.main()
