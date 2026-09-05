from __future__ import annotations

import threading
import unittest

from support import JsonServer
from lib.auth import DeviceAuthorizationClient, DeviceAuthorizationError
from lib.protocol.validation import load_generated_json, validate_server_info


class DeviceAuthorizationTests(unittest.TestCase):
    def _server_info(self) -> dict:
        info = load_generated_json("fixtures/server-info.json")
        info["capabilities"]["nativeDeviceAuthorization"] = True
        info["nativeDeviceAuthorization"] = {
            "clientId": "kodi-native",
            "scopes": ["game.play", "groups.read"],
        }
        info["endpoints"].update(
            {
                "deviceAuthorizationPath": "/oauth/device_authorization",
                "deviceTokenPath": "/oauth/token",
                "deviceRevocationPath": "/oauth/revoke",
            }
        )
        return validate_server_info(info)

    def test_uses_form_encoded_device_poll_refresh_and_revocation(self) -> None:
        captured: list[tuple[str, object, str]] = []

        def responder(method: str, path: str, body: object, headers: dict[str, str]):
            captured.append((path, body, headers.get("content-type", "")))
            if path == "/oauth/device_authorization":
                return 200, {
                    "device_code": "device-secret",
                    "user_code": "ABCD-EFGH",
                    "verification_uri": "https://example.test/device",
                    "verification_uri_complete": "https://example.test/device?user_code=ABCD-EFGH",
                    "expires_in": 60,
                    "interval": 1,
                }, {}
            if path == "/oauth/token" and body.get("grant_type") == "refresh_token":
                return 200, {"access_token": "refreshed", "expires_in": 300}, {}
            if path == "/oauth/token":
                return 200, {
                    "access_token": "access",
                    "refresh_token": "refresh",
                    "expires_in": 300,
                }, {}
            return 204, b"", {"Content-Type": "application/json"}

        with JsonServer(responder) as server:
            client = DeviceAuthorizationClient(server.origin, self._server_info())
            authorization = client.begin(client.client_id, client.scope)
            token = client.poll(authorization, client.client_id, threading.Event())
            refreshed = client.refresh("refresh")
            client.revoke("refresh")

        self.assertEqual(token["access_token"], "access")
        self.assertEqual(refreshed["access_token"], "refreshed")
        self.assertEqual(captured[0][1]["scope"], "game.play groups.read")
        self.assertTrue(
            all(
                content_type.startswith("application/x-www-form-urlencoded")
                for _path, _body, content_type in captured
            )
        )

    def test_capability_gate_and_cancellation_are_explicit(self) -> None:
        info = load_generated_json("fixtures/server-info.json")
        with self.assertRaisesRegex(DeviceAuthorizationError, "does not advertise"):
            DeviceAuthorizationClient("http://127.0.0.1:3000", info)

    def test_rejects_device_response_copy_that_exceeds_visible_limits(self) -> None:
        responses = (
            {
                "device_code": "device-secret",
                "user_code": "U" * 201,
                "verification_uri": "https://example.test/device",
                "expires_in": 60,
            },
            {
                "device_code": "device-secret",
                "user_code": "ABCD-EFGH",
                "verification_uri": "https://example.test/" + ("u" * 480),
                "expires_in": 60,
            },
        )
        for response in responses:
            with self.subTest(field=max(response, key=lambda key: len(str(response[key])))):
                def responder(
                    method: str, path: str, body: object, headers: dict[str, str]
                ):
                    return 200, response, {}

                with JsonServer(responder) as server:
                    client = DeviceAuthorizationClient(server.origin, self._server_info())
                    with self.assertRaisesRegex(
                        DeviceAuthorizationError,
                        "invalid device authorization",
                    ):
                        client.begin(client.client_id, client.scope)


if __name__ == "__main__":
    unittest.main()
