"""Pure-Python QR Code Model 2 byte-mode encoder and local PNG renderer.

The implementation follows Project Nayuki's MIT-licensed QR generator algorithm. It
supports versions 1–20 at error-correction level M, which comfortably covers bounded
Room join URLs without a network service or binary dependency.
"""

from __future__ import annotations

import binascii
import os
import struct
import tempfile
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


ECC_CODEWORDS_PER_BLOCK = (
    -1,
    10,
    16,
    26,
    18,
    24,
    16,
    18,
    22,
    22,
    26,
    30,
    22,
    22,
    24,
    24,
    28,
    28,
    26,
    26,
    26,
)
NUM_ERROR_CORRECTION_BLOCKS = (
    -1,
    1,
    1,
    1,
    2,
    2,
    4,
    4,
    4,
    5,
    5,
    5,
    8,
    9,
    9,
    10,
    10,
    11,
    13,
    14,
    16,
)
MIN_VERSION = 1
MAX_VERSION = 20


class QrOverflowError(ValueError):
    pass


@dataclass(frozen=True)
class QrCode:
    version: int
    size: int
    modules: tuple[tuple[bool, ...], ...]

    def module(self, x: int, y: int) -> bool:
        return 0 <= x < self.size and 0 <= y < self.size and self.modules[y][x]


def encode_text(value: str) -> QrCode:
    return encode_bytes(value.encode("utf-8"))


def encode_bytes(data: bytes) -> QrCode:
    version = next(
        (
            current
            for current in range(MIN_VERSION, MAX_VERSION + 1)
            if _required_bits(len(data), current) <= _data_codewords(current) * 8
        ),
        None,
    )
    if version is None:
        raise QrOverflowError("Room join URL is too long for the embedded QR encoder")
    capacity = _data_codewords(version) * 8
    bits: list[int] = []
    _append_bits(bits, 0x4, 4)
    _append_bits(bits, len(data), 8 if version <= 9 else 16)
    for value in data:
        _append_bits(bits, value, 8)
    bits.extend([0] * min(4, capacity - len(bits)))
    bits.extend([0] * ((-len(bits)) % 8))
    pad = 0xEC
    while len(bits) < capacity:
        _append_bits(bits, pad, 8)
        pad ^= 0xEC ^ 0x11
    data_codewords = bytes(
        sum(bits[index + bit] << (7 - bit) for bit in range(8))
        for index in range(0, len(bits), 8)
    )
    all_codewords = _add_error_correction(data_codewords, version)
    return _draw(version, all_codewords)


def write_png(code: QrCode, target: str | Path, scale: int = 8, border: int = 4) -> Path:
    if not 2 <= scale <= 24 or not 4 <= border <= 16:
        raise ValueError("QR scale or border is outside the supported range")
    target_path = Path(target)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    size = (code.size + border * 2) * scale
    row_size = size * 4 + 1
    raw = bytearray(row_size * size)
    offset = 0
    for y in range(size):
        raw[offset] = 0
        offset += 1
        module_y = y // scale - border
        for x in range(size):
            module_x = x // scale - border
            color = 0 if code.module(module_x, module_y) else 255
            raw[offset : offset + 4] = bytes((color, color, color, 255))
            offset += 4
    header = struct.pack("!IIBBBBB", size, size, 8, 6, 0, 0, 0)
    value = b"".join(
        (
            b"\x89PNG\r\n\x1a\n",
            _png_chunk(b"IHDR", header),
            _png_chunk(b"IDAT", zlib.compress(bytes(raw), level=9)),
            _png_chunk(b"IEND", b""),
        )
    )
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{target_path.name}.", dir=target_path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target_path)
        try:
            target_path.chmod(0o600)
        except OSError:
            pass
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
        raise
    return target_path


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack("!I", len(data)) + kind + data + struct.pack(
        "!I", binascii.crc32(kind + data) & 0xFFFFFFFF
    )


def _required_bits(data_length: int, version: int) -> int:
    return 4 + (8 if version <= 9 else 16) + data_length * 8


def _append_bits(target: list[int], value: int, length: int) -> None:
    if value < 0 or value >> length:
        raise ValueError("Bit value does not fit")
    target.extend((value >> bit) & 1 for bit in reversed(range(length)))


def _raw_data_modules(version: int) -> int:
    result = (16 * version + 128) * version + 64
    if version >= 2:
        alignment = version // 7 + 2
        result -= (25 * alignment - 10) * alignment - 55
        if version >= 7:
            result -= 36
    return result


def _data_codewords(version: int) -> int:
    return _raw_data_modules(version) // 8 - (
        ECC_CODEWORDS_PER_BLOCK[version] * NUM_ERROR_CORRECTION_BLOCKS[version]
    )


