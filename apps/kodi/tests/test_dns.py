from __future__ import annotations

import struct
import random
import unittest
from unittest.mock import Mock, patch

from support import RESOURCES_ROOT
from lib.protocol.validation import PROTOCOL_VERSION
from lib.discovery.dns import (
    CLASS_IN,
    TYPE_A,
    TYPE_PTR,
    TYPE_SRV,
    TYPE_TXT,
    DnsFormatError,
    build_query,
    encode_name,
    parse_message,
)
from lib.discovery.mdns import (
    SERVICE_TYPE,
    MDNS_IPV4,
    MdnsBrowser,
    endpoints_from_records,
    same_machine_origins,
    valid_partycard_txt,
)


def record(name: str, kind: int, value: bytes, ttl: int = 120) -> bytes:
    return encode_name(name) + struct.pack("!HHIH", kind, CLASS_IN, ttl, len(value)) + value


class DnsParserTests(unittest.TestCase):
    def test_browser_retries_queries_on_schedule_and_stops_at_deadline(self) -> None:
        now = [0.0]
        sent_at = []
        connection = Mock()
        connection.sendto.side_effect = lambda _query, _destination: sent_at.append(now[0])

        def select_ready(_readers, _writers, _errors, timeout):
            now[0] += timeout
            return [], [], []

        with patch.object(MdnsBrowser, "_open_sockets", return_value=[(connection, MDNS_IPV4)]), \
                patch("lib.discovery.mdns.time.monotonic", side_effect=lambda: now[0]), \
                patch("lib.discovery.mdns.select.select", side_effect=select_ready):
            endpoints = MdnsBrowser().browse(duration=5.5)

        self.assertEqual(endpoints, ())
        self.assertEqual(sent_at, [0.0, 0.5, 2.0, 5.0])
        self.assertEqual(now[0], 5.5)
        connection.close.assert_called_once()

    def test_same_machine_discovery_does_not_depend_on_multicast_loopback(self) -> None:
        origins = same_machine_origins()
        self.assertIn("http://127.0.0.1:3000", origins)
        self.assertIn("http://[::1]:3000", origins)
        self.assertEqual(len(origins), len(set(origins)))

    def test_builds_a_standard_ptr_query(self) -> None:
        query = build_query(SERVICE_TYPE)
        self.assertEqual(len(query), 12 + len(encode_name(SERVICE_TYPE)) + 4)
        self.assertEqual(struct.unpack_from("!H", query, 4)[0], 1)

    def test_parses_and_projects_a_complete_dns_sd_answer(self) -> None:
        instance = "Living Room._partycard._tcp.local."
        host = "partybox.local."
        txt = [b"txtvers=1", b"api=1", f"ws={PROTOCOL_VERSION}".encode("ascii"), b"tls=0", b"path=/api/v1", b"cap=rooms,display-bootstrap"]
        txt_wire = b"".join(bytes((len(entry),)) + entry for entry in txt)
        packet = struct.pack("!HHHHHH", 0, 0x8400, 0, 1, 0, 3)
        packet += record(SERVICE_TYPE, TYPE_PTR, encode_name(instance))
        packet += record(instance, TYPE_SRV, struct.pack("!HHH", 0, 0, 3000) + encode_name(host))
        packet += record(instance, TYPE_TXT, txt_wire)
        packet += record(host, TYPE_A, bytes((192, 168, 1, 20)))
        message = parse_message(packet)
        records = tuple((entry, ("192.168.1.20", 5353)) for entry in message.records)
        endpoints = endpoints_from_records(SERVICE_TYPE, records)
        self.assertEqual(len(endpoints), 1)
        self.assertEqual(endpoints[0].origin, "http://192.168.1.20:3000")
        self.assertEqual(endpoints[0].txt["ws"], str(PROTOCOL_VERSION))

    def test_rejects_cyclic_compression_pointer(self) -> None:
        packet = struct.pack("!HHHHHH", 0, 0x8400, 0, 1, 0, 0)
        packet += b"\xc0\x0c" + struct.pack("!HHIH", TYPE_PTR, CLASS_IN, 1, 1) + b"\x00"
        with self.assertRaisesRegex(DnsFormatError, "cyclic"):
            parse_message(packet)

    def test_rejects_truncated_reserved_and_trailing_record_data(self) -> None:
        header = struct.pack("!HHHHHH", 0, 0x8400, 0, 1, 0, 0)
        with self.assertRaises(DnsFormatError):
            parse_message(header + b"\xc0\xff")
        with self.assertRaises(DnsFormatError):
            parse_message(header + b"\x40")

        ptr_value = encode_name("example.local.") + b"garbage"
        with self.assertRaisesRegex(DnsFormatError, "exactly fill"):
            parse_message(header + record(SERVICE_TYPE, TYPE_PTR, ptr_value))

        with self.assertRaisesRegex(DnsFormatError, "TXT entry is truncated"):
            parse_message(header + record(SERVICE_TYPE, TYPE_TXT, b"\x05abc"))

    def test_ignores_expired_and_non_internet_records(self) -> None:
        instance = "TV._partycard._tcp.local."
        host = "partybox.local."
        txt_items = [b"txtvers=1", b"api=1", f"ws={PROTOCOL_VERSION}".encode("ascii"), b"tls=0", b"path=/api/v1", b"cap=rooms"]
        txt = b"".join(bytes((len(entry),)) + entry for entry in txt_items)
        packet = struct.pack("!HHHHHH", 0, 0x8400, 0, 1, 0, 3)
        packet += record(SERVICE_TYPE, TYPE_PTR, encode_name(instance), ttl=0)
        packet += record(instance, TYPE_SRV, struct.pack("!HHH", 0, 0, 3000) + encode_name(host))
        packet += record(instance, TYPE_TXT, txt)
        packet += record(host, TYPE_A, bytes((192, 168, 1, 20)))
        message = parse_message(packet)
        records = tuple((entry, ("192.168.1.20", 5353)) for entry in message.records)
        self.assertEqual(endpoints_from_records(SERVICE_TYPE, records), ())

    def test_bounded_fuzz_corpus_never_leaks_parser_exceptions(self) -> None:
        source = random.Random(712_012)
        for _ in range(250):
            packet = source.randbytes(source.randint(0, 256))
            try:
                parse_message(packet)
            except DnsFormatError:
                continue

    def test_txt_profile_is_exact_and_capability_bounded(self) -> None:
        valid = {
            "txtvers": "1",
            "api": "1",
            "ws": str(PROTOCOL_VERSION),
            "tls": "1",
            "path": "/api/v1",
            "cap": "rooms",
        }
        self.assertTrue(valid_partycard_txt(valid))
        self.assertFalse(valid_partycard_txt({**valid, "ws": str(PROTOCOL_VERSION - 1)}))
        self.assertFalse(valid_partycard_txt({**valid, "ws": str(PROTOCOL_VERSION + 1)}))
        self.assertFalse(valid_partycard_txt({**valid, "cap": "display-bootstrap"}))


if __name__ == "__main__":
    unittest.main()
