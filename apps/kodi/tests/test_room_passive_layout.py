from __future__ import annotations

import unittest
import xml.etree.ElementTree as ET

from support import RESOURCES_ROOT


SKIN_PATH = (
    RESOURCES_ROOT
    / "skins"
    / "Default"
    / "1080i"
    / "script-partycard-tv-main.xml"
)
PASSIVE_ROOM = "String.IsEqual(Window.Property(PassiveRoomStage),true)"
NOT_PASSIVE_ROOM = "!String.IsEqual(Window.Property(PassiveRoomStage),true)"


def _label(control: ET.Element) -> str:
    return control.findtext("label") or ""


def _visible(control: ET.Element) -> str:
    return control.findtext("visible") or ""


def _geometry(control: ET.Element) -> tuple[str, ...]:
    return tuple(
        control.findtext(name, "")
        for name in ("left", "top", "width", "height", "font", "align", "aligny")
    )


def _is_passive(control: ET.Element) -> bool:
    visibility = _visible(control)
    return PASSIVE_ROOM in visibility and NOT_PASSIVE_ROOM not in visibility


def _group_with_visibility(root: ET.Element, marker: str) -> ET.Element:
    for group in root.findall("./controls/control[@type='group']"):
        if marker == _visible(group):
            return group
    raise AssertionError(f"Missing group with visibility {marker}")


def _assert_timed_autoscroll(
    case: unittest.TestCase,
    control: ET.Element,
    *,
    delay: str = "3000",
    time: str = "3000",
    repeat: str = "3000",
) -> None:
    autoscroll = control.find("autoscroll")
    case.assertIsNotNone(autoscroll)
    if autoscroll is None:
        return
    case.assertEqual(autoscroll.text, "true")
    case.assertEqual(autoscroll.get("delay"), delay)
    case.assertEqual(autoscroll.get("time"), time)
    case.assertEqual(autoscroll.get("repeat"), repeat)


class PassiveRoomLayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.skin = ET.parse(SKIN_PATH).getroot()

    def test_lobby_text_advances_without_focus_including_contract_length_urls(self) -> None:
        lobby = _group_with_visibility(
            self.skin,
            "String.IsEqual(Window.Property(ViewMode),lobby)",
        )
        labels = lobby.findall("./control[@type='label']")
        self.assertGreaterEqual(len(labels), 10)
        self.assertTrue(all(label.findtext("scroll") == "true" for label in labels))

        textboxes = lobby.findall("./control[@type='textbox']")
        join_urls = next(
            control
            for control in textboxes
            if "Window.Property(JoinUrls)" in _label(control)
        )
        _assert_timed_autoscroll(
            self,
            join_urls,
            delay="1500",
            time="1000",
            repeat="1500",
        )
        for control in textboxes:
            if control is join_urls:
                continue
            _assert_timed_autoscroll(self, control)
            if "Window.Property(Fact" in _label(control):
                self.assertLessEqual(int(control.findtext("height", "0")), 72)

    def test_room_rosters_scroll_overflow_inside_compact_fixed_geometry(self) -> None:
        for control_id, maximum_width in (("58", 280), ("55", 278)):
            roster = self.skin.find(f"./controls/control[@id='{control_id}']")
            self.assertIsNotNone(roster)
            if roster is None:
                continue
            for layout_name in ("itemlayout", "focusedlayout"):
                layout = roster.find(layout_name)
                self.assertIsNotNone(layout)
                if layout is None:
                    continue
                self.assertLessEqual(int(layout.get("width", "0")), maximum_width)
                text_controls = layout.findall("./control[@type='label']")
                self.assertEqual(len(text_controls), 3)
                self.assertTrue(
                    all(control.findtext("scroll") == "true" for control in text_controls)
                )

        roster_header = next(
            group
            for group in self.skin.findall("./controls/control[@type='group']")
            if "Window.Property(HasRoster)" in _visible(group)
            and group.find("./control[@type='textbox']") is not None
        )
        for label in roster_header.findall("./control[@type='label']"):
            self.assertEqual(label.findtext("scroll"), "true")
        body = roster_header.find("./control[@type='textbox']")
        self.assertIsNotNone(body)
        if body is not None:
            _assert_timed_autoscroll(self, body)
            panel = roster_header.find("./control[@type='image']")
            footer = next(
                label
                for label in roster_header.findall("./control[@type='label']")
                if "Window.Property(Footer)" in _label(label)
            )
            self.assertIsNotNone(panel)
            if panel is not None:
                panel_bottom = int(panel.findtext("top", "0")) + int(
                    panel.findtext("height", "0")
                )
                body_bottom = int(body.findtext("top", "0")) + int(
                    body.findtext("height", "0")
                )
                self.assertGreaterEqual(panel_bottom - body_bottom, 12)
            footer_bottom = int(footer.findtext("top", "0")) + int(
                footer.findtext("height", "0")
            )
            self.assertGreaterEqual(int(body.findtext("top", "0")) - footer_bottom, 2)
            self.assertGreaterEqual(int(body.findtext("height", "0")), 64)
            self.assertEqual(body.findtext("aligny"), "center")

    def test_room_roster_status_keeps_safe_bottom_inset(self) -> None:
        expected_geometry = {
            "58": {
                "panel": (3, 3, 274, 101),
                "status": (18, 66, 244, 24),
            },
            "55": {
                "panel": (3, 3, 272, 162),
                "status": (26, 116, 238, 28),
            },
        }
        for control_id, expected in expected_geometry.items():
            roster = self.skin.find(f"./controls/control[@id='{control_id}']")
            self.assertIsNotNone(roster)
            if roster is None:
                continue
            for layout_name in ("itemlayout", "focusedlayout"):
                layout = roster.find(layout_name)
                self.assertIsNotNone(layout)
                if layout is None:
                    continue
                panel = next(
                    control
                    for control in layout.findall("./control[@type='image']")
                    if control.findtext("texture") == "partycard-tv-button.png"
                )
                status = next(
                    control
                    for control in layout.findall("./control[@type='label']")
                    if "ListItem.Property(Badge)" in _label(control)
                )
                panel_geometry = tuple(
                    int(panel.findtext(name, "0"))
                    for name in ("left", "top", "width", "height")
                )
                status_geometry = tuple(
                    int(status.findtext(name, "0"))
                    for name in ("left", "top", "width", "height")
                )
                self.assertEqual(panel_geometry, expected["panel"])
                self.assertEqual(status_geometry, expected["status"])
                panel_bottom = panel_geometry[1] + panel_geometry[3]
                status_bottom = status_geometry[1] + status_geometry[3]
                self.assertGreaterEqual(panel_bottom - status_bottom, 12)

    def test_room_current_player_uses_the_centred_scrolling_turn_indicator(self) -> None:
        stage = _group_with_visibility(
            self.skin,
            "String.IsEqual(Window.Property(ViewMode),card)",
        )
        current_player = [
            control
            for control in stage.findall("./control[@type='label']")
            if "Window.Property(CurrentPlayer)" in _label(control)
        ]
        centred = [
            control
            for control in current_player
            if "!String.IsEqual(Window.Property(CurrentPlayerBodyVisible),true)"
            in _visible(control)
        ]
        compact = [
            control
            for control in current_player
            if "String.IsEqual(Window.Property(CurrentPlayerBodyVisible),true)"
            in _visible(control)
            and "!String.IsEqual(Window.Property(CurrentPlayerBodyVisible),true)"
            not in _visible(control)
        ]
        self.assertEqual(len(centred), 2)
        self.assertEqual(len(compact), 2)
        self.assertEqual(len({_geometry(control) for control in centred}), 1)
        self.assertTrue(all(control.findtext("scroll") == "true" for control in centred))
        self.assertTrue(all(control.findtext("scrollspeed") == "60" for control in centred))
        self.assertTrue(all(control.findtext("font") == "font30_title" for control in centred))

        status_text = [
            control
            for control in stage.findall("./control[@type='textbox']")
            if "Window.Property(Body)" in _label(control)
        ]
        self.assertEqual(len(status_text), 2)
        self.assertTrue(
            all(
                "String.IsEqual(Window.Property(CurrentPlayerBodyVisible),true)"
                in _visible(control)
                for control in status_text
            )
        )

    def test_room_card_text_autoscrolls_without_changing_card_geometry(self) -> None:
        for group_marker, expected_variants in (
            (
                "String.IsEqual(Window.Property(ViewMode),card) + "
                "!String.IsEqual(Window.Property(ResultVisible),true)",
                4,
            ),
            (
                "String.IsEqual(Window.Property(ViewMode),card) + "
                "String.IsEqual(Window.Property(ResultVisible),true)",
                3,
            ),
        ):
            group = _group_with_visibility(self.skin, group_marker)
            card_text = [
                control
                for control in group.findall("./control[@type='textbox']")
                if "Window.Property(CardText)" in _label(control)
                and "Window.Property(HasCardPages)" in _visible(control)
            ]
            passive = [control for control in card_text if _is_passive(control)]
            interactive = [
                control for control in card_text if NOT_PASSIVE_ROOM in _visible(control)
            ]
            self.assertEqual(len(passive), expected_variants)
            self.assertEqual(len(interactive), expected_variants)
            for control in passive:
                _assert_timed_autoscroll(self, control)
            self.assertTrue(
                all(control.findtext("autoscroll") == "false" for control in interactive)
            )
            self.assertEqual(
                sorted(_geometry(control) for control in passive),
                sorted(_geometry(control) for control in interactive),
            )

        ordinary = _group_with_visibility(
            self.skin,
            "String.IsEqual(Window.Property(ViewMode),card) + "
            "!String.IsEqual(Window.Property(ResultVisible),true)",
        )
        passive_body = next(
            control
            for control in ordinary.findall("./control[@type='textbox']")
            if "Window.Property(Body)" in _label(control)
            and _is_passive(control)
        )
        _assert_timed_autoscroll(self, passive_body)

        result = _group_with_visibility(
            self.skin,
            "String.IsEqual(Window.Property(ViewMode),card) + "
            "String.IsEqual(Window.Property(ResultVisible),true)",
        )
        for property_name in ("ResultYes", "ResultNo"):
            aggregate = [
                control
                for control in result.findall("./control[@type='textbox']")
                if _label(control) == f"$INFO[Window.Property({property_name})]"
            ]
            passive_aggregate = [control for control in aggregate if _is_passive(control)]
            interactive_aggregate = [
                control for control in aggregate if NOT_PASSIVE_ROOM in _visible(control)
            ]
            self.assertEqual(len(passive_aggregate), 1)
            self.assertEqual(len(interactive_aggregate), 1)
            _assert_timed_autoscroll(self, passive_aggregate[0])
            self.assertEqual(
                _geometry(passive_aggregate[0]),
                _geometry(interactive_aggregate[0]),
            )


if __name__ == "__main__":
    unittest.main()