def _add_error_correction(data: bytes, version: int) -> bytes:
    block_count = NUM_ERROR_CORRECTION_BLOCKS[version]
    ecc_length = ECC_CODEWORDS_PER_BLOCK[version]
    raw_codewords = _raw_data_modules(version) // 8
    short_block_count = block_count - raw_codewords % block_count
    short_block_length = raw_codewords // block_count
    divisor = _reed_solomon_divisor(ecc_length)
    blocks: list[bytes] = []
    offset = 0
    for index in range(block_count):
        data_length = short_block_length - ecc_length + (0 if index < short_block_count else 1)
        current = data[offset : offset + data_length]
        offset += data_length
        ecc = _reed_solomon_remainder(current, divisor)
        if index < short_block_count:
            current += b"\x00"
        blocks.append(current + ecc)
    if offset != len(data):
        raise AssertionError("QR block partition did not consume all data")
    result = bytearray()
    for index in range(len(blocks[0])):
        for block_index, block in enumerate(blocks):
            if index == short_block_length - ecc_length and block_index < short_block_count:
                continue
            result.append(block[index])
    if len(result) != raw_codewords:
        raise AssertionError("QR interleave length is invalid")
    return bytes(result)


def _reed_solomon_divisor(degree: int) -> bytes:
    result = bytearray(degree)
    result[-1] = 1
    root = 1
    for _ in range(degree):
        for index in range(degree):
            result[index] = _reed_solomon_multiply(result[index], root)
            if index + 1 < degree:
                result[index] ^= result[index + 1]
        root = _reed_solomon_multiply(root, 0x02)
    return bytes(result)


def _reed_solomon_remainder(data: bytes, divisor: bytes) -> bytes:
    result = bytearray(len(divisor))
    for value in data:
        factor = value ^ result[0]
        result[:-1] = result[1:]
        result[-1] = 0
        for index, coefficient in enumerate(divisor):
            result[index] ^= _reed_solomon_multiply(coefficient, factor)
    return bytes(result)


def _reed_solomon_multiply(left: int, right: int) -> int:
    result = 0
    for bit in reversed(range(8)):
        result = (result << 1) ^ ((result >> 7) * 0x11D)
        result ^= ((right >> bit) & 1) * left
    return result


