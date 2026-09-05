from __future__ import annotations

import unittest
import xml.etree.ElementTree as ET

from support import CLIENT_ROOT, RESOURCES_ROOT
from lib import strings
from lib.localization import load_po_catalog
from lib.presentation import LOBBY_ROSTER_PAGE_SIZE, PROFILE_PAGE_SIZE, present
from lib.routes import Route
from lib.state import AppState, RecoveryEnvelope, ServerRecord, initial_setup


SPICY_DESCRIPTION = (
    "For adults who want the boldest questions and dares, explicit topics, "
    "intimate conversations, and deliberately challenging social prompts "
    "without hiding any important explanation from the selection card."
)


def _profiles() -> tuple[dict, ...]:
    values = [
        {
            "id": "PROFILE_SPICY",
            "name": "Spicy",
            "description": SPICY_DESCRIPTION,
            "requiresAdultConfirmation": True,
        }
    ]
    values.extend(
        {
            "id": f"PROFILE_FIXTURE_{index}",
            "name": f"Profile {index}",
            "description": f"Complete description for profile {index}.",
            "requiresAdultConfirmation": False,
        }
        for index in range(1, 9)
    )
    return tuple(values)


def _number(node: ET.Element, name: str) -> int:
    value = node.findtext(name)
    if value is None:
        raise AssertionError(f"Missing {name} in {ET.tostring(node, encoding='unicode')}")
    return int(value)


def _child_with_label(node: ET.Element, label: str) -> ET.Element:
    for child in node.findall("./control"):
        if child.findtext("label") == label:
            return child
    raise AssertionError(f"Missing child labelled {label}")


class SurfaceGeometryRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.skin = ET.parse(
            RESOURCES_ROOT
            / "skins"
            / "Default"
            / "1080i"
            / "script-partycard-tv-main.xml"
        ).getroot()

    def control(self, control_id: int) -> ET.Element:
        controls = self.skin.findall(f".//control[@id='{control_id}']")
        self.assertEqual(len(controls), 1, f"Expected exactly one control {control_id}")
        return controls[0]

    def test_help_topics_autoscroll_complete_titles_inside_their_rows(self) -> None:
        topics = self.control(54)
        self.assertEqual(topics.get("type"), "fixedlist")
        # Kodi will expose partial rows at both viewport edges when a list's
        # height is not an exact multiple of its item height. Keep a whole-row
        # viewport so settled D-pad navigation never paints clipped topic cards.
        item_height = int(topics.find("itemlayout").get("height"))
        self.assertEqual(_number(topics, "height") % item_height, 0)
        self.assertEqual(_number(topics, "focusposition"), 2)
        self.assertEqual(_number(topics, "movement"), 2)
        self.assertEqual(_number(topics, "scrolltime"), 0)
        for layout_name in ("itemlayout", "focusedlayout"):
            layout = topics.find(layout_name)
            self.assertIsNotNone(layout)
            title = _child_with_label(layout, "$INFO[ListItem.Label]")
            self.assertEqual(title.get("type"), "textbox")
            self.assertEqual(title.findtext("font"), "font20_title")
            self.assertEqual(title.findtext("autoscroll"), "true")
            self.assertGreaterEqual(_number(title, "height"), 60)
            self.assertLessEqual(
                _number(title, "top") + _number(title, "height"),
                int(layout.get("height")),
            )

    def test_german_home_descriptions_fit_two_measured_noto_sans_lines(self) -> None:
        german = load_po_catalog(
            CLIENT_ROOT / "resources/language/resource.language.de_de/strings.po"
        )
        descriptions = {
            strings.DISPLAY_ROOM_HINT: (
                "Mit einem Raum verbinden und nur anzeigen.",
                "$INFO[Window.Property(Home3Secondary)]",
                398,
            ),
            strings.SERVERS_HINT: (
                "Lokale und globale Server finden und verwalten.",
                "$INFO[Window.Property(Home4Secondary)]",
                380,
            ),
        }
        for message_id, (expected, label, measured_width) in descriptions.items():
            with self.subTest(message_id=message_id):
                control = next(
                    candidate
                    for candidate in self.skin.findall(".//control[@type='textbox']")
                    if candidate.findtext("label") == label
                )
                self.assertEqual(german[message_id], expected)
                self.assertGreaterEqual(_number(control, "height"), 80)
                self.assertGreaterEqual(
                    _number(control, "width") - measured_width,
                    30,
                )

    def test_profile_projection_keeps_three_complete_unselected_cards_on_three_pages(
        self,
    ) -> None:
        profiles = _profiles()
        self.assertEqual(len(SPICY_DESCRIPTION), 203)
        self.assertEqual(PROFILE_PAGE_SIZE, 3)

        setup = initial_setup("COUCH", "en-GB", False)
        self.assertEqual(setup.profile_id, "")
        pages = []
        for page in range(3):
            with self.subTest(page=page + 1):
                view = present(
                    AppState(
                        route=Route.SETUP_PROFILE,
                        setup=setup,
                        profiles=profiles,
                        collection_page=page,
                    )
                )
                pages.append(view)
                self.assertEqual(view.view_mode, "profiles")
                self.assertEqual(len(view.items), 3)
                self.assertFalse(any(entry.selected for entry in view.items))
                self.assertIsNotNone(view.pagination)
                self.assertEqual(view.pagination.status.message_id, strings.PAGE_STATUS)
                self.assertEqual(view.pagination.status.arguments, (page + 1, 3))

        spicy = pages[0].items[0]
        self.assertEqual(spicy.key, "setup:profile:PROFILE_SPICY")
        self.assertEqual(spicy.secondary.literal, SPICY_DESCRIPTION)

    def test_profile_control_is_three_horizontal_cards_with_bounded_copy_scrolling(self) -> None:
        profiles = self.control(60)
        self.assertEqual(profiles.get("type"), "panel")
        self.assertEqual(profiles.findtext("orientation"), "horizontal")
        self.assertEqual(profiles.findtext("scrolltime"), "0")
        self.assertIsNone(profiles.find("pagecontrol"))
        self.assertIsNone(profiles.find(".//control[@id='92']"))
        self.assertIsNone(profiles.find(".//control[@id='93']"))

        panel_width = _number(profiles, "width")
        panel_height = _number(profiles, "height")
        item_layout = profiles.find("itemlayout")
        focused_layout = profiles.find("focusedlayout")
        self.assertIsNotNone(item_layout)
        self.assertIsNotNone(focused_layout)
        item_width = int(item_layout.get("width"))
        item_height = int(item_layout.get("height"))
        self.assertLessEqual(3 * item_width, panel_width)
        self.assertGreater(4 * item_width, panel_width)
        self.assertEqual(item_height, panel_height)
        self.assertEqual(focused_layout.get("width"), item_layout.get("width"))
        self.assertEqual(focused_layout.get("height"), item_layout.get("height"))

        for layout in (item_layout, focused_layout):
            title = _child_with_label(layout, "$INFO[ListItem.Label]")
            description = _child_with_label(layout, "$INFO[ListItem.Label2]")
            self.assertEqual(title.get("type"), "textbox")
            self.assertEqual(title.findtext("autoscroll"), "true")
            self.assertEqual(description.get("type"), "textbox")
            self.assertEqual(description.findtext("autoscroll"), "true")
            self.assertLessEqual(
                _number(title, "top") + _number(title, "height"),
                _number(description, "top"),
            )
            self.assertGreaterEqual(_number(description, "height"), 250)
            self.assertLessEqual(
                _number(description, "top") + _number(description, "height"),
                item_height,
            )

        previous_page = self.control(92)
        next_page = self.control(93)
        action_bar = self.control(56)
        panel_bottom = _number(profiles, "top") + panel_height
        pagination_top = _number(previous_page, "top")
        pagination_bottom = pagination_top + _number(previous_page, "height")
        self.assertEqual(pagination_top, _number(next_page, "top"))
        self.assertLessEqual(panel_bottom, pagination_top)
        self.assertLessEqual(pagination_bottom, _number(action_bar, "top"))
        self.assertLessEqual(
            _number(previous_page, "left") + _number(previous_page, "width"),
            _number(next_page, "left"),
        )

    def test_summary_multiline_value_keeps_clear_of_adjacent_fact_labels(self) -> None:
        summary = next(
            group
            for group in self.skin.findall(".//control[@type='group']")
            if group.findtext("visible")
            == "String.IsEqual(Window.Property(ViewMode),summary)"
        )
        fact_one_label = _child_with_label(
            summary,
            "$INFO[Window.Property(Fact1Label)]",
        )
        fact_one_value = _child_with_label(
            summary,
            "$INFO[Window.Property(Fact1Value)]",
        )
        fact_four_label = _child_with_label(
            summary,
            "$INFO[Window.Property(Fact4Label)]",
        )

        self.assertEqual(fact_one_value.get("type"), "textbox")
        self.assertEqual(fact_one_value.findtext("autoscroll"), "true")
        self.assertGreaterEqual(
            _number(fact_one_value, "top")
            - (_number(fact_one_label, "top") + _number(fact_one_label, "height")),
            16,
        )
        self.assertLessEqual(
            _number(fact_one_value, "top") + _number(fact_one_value, "height"),
            _number(fact_four_label, "top"),
        )

    def test_device_link_bounds_provider_copy_in_separate_wrapped_regions(self) -> None:
        device_link = next(
            group
            for group in self.skin.findall(".//control[@type='group']")
            if group.findtext("visible")
            == "String.IsEqual(Window.Property(ViewMode),device-link)"
        )
        panel = next(
            child
            for child in device_link.findall("./control")
            if child.get("type") == "image"
        )
        code = _child_with_label(device_link, "$INFO[Window.Property(Heading)]")
        instructions = _child_with_label(device_link, "$INFO[Window.Property(Body)]")
        uri = _child_with_label(device_link, "$INFO[Window.Property(Footer)]")

        for control in (code, instructions, uri):
            self.assertEqual(control.get("type"), "textbox")
            self.assertGreaterEqual(_number(control, "left"), _number(panel, "left"))
            self.assertGreaterEqual(_number(control, "top"), _number(panel, "top"))
            self.assertLessEqual(
                _number(control, "left") + _number(control, "width"),
                _number(panel, "left") + _number(panel, "width"),
            )
            self.assertLessEqual(
                _number(control, "top") + _number(control, "height"),
                _number(panel, "top") + _number(panel, "height"),
            )
        self.assertEqual(code.findtext("autoscroll"), "true")
        self.assertEqual(uri.findtext("autoscroll"), "true")
        self.assertLessEqual(
            _number(code, "top") + _number(code, "height"),
            _number(instructions, "top"),
        )
        self.assertLessEqual(
            _number(instructions, "top") + _number(instructions, "height"),
            _number(uri, "top"),
        )

    def test_lobby_roster_fits_eight_compact_cards_with_overflow_marquees(self) -> None:
        roster = self.control(58)
        self.assertEqual(LOBBY_ROSTER_PAGE_SIZE, 8)
        self.assertEqual(roster.get("type"), "panel")
        self.assertEqual(roster.findtext("orientation"), "vertical")
        self.assertEqual(roster.findtext("scrolltime"), "0")
        self.assertEqual(roster.findtext("enable"), "false")
        self.assertIsNone(roster.find("pagecontrol"))

        roster_width = _number(roster, "width")
        roster_height = _number(roster, "height")
        for layout_name in ("itemlayout", "focusedlayout"):
            layout = roster.find(layout_name)
            self.assertIsNotNone(layout)
            item_width = int(layout.get("width"))
            item_height = int(layout.get("height"))
            self.assertEqual(4 * item_width, roster_width)
            self.assertLessEqual(2 * item_height, roster_height)
            self.assertLessEqual(item_width, 280)

            name = _child_with_label(layout, "$INFO[ListItem.Label]")
            owner = _child_with_label(layout, "$INFO[ListItem.Label2]")
            badge = _child_with_label(layout, "$INFO[ListItem.Property(Badge)]")
            self.assertEqual(name.get("type"), "label")
            self.assertEqual(owner.get("type"), "label")
            self.assertEqual(name.findtext("scroll"), "true")
            self.assertEqual(owner.findtext("scroll"), "true")
            self.assertLessEqual(
                _number(name, "top") + _number(name, "height"),
                _number(owner, "top"),
            )
            self.assertLessEqual(
                _number(owner, "top") + _number(owner, "height"),
                _number(badge, "top"),
            )
            self.assertLessEqual(
                _number(badge, "top") + _number(badge, "height"),
                item_height,
            )

    def test_diagnostics_uses_consistent_fonts_and_keeps_identifiers_on_one_line(
        self,
    ) -> None:
        server_id = "12345678-1234-4234-8234-123456789abc"
        display_name = "W" * 80
        origin = f"https://{'h' * 63}.example.test:30443"
        server = ServerRecord(
            server_id,
            origin,
            display_name,
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
        server_summary = next(
            entry for entry in view.items if entry.key == "diagnostics:server"
        )
        self.assertEqual(server_summary.kind, "server-identifier")
        self.assertEqual(server_summary.label.literal, display_name)
        self.assertEqual(server_summary.secondary.literal, origin)

        identifier = next(
            entry for entry in view.items if entry.key == "diagnostics:server-id"
        )
        self.assertEqual(identifier.kind, "row")
        self.assertIsNotNone(identifier.secondary.literal)
        self.assertNotIn("\n", identifier.secondary.literal)
        self.assertEqual(identifier.secondary.literal, server_id)

        settings = self.control(59)
        item_height = int(settings.find("itemlayout").get("height"))
        for layout_name in ("itemlayout", "focusedlayout"):
            layout = settings.find(layout_name)
            summary_label = [
                child
                for child in layout.findall("./control")
                if child.findtext("label") == "$INFO[ListItem.Label]"
                and child.findtext("visible")
                == "String.IsEqual(ListItem.Property(Kind),server-identifier)"
            ]
            summary_origin = [
                child
                for child in layout.findall("./control")
                if child.findtext("label") == "$INFO[ListItem.Label2]"
                and child.findtext("visible")
                == "String.IsEqual(ListItem.Property(Kind),server-identifier)"
            ]
            self.assertEqual(len(summary_label), 1)
            self.assertEqual(len(summary_origin), 1)
            self.assertEqual(summary_label[0].findtext("font"), "font30_title")
            self.assertEqual(summary_origin[0].findtext("font"), "font20")
            self.assertEqual(summary_label[0].findtext("scroll"), "true")
            self.assertEqual(summary_origin[0].findtext("scroll"), "true")
            self.assertLessEqual(
                _number(summary_label[0], "top") + _number(summary_label[0], "height"),
                _number(summary_origin[0], "top"),
            )
            self.assertLessEqual(
                _number(summary_origin[0], "top") + _number(summary_origin[0], "height"),
                item_height,
            )

            event_label = [
                child
                for child in layout.findall("./control")
                if child.findtext("visible")
                == "String.IsEqual(ListItem.Property(Kind),diagnostic-event)"
                and child.findtext("label") == "$INFO[ListItem.Label]"
            ][0]
            event_detail = [
                child
                for child in layout.findall("./control")
                if child.findtext("visible")
                == "String.IsEqual(ListItem.Property(Kind),diagnostic-event)"
                and child.findtext("label") == "$INFO[ListItem.Label2]"
            ][0]
            self.assertEqual(event_label.findtext("font"), "font30_title")
            self.assertEqual(event_detail.findtext("font"), "font20")

    def test_german_fixed_width_actions_keep_estuary_noto_sans_margin(self) -> None:
        """Guard labels whose German translations previously clipped in Kodi.

        The pixel values are measurements at the XML's ``font30_title`` size using
        Estuary's bundled Noto Sans. They deliberately leave at least 30 px for Kodi's
        focus texture and renderer variance; explanatory copy remains in the body.
        """

        german = load_po_catalog(
            CLIENT_ROOT / "resources/language/resource.language.de_de/strings.po"
        )
        general_actions = self.control(56)
        general_label = _child_with_label(
            general_actions.find("itemlayout"),
            "$INFO[ListItem.Label]",
        )
        general_width = _number(general_label, "width")
        confirmation_width = _number(self.control(81), "width")
        home_title_width = _number(self.control(105), "width") - 56

        measurements = {
            strings.UNLINK_DEVICE: ("Geräteverknüpfung lösen", 375, confirmation_width),
            strings.RESET_CARD: ("Kartenregel zurücksetzen", 374, confirmation_width),
            strings.RECOVER_SESSION: ("Spiel wiederherstellen", 325, home_title_width),
            strings.DISCARD_RECOVERY: ("Fortsetzung verwerfen", 332, confirmation_width),
            strings.ADD_FALLBACK: ("Ausweichsprache hinzufügen", 428, general_width),
            strings.CLEAR_RECENT_SERVERS: (
                "Gespeicherte Server löschen",
                416,
                general_width,
            ),
            strings.ADJUST_SETUP: ("Beenden & Setup anpassen", 400, confirmation_width),
            strings.CONFIRM_ADULT: (
                "Volljährigkeit bestätigen",
                357,
                confirmation_width,
            ),
        }
        for message_id, (expected, measured_width, available_width) in measurements.items():
            with self.subTest(message_id=message_id):
                self.assertEqual(german[message_id], expected)
                self.assertGreaterEqual(
                    available_width - measured_width,
                    30,
                    f"German string #{message_id} has no safe fixed-control margin",
                )

        voter_page_status = next(
            control
            for control in self.skin.findall(".//control[@type='label']")
            if control.findtext("label") == "$INFO[Window.Property(PageStatus)]"
        )
        self.assertEqual(
            german[strings.VOTER_PAGE_STATUS],
            "Abstimmungsseite %s von %s",
        )
        # Page 250/250 measures 442 px at Noto Sans 30 px. Retain a conservative
        # 15 px renderer allowance while protecting the fixed 500 px status band.
        self.assertGreaterEqual(_number(voter_page_status, "width") - 457, 30)

        submitting_stage = next(
            control
            for control in self.skin.findall(".//control[@type='label']")
            if control.findtext("label")
            == "$INFO[Window.Property(VotingStageLabel)]"
            and "!String.IsEmpty(Window.Property(VotingPlayer))"
            in control.findtext("visible", "")
        )
        self.assertEqual(german[strings.SUBMITTING_VOTE], "Stimmabgabe")
        # ``Stimmabgabe`` measures 197 px in Estuary's Noto Sans at the
        # control's rendered size. Keep at least 30 px clear in the fixed rail.
        self.assertGreaterEqual(_number(submitting_stage, "width") - 197, 30)

        private_hint = next(
            control
            for control in self.skin.findall(".//control[@type='label']")
            if control.findtext("label")
            == "$INFO[Window.Property(VotingHint)]"
        )
        result_status = next(
            control
            for control in self.skin.findall(".//control[@type='label']")
            if control.findtext("label")
            == "$INFO[Window.Property(ResultStatus)]"
        )
        self.assertEqual(private_hint.findtext("scroll"), "true")
        self.assertEqual(result_status.findtext("scroll"), "true")

    def test_card_rule_badge_fits_the_german_inherit_value(self) -> None:
        german = load_po_catalog(
            CLIENT_ROOT / "resources/language/resource.language.de_de/strings.po"
        )
        self.assertEqual(german[strings.INHERIT], "Übernehmen")

        rows = self.control(53)
        for layout_name in ("itemlayout", "focusedlayout"):
            layout = rows.find(layout_name)
            badges = [
                child
                for child in layout.findall("./control")
                if child.findtext("label") == "$INFO[ListItem.Property(Badge)]"
                and "String.IsEmpty(ListItem.Property(Detail))"
                in child.findtext("visible", "")
                and "!String.IsEmpty" not in child.findtext("visible", "")
            ]
            self.assertEqual(len(badges), 1)
            badge = badges[0]
            self.assertGreaterEqual(_number(badge, "width"), 240)
            self.assertEqual(badge.findtext("scroll"), "true")
            self.assertLessEqual(
                _number(badge, "left") + _number(badge, "width"),
                int(layout.get("width")),
            )

    def test_diagnostic_events_use_a_compact_complete_detail_band(self) -> None:
        source = "deterministic-visual-source-04"
        error_type = "ConnectionRefusedErrorWithAnIntentionallyLongName"
        origin = f"https://{'h' * 63}.example.test:30005"
        view = present(
            AppState(
                route=Route.DIAGNOSTICS,
                diagnostics=(
                    {
                        "event": "discovery.candidate_rejected",
                        "source": source,
                        "error_type": error_type,
                    },
                    {"event": "server.validated", "origin": origin},
                ),
            )
        )
        rejected = next(
            entry for entry in view.items if entry.key == "diagnostics:event:0"
        )
        validated = next(
            entry for entry in view.items if entry.key == "diagnostics:event:1"
        )
        self.assertEqual(rejected.kind, "diagnostic-event")
        self.assertEqual(validated.kind, "diagnostic-event")
        self.assertEqual(rejected.secondary.arguments, (source, error_type))
        self.assertEqual(validated.secondary.literal.replace("\n", ""), origin)
        self.assertTrue(
            all(len(line) <= 60 for line in validated.secondary.literal.splitlines())
        )

        settings = self.control(59)
        item_height = int(settings.find("itemlayout").get("height"))
        for layout_name in ("itemlayout", "focusedlayout"):
            layout = settings.find(layout_name)
            title = [
                child
                for child in layout.findall("./control")
                if child.findtext("label") == "$INFO[ListItem.Label]"
                and child.findtext("visible")
                == "String.IsEqual(ListItem.Property(Kind),diagnostic-event)"
            ]
            detail = [
                child
                for child in layout.findall("./control")
                if child.findtext("label") == "$INFO[ListItem.Label2]"
                and child.findtext("visible")
                == "String.IsEqual(ListItem.Property(Kind),diagnostic-event)"
            ]
            self.assertEqual(len(title), 1)
            self.assertEqual(len(detail), 1)
            self.assertEqual(title[0].findtext("font"), "font30_title")
            self.assertEqual(detail[0].findtext("font"), "font20")
            self.assertEqual(detail[0].findtext("autoscroll"), "true")
            self.assertLessEqual(
                _number(title[0], "top") + _number(title[0], "height"),
                _number(detail[0], "top"),
            )
            self.assertLessEqual(
                _number(detail[0], "top") + _number(detail[0], "height"),
                item_height,
            )

    def test_recovery_cards_keep_permanent_home_order_and_use_bottom_row_geometry(self) -> None:
        recovery = RecoveryEnvelope(
            schema_version=1,
            server_id="server-id",
            origin="http://127.0.0.1:3000",
            mode="ROOM",
            created_at=1.0,
            last_connected_at=1.0,
            room_code="ABC234",
            participant_id="participant-id",
            credential_reference="credential-reference",
        )
        view = present(AppState(route=Route.HOME, recovery=recovery))
        self.assertEqual(
            [entry.key for entry in view.items],
            [
                "home:couch",
                "home:host",
                "home:display",
                "home:servers",
                "home:preferences",
                "home:recover",
                "home:discard-recovery",
            ],
        )
        self.assertFalse(view.items[5].danger)
        self.assertTrue(view.items[6].danger)

        upper_cards = [self.control(control_id) for control_id in range(100, 105)]
        recover = self.control(105)
        discard = self.control(106)
        unused = self.control(107)
        upper_bottom = max(
            _number(card, "top") + _number(card, "height") for card in upper_cards
        )
        self.assertEqual(_number(recover, "top"), _number(discard, "top"))
        self.assertEqual(_number(recover, "height"), _number(discard, "height"))
        self.assertLessEqual(upper_bottom, _number(recover, "top"))
        self.assertLessEqual(
            _number(recover, "left") + _number(recover, "width"),
            _number(discard, "left"),
        )
        self.assertLessEqual(
            _number(discard, "left") + _number(discard, "width"),
            _number(unused, "left"),
        )

        for suffix, card in ((6, recover), (7, discard)):
            secondary = next(
                node
                for node in self.skin.findall(".//control[@type='textbox']")
                if node.findtext("label")
                == f"$INFO[Window.Property(Home{suffix}Secondary)]"
            )
            self.assertEqual(secondary.findtext("autoscroll"), "false")
            self.assertGreater(_number(secondary, "top"), _number(card, "top"))
            self.assertLessEqual(
                _number(secondary, "top") + _number(secondary, "height"),
                _number(card, "top") + _number(card, "height"),
            )
            self.assertGreater(_number(secondary, "left"), _number(card, "left"))
            self.assertLessEqual(
                _number(secondary, "left") + _number(secondary, "width"),
                _number(card, "left") + _number(card, "width"),
            )

    def test_contract_length_copy_has_a_complete_overflow_mechanism(self) -> None:
        heading = next(
            control
            for control in self.skin.findall(".//control[@type='label']")
            if control.findtext("label") == "$INFO[Window.Property(Heading)]"
            and control.findtext("width") == "1300"
        )
        self.assertEqual(heading.findtext("scroll"), "true")
        self.assertEqual(heading.findtext("scrollspeed"), "60")

        rows = self.control(53)
        for layout_name in ("itemlayout", "focusedlayout"):
            layout = rows.find(layout_name)
            generic_title = next(
                child
                for child in layout.findall("./control")
                if child.findtext("label") == "$INFO[ListItem.Label]"
                and "card-result" in child.findtext("visible", "")
                and child.findtext("top") == "20"
            )
            card_copy = next(
                child
                for child in layout.findall("./control")
                if child.findtext("visible")
                == "String.IsEqual(ListItem.Property(Kind),card-result)"
            )
            self.assertEqual(generic_title.get("type"), "label")
            self.assertEqual(generic_title.findtext("scroll"), "true")
            self.assertEqual(generic_title.findtext("scrollspeed"), "60")
            self.assertEqual(card_copy.get("type"), "textbox")
            self.assertEqual(card_copy.findtext("autoscroll"), "true")

        action_secondary = _child_with_label(
            self.control(56).find("focusedlayout"),
            "$INFO[ListItem.Label2]",
        )
        self.assertEqual(action_secondary.findtext("scroll"), "true")
        self.assertEqual(action_secondary.findtext("scrollspeed"), "60")

        summary_primary = next(
            control
            for control in self.skin.findall(".//control[@type='textbox']")
            if control.findtext("label") == "$INFO[Window.Property(Fact1Value)]"
            and control.findtext("width") == "480"
        )
        self.assertEqual(summary_primary.findtext("autoscroll"), "true")

        for fact_number in range(2, 7):
            with self.subTest(summary_fact=fact_number):
                summary_value = next(
                    control
                    for control in self.skin.findall(".//control[@type='label']")
                    if control.findtext("label")
                    == f"$INFO[Window.Property(Fact{fact_number}Value)]"
                    and control.findtext("width") == "480"
                )
                self.assertEqual(summary_value.findtext("scroll"), "true")
                self.assertEqual(summary_value.findtext("scrollspeed"), "60")

        summary_seventh = next(
            control
            for control in self.skin.findall(".//control[@type='label']")
            if control.findtext("label") == "$INFO[Window.Property(Fact7Value)]"
            and control.findtext("width") == "1580"
        )
        self.assertEqual(summary_seventh.findtext("scroll"), "true")
        self.assertEqual(summary_seventh.findtext("scrollspeed"), "60")
        self.assertLessEqual(
            _number(summary_seventh, "top") + _number(summary_seventh, "height"),
            780,
        )

        classification_label = (
            "$INFO[Window.Property(CardEyebrow)]  "
            "$INFO[Window.Property(CardClassification)]"
        )
        classifications = [
            control
            for control in self.skin.findall(".//control[@type='label']")
            if control.findtext("label") == classification_label
        ]
        self.assertEqual(len(classifications), 4)
        self.assertEqual(
            sorted(control.findtext("width") for control in classifications),
            ["650", "650", "900", "900"],
        )
        for classification in classifications:
            self.assertEqual(classification.findtext("scroll"), "true")
            self.assertEqual(classification.findtext("scrollspeed"), "60")

        join_urls = next(
            control
            for control in self.skin.findall(".//control[@type='textbox']")
            if control.findtext("label") == "$INFO[Window.Property(JoinUrls)]"
        )
        self.assertEqual(join_urls.findtext("autoscroll"), "true")

        generic_footer = next(
            control
            for control in self.skin.findall(".//control[@type='label']")
            if control.findtext("label") == "$INFO[Window.Property(Footer)]"
            and control.findtext("width") == "1682"
        )
        self.assertEqual(generic_footer.findtext("scroll"), "true")
        self.assertEqual(generic_footer.findtext("scrollspeed"), "60")

    def test_player_profile_name_and_body_stay_inside_the_context_card(self) -> None:
        group = next(
            control
            for control in self.skin.findall(".//control[@type='group']")
            if control.findtext("visible")
            == "String.IsEqual(Window.Property(ViewMode),player-profile)"
        )
        paper = next(
            control
            for control in group.findall("./control[@type='image']")
            if control.findtext("texture") == "partycard-tv-paper.png"
        )
        name = _child_with_label(group, "$INFO[Window.Property(Fact1Value)]")
        body = _child_with_label(group, "$INFO[Window.Property(Body)]")

        self.assertEqual(name.get("type"), "label")
        self.assertEqual(name.findtext("scroll"), "true")
        self.assertEqual(name.findtext("scrollspeed"), "60")
        for control in (name, body):
            with self.subTest(label=control.findtext("label")):
                self.assertGreaterEqual(_number(control, "left"), _number(paper, "left"))
                self.assertGreaterEqual(_number(control, "top"), _number(paper, "top"))
                self.assertLessEqual(
                    _number(control, "left") + _number(control, "width"),
                    _number(paper, "left") + _number(paper, "width"),
                )
                self.assertLessEqual(
                    _number(control, "top") + _number(control, "height"),
                    _number(paper, "top") + _number(paper, "height"),
                )

    def test_current_four_action_couch_menu_exactly_fits_its_command_bar(self) -> None:
        menu = self.control(64)
        self.assertEqual(menu.get("type"), "list")
        self.assertEqual(menu.findtext("orientation"), "horizontal")
        self.assertEqual(menu.findtext("scrolltime"), "0")
        self.assertIn("ViewMode),active-menu", menu.findtext("visible", ""))
        for layout_name in ("itemlayout", "focusedlayout"):
            layout = menu.find(layout_name)
            self.assertIsNotNone(layout)
            self.assertEqual(int(layout.get("width")) * 4, _number(menu, "width"))
            label = _child_with_label(layout, "$INFO[ListItem.Label]")
            self.assertLessEqual(
                _number(label, "left") + _number(label, "width"),
                int(layout.get("width")),
            )
            self.assertLessEqual(
                _number(label, "top") + _number(label, "height"),
                int(layout.get("height")),
            )

    def test_anonymous_result_totals_and_passive_status_are_bounded(self) -> None:
        anonymous_totals = [
            control
            for property_name in ("ResultYes", "ResultNo")
            for control in self.skin.findall(".//control[@type='textbox']")
            if control.findtext("label")
            == f"$INFO[Window.Property({property_name})]"
            and "!String.IsEqual(Window.Property(PassiveRoomStage),true)"
            in control.findtext("visible", "")
        ]
        self.assertEqual(len(anonymous_totals), 2)
        for total in anonymous_totals:
            with self.subTest(label=total.findtext("label")):
                self.assertLessEqual(
                    _number(total, "left") + _number(total, "width"), 1920
                )
                self.assertLessEqual(
                    _number(total, "top") + _number(total, "height"), 1080
                )

        passive_body = next(
            control
            for control in self.skin.findall(".//control[@type='textbox']")
            if control.findtext("label") == "$INFO[Window.Property(Body)]"
            and control.findtext("left") == "118"
            and control.findtext("width") == "270"
        )
        self.assertEqual(passive_body.findtext("autoscroll"), "true")
        self.assertLessEqual(
            _number(passive_body, "left") + _number(passive_body, "width"), 1920
        )
        self.assertLessEqual(
            _number(passive_body, "top") + _number(passive_body, "height"), 1080
        )

        couch_recovery_body = next(
            control
            for control in self.skin.findall(".//control[@type='textbox']")
            if control.findtext("label") == "$INFO[Window.Property(Body)]"
            and control.findtext("left") == "430"
            and "!String.IsEqual(Window.Property(PassiveRoomStage),true)"
            in control.findtext("visible", "")
        )
        self.assertEqual(couch_recovery_body.findtext("font"), "font10")
        self.assertEqual(couch_recovery_body.findtext("autoscroll"), "false")
        self.assertGreaterEqual(_number(couch_recovery_body, "height"), 96)
        self.assertGreaterEqual(_number(couch_recovery_body, "top"), 688)
        self.assertLessEqual(
            _number(couch_recovery_body, "top")
            + _number(couch_recovery_body, "height"),
            794,
        )

    def test_maximum_notification_and_confirmation_copy_stays_inside_1080p(self) -> None:
        notification = next(
            control
            for control in self.skin.findall(".//control[@type='textbox']")
            if control.findtext("label") == "$INFO[Window.Property(Notification)]"
        )
        self.assertEqual(notification.findtext("autoscroll"), "true")
        self.assertLessEqual(
            _number(notification, "left") + _number(notification, "width"),
            1920,
        )
        self.assertLessEqual(
            _number(notification, "top") + _number(notification, "height"),
            1080,
        )
        self.assertGreaterEqual(_number(notification, "width"), 1200)
        self.assertGreaterEqual(_number(notification, "height"), 300)

        for property_name in ("ConfirmTitle", "ConfirmBody"):
            with self.subTest(property_name=property_name):
                confirmation = next(
                    control
                    for control in self.skin.findall(".//control[@type='textbox']")
                    if control.findtext("label")
                    == f"$INFO[Window.Property({property_name})]"
                )
                self.assertEqual(confirmation.findtext("autoscroll"), "true")
                self.assertLessEqual(
                    _number(confirmation, "left") + _number(confirmation, "width"),
                    1920,
                )
                self.assertLessEqual(
                    _number(confirmation, "top") + _number(confirmation, "height"),
                    1080,
                )


if __name__ == "__main__":
    unittest.main()
