from __future__ import annotations

import unittest

from support import private_resolver, public_resolver
from lib.discovery.address_policy import (
    AddressPolicyError,
    normalize_origin,
    relative_url,
    validate_transport,
    websocket_url,
)


class AddressPolicyTests(unittest.TestCase):
    def test_normalizes_local_and_global_manual_entries(self) -> None:
        self.assertEqual(normalize_origin("192.168.1.20:3000"), "http://192.168.1.20:3000")
        self.assertEqual(normalize_origin("Play.Example.COM/"), "https://play.example.com")
        self.assertEqual(normalize_origin("http://[fd00::20]:3000"), "http://[fd00::20]:3000")

    def test_plain_http_requires_local_resolution_and_local_server_mode(self) -> None:
        self.assertEqual(
            validate_transport("http://partybox:3000", "local", private_resolver),
            "http://partybox:3000",
        )
        with self.assertRaisesRegex(AddressPolicyError, "local destinations"):
            validate_transport("http://partybox:3000", "local", public_resolver)
        with self.assertRaisesRegex(AddressPolicyError, "require HTTPS"):
            validate_transport("http://192.168.1.20:3000", "public", private_resolver)

    def test_rejects_credentials_paths_queries_and_remote_endpoints(self) -> None:
        for value in (
            "http://user:pass@192.168.1.2",
            "https://example.com/api",
            "https://example.com/?token=x",
        ):
            with self.subTest(value=value), self.assertRaises(AddressPolicyError):
                normalize_origin(value)
        with self.assertRaises(AddressPolicyError):
            relative_url("https://example.com", "//evil.example/path")

    def test_websocket_url_preserves_same_origin_path(self) -> None:
        self.assertEqual(
            websocket_url("https://play.example.com", "/ws", "de-DE"),
            "wss://play.example.com/ws?locale=de-DE",
        )


if __name__ == "__main__":
    unittest.main()

