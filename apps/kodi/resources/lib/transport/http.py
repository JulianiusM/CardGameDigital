"""Standard-library HTTP client with redirect, size, origin, and TLS boundaries."""

from __future__ import annotations

import json
import ssl
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any, Mapping, Optional
from urllib.parse import urlencode
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

from ..discovery.address_policy import relative_url, validate_transport
from ..native_settings_metadata import SOURCE_LOCALE
from ..protocol.validation import (
    validate_card_search,
    validate_couch_snapshot,
    validate_eligibility_preview,
    validate_game_settings,
    validate_group,
    validate_groups,
    validate_help_document,
    validate_help_index,
    validate_locales,
    validate_profiles,
    validate_room_join,
    validate_server_info,
    validate_taxonomy,
)
from ..version import APPLICATION_VERSION


JSON_CONTENT_TYPE = 'application/json'


MAX_RESPONSE_BYTES = 1024 * 1024


def _group_scope_query(group_id: object) -> str:
    if not group_id:
        return ""
    return "?" + urlencode({"groupId": str(group_id)})


class HttpFailure(RuntimeError):
    def __init__(self, message: str, status: Optional[int] = None, code: Optional[str] = None):
        super().__init__(message)
        self.status = status
        self.code = code


class _RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, request: Any, file_pointer: Any, code: int, message: str, headers: Any, new_url: str) -> None:
        return None


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: Mapping[str, str]
    body: Any


