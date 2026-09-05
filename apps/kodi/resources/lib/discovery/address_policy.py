"""Origin normalization and transport policy for local/global servers."""

from __future__ import annotations

import ipaddress
import socket
from typing import Callable, Iterable
from urllib.parse import quote, urlsplit, urlunsplit


class AddressPolicyError(ValueError):
    pass


Resolver = Callable[..., Iterable[tuple]]


def normalize_origin(value: str) -> str:
    candidate = value.strip()
    if not candidate or any(character.isspace() for character in candidate):
        raise AddressPolicyError("Server address is empty or contains whitespace")
    if "://" not in candidate:
        probe = urlsplit(f"//{candidate}")
        host = probe.hostname or ""
        scheme = "http" if _obviously_local_name(host) else "https"
        candidate = f"{scheme}://{candidate}"
    parsed, port = _parse_origin(candidate)
    host = parsed.hostname.rstrip(".").encode("idna").decode("ascii").lower()
    try:
        address = ipaddress.ip_address(host)
        rendered_host = f"[{address.compressed}]" if address.version == 6 else address.compressed
    except ValueError:
        rendered_host = host
    default_port = 80 if parsed.scheme == "http" else 443
    authority = rendered_host if port in {None, default_port} else f"{rendered_host}:{port}"
    return urlunsplit((parsed.scheme, authority, "", "", ""))

def _parse_origin(candidate):
    parsed = urlsplit(candidate)
    if parsed.scheme not in {"http", "https"}:
        raise AddressPolicyError("Only HTTP and HTTPS server origins are supported")
    if not parsed.hostname or parsed.username or parsed.password:
        raise AddressPolicyError("Server origin must contain a host and no user information")
    if parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise AddressPolicyError("Server address must be an origin without a path or query")
    try:
        port = parsed.port
    except ValueError as error:
        raise AddressPolicyError("Server port is invalid") from error
    if port is not None and not 1 <= port <= 65535:
        raise AddressPolicyError("Server port is invalid")
    return parsed, port


def validate_transport(
    origin: str,
    deployment_mode: str | None = None,
    resolver: Resolver = socket.getaddrinfo,
) -> str:
    normalized = normalize_origin(origin)
    parsed = urlsplit(normalized)
    if parsed.scheme != "https":
        _validate_local_http(parsed, deployment_mode, resolver)
    return normalized


def _validate_local_http(parsed, deployment_mode, resolver) -> None:
    if deployment_mode is not None and deployment_mode != "local":
        raise AddressPolicyError("Public/global servers require HTTPS")
    addresses = resolve_addresses(parsed.hostname or "", parsed.port or 80, resolver)
    if not addresses or not all(_allowed_local_address(address) for address in addresses):
        raise AddressPolicyError("Plain HTTP is allowed only for local destinations")


def resolve_addresses(host: str, port: int, resolver: Resolver = socket.getaddrinfo) -> set[str]:
    try:
        return {
            str(result[4][0]).split("%", maxsplit=1)[0]
            for result in resolver(host, port, type=socket.SOCK_STREAM)
        }
    except OSError as error:
        raise AddressPolicyError("Server host could not be resolved") from error


def relative_url(origin: str, endpoint: str) -> str:
    parsed = urlsplit(endpoint)
    if not endpoint.startswith("/") or endpoint.startswith("//"):
        raise AddressPolicyError("Endpoint is not same-origin relative")
    if parsed.scheme or parsed.netloc or parsed.username or parsed.password:
        raise AddressPolicyError("Endpoint contains a remote authority")
    return f"{normalize_origin(origin)}{endpoint}"


def websocket_url(origin: str, endpoint: str, locale: str | None = None) -> str:
    http_url = relative_url(origin, endpoint)
    parsed = urlsplit(http_url)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    query = f"locale={quote(locale)}" if locale else ""
    return urlunsplit((scheme, parsed.netloc, parsed.path, query, ""))


def _obviously_local_name(host: str) -> bool:
    lowered = host.rstrip(".").lower()
    if lowered in {"localhost", "localhost.localdomain"} or lowered.endswith(".local"):
        return True
    try:
        return _allowed_local_address(str(ipaddress.ip_address(lowered)))
    except ValueError:
        return False


def _allowed_local_address(value: str) -> bool:
    address = ipaddress.ip_address(value)
    if address.is_loopback or address.is_link_local:
        return True
    # These are RFC 1918 policy ranges, not hardcoded destination servers.
    if isinstance(address, ipaddress.IPv4Address):
        return any(
            address in network
            for network in (
                ipaddress.ip_network("10.0.0.0/8"),
                ipaddress.ip_network("172.16.0.0/12"),
                ipaddress.ip_network("192.168.0.0/16"),
            )
        )
    return address in ipaddress.ip_network("fc00::/7")

