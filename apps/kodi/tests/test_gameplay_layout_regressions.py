from __future__ import annotations

import unittest
import xml.etree.ElementTree as ET

from support import RESOURCES_ROOT
from lib import strings
from lib.layout import card_text_fit, result_card_text_fit
from lib.presentation import (
    COUCH_VOTER_PAGE_SIZE,
    GAME_ROSTER_PAGE_SIZE,
    NAMED_RESULT_COLUMN_PAGE_SIZE,
    present,
)
from lib.routes import Route
from lib.state import ActiveRoom, AppState


SKIN_PATH = (
    RESOURCES_ROOT
    / "skins"
    / "Default"
    / "1080i"
    / "script-partycard-tv-main.xml"
)
MAXIMUM_PLAYER_COUNT = 1_000
MAXIMUM_PLAYER_NAME_LENGTH = 40
ROOM = ActiveRoom(
    "00000000-0000-4000-8000-000000000001",
    "ABC234",
    "00000000-0000-4000-8000-000000000002",
    "fixture-reference",
    "DISPLAY",
    "DISPLAY_WAITING_FOR_HOST",
)


def _maximum_name(index: int) -> str:
    prefix = f"P{index:04d}"
    return prefix + ("W" * (MAXIMUM_PLAYER_NAME_LENGTH - len(prefix)))


def _number(control: ET.Element, name: str) -> int:
    return int(control.findtext(name, "0"))


def _bounds(control: ET.Element) -> tuple[int, int, int, int]:
    left = _number(control, "left")
    top = _number(control, "top")
    return (
        left,
        top,
        left + _number(control, "width"),
        top + _number(control, "height"),
    )


def _assert_contains(
    case: unittest.TestCase,
    outer: ET.Element,
    inner: ET.Element,
    message: str,
) -> None:
    outer_left, outer_top, outer_right, outer_bottom = _bounds(outer)
    inner_left, inner_top, inner_right, inner_bottom = _bounds(inner)
    case.assertGreaterEqual(inner_left, outer_left, message)
    case.assertGreaterEqual(inner_top, outer_top, message)
    case.assertLessEqual(inner_right, outer_right, message)
    case.assertLessEqual(inner_bottom, outer_bottom, message)


def _property_controls(parent: ET.Element, property_name: str) -> tuple[ET.Element, ...]:
    marker = f"Window.Property({property_name})"
    return tuple(
        control
        for control in parent.findall("./control")
        if marker in (control.findtext("label") or "")
    )


def _card_stage(skin: ET.Element) -> ET.Element:
    return next(
        control
        for control in skin.findall("./controls/control[@type='group']")
        if (control.findtext("visible") or "")
        == "String.IsEqual(Window.Property(ViewMode),card)"
    )


def _ordinary_card_group(skin: ET.Element) -> ET.Element:
    return next(
        control
        for control in skin.findall("./controls/control[@type='group']")
        if (control.findtext("visible") or "")
        == "String.IsEqual(Window.Property(ViewMode),card) + "
        "!String.IsEqual(Window.Property(ResultVisible),true)"
    )


def _result_group(skin: ET.Element) -> ET.Element:
    return next(
        control
        for control in skin.findall("./controls/control[@type='group']")
        if (control.findtext("visible") or "")
        == "String.IsEqual(Window.Property(ViewMode),card) + "
        "String.IsEqual(Window.Property(ResultVisible),true)"
    )


class GameplayLayoutRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.skin = ET.parse(SKIN_PATH).getroot()

    def test_active_status_and_current_player_bands_have_ordered_contained_text(self) -> None:
        stage = _card_stage(self.skin)
        status_surfaces = sorted(
            (
                control
                for control in stage.findall("./control[@type='image']")
                if _number(control, "top") == 18
            ),
            key=lambda control: _number(control, "left"),
        )
        self.assertEqual(len(status_surfaces), 5)

        properties_by_surface = (
            ("Fact1Label", "Fact1Value"),
            ("Fact2Label", "Fact2Value"),
            ("Fact3Label", "Fact3Value"),
            ("Fact4Value",),
            ("Fact5Label", "RoomCode"),
        )
        for index, (surface, property_names) in enumerate(
            zip(status_surfaces, properties_by_surface)
        ):
            with self.subTest(status_surface=index):
                if index:
                    self.assertLessEqual(
                        _bounds(status_surfaces[index - 1])[2],
                        _bounds(surface)[0],
                        "Active-game status surfaces overlap",
                    )
                for property_name in property_names:
                    controls = _property_controls(stage, property_name)
                    self.assertEqual(len(controls), 1)
                    _assert_contains(
                        self,
                        surface,
                        controls[0],
                        f"{property_name} escapes its active-game status surface",
                    )
                    control_bounds = _bounds(controls[0])
                    surface_bounds = _bounds(surface)
                    self.assertGreaterEqual(
                        control_bounds[1] - surface_bounds[1],
                        4,
                        f"{property_name} is cramped against the top pill border",
                    )
                    self.assertGreaterEqual(
                        surface_bounds[3] - control_bounds[3],
                        4,
                        f"{property_name} is cramped against the bottom pill border",
                    )
                    self.assertEqual(
                        controls[0].findtext("scroll"),
                        "true",
                        f"{property_name} can still clip inside its status pill",
                    )
                    minimum_line_height = {
                        "font12": 26,
                        "font20_title": 31,
                    }.get(controls[0].findtext("font"), 0)
                    self.assertGreaterEqual(
                        _number(controls[0], "height"),
                        minimum_line_height,
                        f"{property_name} has less height than its Estuary font line",
                    )
                    self.assertEqual(controls[0].findtext("aligny"), "center")

        current_surfaces = tuple(
            control
            for control in stage.findall("./control[@type='image']")
            if _number(control, "top") == 258
        )
        self.assertEqual(len(current_surfaces), 2)
        self.assertEqual(_bounds(current_surfaces[0]), _bounds(current_surfaces[1]))
        current_surface = current_surfaces[0]
        for property_name in ("NowPlayingLabel", "CurrentPlayer", "Body"):
            controls = _property_controls(stage, property_name)
            expected_controls = 2 if property_name == "Body" else 4
            self.assertEqual(len(controls), expected_controls)
            for control in controls:
                _assert_contains(
                    self,
                    current_surface,
                    control,
                    f"{property_name} escapes the current-player band",
                )

        compact_marker = "String.IsEqual(Window.Property(CurrentPlayerBodyVisible),true)"
        centred_marker = f"!{compact_marker}"
        now_playing_controls = _property_controls(stage, "NowPlayingLabel")
        player_name_controls = _property_controls(stage, "CurrentPlayer")
        centred_now = tuple(
            control
            for control in now_playing_controls
            if centred_marker in (control.findtext("visible") or "")
        )
        centred_names = tuple(
            control
            for control in player_name_controls
            if centred_marker in (control.findtext("visible") or "")
        )
        compact_now = tuple(
            control
            for control in now_playing_controls
            if compact_marker in (control.findtext("visible") or "")
            and centred_marker not in (control.findtext("visible") or "")
        )
        compact_names = tuple(
            control
            for control in player_name_controls
            if compact_marker in (control.findtext("visible") or "")
            and centred_marker not in (control.findtext("visible") or "")
        )
        self.assertEqual(len(centred_now), 2)
        self.assertEqual(len(centred_names), 2)
        self.assertEqual(len(compact_now), 2)
        self.assertEqual(len(compact_names), 2)
        self.assertEqual(len({_bounds(control) for control in centred_now}), 1)
        self.assertEqual(len({_bounds(control) for control in centred_names}), 1)
        self.assertEqual(len({_bounds(control) for control in compact_now}), 1)
        self.assertEqual(len({_bounds(control) for control in compact_names}), 1)

        centred_now_bounds = _bounds(centred_now[0])
        centred_name_bounds = _bounds(centred_names[0])
        self.assertLessEqual(centred_now_bounds[3], centred_name_bounds[1])
        surface_center = (_bounds(current_surface)[1] + _bounds(current_surface)[3]) / 2
        content_center = (centred_now_bounds[1] + centred_name_bounds[3]) / 2
        self.assertLessEqual(abs(surface_center - content_center), 2)

        compact_status = _property_controls(stage, "Body")[0]
        self.assertLessEqual(_bounds(compact_now[0])[3], _bounds(compact_names[0])[1])
        self.assertLessEqual(_bounds(compact_names[0])[3], _bounds(compact_status)[1])
        for control in player_name_controls:
            self.assertEqual(control.findtext("font"), "font30_title")
            self.assertGreaterEqual(_number(control, "height"), 40)
            self.assertEqual(control.findtext("aligny"), "center")
            self.assertEqual(control.findtext("scroll"), "true")
            self.assertEqual(control.findtext("scrollspeed"), "60")
        self.assertLessEqual(
            _bounds(current_surface)[3],
            _bounds(
                next(
                    control
                    for control in _ordinary_card_group(self.skin).findall(
                        "./control[@type='image']"
                    )
                    if control.findtext("texture") == "partycard-tv-panel.png"
                )
            )[1],
            "Current-player band overlaps the Card surface",
        )

    def test_five_card_game_roster_is_compact_and_scrolls_only_overflow(self) -> None:
        roster = self.skin.find("./controls/control[@id='55']")
        self.assertIsNotNone(roster)
        if roster is None:
            return
        item_layout = roster.find("./itemlayout")
        focused_layout = roster.find("./focusedlayout")
        self.assertIsNotNone(item_layout)
        self.assertIsNotNone(focused_layout)
        if item_layout is None or focused_layout is None:
            return

        self.assertEqual(GAME_ROSTER_PAGE_SIZE, 5)
        self.assertEqual(
            _number(roster, "width"),
            GAME_ROSTER_PAGE_SIZE * int(item_layout.attrib["width"]),
        )
        self.assertLessEqual(int(item_layout.attrib["height"]), _number(roster, "height"))

        for layout in (item_layout, focused_layout):
            layout_width = int(layout.attrib["width"])
            layout_height = int(layout.attrib["height"])
            for child in layout.findall("./control"):
                left, top, right, bottom = _bounds(child)
                self.assertGreaterEqual(left, 0)
                self.assertGreaterEqual(top, 0)
                self.assertLessEqual(right, layout_width)
                self.assertLessEqual(bottom, layout_height)

            self.assertLessEqual(layout_width, 278)
            name = next(
                control
                for control in layout.findall("./control[@type='label']")
                if "ListItem.Label]" in (control.findtext("label") or "")
            )
            owner = next(
                control
                for control in layout.findall("./control[@type='label']")
                if "ListItem.Label2" in (control.findtext("label") or "")
            )
            badge = next(
                control
                for control in layout.findall("./control[@type='label']")
                if "ListItem.Property(Badge)" in (control.findtext("label") or "")
            )
            self.assertEqual(name.findtext("scroll"), "true")
            self.assertEqual(owner.findtext("scroll"), "true")
            self.assertLessEqual(_bounds(name)[3], _bounds(owner)[1])
            self.assertLessEqual(_bounds(owner)[3], _bounds(badge)[1])

    def test_couch_voter_pages_preserve_every_maximum_name_without_force_breaks(self) -> None:
        players = [
            {"id": f"player-{index:04d}", "name": _maximum_name(index)}
            for index in range(MAXIMUM_PLAYER_COUNT)
        ]
        names = tuple(player["name"] for player in players)
        self.assertEqual(len(set(names)), MAXIMUM_PLAYER_COUNT)
        self.assertTrue(all(len(name) == MAXIMUM_PLAYER_NAME_LENGTH for name in names))
        self.assertTrue(all(not any(character.isspace() for character in name) for name in names))

        snapshot = {
            "state": "COLLECTING_ANSWERS",
            "players": players,
            "activePlayer": players[-1],
            "currentCard": {
                "cardText": "Never have I ever…",
                "cardType": "QUESTION",
            },
            "votedPlayerIds": [],
            "neverHaveIEverVoting": {
                "revealMode": "NAMED_ANSWERS",
                "progress": [],
                "result": None,
            },
        }
        page_size = COUCH_VOTER_PAGE_SIZE
        total_pages = (MAXIMUM_PLAYER_COUNT + page_size - 1) // page_size
        reached: list[str] = []
        for page in range(total_pages):
            with self.subTest(page=page):
                view = present(
                    AppState(
                        route=Route.COUCH_GAME,
                        collection_page=page,
                        couch_snapshot=snapshot,
                    )
                )
                expected_size = min(page_size, MAXIMUM_PLAYER_COUNT - page * page_size)
                self.assertEqual(len(view.voters), expected_size)
                self.assertEqual(
                    [action.key for action in view.actions],
                    ["couch:skip"],
                )
                self.assertEqual(view.current_player.literal, names[-1])
                self.assertIsNotNone(view.pagination)
                if view.pagination is None:
                    continue
                self.assertEqual(
                    view.pagination.status.message_id,
                    strings.VOTER_PAGE_STATUS,
                )
                self.assertEqual(view.pagination.status.arguments, (page + 1, total_pages))
                for voter in view.voters:
                    self.assertIsNotNone(voter.label.literal)
                    rendered = voter.label.literal or ""
                    self.assertNotIn(
                        "\n",
                        rendered,
                        "The presenter must not force-break a voter name",
                    )
                    reached.append(rendered)
        self.assertEqual(tuple(reached), names)

        voter_list = self.skin.find("./controls/control[@id='63']")
        self.assertIsNotNone(voter_list)
        if voter_list is not None:
            for layout_name in ("itemlayout", "focusedlayout"):
                name = next(
                    control
                    for control in voter_list.findall(
                        f"./{layout_name}/control[@type='label']"
                    )
                    if "ListItem.Label]" in (control.findtext("label") or "")
                )
                self.assertEqual(name.findtext("scroll"), "true")

    def test_couch_voter_pages_keep_stable_rows_and_mark_recorded_votes(self) -> None:
        players = [
            {"id": f"player-{index}", "name": f"Player {index}"}
            for index in range(9)
        ]
        snapshot = {
            "state": "COLLECTING_ANSWERS",
            "players": players,
            "activePlayer": players[0],
            "currentCard": {
                "cardText": "Never have I ever…",
                "cardType": "QUESTION",
            },
            "votedPlayerIds": [],
        }
        state = AppState(
            route=Route.COUCH_GAME,
            collection_page=1,
            couch_snapshot=snapshot,
        )
        before = present(state)

        after = present(
            AppState(
                route=Route.COUCH_GAME,
                collection_page=1,
                couch_snapshot={
                    **snapshot,
                    "votedPlayerIds": ["player-0", "player-4", "player-8"],
                },
            )
        )

        self.assertEqual(
            [entry.key for entry in before.voters],
            [entry.key for entry in after.voters],
        )
        self.assertEqual(before.pagination.status.arguments, (2, 3))
        self.assertEqual(after.pagination.status.arguments, (2, 3))
        self.assertEqual(
            after.voters[0].secondary.message_id,
            strings.VOTED_STATUS,
        )
        self.assertEqual(after.voters[0].secondary.arguments, ())
        self.assertFalse(after.voters[0].enabled)
        self.assertTrue(all(entry.enabled for entry in after.voters[1:]))
        self.assertTrue(
            all(
                entry.secondary.message_id == strings.PENDING
                for entry in after.voters[1:]
            )
        )

        completed_page = present(
            AppState(
                route=Route.COUCH_GAME,
                collection_page=1,
                couch_snapshot={
                    **snapshot,
                    "votedPlayerIds": [
                        f"player-{index}"
                        for index in range(8)
                    ],
                },
            )
        )
        self.assertEqual(
            completed_page.preferred_focus,
            "couch:voters:page-next",
        )
        self.assertEqual(completed_page.pagination.status.arguments, (2, 3))

        final_completed_page = present(
            AppState(
                route=Route.COUCH_GAME,
                collection_page=2,
                couch_snapshot={
                    **snapshot,
                    "votedPlayerIds": [
                        f"player-{index}"
                        for index in range(9)
                    ],
                },
            )
        )
        self.assertEqual(final_completed_page.preferred_focus, "couch:skip")

    def test_couch_action_focus_surface_and_text_stay_inside_the_action_row(self) -> None:
        actions = self.skin.find("./controls/control[@id='51']")
        self.assertIsNotNone(actions)
        if actions is None:
            return
        viewport_height = _number(actions, "height")
        for layout_name in ("itemlayout", "focusedlayout"):
            layout = actions.find(f"./{layout_name}")
            self.assertIsNotNone(layout)
            if layout is None:
                continue
            for child in layout.findall("./control"):
                self.assertLessEqual(
                    _bounds(child)[3],
                    viewport_height,
                    f"{layout_name} content clips at the Couch action viewport edge",
                )

    def test_private_ballot_exposes_cancel_yes_and_no_to_dpad_and_mouse(self) -> None:
        buttons = tuple(
            self.skin.find(f"./controls/control[@id='{control_id}']")
            for control_id in (98, 96, 97)
        )
        self.assertTrue(all(button is not None for button in buttons))
        if any(button is None for button in buttons):
            return

        cancel, yes, no = buttons
        self.assertLessEqual(_bounds(cancel)[2], _bounds(yes)[0])
        self.assertLessEqual(_bounds(yes)[2], _bounds(no)[0])
        for button in buttons:
            self.assertEqual(button.attrib.get("type"), "button")
            self.assertIn("Window.Property(PrivateVoteChoice)", button.findtext("visible", ""))
            self.assertEqual(button.findtext("texturenofocus"), "partycard-tv-button.png")
            self.assertEqual(button.findtext("texturefocus"), "partycard-tv-button-focus.png")
            self.assertEqual(button.findtext("onup"), "94")
            self.assertEqual(button.findtext("ondown"), "94")
            self.assertNotEqual(button.findtext("onleft"), "49")
            self.assertNotEqual(button.findtext("onright"), "49")

        action_list = self.skin.find("./controls/control[@id='51']")
        self.assertIsNotNone(action_list)
        if action_list is not None:
            self.assertIn(
                "!String.IsEqual(Window.Property(PrivateVoteChoice),true)",
                action_list.findtext("visible", ""),
            )

    def test_private_vote_identity_and_hint_use_a_readable_rail_below_the_card(self) -> None:
        stage = _card_stage(self.skin)
        player_band_body = _property_controls(stage, "Body")
        self.assertEqual(len(player_band_body), 2)
        for control in player_band_body:
            self.assertIn(
                "String.IsEqual(Window.Property(CurrentPlayerBodyVisible),true)",
                control.findtext("visible", ""),
            )
        window_source = (
            RESOURCES_ROOT / "lib" / "screens" / "main_window.py"
        ).read_text(encoding="utf-8")
        self.assertIn("and not view.private_vote_choice", window_source)

        ordinary_group = _ordinary_card_group(self.skin)
        card_surface = next(
            control
            for control in ordinary_group.findall("./control[@type='image']")
            if control.findtext("texture") == "partycard-tv-panel.png"
        )
        voting_stage = next(
            group
            for group in self.skin.findall("./controls/control[@type='group']")
            if "Window.Property(VotingStageLabel)" in (group.findtext("visible") or "")
        )
        voting_surface = next(
            control
            for control in voting_stage.findall("./control[@type='image']")
            if control.findtext("texture") == "partycard-tv-panel.png"
        )
        voting_player = _property_controls(voting_stage, "VotingPlayer")[0]
        private_hint = _property_controls(voting_stage, "VotingHint")[0]
        stage_label = next(
            control
            for control in _property_controls(voting_stage, "VotingStageLabel")
            if "!String.IsEmpty(Window.Property(VotingPlayer))"
            in control.findtext("visible", "")
        )
        self.assertEqual(_number(voting_surface, "height"), 62)
        _assert_contains(self, voting_surface, stage_label, "Vote stage escapes its rail")
        _assert_contains(self, voting_surface, voting_player, "Voter name escapes its rail")
        _assert_contains(self, voting_surface, private_hint, "Vote hint escapes its rail")
        self.assertLessEqual(_bounds(stage_label)[2], _bounds(voting_player)[0])
        self.assertLessEqual(_bounds(voting_player)[2], _bounds(private_hint)[0])
        self.assertGreaterEqual(_number(private_hint, "width"), 720)
        self.assertEqual(voting_player.findtext("scroll"), "true")
        self.assertEqual(private_hint.findtext("scroll"), "true")
        self.assertLessEqual(
            _bounds(card_surface)[3],
            _bounds(voting_surface)[1],
            "The vote rail overlaps the Card",
        )

        private_buttons = tuple(
            self.skin.find(f"./controls/control[@id='{control_id}']")
            for control_id in (98, 96, 97)
        )
        self.assertTrue(all(button is not None for button in private_buttons))
        if all(button is not None for button in private_buttons):
            self.assertLessEqual(
                _bounds(private_hint)[3],
                min(_bounds(button)[1] for button in private_buttons),
                "The private-vote shortcut hint overlaps its answer buttons",
            )

    def test_private_ballot_projection_preserves_a_maximum_unbroken_voter_name(self) -> None:
        voter_name = _maximum_name(MAXIMUM_PLAYER_COUNT - 1)
        view = present(
            AppState(
                route=Route.COUCH_GAME,
                couch_vote_player_id="voter",
                couch_vote_phase="CHOICE",
                couch_snapshot={
                    "state": "COLLECTING_ANSWERS",
                    "players": [{"id": "voter", "name": voter_name}],
                    "activePlayer": {"id": "voter", "name": voter_name},
                    "votedPlayerIds": [],
                    "currentCard": {
                        "cardText": "Never have I ever kept the remote.",
                        "cardType": "QUESTION",
                    },
                },
            )
        )

        self.assertTrue(view.private_vote_choice)
        self.assertEqual(view.voting_stage_label.message_id, strings.CASTING_VOTE)
        self.assertEqual(view.voting_player.literal, voter_name)
        self.assertNotIn("\n", view.voting_player.literal or "")
        self.assertEqual(view.voting_hint.message_id, strings.PRIVATE_VOTE_HINT)

    def test_named_result_headers_and_five_scrolling_rows_stay_inside_surfaces(self) -> None:
        result_group = _result_group(self.skin)
        result_surfaces = sorted(
            (
                control
                for control in result_group.findall("./control[@type='image']")
                if (control.findtext("texture") or "").startswith(
                    "partycard-tv-result-"
                )
            ),
            key=lambda control: _number(control, "left"),
        )
        self.assertEqual(len(result_surfaces), 2)
        self.assertLessEqual(_bounds(result_surfaces[0])[2], _bounds(result_surfaces[1])[0])
        self.assertEqual(NAMED_RESULT_COLUMN_PAGE_SIZE, 5)

        for surface, prefix, control_id in zip(
            result_surfaces,
            ("ResultYes", "ResultNo"),
            (61, 62),
        ):
            header = next(
                control
                for control in _property_controls(result_group, prefix)
                if "HasNamedResults" in (control.findtext("visible") or "")
            )
            names = result_group.find(f"./control[@id='{control_id}']")
            self.assertIsNotNone(names)
            if names is None:
                continue
            _assert_contains(self, surface, header, f"{prefix} header escapes its result Card")
            _assert_contains(self, surface, names, f"{prefix} names escape their result Card")
            self.assertLessEqual(_bounds(header)[3], _bounds(names)[1])
            self.assertEqual(header.findtext("scroll"), "true")
            self.assertEqual(names.attrib.get("type"), "list")
            self.assertEqual(_number(names, "height"), 5 * 58)
            for layout_name in ("itemlayout", "focusedlayout"):
                label = names.find(f"./{layout_name}/control[@type='label']")
                self.assertIsNotNone(label)
                if label is not None:
                    self.assertEqual(label.findtext("scroll"), "true")

        result_status = _property_controls(result_group, "ResultStatus")[0]
        self.assertEqual(result_status.findtext("scroll"), "true")

    def test_maximum_protocol_card_text_is_preserved_before_kodi_layout(self) -> None:
        # This protects transport/presentation content integrity only. The separate
        # visual audit must still prove that Kodi offers a legible way to reach it.
        for length in (904, 10_000):
            with self.subTest(length=length):
                card_text = "W" * length
                card = {
                    "cardText": card_text,
                    "cardType": "QUESTION",
                    "cardIntensity": 5,
                    "intensity": 5,
                }
                couch = present(
                    AppState(
                        route=Route.COUCH_GAME,
                        couch_snapshot={
                            "state": "SHOWING_CARD",
                            "players": [{"id": "player", "name": "Player"}],
                            "activePlayer": {"id": "player", "name": "Player"},
                            "currentCard": card,
                        },
                    )
                )
                room = present(
                    AppState(
                        route=Route.ROOM_GAME_DISPLAY,
                        active_room=ROOM,
                        room_snapshot={
                            "participants": [],
                            "session": {
                                "state": "SHOWING_CARD",
                                "players": [{"id": "player", "name": "Player"}],
                                "activePlayer": {"id": "player", "name": "Player"},
                                "currentCard": card,
                            },
                        },
                    )
                )
                self.assertGreater(couch.card_page_count, 1)
                self.assertEqual(room.card_page_count, 1)
                self.assertEqual(room.card_text.literal, card_text)
                self.assertEqual(room.card_page_status.literal, "")
                couch_pages = []
                for page in range(couch.card_page_count):
                    page_view = present(
                        AppState(
                            route=Route.COUCH_GAME,
                            card_page=page,
                            couch_snapshot={
                                "state": "SHOWING_CARD",
                                "players": [{"id": "player", "name": "Player"}],
                                "activePlayer": {"id": "player", "name": "Player"},
                                "currentCard": card,
                            },
                        )
                    )
                    couch_pages.append((page_view.card_text.literal or "").replace("\n", ""))
                self.assertEqual("".join(couch_pages), card_text)
                self.assertEqual(card_text_fit(card_text), "overflow")
                self.assertEqual(result_card_text_fit(card_text), "overflow")

        ordinary_group = _ordinary_card_group(self.skin)
        card_surface = next(
            control
            for control in ordinary_group.findall("./control[@type='image']")
            if control.findtext("texture") == "partycard-tv-panel.png"
        )
        for card_text_control in _property_controls(ordinary_group, "CardText"):
            _assert_contains(
                self,
                card_surface,
                card_text_control,
                "A Card text fit tier escapes the bordered Card surface",
            )


if __name__ == "__main__":
    unittest.main()
