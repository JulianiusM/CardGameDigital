from __future__ import annotations

import unittest

from support import RESOURCES_ROOT
from lib.diagnostics import DiagnosticBuffer, redact


class DiagnosticTests(unittest.TestCase):
    def test_recursively_redacts_credentials_tokens_card_text_and_url_queries(self) -> None:
        value = redact(
            {
                "participantCredential": "secret-value",
                "nested": {"access_token": "token-value", "cardText": "private Card"},
                "url": "https://example.com/play?room=ABC234&token=secret#fragment",
            }
        )
        self.assertEqual(value["participantCredential"], "[redacted]")
        self.assertEqual(value["nested"]["access_token"], "[redacted]")
        self.assertEqual(value["nested"]["cardText"], "[redacted]")
        self.assertNotIn("secret", value["url"])
        self.assertNotIn("fragment", value["url"])

    def test_buffer_is_bounded_and_structured(self) -> None:
        buffer = DiagnosticBuffer(10)
        for index in range(20):
            buffer.add("event", index=index, password="hidden")
        entries = buffer.entries()
        self.assertEqual(len(entries), 10)
        self.assertTrue(all(entry["password"] == "[redacted]" for entry in entries))


if __name__ == "__main__":
    unittest.main()

