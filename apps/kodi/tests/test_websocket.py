from __future__ import annotations

import base64
import hashlib
import json
import socket
import ssl
import struct
import threading
import unittest
from unittest.mock import Mock, patch

from support import RESOURCES_ROOT
from lib.transport.websocket import WEBSOCKET_GUID, WebSocketConnection, WebSocketFailure
from lib.protocol.validation import PROTOCOL_VERSION, MAX_MESSAGE_BYTES, ProtocolViolation, decode_envelope


def server_frame(opcode: int, payload: bytes) -> bytes:
    if len(payload) < 126:
        header = bytes((0x80 | opcode, len(payload)))
    elif len(payload) <= 0xFFFF:
        header = bytes((0x80 | opcode, 126)) + struct.pack("!H", len(payload))
    else:
        header = bytes((0x80 | opcode, 127)) + struct.pack("!Q", len(payload))
    return header + payload


def read_client_frame(connection: socket.socket) -> tuple[int, bytes, bool]:
    first, second = connection.recv(2)
    length = second & 0x7F
    if length == 126:
        length = struct.unpack("!H", connection.recv(2))[0]
    mask = connection.recv(4)
    payload = bytearray()
    while len(payload) < length:
        payload.extend(connection.recv(length - len(payload)))
    decoded = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
    return first & 0x0F, decoded, bool(second & 0x80)


class WebSocketTransportTests(unittest.TestCase):
    def test_rejects_oversized_continuation_before_reading_its_body(self) -> None:
        connection = WebSocketConnection("ws://example.test/ws", "http://example.test")
        connection._fragment_opcode = 0x1
        connection._fragments = bytearray(b"x" * 100)
        with patch.object(connection, "_read_exact", side_effect=[b"\x80\x7f", struct.pack("!Q", MAX_MESSAGE_BYTES)]) as read:
            with self.assertRaisesRegex(WebSocketFailure, "Fragmented message exceeds"):
                connection._receive_frame()
        self.assertEqual(read.call_count, 2)
        self.assertEqual(len(connection._fragments), 100)

    def test_utf8_decoder_accepts_exact_budget_and_rejects_one_more_byte(self) -> None:
        fixture = json.loads((RESOURCES_ROOT / "data" / "fixtures" / "ordinary-room.json").read_text(encoding="utf-8"))
        raw = json.dumps(fixture, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        # JSON permits trailing whitespace; this tests the byte boundary independently
        # of the logical roster/settings bounds.
        exact = raw + b" " * (MAX_MESSAGE_BYTES - len(raw))
        self.assertEqual(decode_envelope(exact)["payload"], fixture["payload"])
        with self.assertRaisesRegex(ProtocolViolation, "message exceeds"):
            decode_envelope(exact + b" ")
        with self.assertRaisesRegex(ProtocolViolation, "message exceeds"):
            decode_envelope("界" * (MAX_MESSAGE_BYTES // 3 + 1))

    def test_rejects_oversized_outgoing_json_before_sending(self) -> None:
        connection = WebSocketConnection("ws://example.test/ws", "http://example.test")
        with patch.object(connection, "_send_frame") as send:
            with self.assertRaisesRegex(WebSocketFailure, "Outgoing WebSocket message exceeds"):
                connection.send_json({"value": "界" * (MAX_MESSAGE_BYTES // 3 + 1)})
        send.assert_not_called()

    def test_wss_requires_modern_tls_and_verifies_the_server_hostname(self) -> None:
        context = ssl.create_default_context()
        context.minimum_version = ssl.TLSVersion.MINIMUM_SUPPORTED
        raw = Mock()
        connection = WebSocketConnection("wss://example.test/ws", "https://example.test")
        with patch("lib.transport.websocket.socket.create_connection", return_value=raw), patch(
            "lib.transport.websocket.ssl.create_default_context", return_value=context
        ), patch.object(context, "wrap_socket", side_effect=ssl.SSLError("untrusted certificate")) as wrap:
            with self.assertRaises(ssl.SSLError):
                connection.connect()
        wrap.assert_called_once_with(raw, server_hostname="example.test")
        self.assertEqual(context.minimum_version, ssl.TLSVersion.TLSv1_2)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)

    def test_handshake_client_masking_ping_pong_and_json_validation(self) -> None:
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        errors: list[BaseException] = []
        observations: list[tuple[int, bytes, bool]] = []

        def serve() -> None:
            try:
                connection, _ = listener.accept()
                with connection:
                    request = bytearray()
                    while b"\r\n\r\n" not in request:
                        request.extend(connection.recv(4096))
                    headers = {}
                    for line in request.decode("iso-8859-1").split("\r\n")[1:]:
                        name, separator, value = line.partition(":")
                        if separator:
                            headers[name.casefold()] = value.strip()
                    accept = base64.b64encode(
                        hashlib.sha1(
                            f"{headers['sec-websocket-key']}{WEBSOCKET_GUID}".encode("ascii")
                        ).digest()
                    ).decode("ascii")
                    connection.sendall(
                        (
                            "HTTP/1.1 101 Switching Protocols\r\n"
                            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                            f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
                        ).encode("ascii")
                    )
                    observations.append(read_client_frame(connection))
                    connection.sendall(server_frame(0x9, b"alive"))
                    hello = json.dumps(
                        {
                            "protocol": PROTOCOL_VERSION,
                            "type": "server.hello",
                            "requestId": "one",
                            "revision": None,
                            "payload": {
                                "protocolVersion": PROTOCOL_VERSION,
                                "participantId": "00000000-0000-4000-8000-000000000001",
                                "role": "DISPLAY",
                            },
                        },
                        separators=(",", ":"),
                    ).encode("utf-8")
                    connection.sendall(server_frame(0x1, hello))
                    observations.append(read_client_frame(connection))
            except BaseException as error:
                errors.append(error)

        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        connection = WebSocketConnection(
            f"ws://127.0.0.1:{listener.getsockname()[1]}/ws",
            f"http://127.0.0.1:{listener.getsockname()[1]}",
        )
        try:
            connection.connect()
            connection.send_json({"hello": "world"})
            incoming = connection.receive_json()
            self.assertEqual(incoming["type"], "server.hello")
        finally:
            connection.close()
            listener.close()
            thread.join(timeout=2)
        if errors:
            raise errors[0]
        self.assertEqual(observations[0][0], 0x1)
        self.assertTrue(observations[0][2])
        self.assertEqual(json.loads(observations[0][1]), {"hello": "world"})
        self.assertEqual(observations[1], (0xA, b"alive", True))


if __name__ == "__main__":
    unittest.main()
