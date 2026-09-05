"""Semantic focus restoration independent of changing list indices."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Optional


@dataclass
class FocusCoordinator:
    remembered: dict[str, str] = field(default_factory=dict)

    def remember(self, route: str, semantic_key: Optional[str]) -> None:
        if semantic_key:
            self.remembered[route] = semantic_key

    def target(
        self,
        route: str,
        available: Iterable[str],
        preferred: Optional[str] = None,
        previous: Iterable[str] = (),
    ) -> Optional[str]:
        keys = tuple(available)
        if not keys:
            return None
        remembered = self.remembered.get(route)
        if remembered in keys:
            return remembered
        previous_keys = tuple(previous)
        if remembered in previous_keys:
            old_index = previous_keys.index(remembered)
            return keys[self.nearest(old_index, len(keys))]
        if preferred in keys:
            return preferred
        return keys[0]

    @staticmethod
    def nearest(previous_index: int, count: int) -> int:
        if count <= 0:
            return -1
        return max(0, min(previous_index, count - 1))
