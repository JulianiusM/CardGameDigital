from __future__ import annotations

import unittest

from support import RESOURCES_ROOT
from lib.presentation import HELP_PAGE_LINES, _text_pages


REPOSITORY_ROOT = RESOURCES_ROOT.parents[2]


class HelpPaginationTests(unittest.TestCase):
    def test_measured_kodi_help_surface_uses_ten_rendered_lines(self) -> None:
        self.assertEqual(HELP_PAGE_LINES, 10)

    def test_every_bundled_help_document_fits_the_fixed_article_surface(self) -> None:
        documents = sorted((REPOSITORY_ROOT / "docs" / "user-guide").glob("*/*.md"))
        self.assertTrue(documents)
        for document in documents:
            with self.subTest(document=document.relative_to(REPOSITORY_ROOT)):
                pages = _text_pages(document.read_text(encoding="utf-8"))
                self.assertTrue(all(1 <= len(page.splitlines()) <= HELP_PAGE_LINES for page in pages))
                self.assertTrue(
                    all(
                        len(page.splitlines()) >= HELP_PAGE_LINES - 3
                        for page in pages[:-1]
                    )
                )

    def test_sentence_boundaries_are_kept_when_the_sentence_fits_a_page(self) -> None:
        sentences = tuple(
            f"Sentence {index} contains enough readable words to exercise measured wrapping."
            for index in range(30)
        )
        pages = _text_pages(" ".join(sentences), line_width=42, maximum_lines=8)

        self.assertGreater(len(pages), 1)
        self.assertTrue(all(page.endswith(".") for page in pages))

    def test_unbroken_worst_case_token_is_complete_across_bounded_pages(self) -> None:
        token = "W" * 1_000
        pages = _text_pages(token, line_width=40, maximum_lines=6)

        self.assertEqual("".join("".join(page.splitlines()) for page in pages), token)
        self.assertTrue(all(len(page.splitlines()) <= 6 for page in pages))

    def test_german_structured_article_never_splits_a_fitting_bullet(self) -> None:
        article = """Hier findest du nicht nur Regeln, sondern konkrete Hilfe für die Vorbereitung, einen sicheren Spielabend und typische Verbindungsprobleme.

Empfohlene Reihenfolge
• Schnellstart und Spielaufbau – passende Gerätekombination wählen und Runde starten.
• Spielmodi und Karten – verstehen, wie die vier Modi ablaufen.
• Räume, Geräte und Spielleitung – Raumcode, Party Screen, mehrere Personen pro Gerät und Hostwechsel.
• Grenzen und respektvolles Spielen – Grenzen setzen, Karten ablehnen und Einvernehmen bewahren.
• Konten und gespeicherte Daten – schnelle Runden, DataSpaces, Gruppen und Export."""

        pages = _text_pages(article)

        self.assertEqual(len(pages[0].splitlines()), 9)
        self.assertTrue(pages[0].endswith("Gerät und Hostwechsel."))
        self.assertTrue(
            pages[1].startswith("• Grenzen und respektvolles Spielen")
        )
        self.assertNotIn(
            "Grenzen und respektvolles Spielen",
            pages[0],
        )
        self.assertEqual(
            " ".join("\n".join(pages).split()),
            " ".join(article.split()),
        )


if __name__ == "__main__":
    unittest.main()
