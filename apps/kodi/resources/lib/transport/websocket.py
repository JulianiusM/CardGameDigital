"""Auditable RFC 6455 client used for one Room connection while the add-on is open."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import queue
import random
import socket
import ssl
import struct
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Callable, Optional
from urllib.parse import unquote, urlsplit

from ..protocol.validation import (
    MAX_MESSAGE_BYTES,
    PROTOCOL_VERSION,
    ProtocolViolation,
    decode_envelope,
)
from ..version import APPLICATION_VERSION


WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class WebSocketFailure(RuntimeError):
    pass


class WebSocketClosed(WebSocketFailure):
    def __init__(self, code: int = 1006, reason: str = "") -> None:
        super().__init__(reason or f"WebSocket closed ({code})")
        self.code = code
        self.reason = reason


class WebSocketConnection:
    def __init__(self, url: str, origin: str, timeout: float = 6.0) -> None:
        parsed = urlsplit(url)
        if parsed.scheme not in {"ws", "wss"} or not parsed.hostname:
            raise WebSocketFailure("Invalid WebSocket URL")
        if parsed.username or parsed.password or parsed.fragment:
            raise WebSocketFailure("WebSocket URL contains forbidden components")
        self.url = url
        self.origin = origin
        self.timeout = timeout
        self._socket: Optional[socket.socket] = None
        self._buffer = bytearray()
        self._fragments = bytearray()
        self._fragment_opcode: Optional[int] = None
        self._send_lock = threading.Lock()

    def connect(self) -> None:
        parsed = urlsplit(self.url)
        host = unquote(parsed.hostname or "")
        port = parsed.port or (443 if parsed.scheme == "wss" else 80)
        raw = socket.create_connection((host, port), timeout=self.timeout)
        if parsed.scheme == "wss":
            context = ssl.create_default_context()
            raw = context.wrap_socket(raw, server_hostname=host.split("%", maxsplit=1)[0])
        raw.settimeout(self.timeout)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        default_port = 443 if parsed.scheme == "wss" else 80
        authority = parsed.hostname or ""
        if ":" in authority and not authority.startswith("["):
            authority = f"[{authority}]"
        if port != default_port:
            authority = f"{authority}:{port}"
        target = parsed.path or "/"
        if parsed.query:
            target = f"{target}?{parsed.query}"
        request = (
            f"GET {target} HTTP/1.1\r\n"
            f"Host: {authority}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            f"Origin: {self.origin}\r\n"
            f"User-Agent: PartyGameKodi/{APPLICATION_VERSION}\r\n\r\n"
        ).encode("ascii")
        raw.sendall(request)
        response = bytearray()
        while b"\r\n\r\n" not in response:
            chunk = raw.recv(4096)
            if not chunk:
                raw.close()
                raise WebSocketFailure("WebSocket handshake ended early")
            response.extend(chunk)
            if len(response) > 16 * 1024:
                raw.close()
                raise WebSocketFailure("WebSocket handshake is too large")
        header, remainder = bytes(response).split(b"\r\n\r\n", maxsplit=1)
        lines = header.decode("iso-8859-1").split("\r\n")
        if not lines or " 101 " not in f" {lines[0]} ":
            raw.close()
            raise WebSocketFailure("Server refused the WebSocket upgrade")
        headers: dict[str, str] = {}
        for line in lines[1:]:
            name, separator, value = line.partition(":")
            if separator:
                headers[name.strip().casefold()] = value.strip()
        expected = base64.b64encode(
            hashlib.sha1(f"{key}{WEBSOCKET_GUID}".encode("ascii")).digest()
        ).decode("ascii")
        if headers.get("sec-websocket-accept") != expected:
            raw.close()
            raise WebSocketFailure("WebSocket accept proof is invalid")
        if headers.get("upgrade", "").casefold() != "websocket":
            raw.close()
            raise WebSocketFailure("WebSocket upgrade header is invalid")
        connection_tokens = {
            token.strip().casefold() for token in headers.get("connection", "").split(",")
        }
        if "upgrade" not in connection_tokens:
            raw.close()
            raise WebSocketFailure("WebSocket connection header is invalid")
        self._socket = raw
        self._buffer.extend(remainder)

    def set_timeout(self, timeout: float) -> None:
        if self._socket:
            self._socket.settimeout(timeout)

    def send_json(self, value: dict) -> None:
        encoded = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        if len(encoded) > MAX_MESSAGE_BYTES:
            raise WebSocketFailure("Outgoing WebSocket message exceeds 64 KiB")
        self._send_frame(0x1, encoded)

    def receive_json(self) -> dict:
        while True:
            opcode, final, payload = self._receive_frame()
            if opcode == 0x8:
                code = struct.unpack("!H", payload[:2])[0] if len(payload) >= 2 else 1000
                reason = payload[2:].decode("utf-8", errors="replace")[:123]
                try:
                    self._send_frame(0x8, payload[:125])
                except WebSocketFailure:
                    pass
                raise WebSocketClosed(code, reason)
            if opcode == 0x9:
                self._send_frame(0xA, payload)
                continue
            if opcode == 0xA:
                continue
            if opcode in {0x1, 0x2}:
                if self._fragment_opcode is not None:
                    raise WebSocketFailure("Started a second fragmented message")
                if final:
                    if opcode != 0x1:
                        raise WebSocketFailure("Binary messages are not supported")
                    return decode_envelope(payload)
                self._fragment_opcode = opcode
                self._fragments = bytearray(payload)
                continue
            if opcode == 0x0:
                if self._fragment_opcode is None:
                    raise WebSocketFailure("Unexpected continuation frame")
                self._fragments.extend(payload)
                if len(self._fragments) > MAX_MESSAGE_BYTES:
                    raise WebSocketFailure("Fragmented message exceeds 64 KiB")
                if final:
                    original_opcode = self._fragment_opcode
                    message = bytes(self._fragments)
                    self._fragment_opcode = None
                    self._fragments.clear()
                    if original_opcode != 0x1:
                        raise WebSocketFailure("Binary messages are not supported")
                    return decode_envelope(message)
                continue
            raise WebSocketFailure("Unsupported WebSocket opcode")

    def close(self, code: int = 1000, reason: str = "") -> None:
        current = self._socket
        if not current:
            return
        payload = struct.pack("!H", code) + reason.encode("utf-8")[:123]
        try:
            self._send_frame(0x8, payload)
        except (OSError, WebSocketFailure):
            pass
        try:
            current.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        current.close()
        self._socket = None

    def _send_frame(self, opcode: int, payload: bytes) -> None:
        current = self._socket
        if not current:
            raise WebSocketFailure("WebSocket is not connected")
        if opcode >= 0x8 and len(payload) > 125:
            raise WebSocketFailure("Control frame is too large")
        first = 0x80 | opcode
        length = len(payload)
        if length < 126:
            header = struct.pack("!BB", first, 0x80 | length)
        elif length <= 0xFFFF:
            header = struct.pack("!BBH", first, 0x80 | 126, length)
        else:
            header = struct.pack("!BBQ", first, 0x80 | 127, length)
        mask = os.urandom(4)
        masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        try:
            with self._send_lock:
                current.sendall(header + mask + masked)
        except OSError as error:
            raise WebSocketFailure("WebSocket send failed") from error

    def _receive_frame(self) -> tuple[int, bool, bytes]:
        first, second = self._read_exact(2)
        final = bool(first & 0x80)
        if first & 0x70:
            raise WebSocketFailure("Reserved WebSocket bits are set")
        opcode = first & 0x0F
        masked = bool(second & 0x80)
        if masked:
            raise WebSocketFailure("Server frames must not be masked")
        length = second & 0x7F
        if length == 126:
            length = struct.unpack("!H", self._read_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._read_exact(8))[0]
            if length & (1 << 63):
                raise WebSocketFailure("WebSocket length has the high bit set")
        if opcode >= 0x8 and (not final or length > 125):
            raise WebSocketFailure("Invalid WebSocket control frame")
        if length > MAX_MESSAGE_BYTES:
            raise WebSocketFailure("WebSocket frame exceeds 64 KiB")
        return opcode, final, self._read_exact(length)

    def _read_exact(self, length: int) -> bytes:
        current = self._socket
        if not current:
            raise WebSocketFailure("WebSocket is not connected")
        while len(self._buffer) < length:
            chunk = current.recv(max(4096, length - len(self._buffer)))
            if not chunk:
                raise WebSocketClosed()
            self._buffer.extend(chunk)
        result = bytes(self._buffer[:length])
        del self._buffer[:length]
        return result


def envelope(event_type: str, payload: dict, revision: Optional[int] = None) -> dict:
    return {
        "protocol": PROTOCOL_VERSION,
        "type": event_type,
        "requestId": str(uuid.uuid4()),
        "revision": revision,
        "payload": payload,
    }


@dataclass(frozen=True)
class RoomConnectionSettings:
    url: str
    origin: str
    room_code: str
    participant_id: str
    role: str
    application_version: str


class RoomWebSocketWorker:
    def __init__(
        self,
        settings: RoomConnectionSettings,
        participant_credential: str,
        on_event: Callable[[str, dict], None],
        random_source: Optional[random.Random] = None,
    ) -> None:
        self.settings = settings
        self._credential = participant_credential
        self._on_event = on_event
        self._random = random_source or random.Random()
        self._outgoing: queue.Queue[dict | None] = queue.Queue(maxsize=64)
        self._stop = threading.Event()
        self._leaving = threading.Event()
        self._leave_started = 0.0
        self._thread = threading.Thread(target=self._run, name="party-game-room", daemon=True)
        self._connection: Optional[WebSocketConnection] = None

    def start(self) -> None:
        self._thread.start()

    def send(self, value: dict) -> None:
        if self._stop.is_set():
            return
        try:
            self._outgoing.put_nowait(value)
        except queue.Full:
            self._on_event("error", {"code": "CLIENT_QUEUE_FULL"})

    def stop(self, intentional: bool = True) -> None:
        self._stop.set()
        try:
            self._outgoing.put_nowait(None)
        except queue.Full:
            pass
        current = self._connection
        if current:
            current.close(1000, "add-on stopped" if intentional else "")
        if self._thread.is_alive() and threading.current_thread() is not self._thread:
            self._thread.join(timeout=2.0)

    def leave(self, revision: Optional[int] = None) -> None:
        if self._stop.is_set() or self._leaving.is_set():
            return
        self._leaving.set()
        self._leave_started = time.monotonic()
        self.send(envelope("command.leaveRoom", {}, revision))

    def _run(self) -> None:
        attempt = 0
        while not self._stop.is_set():
            connection = WebSocketConnection(self.settings.url, self.settings.origin)
            self._connection = connection
            try:
                self._on_event("state", {"state": "CONNECTING" if attempt == 0 else "RECONNECTING"})
                connection.connect()
                connection.set_timeout(0.25)
                connection.send_json(
                    envelope(
                        "client.hello",
                        {
                            "supportedProtocolVersions": [PROTOCOL_VERSION],
                            "applicationVersion": self.settings.application_version,
                            "role": self.settings.role,
                            "capabilities": ["DISPLAY_SESSION", "LEAVE_ROOM"],
                            "roomCode": self.settings.room_code,
                            "participantCredential": self._credential,
                        },
                    )
                )
                attempt = 0
                self._connected_loop(connection)
            except WebSocketClosed as error:
                if self._leaving.is_set():
                    self._on_event("left", {"code": error.code})
                    return
                if error.code in {4001, 4401}:
                    self._on_event("closed", {"code": error.code})
                    return
                if error.code == 4002:
                    self._on_event(
                        "error",
                        {"code": "CONNECTION_REPLACED", "transport_state": "ERROR"},
                    )
                    return
                if self._stop.is_set():
                    return
            except ProtocolViolation:
                self._on_event(
                    "error",
                    {"code": "PROTOCOL_VIOLATION", "transport_state": "ERROR"},
                )
                return
            except (WebSocketFailure, OSError, ssl.SSLError):
                if self._leaving.is_set():
                    self._on_event("left", {"code": 1006})
                    return
                if self._stop.is_set():
                    return
            finally:
                connection.close()
                self._connection = None
            attempt += 1
            delay = min(20.0, 0.75 * (2 ** min(attempt, 5)))
            delay *= self._random.uniform(0.8, 1.2)
            self._on_event("state", {"state": "RECONNECTING"})
            self._stop.wait(delay)

    def _connected_loop(self, connection: WebSocketConnection) -> None:
        last_ping = time.monotonic()
        pending_ping: tuple[str, float] | None = None
        while not self._stop.is_set():
            while True:
                try:
                    outgoing = self._outgoing.get_nowait()
                except queue.Empty:
                    break
                if outgoing is None:
                    return
                connection.send_json(outgoing)
            if time.monotonic() - last_ping >= 20.0:
                ping = envelope("client.ping", {})
                connection.send_json(ping)
                pending_ping = (str(ping["requestId"]), time.monotonic())
                last_ping = time.monotonic()
            if pending_ping and time.monotonic() - pending_ping[1] > 10.0:
                raise WebSocketFailure("Server heartbeat timed out")
            if self._leaving.is_set() and time.monotonic() - self._leave_started > 3.0:
                self._on_event("left", {"code": 1006})
                return
            try:
                incoming = connection.receive_json()
                if (
                    incoming.get("type") == "server.pong"
                    and pending_ping
                    and incoming.get("requestId") == pending_ping[0]
                ):
                    pending_ping = None
                if incoming.get("type") == "server.hello":
                    participant_id = incoming.get("payload", {}).get("participantId")
                    if participant_id != self.settings.participant_id:
                        raise ProtocolViolation("Server hello participant identity changed")
                self._on_event("envelope", {"envelope": incoming})
                if incoming.get("type") == "server.hello":
                    self._on_event("state", {"state": "CONNECTED"})
                    connection.send_json(envelope("room.snapshot.request", {}))
            except socket.timeout:
                continue
