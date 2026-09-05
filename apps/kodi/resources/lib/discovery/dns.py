"""Bounds-checked DNS packet encoder/parser for release-one DNS-SD browsing."""

from __future__ import annotations

import ipaddress
import struct
from dataclasses import dataclass
from typing import Any


MAX_PACKET = 9000
MAX_RECORDS = 512
MAX_POINTER_JUMPS = 32
TYPE_A = 1
TYPE_PTR = 12
TYPE_TXT = 16
TYPE_AAAA = 28
TYPE_SRV = 33
CLASS_IN = 1


class DnsFormatError(ValueError):
    pass


@dataclass(frozen=True)
class DnsRecord:
    name: str
    record_type: int
    record_class: int
    ttl: int
    value: Any


@dataclass(frozen=True)
class DnsMessage:
    identifier: int
    flags: int
    answers: tuple[DnsRecord, ...]
    authorities: tuple[DnsRecord, ...]
    additional: tuple[DnsRecord, ...]

    @property
    def records(self) -> tuple[DnsRecord, ...]:
        return self.answers + self.authorities + self.additional


def encode_name(name: str) -> bytes:
    stripped = name.rstrip(".")
    labels = stripped.split(".") if stripped else []
    encoded = bytearray()
    for label in labels:
        current = label.encode("utf-8")
        if not current or len(current) > 63:
            raise DnsFormatError("DNS label length is invalid")
        encoded.append(len(current))
        encoded.extend(current)
    encoded.append(0)
    if len(encoded) > 255:
        raise DnsFormatError("DNS name is too long")
    return bytes(encoded)


def build_query(name: str, record_type: int = TYPE_PTR) -> bytes:
    header = struct.pack("!HHHHHH", 0, 0, 1, 0, 0, 0)
    return header + encode_name(name) + struct.pack("!HH", record_type, CLASS_IN)


def parse_message(packet: bytes) -> DnsMessage:
    if not 12 <= len(packet) <= MAX_PACKET:
        raise DnsFormatError("DNS packet length is invalid")
    identifier, flags, questions, answers, authorities, additional = struct.unpack_from(
        "!HHHHHH", packet, 0
    )
    total_records = answers + authorities + additional
    if questions > MAX_RECORDS or total_records > MAX_RECORDS:
        raise DnsFormatError("DNS packet has too many entries")
    offset = 12
    for _ in range(questions):
        _, offset = read_name(packet, offset)
        offset = _require(packet, offset, 4)
    groups: list[tuple[DnsRecord, ...]] = []
    for count in (answers, authorities, additional):
        records: list[DnsRecord] = []
        for _ in range(count):
            record, offset = _read_record(packet, offset)
            records.append(record)
        groups.append(tuple(records))
    if offset > len(packet):
        raise DnsFormatError("DNS parser passed the packet boundary")
    return DnsMessage(identifier, flags, groups[0], groups[1], groups[2])


def read_name(packet: bytes, offset: int) -> tuple[str, int]:
    if not 0 <= offset < len(packet):
        raise DnsFormatError("DNS name starts outside the packet")
    labels: list[str] = []
    cursor = offset
    result_offset: int | None = None
    visited: set[int] = set()
    wire_length = 1
    while True:
        if cursor >= len(packet):
            raise DnsFormatError("DNS name is truncated")
        length = packet[cursor]
        if length == 0:
            cursor += 1
            result_offset = result_offset or cursor
            break
        if length & 0xC0 == 0xC0:
            pointer = _compression_pointer(packet, cursor, visited)
            result_offset = result_offset or (cursor + 2)
            cursor = pointer
            continue
        label, end = _read_label(packet, cursor, length)
        labels.append(label)
        wire_length += length + 1
        if wire_length > 255 or len(labels) > 127:
            raise DnsFormatError("DNS name exceeds protocol limits")
        cursor = end
    return f"{'.'.join(labels)}." if labels else ".", int(result_offset)


def _read_record(packet: bytes, offset: int) -> tuple[DnsRecord, int]:
    name, offset = read_name(packet, offset)
    _require(packet, offset, 10)
    record_type, record_class, ttl, data_length = struct.unpack_from("!HHIH", packet, offset)
    offset += 10
    data_start = offset
    data_end = data_start + data_length
    if data_end > len(packet):
        raise DnsFormatError("DNS record data is truncated")
    if record_type == TYPE_PTR:
        value, consumed = read_name(packet, data_start)
        if consumed != data_end:
            raise DnsFormatError("PTR name does not exactly fill its record")
    elif record_type == TYPE_SRV:
        value = _read_srv_record(packet, data_start, data_end, data_length)
    elif record_type == TYPE_TXT:
        value = _parse_txt(packet[data_start:data_end])
    elif record_type == TYPE_A:
        if data_length != 4:
            raise DnsFormatError("A record length is invalid")
        value = str(ipaddress.IPv4Address(packet[data_start:data_end]))
    elif record_type == TYPE_AAAA:
        if data_length != 16:
            raise DnsFormatError("AAAA record length is invalid")
        value = str(ipaddress.IPv6Address(packet[data_start:data_end]))
    else:
        value = packet[data_start:data_end]
    return DnsRecord(name, record_type, record_class & 0x7FFF, ttl, value), data_end


def _read_srv_record(packet, data_start, data_end, data_length):
    if data_length < 7:
        raise DnsFormatError("SRV record is too short")
    priority, weight, port = struct.unpack_from("!HHH", packet, data_start)
    target, consumed = read_name(packet, data_start + 6)
    if consumed != data_end:
        raise DnsFormatError("SRV target does not exactly fill its record")
    value = {"priority": priority, "weight": weight, "port": port, "target": target}
    return value


def _parse_txt(data: bytes) -> dict[str, str]:
    result: dict[str, str] = {}
    offset = 0
    while offset < len(data):
        length = data[offset]
        offset += 1
        end = offset + length
        if end > len(data):
            raise DnsFormatError("TXT entry is truncated")
        try:
            entry = data[offset:end].decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise DnsFormatError("TXT entry is not valid UTF-8") from error
        key, separator, value = entry.partition("=")
        lowered = key.casefold()
        if not key or lowered in result:
            raise DnsFormatError("TXT key is empty or duplicated")
        result[lowered] = value if separator else ""
        offset = end
    return result


def _require(packet: bytes, offset: int, size: int) -> int:
    result = offset + size
    if offset < 0 or result > len(packet):
        raise DnsFormatError("DNS field is truncated")
    return result


def _compression_pointer(packet: bytes, cursor: int, visited: set[int]) -> int:
    if cursor + 1 >= len(packet):
        raise DnsFormatError("DNS compression pointer is truncated")
    pointer = ((packet[cursor] & 0x3F) << 8) | packet[cursor + 1]
    if pointer >= len(packet) or pointer in visited:
        raise DnsFormatError("DNS compression pointer is invalid or cyclic")
    visited.add(pointer)
    if len(visited) > MAX_POINTER_JUMPS:
        raise DnsFormatError("DNS compression chain is too deep")
    return pointer


def _read_label(packet: bytes, cursor: int, length: int) -> tuple[str, int]:
    if length & 0xC0:
        raise DnsFormatError("DNS label uses a reserved length prefix")
    cursor += 1
    end = cursor + length
    if end > len(packet):
        raise DnsFormatError("DNS label is truncated")
    try:
        label = packet[cursor:end].decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise DnsFormatError("DNS label is not valid UTF-8") from error
    return label, end
