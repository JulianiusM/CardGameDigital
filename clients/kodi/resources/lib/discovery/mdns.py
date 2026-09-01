"""Bounded multicast DNS-SD browser for `_partycard._tcp.local.`."""

from __future__ import annotations

import ipaddress
import select
import socket
import time
from dataclasses import dataclass
from typing import Callable, Iterable, Optional

from .dns import CLASS_IN, DnsFormatError, TYPE_A, TYPE_AAAA, TYPE_PTR, TYPE_SRV, TYPE_TXT, build_query, parse_message


SERVICE_TYPE = "_partycard._tcp.local."
MDNS_IPV4 = ("224.0.0.251", 5353)
MDNS_IPV6 = ("ff02::fb", 5353)
MAX_DISCOVERY_ENDPOINTS = 50
DEFAULT_LOCAL_SERVER_PORT = 3000


@dataclass(frozen=True)
class DiscoveryEndpoint:
    instance: str
    origin: str
    txt: dict[str, str]
    ttl: int


class MdnsBrowser:
    def __init__(self, service_type: str = SERVICE_TYPE) -> None:
        self.service_type = service_type.rstrip(".") + "."
        self._closed = False

    def close(self) -> None:
        self._closed = True

    def browse(
        self,
        duration: float = 5.0,
        on_packet_error: Optional[Callable[[Exception], None]] = None,
    ) -> tuple[DiscoveryEndpoint, ...]:
        sockets = self._open_sockets()
        if not sockets:
            return ()
        query = build_query(self.service_type, TYPE_PTR)
        records = []
        deadline = time.monotonic() + max(0.1, min(duration, 10.0))
        next_query_at = time.monotonic()
        query_intervals = iter((0.0, 0.5, 1.5, 3.0))
        next_interval = next(query_intervals, None)
        try:
            while not self._closed and time.monotonic() < deadline:
                now = time.monotonic()
                if next_interval is not None and now >= next_query_at:
                    for current, destination in sockets:
                        try:
                            current.sendto(query, destination)
                        except OSError:
                            pass
                    next_interval = next(query_intervals, None)
                    if next_interval is not None:
                        next_query_at = now + next_interval
                readable, _, _ = select.select(
                    [current for current, _ in sockets], [], [], min(0.25, deadline - time.monotonic())
                )
                for current in readable:
                    try:
                        packet, sender = current.recvfrom(9001)
                        if len(packet) > 9000:
                            continue
                        message = parse_message(packet)
                        records.extend((record, sender) for record in message.records)
                    except (OSError, DnsFormatError) as error:
                        if on_packet_error:
                            on_packet_error(error)
        finally:
            for current, _ in sockets:
                current.close()
        return endpoints_from_records(self.service_type, records)

    @staticmethod
    def _open_sockets() -> list[tuple[socket.socket, tuple]]:
        result: list[tuple[socket.socket, tuple]] = []
        try:
            current = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
            current.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            current.bind(("", 5353))
            membership = socket.inet_aton(MDNS_IPV4[0]) + socket.inet_aton("0.0.0.0")
            current.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, membership)
            current.setblocking(False)
            result.append((current, MDNS_IPV4))
        except OSError:
            try:
                current.close()
            except (OSError, UnboundLocalError):
                pass
        try:
            current6 = socket.socket(socket.AF_INET6, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
            current6.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            current6.bind(("::", 5353))
            current6.setsockopt(
                socket.IPPROTO_IPV6,
                socket.IPV6_JOIN_GROUP,
                socket.inet_pton(socket.AF_INET6, MDNS_IPV6[0]) + (0).to_bytes(4, "little"),
            )
            current6.setblocking(False)
            result.append((current6, (MDNS_IPV6[0], MDNS_IPV6[1], 0, 0)))
        except OSError:
            try:
                current6.close()
            except (OSError, UnboundLocalError):
                pass
        return result


def same_machine_origins(port: int = DEFAULT_LOCAL_SERVER_PORT) -> tuple[str, ...]:
    """Return bounded local candidates that do not depend on multicast loopback.

    Windows may deliver a multicast packet to only one of multiple processes bound to
    port 5353. A server and Kodi running on the same machine must still discover each
    other, so the release-default front-door port is probed directly as well.
    """

    addresses = {"127.0.0.1", "::1"}
    try:
        results = socket.getaddrinfo(socket.gethostname(), port, type=socket.SOCK_STREAM)
    except OSError:
        results = ()
    for result in results:
        address = str(result[4][0]).split("%", maxsplit=1)[0]
        try:
            parsed = ipaddress.ip_address(address)
        except ValueError:
            continue
        if parsed.is_loopback or parsed.is_private or parsed.is_link_local:
            addresses.add(parsed.compressed)
    origins: list[str] = []
    for address in sorted(addresses, key=lambda value: (":" in value, value)):
        authority = f"[{address}]:{port}" if ":" in address else f"{address}:{port}"
        origins.append(f"http://{authority}")
    return tuple(origins[:16])


def endpoints_from_records(service_type: str, records: Iterable[tuple]) -> tuple[DiscoveryEndpoint, ...]:
    normalized_service = service_type.casefold()
    instances: set[str] = set()
    services: dict[str, tuple[dict, int]] = {}
    texts: dict[str, tuple[dict[str, str], int]] = {}
    addresses: dict[str, list[tuple[str, int, int]]] = {}
    for record, sender in records:
        if record.record_class != CLASS_IN or record.ttl <= 0:
            continue
        name = record.name.casefold()
        if record.record_type == TYPE_PTR and name == normalized_service:
            instances.add(str(record.value).casefold())
        elif record.record_type == TYPE_SRV:
            services[name] = (record.value, record.ttl)
        elif record.record_type == TYPE_TXT:
            texts[name] = (record.value, record.ttl)
        elif record.record_type in {TYPE_A, TYPE_AAAA}:
            scope = int(sender[3]) if len(sender) >= 4 else 0
            addresses.setdefault(name, []).append((str(record.value), scope, record.ttl))
    endpoints: list[DiscoveryEndpoint] = []
    for instance in sorted(instances):
        service = services.get(instance)
        text = texts.get(instance)
        if not service or not text or not valid_partycard_txt(text[0]):
            continue
        target = str(service[0]["target"]).casefold()
        port = int(service[0]["port"])
        if not 1 <= port <= 65_535:
            continue
        scheme = "https" if text[0]["tls"] == "1" else "http"
        for address, scope, address_ttl in addresses.get(target, ()):
            parsed = ipaddress.ip_address(address)
            if parsed.version == 6:
                zone = f"%25{scope}" if parsed.is_link_local and scope else ""
                authority = f"[{parsed.compressed}{zone}]:{port}"
            else:
                authority = f"{parsed.compressed}:{port}"
            endpoints.append(
                DiscoveryEndpoint(
                    instance=instance,
                    origin=f"{scheme}://{authority}",
                    txt=dict(text[0]),
                    ttl=min(service[1], text[1], address_ttl),
                )
            )
    unique = {entry.origin: entry for entry in endpoints}
    return tuple(unique[key] for key in sorted(unique)[:MAX_DISCOVERY_ENDPOINTS])


def valid_partycard_txt(value: dict[str, str]) -> bool:
    required = {"txtvers", "api", "ws", "tls", "path", "cap"}
    if not required.issubset(value):
        return False
    if value["txtvers"] != "1" or value["api"] != "1" or value["ws"] != "2":
        return False
    if value["tls"] not in {"0", "1"} or value["path"] != "/api/v1":
        return False
    capabilities = set(value["cap"].split(","))
    return "rooms" in capabilities
