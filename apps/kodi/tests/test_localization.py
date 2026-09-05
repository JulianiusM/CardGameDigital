from __future__ import annotations

import json
import unittest
import xml.etree.ElementTree as ET

from support import CLIENT_ROOT
from lib import native_settings_metadata as native_settings
from lib.localization import CatalogLocalizer, load_po_catalog
from lib.presentation import HELP_PAGE_LINES, _text_pages
from lib import strings


class LocalizationTests(unittest.TestCase):
    def test_generated_artifacts_match_the_canonical_catalog_and_addon_version(self) -> None:
        catalog_path = CLIENT_ROOT.parents[1] / "packages/localization/kodiCatalog.json"
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        messages = catalog["messages"]
        expected_constants = {
            message["constant"]: message["id"] for message in messages
        }
        actual_constants = {
            name: value
            for name, value in vars(strings).items()
            if name.isupper() and isinstance(value, int) and 32000 <= value <= 32999
        }
        self.assertEqual(actual_constants, expected_constants)

        english = load_po_catalog(
            CLIENT_ROOT / "resources/language/resource.language.en_gb/strings.po"
        )
        german = load_po_catalog(
            CLIENT_ROOT / "resources/language/resource.language.de_de/strings.po"
        )
        for message in messages:
            with self.subTest(message=message["constant"]):
                if "sharedKey" in message:
                    self.assertEqual(message["sharedKey"], message["constant"])
                    self.assertNotIn("source", message)
                    self.assertNotIn("translations", message)
                    self.assertIn(message["id"], english)
                    self.assertIn(message["id"], german)
                    continue
                self.assertEqual(english[message["id"]], message["source"])
                self.assertEqual(
                    german[message["id"]], message["translations"]["de-DE"]
                )

        addon = ET.parse(CLIENT_ROOT / "addon.xml").getroot()
        project_version = f'{addon.attrib["name"]} {addon.attrib["version"]}'
        for relative_path in (
            "resource.language.en_gb/strings.po",
            "resource.language.de_de/strings.po",
        ):
            content = (CLIENT_ROOT / "resources/language" / relative_path).read_text(
                encoding="utf-8"
            )
            self.assertIn(f'"Project-Id-Version: {project_version}\\n"', content)

    def test_native_settings_and_locale_metadata_match_the_canonical_manifest(self) -> None:
        catalog = json.loads(
            (CLIENT_ROOT.parents[1] / "packages/localization/kodiCatalog.json").read_text(
                encoding="utf-8"
            )
        )
        message_ids = {
            message["constant"]: message["id"] for message in catalog["messages"]
        }
        source = catalog["nativeSettings"]
        definitions = [
            setting
            for category in source["categories"]
            for setting in category["settings"]
        ]

        expected_ids = tuple(setting["id"] for setting in definitions)
        self.assertEqual(native_settings.SETTING_IDS, expected_ids)
        self.assertEqual(
            {
                getattr(native_settings, setting["constant"]): setting["type"]
                for setting in definitions
            },
            native_settings.SETTING_TYPES,
        )
        self.assertEqual(
            {
                setting["id"]: message_ids[setting["labelConstant"]]
                for setting in definitions
            },
            native_settings.SETTING_LABEL_IDS,
        )
        self.assertEqual(
            {
                setting["id"]: message_ids[setting["helpConstant"]]
                for setting in definitions
            },
            native_settings.SETTING_HELP_IDS,
        )
        self.assertEqual(
            {setting["id"]: setting["default"] for setting in definitions},
            native_settings.SETTING_DEFAULTS,
        )
        self.assertEqual(
            {
                setting["id"]: setting["maximumLength"]
                for setting in definitions
                if "maximumLength" in setting
            },
            native_settings.SETTING_MAXIMUM_LENGTHS,
        )
        self.assertEqual(
            {
                setting["id"]: (
                    setting["minimum"],
                    setting["step"],
                    setting["maximum"],
                )
                for setting in definitions
                if setting["type"] == "integer"
            },
            native_settings.SETTING_INTEGER_RANGES,
        )

        automatic = source["automaticLocale"]
        explicit_locales = catalog["locales"]
        self.assertEqual(native_settings.SOURCE_LOCALE, catalog["sourceLocale"])
        self.assertEqual(native_settings.AUTOMATIC_LOCALE, automatic["value"])
        self.assertEqual(
            native_settings.LOCALE_VALUES,
            (automatic["value"], *(locale["tag"] for locale in explicit_locales)),
        )
        self.assertEqual(
            native_settings.LOCALE_DIRECTORIES,
            {locale["tag"]: locale["directory"] for locale in explicit_locales},
        )
        self.assertEqual(
            native_settings.LOCALE_LABEL_IDS,
            {
                automatic["value"]: message_ids[automatic["labelConstant"]],
                **{
                    locale["tag"]: message_ids[locale["nativeLabelConstant"]]
                    for locale in explicit_locales
                },
            },
        )

        root = ET.parse(CLIENT_ROOT / "resources/settings.xml").getroot()
        section = root.find("section")
        self.assertIsNotNone(section)
        assert section is not None
        self.assertEqual(section.attrib["id"], source["sectionId"])
        actual_categories = section.findall("category")
        self.assertEqual(
            [category.attrib["id"] for category in actual_categories],
            [category["id"] for category in source["categories"]],
        )
        for category_source, category in zip(source["categories"], actual_categories):
            self.assertEqual(
                category.attrib["label"],
                str(message_ids[category_source["labelConstant"]]),
            )
            actual_settings = category.findall("./group/setting")
            self.assertEqual(
                [setting.attrib["id"] for setting in actual_settings],
                [setting["id"] for setting in category_source["settings"]],
            )
            for setting_source, setting in zip(
                category_source["settings"], actual_settings
            ):
                with self.subTest(setting=setting_source["id"]):
                    self.assertEqual(setting.attrib["type"], setting_source["type"])
                    self.assertEqual(
                        setting.attrib["label"],
                        str(message_ids[setting_source["labelConstant"]]),
                    )
                    self.assertEqual(
                        setting.attrib["help"],
                        str(message_ids[setting_source["helpConstant"]]),
                    )
                    self.assertEqual(setting.findtext("level"), "0")
                    expected_default = setting_source["default"]
                    if isinstance(expected_default, bool):
                        expected_default_text = str(expected_default).lower()
                    else:
                        expected_default_text = str(expected_default)
                    self.assertEqual(setting.findtext("default") or "", expected_default_text)

                    if "allowEmpty" in setting_source:
                        self.assertEqual(
                            setting.findtext("./constraints/allowempty"),
                            str(setting_source["allowEmpty"]).lower(),
                        )
                    if setting_source.get("localeOptions"):
                        options = setting.findall("./constraints/options/option")
                        expected_options = [
                            (
                                str(message_ids[automatic["labelConstant"]]),
                                automatic["value"],
                            ),
                            *[
                                (
                                    str(message_ids[locale["nativeLabelConstant"]]),
                                    locale["tag"],
                                )
                                for locale in explicit_locales
                            ],
                        ]
                        self.assertEqual(
                            [(option.attrib["label"], option.text) for option in options],
                            expected_options,
                        )
                    if setting_source["type"] == "integer":
                        self.assertEqual(
                            setting.findtext("./constraints/minimum"),
                            str(setting_source["minimum"]),
                        )
                        self.assertEqual(
                            setting.findtext("./constraints/step"),
                            str(setting_source["step"]),
                        )
                        self.assertEqual(
                            setting.findtext("./constraints/maximum"),
                            str(setting_source["maximum"]),
                        )
                    control = setting.find("control")
                    self.assertIsNotNone(control)
                    assert control is not None
                    expected_control_attributes = {"type": setting_source["control"]["type"]}
                    if "format" in setting_source["control"]:
                        expected_control_attributes["format"] = setting_source["control"][
                            "format"
                        ]
                    self.assertEqual(control.attrib, expected_control_attributes)
                    heading_constant = setting_source["control"].get("headingConstant")
                    expected_heading = None
                    if heading_constant is not None:
                        expected_heading = str(message_ids[heading_constant])
                    self.assertEqual(control.findtext("heading"), expected_heading)

    def test_bootstrap_shell_references_generated_string_constants(self) -> None:
        runtime = (CLIENT_ROOT / "resources/lib/kodi_runtime.py").read_text(encoding="utf-8")
        window = (CLIENT_ROOT / "resources/lib/screens/main_window.py").read_text(
            encoding="utf-8"
        )
        self.assertIn("bootstrap_strings.ADDON_START_FAILED", runtime)
        self.assertIn("bootstrap_strings.LOADING", window)
        self.assertIn("bootstrap_strings.BACK", window)
        self.assertIn("bootstrap_strings.HELP", window)
        for source in (runtime, window):
            self.assertNotRegex(source, r"(?m)^\w+(?:_MESSAGE)? = 32\d{3}$")

    def test_catalogs_resolve_the_same_ids_and_explicit_locale(self) -> None:
        english = load_po_catalog(
            CLIENT_ROOT / "resources/language/resource.language.en_gb/strings.po"
        )
        german = load_po_catalog(
            CLIENT_ROOT / "resources/language/resource.language.de_de/strings.po"
        )
        self.assertEqual(set(english), set(german))
        self.assertEqual(english[32007], "Home")
        self.assertEqual(german[32007], "Start")
        self.assertEqual(english[32105], "Remaining")
        self.assertEqual(german[32105], "Übrig")
        self.assertEqual(english[32405], "Allowed range: %s–%s.")
        self.assertEqual(german[32405], "Zulässiger Bereich: %s–%s.")
        self.assertEqual(
            english[32432],
            "D-pad + OK · Page Up: Yes · Page Down: No",
        )
        self.assertEqual(
            german[32432],
            "Steuerkreuz + OK · Bild hoch: Ja · Bild runter: Nein",
        )

        localizer = CatalogLocalizer(CLIENT_ROOT)
        self.assertEqual(
            localizer.template(32007, "de-DE", lambda _key: "fallback"),
            "Start",
        )
        self.assertEqual(localizer.template(32007, "auto", lambda _key: "Kodi"), "Kodi")

    def test_german_help_and_destructive_copy_survives_bounded_page_layout(self) -> None:
        german = load_po_catalog(
            CLIENT_ROOT / "resources/language/resource.language.de_de/strings.po"
        )
        help_copy = "\n\n".join(
            german[message_id]
            for message_id in (
                strings.HELP_GETTING_STARTED_BODY,
                strings.HELP_SERVERS_BODY,
                strings.HELP_NAVIGATION_BODY,
                strings.HELP_GAMEPLAY_BODY,
            )
        )
        pages = _text_pages(help_copy)
        self.assertGreater(len(pages), 1)
        self.assertEqual(HELP_PAGE_LINES, 10)
        self.assertTrue(
            all(len(page.splitlines()) <= HELP_PAGE_LINES for page in pages)
        )
        self.assertTrue(
            all(len(line) <= 82 for page in pages for line in page.splitlines())
        )
        source_words = help_copy.replace("\n", " ").split()
        paged_words = " ".join(pages).replace("\n", " ").split()
        self.assertEqual(paged_words, source_words)

        destructive_copy = {
            strings.DISCARD_RECOVERY_BODY: (
                "Gespeicherte Fortsetzungsdaten entfernen? Dadurch wird kein "
                "Verlassen-Befehl an den Server gesendet."
            ),
            strings.END_GAME_BODY: (
                "Dieses Spiel beenden? Die aktuelle Sitzung wird geschlossen und "
                "kann nicht fortgesetzt werden."
            ),
            strings.EXIT_ADDON_BODY: (
                "Zu Kodi zurückkehren? Ein wiederherstellbares Spiel bleibt verfügbar."
            ),
            strings.CONFIRM_ADULT_BODY: (
                "Dieses Profil enthält explizite Inhalte für Erwachsene. Bestätige, "
                "dass alle Spielenden volljährig sind."
            ),
            strings.ROOM_DISPLAY_LEAVE_TITLE: "Diese Anzeige vom Raum trennen?",
            strings.ROOM_DISPLAY_LEAVE_BODY: (
                "Der Raum bleibt offen. Diese Anzeige verlässt ihn; ihre gespeicherte "
                "Raumverbindung wird entfernt."
            ),
        }
        for message_id, expected in destructive_copy.items():
            with self.subTest(message_id=message_id):
                self.assertEqual(german[message_id], expected)

        self.assertEqual(
            german[strings.DISPLAY_ROOM_HINT],
            "Mit einem Raum verbinden und nur anzeigen.",
        )
        self.assertEqual(
            german[strings.SERVERS_HINT],
            "Lokale und globale Server finden und verwalten.",
        )
        self.assertEqual(german[strings.SUBMITTING_VOTE], "Stimmabgabe")
        self.assertEqual(
            german[strings.EXACT_CARDS_HELP],
            "Überschreibe eine Karte nach Standardwerten und bedingten Regeln.",
        )

    def test_removed_anonymous_handoff_copy_is_not_shipped(self) -> None:
        english = load_po_catalog(
            CLIENT_ROOT / "resources/language/resource.language.en_gb/strings.po"
        )
        german = load_po_catalog(
            CLIENT_ROOT / "resources/language/resource.language.de_de/strings.po"
        )
        for constant in ("PASS_REMOTE", "READY_TO_VOTE", "PASS_REMOTE_SHORT"):
            with self.subTest(constant=constant):
                self.assertFalse(hasattr(strings, constant))
        self.assertNotIn(32279, english)
        self.assertNotIn(32282, english)
        self.assertNotIn(32456, english)
        self.assertNotIn(32279, german)
        self.assertNotIn(32282, german)
        self.assertNotIn(32456, german)


if __name__ == "__main__":
    unittest.main()
