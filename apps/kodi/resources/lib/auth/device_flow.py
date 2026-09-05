"""OAuth-style device flow used only for explicitly advertised server endpoints."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Mapping
from urllib.parse import urlsplit

from ..native_settings_metadata import SOURCE_LOCALE
from ..transport.http import HttpFailure, JsonHttpClient


class DeviceAuthorizationError(RuntimeError):
    pass


MAXIMUM_DEVICE_CODE_LENGTH = 4_096
MAXIMUM_USER_CODE_LENGTH = 200
MAXIMUM_VERIFICATION_URI_LENGTH = 500
MAXIMUM_COMPLETE_URI_LENGTH = 2_000


def _response_text(response: Mapping[str, Any], key: str, maximum: int) -> str:
    value = response.get(key)
    if not isinstance(value, str) or not value or len(value) > maximum:
        raise DeviceAuthorizationError(
            f"Server returned an invalid device authorization {key}"
        )
    return value


def _response_http_uri(
    response: Mapping[str, Any], key: str, maximum: int
) -> str:
    value = _response_text(response, key, maximum)
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or any(character.isspace() for character in value)
    ):
        raise DeviceAuthorizationError(
            f"Server returned an invalid device authorization {key}"
        )
    try:
        parsed.port
    except ValueError as error:
        raise DeviceAuthorizationError(
            f"Server returned an invalid device authorization {key}"
        ) from error
    return value


@dataclass(frozen=True)
class DeviceAuthorization:
    device_code: str
    user_code: str
    verification_uri: str
    verification_uri_complete: str | None
    expires_at: float
    interval: float


class DeviceAuthorizationClient:
    def __init__(
        self,
        origin: str,
        server_info: Mapping[str, Any],
        locale: str = SOURCE_LOCALE,
    ) -> None:
        capabilities = server_info.get("capabilities", {})
        endpoints = server_info.get("endpoints", {})
        if not capabilities.get("nativeDeviceAuthorization"):
            raise DeviceAuthorizationError("Server does not advertise device authorization")
        configuration = server_info.get("nativeDeviceAuthorization", {})
        self.client_id = str(configuration.get("clientId", ""))
        scopes = configuration.get("scopes", ())
        if not self.client_id or not isinstance(scopes, list) or not scopes:
            raise DeviceAuthorizationError("Server native authorization settings are incomplete")
        self.scope = " ".join(str(scope) for scope in scopes)
        self.authorization_path = endpoints.get("deviceAuthorizationPath")
        self.token_path = endpoints.get("deviceTokenPath")
        self.revocation_path = endpoints.get("deviceRevocationPath")
        if not all(isinstance(path, str) and path.startswith("/") for path in (self.authorization_path, self.token_path)):
            raise DeviceAuthorizationError("Server device authorization endpoints are incomplete")
        self.http = JsonHttpClient(origin, locale)

    def begin(self, client_id: str, scope: str) -> DeviceAuthorization:
        response = self.http.request_form(
            "POST", self.authorization_path, {"client_id": client_id, "scope": scope}
        ).body
        now = time.time()
        try:
            expires_in = max(1, min(int(response["expires_in"]), 1800))
            interval = max(1, min(float(response.get("interval", 5)), 30))
            complete_uri = response.get("verification_uri_complete")
            if complete_uri is not None:
                complete_uri = _response_http_uri(
                    response,
                    "verification_uri_complete",
                    MAXIMUM_COMPLETE_URI_LENGTH,
                )
            return DeviceAuthorization(
                device_code=_response_text(
                    response, "device_code", MAXIMUM_DEVICE_CODE_LENGTH
                ),
                user_code=_response_text(response, "user_code", MAXIMUM_USER_CODE_LENGTH),
                verification_uri=_response_http_uri(
                    response, "verification_uri", MAXIMUM_VERIFICATION_URI_LENGTH
                ),
                verification_uri_complete=complete_uri,
                expires_at=now + expires_in,
                interval=interval,
            )
        except (KeyError, TypeError, ValueError) as error:
            raise DeviceAuthorizationError("Server returned an invalid device authorization") from error

    def poll(
        self,
        authorization: DeviceAuthorization,
        client_id: str,
        cancelled: threading.Event,
        on_pending: Callable[[float], None] | None = None,
    ) -> dict[str, Any]:
        interval = authorization.interval
        while not cancelled.is_set() and time.time() < authorization.expires_at:
            if cancelled.wait(interval):
                break
            try:
                response = self.http.request_form(
                    "POST",
                    self.token_path,
                    {
                        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                        "device_code": authorization.device_code,
                        "client_id": client_id,
                    },
                ).body
                if not isinstance(response.get("access_token"), str):
                    raise DeviceAuthorizationError("Token response has no access token")
                return response
            except HttpFailure as error:
                if error.code == "authorization_pending":
                    if on_pending:
                        on_pending(authorization.expires_at - time.time())
                    continue
                if error.code == "slow_down":
                    interval = min(30, interval + 5)
                    continue
                if error.code in {"access_denied", "expired_token"}:
                    raise DeviceAuthorizationError(error.code) from error
                raise
        raise DeviceAuthorizationError("Device authorization expired or was cancelled")

    def revoke(self, token: str) -> None:
        if not self.revocation_path:
            raise DeviceAuthorizationError("Server does not advertise token revocation")
        self.http.request_form("POST", self.revocation_path, {"token": token})

    def refresh(self, refresh_token: str) -> dict[str, Any]:
        response = self.http.request_form(
            "POST",
            self.token_path,
            {
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": self.client_id,
            },
        ).body
        if not isinstance(response.get("access_token"), str):
            raise DeviceAuthorizationError("Refresh response has no access token")
        return response
