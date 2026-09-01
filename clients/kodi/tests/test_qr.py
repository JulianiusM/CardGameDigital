from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from support import RESOURCES_ROOT
from lib.qr import QrOverflowError, encode_text, write_png


class QrTests(unittest.TestCase):
    def test_encodes_room_join_url_with_finder_and_timing_patterns(self) -> None:
        code = encode_text("http://192.168.1.20:3000/play/?room=ABC234")
        self.assertEqual(code.version, 3)
        self.assertEqual(code.size, 29)
        for center_x, center_y in ((3, 3), (code.size - 4, 3), (3, code.size - 4)):
            self.assertTrue(code.module(center_x, center_y))
            self.assertFalse(code.module(center_x + 2, center_y))
            self.assertTrue(code.module(center_x + 3, center_y))
        self.assertEqual(
            [code.module(index, 6) for index in range(8, 13)],
            [True, False, True, False, True],
        )

    def test_png_is_deterministic_local_and_high_contrast(self) -> None:
        code = encode_text("https://play.example.com/play/?room=ABC234")
        with tempfile.TemporaryDirectory() as directory:
            first = write_png(code, Path(directory) / "one.png")
            second = write_png(code, Path(directory) / "two.png")
            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertTrue(first.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"))

    def test_rejects_unbounded_payload(self) -> None:
        with self.assertRaises(QrOverflowError):
            encode_text("x" * 1000)


if __name__ == "__main__":
    unittest.main()
