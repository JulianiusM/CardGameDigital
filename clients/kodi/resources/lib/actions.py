"""Data-only actions and effect descriptions for the unidirectional client loop."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping, Optional


@dataclass(frozen=True)
class Action:
    kind: str
    payload: Mapping[str, Any] = field(default_factory=dict)
    operation_id: Optional[str] = None


@dataclass(frozen=True)
class Effect:
    kind: str
    payload: Mapping[str, Any] = field(default_factory=dict)
    owner: Optional[str] = None
    operation_id: Optional[str] = None


def action(kind: str, operation_id: Optional[str] = None, **payload: Any) -> Action:
    return Action(kind=kind, payload=payload, operation_id=operation_id)


def effect(
    kind: str,
    owner: Optional[str] = None,
    operation_id: Optional[str] = None,
    **payload: Any,
) -> Effect:
    return Effect(kind=kind, payload=payload, owner=owner, operation_id=operation_id)