def _alignment_positions(version: int) -> tuple[int, ...]:
    if version == 1:
        return ()
    count = version // 7 + 2
    step = 26 if version == 32 else ((version * 4 + count * 2 + 1) // (count * 2 - 2)) * 2
    result = [6]
    position = version * 4 + 10
    for _ in range(count - 1):
        result.insert(1, position)
        position -= step
    return tuple(result)


def _draw(version: int, codewords: bytes) -> QrCode:
    size = version * 4 + 17
    modules = [[False] * size for _ in range(size)]
    function = [[False] * size for _ in range(size)]

    def set_function(x: int, y: int, dark: bool) -> None:
        modules[y][x] = dark
        function[y][x] = True

    for index in range(size):
        set_function(6, index, index % 2 == 0)
        set_function(index, 6, index % 2 == 0)
    _finder(modules, function, 3, 3)
    _finder(modules, function, size - 4, 3)
    _finder(modules, function, 3, size - 4)
    alignment = _alignment_positions(version)
    for row, y in enumerate(alignment):
        for column, x in enumerate(alignment):
            if (row == 0 and column == 0) or (row == 0 and column == len(alignment) - 1):
                continue
            if row == len(alignment) - 1 and column == 0:
                continue
            _alignment(modules, function, x, y)
    _format_bits(modules, function, 0)
    if version >= 7:
        _version_bits(modules, function, version)
    _draw_codewords(modules, function, codewords)
    best_mask = min(
        range(8),
        key=lambda mask: _trial_penalty(modules, function, mask),
    )
    _apply_mask(modules, function, best_mask)
    _format_bits(modules, function, best_mask)
    return QrCode(version, size, tuple(tuple(row) for row in modules))


def _finder(modules: list[list[bool]], function: list[list[bool]], center_x: int, center_y: int) -> None:
    size = len(modules)
    for y_offset in range(-4, 5):
        for x_offset in range(-4, 5):
            x = center_x + x_offset
            y = center_y + y_offset
            if 0 <= x < size and 0 <= y < size:
                distance = max(abs(x_offset), abs(y_offset))
                modules[y][x] = distance not in {2, 4}
                function[y][x] = True


def _alignment(modules: list[list[bool]], function: list[list[bool]], center_x: int, center_y: int) -> None:
    for y_offset in range(-2, 3):
        for x_offset in range(-2, 3):
            modules[center_y + y_offset][center_x + x_offset] = max(
                abs(x_offset), abs(y_offset)
            ) != 1
            function[center_y + y_offset][center_x + x_offset] = True


def _format_bits(modules: list[list[bool]], function: list[list[bool]], mask: int) -> None:
    size = len(modules)
    data = mask
    remainder = data
    for _ in range(10):
        remainder = (remainder << 1) ^ ((remainder >> 9) * 0x537)
    bits = ((data << 10) | remainder) ^ 0x5412

    def set_value(x: int, y: int, bit: int) -> None:
        modules[y][x] = bool((bits >> bit) & 1)
        function[y][x] = True

    for index in range(6):
        set_value(8, index, index)
    set_value(8, 7, 6)
    set_value(8, 8, 7)
    set_value(7, 8, 8)
    for index in range(9, 15):
        set_value(14 - index, 8, index)
    for index in range(8):
        set_value(size - 1 - index, 8, index)
    for index in range(8, 15):
        set_value(8, size - 15 + index, index)
    modules[size - 8][8] = True
    function[size - 8][8] = True


def _version_bits(
    modules: list[list[bool]],
    function: list[list[bool]],
    version: int,
) -> None:
    size = len(modules)
    remainder = version
    for _ in range(12):
        remainder = (remainder << 1) ^ ((remainder >> 11) * 0x1F25)
    bits = (version << 12) | remainder
    for index in range(18):
        dark = bool((bits >> index) & 1)
        x = size - 11 + index % 3
        y = index // 3
        modules[y][x] = dark
        modules[x][y] = dark
        function[y][x] = True
        function[x][y] = True


def _draw_codewords(
    modules: list[list[bool]],
    function: list[list[bool]],
    codewords: bytes,
) -> None:
    size = len(modules)
    bit_index = 0
    right = size - 1
    while right >= 1:
        if right == 6:
            right = 5
        upward = ((right + 1) & 2) == 0
        bit_index = _draw_codeword_pair(size, upward, right, function, bit_index, codewords, modules)
        right -= 2
    if bit_index < len(codewords) * 8:
        raise AssertionError("QR matrix did not fit all codewords")

def _draw_codeword_pair(size, upward, right, function, bit_index, codewords, modules):
    for vertical in range(size):
        y = size - 1 - vertical if upward else vertical
        for column in range(2):
            x = right - column
            if function[y][x]:
                continue
            if bit_index < len(codewords) * 8:
                modules[y][x] = bool(
                    (codewords[bit_index >> 3] >> (7 - (bit_index & 7))) & 1
                )
            bit_index += 1
    return bit_index


def _trial_penalty(
    modules: list[list[bool]],
    function: list[list[bool]],
    mask: int,
) -> int:
    _apply_mask(modules, function, mask)
    _format_bits(modules, function, mask)
    result = _penalty(modules)
    _apply_mask(modules, function, mask)
    return result


MASKS: tuple[Callable[[int, int], bool], ...] = (
    lambda x, y: (x + y) % 2 == 0,
    lambda _x, y: y % 2 == 0,
    lambda x, _y: x % 3 == 0,
    lambda x, y: (x + y) % 3 == 0,
    lambda x, y: (x // 3 + y // 2) % 2 == 0,
    lambda x, y: x * y % 2 + x * y % 3 == 0,
    lambda x, y: (x * y % 2 + x * y % 3) % 2 == 0,
    lambda x, y: ((x + y) % 2 + x * y % 3) % 2 == 0,
)


def _apply_mask(modules: list[list[bool]], function: list[list[bool]], mask: int) -> None:
    predicate = MASKS[mask]
    for y, row in enumerate(modules):
        for x in range(len(row)):
            if not function[y][x] and predicate(x, y):
                row[x] = not row[x]


def _penalty(modules: list[list[bool]]) -> int:
    size = len(modules)
    result = 0
    for rows in (modules, [list(column) for column in zip(*modules)]):
        for row in rows:
            result = _row_penalty(result, row)
    for y in range(size - 1):
        for x in range(size - 1):
            value = modules[y][x]
            if (
                modules[y][x + 1] == value
                and modules[y + 1][x] == value
                and modules[y + 1][x + 1] == value
            ):
                result += 3
    dark = sum(value for row in modules for value in row)
    result += abs(dark * 20 - size * size * 10) // (size * size) * 10
    return result

def _row_penalty(result, row):
    run_color = row[0]
    run_length = 1
    for color in row[1:]:
        if color == run_color:
            run_length += 1
            if run_length == 5:
                result += 3
            elif run_length > 5:
                result += 1
        else:
            run_color = color
            run_length = 1
    pattern = "".join("1" if value else "0" for value in row)
    result += 40 * (pattern.count("10111010000") + pattern.count("00001011101"))
    return result

