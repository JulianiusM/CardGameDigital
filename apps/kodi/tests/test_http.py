from __future__ import annotations

import copy
import ssl
import unittest
from unittest.mock import patch
from urllib.request import HTTPSHandler

from support import JsonServer
from lib.discovery.address_policy import AddressPolicyError
from lib.protocol.validation import load_generated_json
from lib.transport.http import ApiClient, HttpFailure, JsonHttpClient, MAX_RESPONSE_BYTES


class HttpTransportTests(unittest.TestCase):
    def test_https_requires_modern_tls_and_certificate_verification(self) -> None:
        context = ssl.create_default_context()
        context.minimum_version = ssl.TLSVersion.MINIMUM_SUPPORTED
        with patch("lib.transport.http.ssl.create_default_context", return_value=context):
            client = JsonHttpClient("https://example.test")
        handler = next(item for item in client._opener.handlers if isinstance(item, HTTPSHandler))
        self.assertIs(handler._context, context)
        self.assertEqual(context.minimum_version, ssl.TLSVersion.TLSv1_2)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)

    def test_probe_validates_local_server_and_rejects_redirects(self) -> None:
        info = load_generated_json("fixtures/server-info.json")

        def responder(method: str, path: str, body: object, headers: dict[str, str]):
            if path == "/readyz":
                return 200, b"ready", {"Content-Type": "text/plain"}
            if path == "/api/v1/server-info":
                return 200, info, {}
            if path == "/redirect":
                return 302, {}, {"Location": "/api/v1/server-info"}
            return 404, {"error": {"code": "NOT_FOUND", "message": "Missing"}}, {}

        with JsonServer(responder) as server:
            origin, result = ApiClient.probe(server.origin)
            self.assertEqual(origin, server.origin)
            self.assertEqual(result["serverId"], info["serverId"])
            with self.assertRaisesRegex(HttpFailure, "redirect"):
                JsonHttpClient(server.origin).request("GET", "/redirect")

    def test_plain_http_server_cannot_claim_public_deployment(self) -> None:
        info = load_generated_json("fixtures/server-info.json")
        info["deploymentMode"] = "public"

        def responder(_method: str, path: str, _body: object, _headers: dict[str, str]):
            if path == "/readyz":
                return 200, b"ready", {"Content-Type": "text/plain"}
            return 200, info, {}

        with JsonServer(responder) as server:
            with self.assertRaisesRegex(AddressPolicyError, "require HTTPS"):
                ApiClient.probe(server.origin)

    def test_bounds_response_size_and_projects_server_error(self) -> None:
        def responder(method: str, path: str, body: object, headers: dict[str, str]):
            if path == "/large":
                return 200, b"x" * (MAX_RESPONSE_BYTES + 1), {}
            return 409, {"error": {"code": "STALE_SESSION_REVISION", "message": "Refresh"}}, {}

        with JsonServer(responder) as server:
            with self.assertRaisesRegex(HttpFailure, "size limit"):
                JsonHttpClient(server.origin).request("GET", "/large")
            with self.assertRaises(HttpFailure) as failure:
                JsonHttpClient(server.origin).request("POST", "/command", {})
            self.assertEqual(failure.exception.status, 409)
            self.assertEqual(failure.exception.code, "STALE_SESSION_REVISION")
            self.assertEqual(str(failure.exception), "Refresh")

    def test_rejects_non_json_success_and_unready_probe(self) -> None:
        info = load_generated_json("fixtures/server-info.json")

        def responder(_method: str, path: str, _body: object, _headers: dict[str, str]):
            if path == "/readyz":
                return 200, b"starting", {"Content-Type": "text/plain"}
            if path == "/text":
                return 200, b"not json", {"Content-Type": "text/plain"}
            return 200, info, {}

        with JsonServer(responder) as server:
            with self.assertRaisesRegex(HttpFailure, "not ready"):
                ApiClient.probe(server.origin)
            with self.assertRaisesRegex(HttpFailure, "non-JSON"):
                JsonHttpClient(server.origin).request("GET", "/text")

    def test_room_create_uses_display_bootstrap_and_idempotency_header(self) -> None:
        info = load_generated_json("fixtures/server-info.json")
        join = {
            "roomId": "00000000-0000-4000-8000-000000000010",
            "roomCode": "ABC234",
            "participantId": "00000000-0000-4000-8000-000000000001",
            "participantCredential": "x" * 43,
            "role": "DISPLAY",
            "bootstrapMode": "DISPLAY_WAITING_FOR_HOST",
            "hostStatus": {
                "state": "AWAITING_FIRST_HOST",
                "participantId": None,
                "displayName": None,
                "deadline": 2_000_000_000_000,
            },
        }
        captured: list[tuple[object, object]] = []

        def responder(method: str, path: str, body: object, headers: dict[str, str]):
            captured.append((body, headers.get("idempotency-key")))
            return 201, join, {}

        with JsonServer(responder) as server:
            client = ApiClient(server.origin, info)
            result = client.create_display_room("TV", "EPHEMERAL", {"mode": "x"}, "key")
            self.assertEqual(result["role"], "DISPLAY")
        body, key = captured[0]
        self.assertEqual(body["bootstrapMode"], "DISPLAY_WAITING_FOR_HOST")
        self.assertEqual(key, "key")

    def test_group_update_preserves_saved_defaults_at_the_validated_boundary(self) -> None:
        info = load_generated_json("fixtures/server-info.json")
        group_id = "00000000-0000-4000-8000-000000000010"
        response = {
            "id": group_id,
            "name": "Close friends",
            "members": ["Alex", "Sam"],
            "updatedAt": "2026-08-28T12:00:00.000Z",
            "historyResetAt": None,
            "preferredProfileId": "PROFILE_FRIENDS",
            "customConfiguration": None,
            "cardLanguageSettings": None,
        }
        captured: list[object] = []

        def responder(method: str, path: str, body: object, _headers: dict[str, str]):
            self.assertEqual(method, "PUT")
            self.assertEqual(path, f"/api/v1/groups/{group_id}")
            captured.append(body)
            return 200, response, {}

        with JsonServer(responder) as server:
            result = ApiClient(server.origin, info).update_group(response)
        self.assertEqual(result["name"], "Close friends")
        self.assertEqual(captured[0]["preferredProfileId"], "PROFILE_FRIENDS")

    def test_help_index_and_documents_are_localized_validated_and_plain_text(self) -> None:
        info = load_generated_json("fixtures/server-info.json")
        languages: list[str] = []

        def responder(_method: str, path: str, _body: object, headers: dict[str, str]):
            languages.append(headers.get("accept-language", ""))
            if path == "/api/v1/help":
                return 200, {
                    "documents": [
                        {"slug": "readme", "title": "Overview"},
                        {"slug": "rooms", "title": "Rooms"},
                    ]
                }, {}
            if path == "/api/v1/help/rooms":
                return 200, {
                    "slug": "rooms",
                    "title": "Rooms",
                    "html": (
                        "<h1>Rooms</h1><p>Join safely.</p>"
                        "<ul><li>Scan the code</li><li>Enter it manually</li></ul>"
                        "<script>secret()</script>"
                    ),
                }, {}
            return 404, {"error": {"code": "NOT_FOUND", "message": "Missing"}}, {}

        with JsonServer(responder) as server:
            client = ApiClient(server.origin, info, locale="de-DE")
            topics = client.get_help_index()
            document = client.get_help_document("rooms")
        self.assertEqual([topic["slug"] for topic in topics], ["readme", "rooms"])
        self.assertIn("Join safely.", document["body"])
        self.assertIn("• Scan the code", document["body"])
        self.assertNotIn("secret", document["body"])
        self.assertEqual(languages, ["de-DE", "de-DE"])

    def test_card_search_sends_an_opaque_cursor_and_validates_the_next_page(self) -> None:
        info = load_generated_json("fixtures/server-info.json")
        cursor = "00000000-0000-4000-8000-000000000040"
        group_id = "00000000-0000-4000-8000-000000000010"
        captured: list[object] = []

        def responder(_method: str, path: str, body: object, _headers: dict[str, str]):
            self.assertEqual(
                path,
                f"/api/v1/card-policy/session/cards?groupId={group_id}",
            )
            captured.append(body)
            return 200, {"total": 24, "nextCursor": None, "cards": []}, {}

        with JsonServer(responder) as server:
            result = ApiClient(server.origin, info).search_session_cards(
                {}, "en-GB", "question", cursor=cursor, group_id=group_id
            )
        self.assertEqual(result["total"], 24)
        self.assertEqual(captured[0]["search"]["cursor"], cursor)

    def test_group_eligibility_preview_sends_the_authorization_scope_query(self) -> None:
        info = load_generated_json("fixtures/server-info.json")
        group_id = "00000000-0000-4000-8000-000000000010"

        def responder(_method: str, path: str, body: object, _headers: dict[str, str]):
            self.assertEqual(
                path,
                f"/api/v1/card-policy/session/eligibility-preview?groupId={group_id}",
            )
            self.assertEqual(body["settings"]["groupId"], group_id)
            return 200, {
                "total": 12,
                "availableAtStart": 10,
                "byType": {"QUESTION": 8, "DARE": 4, "CONVERSATION_META": 0},
                "atStartByType": {"QUESTION": 7, "DARE": 3, "CONVERSATION_META": 0},
                "playerCount": 4,
            }, {}

        with JsonServer(responder) as server:
            result = ApiClient(server.origin, info).eligibility_preview(
                {"groupId": group_id},
                4,
            )
        self.assertEqual(result["total"], 12)


if __name__ == "__main__":
    unittest.main()
