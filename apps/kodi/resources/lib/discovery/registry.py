"""Merge saved/manual/mDNS candidates only after authoritative HTTP validation."""

from __future__ import annotations

import time
import ipaddress
from dataclasses import replace
from typing import cast, Iterable
from urllib.parse import urlsplit

from ..state import ServerRecord


SOURCE_PRIORITY = {"manual": 4, "same-machine": 3, "saved": 2, "mdns": 1}


def _origin_priority(origin: str) -> int:
    host = urlsplit(origin).hostname or ""
    try:
        address = ipaddress.ip_address(host.split("%", maxsplit=1)[0])
    except ValueError:
        return 0
    if address.version == 4 and address.is_loopback:
        return 5
    if address.version == 4:
        return 4
    if address.is_loopback:
        return 3
    if not address.is_link_local:
        return 2
    return 1


def validated_record(origin: str, source: str, info: dict) -> ServerRecord:
    return ServerRecord(
        server_id=str(info["serverId"]),
        origin=origin,
        display_name=str(info["displayName"]),
        deployment_mode=str(info["deploymentMode"]),
        source=source,
        last_seen=time.time(),
        capabilities=dict(info.get("capabilities", {})),
        endpoints=dict(info.get("endpoints", {})),
        available=True,
    )


def merge_records(records: Iterable[ServerRecord]) -> tuple[ServerRecord, ...]:
    by_id: dict[str, ServerRecord] = {}
    for candidate in records:
        current = by_id.get(candidate.server_id)
        if current is None or _prefer_candidate(candidate, current):
            by_id[candidate.server_id] = candidate
    return tuple(
        sorted(
            by_id.values(),
            key=lambda entry: (not entry.available, entry.display_name.casefold(), entry.origin),
        )
    )


def _prefer_candidate(candidate: ServerRecord, current: ServerRecord) -> bool:
    if candidate.available and not current.available:
        return True
    candidate_priority = SOURCE_PRIORITY.get(candidate.source, 0)
    current_priority = SOURCE_PRIORITY.get(current.source, 0)
    if candidate_priority != current_priority:
        return candidate_priority > current_priority
    candidate_origin = _origin_priority(candidate.origin)
    current_origin = _origin_priority(current.origin)
    if candidate_origin != current_origin:
        return candidate_origin > current_origin
    return candidate.last_seen > current.last_seen


def mark_unavailable(record: ServerRecord) -> ServerRecord:
    return cast(ServerRecord, replace(record, available=False))
