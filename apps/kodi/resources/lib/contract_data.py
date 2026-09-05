"""Read-only access to generated cross-language contract data."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping


@lru_cache(maxsize=1)
def generated_enums() -> Mapping[str, Any]:
    source = Path(__file__).resolve().parents[1] / "data" / "enums.json"
    with source.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, Mapping):
        raise ValueError("Generated protocol enums must be an object")
    return value


@lru_cache(maxsize=1)
def generated_design_tokens() -> Mapping[str, Any]:
    source = Path(__file__).resolve().parents[1] / "data" / "design-tokens.json"
    with source.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, Mapping):
        raise ValueError("Generated design tokens must be an object")
    return value