class JsonHttpClient:
    def __init__(
        self,
        origin: str,
        locale: str = SOURCE_LOCALE,
        bearer_token: Optional[str] = None,
        timeout: float = 8.0,
    ) -> None:
        self.origin = validate_transport(origin)
        self.locale = locale
        self._bearer_token = bearer_token
        self.timeout = timeout
        context = ssl.create_default_context()
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        self._opener = build_opener(_RejectRedirects(), HTTPSHandler(context=context))

    def request(
        self,
        method: str,
        endpoint: str,
        body: Optional[Mapping[str, Any]] = None,
        headers: Optional[Mapping[str, str]] = None,
    ) -> HttpResponse:
        data = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
        content_type = JSON_CONTENT_TYPE if data is not None else None
        return self._request(method, endpoint, data, content_type, headers, expect_json=True)

    def request_form(
        self,
        method: str,
        endpoint: str,
        body: Mapping[str, Any],
        headers: Optional[Mapping[str, str]] = None,
    ) -> HttpResponse:
        data = urlencode({key: str(value) for key, value in body.items()}).encode("ascii")
        return self._request(
            method,
            endpoint,
            data,
            "application/x-www-form-urlencoded",
            headers,
            expect_json=True,
        )

    def request_text(self, method: str, endpoint: str) -> HttpResponse:
        return self._request(method, endpoint, None, None, None, expect_json=False)

    def _request(
        self,
        method: str,
        endpoint: str,
        data: Optional[bytes],
        content_type: Optional[str],
        headers: Optional[Mapping[str, str]],
        expect_json: bool,
    ) -> HttpResponse:
        validate_transport(self.origin)
        request_headers = {
            "Accept": JSON_CONTENT_TYPE if expect_json else "text/plain",
            "Accept-Language": self.locale,
            "User-Agent": f"PartyGameKodi/{APPLICATION_VERSION}",
        }
        if content_type:
            request_headers["Content-Type"] = content_type
        if self._bearer_token:
            request_headers["Authorization"] = f"Bearer {self._bearer_token}"
        if headers:
            request_headers.update(headers)
        request = Request(
            relative_url(self.origin, endpoint),
            data=data,
            headers=request_headers,
            method=method,
        )
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                status = int(response.status)
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                response_headers = dict(response.headers.items())
        except HTTPError as error:
            if 300 <= error.code < 400:
                raise HttpFailure("Server redirects are not accepted", error.code) from error
            raw = error.read(MAX_RESPONSE_BYTES + 1)
            raise _http_error(error.code, raw) from error
        except OSError as error:
            raise HttpFailure("Server connection failed") from error
        parsed = self._decode_response(raw, status, expect_json, response_headers)
        return HttpResponse(status=status, headers=response_headers, body=parsed)

    def _decode_response(self, raw, status, expect_json, response_headers):
        if len(raw) > MAX_RESPONSE_BYTES:
            raise HttpFailure("Server response exceeded the size limit", status)
        if not raw:
            parsed: Any = None
        elif not expect_json:
            try:
                parsed = raw.decode("utf-8", errors="strict")
            except UnicodeDecodeError as error:
                raise HttpFailure("Server returned invalid text", status) from error
        else:
            response_type = next(
                (
                    value
                    for name, value in response_headers.items()
                    if name.casefold() == "content-type"
                ),
                "",
            )
            if response_type.split(";", maxsplit=1)[0].strip().casefold() not in {
                JSON_CONTENT_TYPE,
                "application/problem+json",
            }:
                raise HttpFailure("Server returned a non-JSON response", status)
            try:
                parsed = json.loads(raw.decode("utf-8", errors="strict"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise HttpFailure("Server returned invalid JSON", status) from error
        return parsed


def _http_error(status: int, raw: bytes) -> HttpFailure:
    message = f"Server request failed ({status})"
    code = None
    message, code = _parse_http_error(raw, code, message)
    return HttpFailure(message, status, code)

def _parse_http_error(raw, code, message):
    if len(raw) > MAX_RESPONSE_BYTES:
        return message, code
    try:
        body = json.loads(raw.decode("utf-8", errors="strict"))
        error = body.get("error", {}) if isinstance(body, dict) else {}
        if isinstance(error, str):
            code = error[:100]
            description = body.get("error_description")
            message = description[:500] if isinstance(description, str) else code
        elif isinstance(error, dict):
            if isinstance(error.get("message"), str):
                message = error["message"][:500]
            if isinstance(error.get("code"), str):
                code = error["code"][:100]
    except (UnicodeDecodeError, json.JSONDecodeError):
        pass
    return message, code


class ApiClient:
    def __init__(
        self,
        origin: str,
        server_info: Optional[Mapping[str, Any]] = None,
        locale: str = SOURCE_LOCALE,
        bearer_token: Optional[str] = None,
    ) -> None:
        self.http = JsonHttpClient(origin, locale, bearer_token)
        self.server_info = dict(server_info or {})
        self.api_base = self.server_info.get("endpoints", {}).get("apiBasePath", "/api/v1")

    @classmethod
    def probe(
        cls,
        origin: str,
        locale: str = SOURCE_LOCALE,
        timeout: float = 8.0,
    ) -> tuple[str, dict[str, Any]]:
        client = cls(origin, locale=locale)
        client.http.timeout = timeout
        readiness = client.http.request_text("GET", "/readyz")
        if readiness.body.strip().casefold() != "ready":
            raise HttpFailure("Server is not ready", readiness.status, "SERVER_NOT_READY")
        info = validate_server_info(client.http.request("GET", "/api/v1/server-info").body)
        validated_origin = validate_transport(origin, info["deploymentMode"])
        return validated_origin, info

    def get_profiles(self) -> tuple[dict[str, Any], ...]:
        body = self.http.request("GET", f"{self.api_base}/game-profiles").body
        return validate_profiles(body)

    def get_locales(self) -> dict[str, Any]:
        body = self.http.request("GET", f"{self.api_base}/catalog/locales").body
        return validate_locales(body)

    def get_taxonomy(self, locale: str) -> dict[str, Any]:
        from urllib.parse import quote

        body = self.http.request(
            "GET", f"{self.api_base}/catalog/taxonomies?locale={quote(locale)}"
        ).body
        return validate_taxonomy(body)

    def get_groups(self) -> tuple[dict[str, Any], ...]:
        body = self.http.request("GET", f"{self.api_base}/groups").body
        return validate_groups(body)

    def get_game_settings(self) -> dict[str, Any]:
        body = self.http.request("GET", f"{self.api_base}/game-settings").body
        return validate_game_settings(body)

    def get_help_index(self) -> tuple[dict[str, str], ...]:
        body = self.http.request("GET", f"{self.api_base}/help").body
        return validate_help_index(body)

    def get_help_document(self, slug: str) -> dict[str, str]:
        from urllib.parse import quote

        document = validate_help_document(
            self.http.request("GET", f"{self.api_base}/help/{quote(slug, safe='')}").body
        )
        return {
            "slug": document["slug"],
            "title": document["title"],
            "body": _help_html_to_text(document["html"]),
        }

    def create_group(self, name: str, members: list[str]) -> dict[str, Any]:
        body = self.http.request(
            "POST", f"{self.api_base}/groups", {"name": name, "members": members}
        ).body
        return validate_group(body)

    def update_group(self, group: Mapping[str, Any]) -> dict[str, Any]:
        group_id = str(group["id"])
        body = self.http.request(
            "PUT",
            f"{self.api_base}/groups/{group_id}",
            {
                "name": group["name"],
                "members": list(group.get("members", ())),
                "preferredProfileId": group.get("preferredProfileId"),
                "customConfiguration": group.get("customConfiguration"),
                "cardLanguageSettings": group.get("cardLanguageSettings"),
            },
        ).body
        return validate_group(body)

    def eligibility_preview(self, settings: Mapping[str, Any], player_count: int) -> dict[str, Any]:
        query = _group_scope_query(settings.get("groupId"))
        body = self.http.request(
            "POST",
            f"{self.api_base}/card-policy/session/eligibility-preview{query}",
            {"settings": settings, "playerCount": player_count},
        ).body
        return validate_eligibility_preview(body)

    def search_session_cards(
        self,
        policy: Mapping[str, Any],
        locale: str,
        query: str,
        limit: int = 24,
        cursor: Optional[str] = None,
        group_id: Optional[str] = None,
    ) -> dict[str, Any]:
        search: dict[str, Any] = {"locale": locale, "query": query, "limit": limit}
        if cursor is not None:
            search["cursor"] = cursor
        body = self.http.request(
            "POST",
            f"{self.api_base}/card-policy/session/cards{_group_scope_query(group_id)}",
            {
                "sessionPolicy": policy,
                "search": search,
            },
        ).body
        return validate_card_search(body, limit)

    def create_couch(self, request: Mapping[str, Any]) -> dict[str, Any]:
        body = self.http.request("POST", f"{self.api_base}/couch/sessions", request).body
        return validate_couch_snapshot(body)

    def get_couch(self, session_id: str) -> dict[str, Any]:
        body = self.http.request("GET", f"{self.api_base}/couch/sessions/{session_id}").body
        return validate_couch_snapshot(body)

    def couch_command(
        self,
        session_id: str,
        command: str,
        revision: int,
        extra: Optional[Mapping[str, Any]] = None,
    ) -> dict[str, Any]:
        body = {"revision": revision, **dict(extra or {})}
        response = self.http.request(
            "POST", f"{self.api_base}/couch/sessions/{session_id}/{command}", body
        ).body
        return validate_couch_snapshot(response)

    def create_display_room(
        self,
        display_name: str,
        persistence: str,
        settings: Mapping[str, Any],
        idempotency_key: str,
    ) -> dict[str, Any]:
        body = self.http.request(
            "POST",
            f"{self.api_base}/rooms",
            {
                "displayName": display_name,
                "persistence": persistence,
                "bootstrapMode": "DISPLAY_WAITING_FOR_HOST",
                "settings": settings,
            },
            {"Idempotency-Key": idempotency_key},
        ).body
        return validate_room_join(body)

    def join_display(self, room_code: str, display_name: str) -> dict[str, Any]:
        body = self.http.request(
            "POST",
            f"{self.api_base}/rooms/{room_code}/participants",
            {"displayName": display_name, "role": "DISPLAY"},
        ).body
        return validate_room_join(body)


class _HelpTextParser(HTMLParser):
    """Project trusted server-rendered help HTML into bounded Kodi plain text."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        del attrs
        if tag in {"script", "style"}:
            self._ignored_depth += 1
            return
        if self._ignored_depth:
            return
        if tag in {"h1", "h2", "h3", "p", "ol", "ul"}:
            self._break(2)
        elif tag == "li":
            self._break(1)
            self.parts.append("• ")
        elif tag == "br":
            self._break(1)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self._ignored_depth:
            self._ignored_depth -= 1
            return
        if self._ignored_depth:
            return
        if tag in {"h1", "h2", "h3", "p", "li", "ol", "ul"}:
            self._break(1 if tag == "li" else 2)

    def handle_data(self, data: str) -> None:
        if self._ignored_depth:
            return
        normalized = " ".join(data.split())
        if not normalized:
            return
        if self.parts and not self.parts[-1].endswith((" ", "\n")):
            self.parts.append(" ")
        self.parts.append(normalized)

    def _break(self, count: int) -> None:
        current = "".join(self.parts).rstrip()
        self.parts = [current, "\n" * count] if current else []

    def text(self) -> str:
        lines = [line.rstrip() for line in "".join(self.parts).splitlines()]
        compact: list[str] = []
        for line in lines:
            if line or (compact and compact[-1]):
                compact.append(line)
        return "\n".join(compact).strip()[:40_000]


def _help_html_to_text(value: str) -> str:
    parser = _HelpTextParser()
    parser.feed(value)
    parser.close()
    return parser.text()
