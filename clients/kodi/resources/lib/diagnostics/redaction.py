"""Recursive structured redaction; Card text and bearer material never enter diagnostics."""

from __future__ import annotations

import re
import threading
import time
from collections import deque
from typing import Any, Mapping
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


SENSITIVE_KEY = re.compile(
    r"(?:authorization|credential|password|secret|token|cookie|cardtext|participantcredential)",
    re.IGNORECASE,
)
SENSITIVE_QUERY = re.compile(r"(?:token|secret|credential|code)", re.IGNORECASE)
REDACTED = "[redacted]"


def redact(value: Any, key: str = "") -> Any:
    if SENSITIVE_KEY.search(key):
        return REDACTED
    if isinstance(value, Mapping):
        return {str(current): redact(inner, str(current)) for current, inner in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(inner, key) for inner in value]
    if isinstance(value, str):
        return _redact_url(value)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return type(value).__name__


def _redact_url(value: str) -> str:
    if "://" not in value:
        return value[:500]
    try:
        parsed = urlsplit(value)
        query = urlencode(
            [
                (name, REDACTED if SENSITIVE_QUERY.search(name) else content)
                for name, content in parse_qsl(parsed.query, keep_blank_values=True)
            ]
        )
        hostname = parsed.hostname or ""
        authority = hostname
        if parsed.port:
            authority = f"{authority}:{parsed.port}"
        return urlunsplit((parsed.scheme, authority, parsed.path, query, ""))[:500]
    except ValueError:
        return "[invalid URL]"


class DiagnosticBuffer:
    def __init__(self, capacity: int = 100) -> None:
        self._entries: deque[dict[str, Any]] = deque(maxlen=max(10, min(capacity, 500)))
        self._lock = threading.Lock()

    def add(self, event: str, **fields: Any) -> None:
        entry = {"at": round(time.time(), 3), "event": event, **redact(fields)}
        with self._lock:
            self._entries.append(entry)

    def entries(self) -> tuple[dict[str, Any], ...]:
        with self._lock:
            return tuple(self._entries)

