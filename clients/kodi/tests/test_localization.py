from __future__ import annotations

import unittest

from support import CLIENT_ROOT
from lib.localization import CatalogLocalizer, load_po_catalog
from lib.presentation import HELP_PAGE_LINES, _text_pages
from lib import strings


class LocalizationTests(unittest.TestCase):
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
