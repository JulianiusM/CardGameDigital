"""Deterministic TV layout decisions shared by rendering and tests."""

from __future__ import annotations

import textwrap


CARD_TEXT_NORMAL_LINE_WIDTH = 52
CARD_TEXT_NORMAL_LINES = 8
CARD_TEXT_RESULT_LINE_WIDTH = 32
CARD_TEXT_RESULT_LINES = 7


LIGHT_TEXT_ATMOSPHERES = {
    "DESIRE_STORIES_3",
    "DESIRE_STORIES_4",
    "DESIRE_STORIES_5",
    "FLIRT_4",
    "FLIRT_5",
    "HEAT_2",
    "HEAT_3",
    "HEAT_4",
    "HEAT_5",
    "INTIMATE_TALK_5",
    "REVEAL_3",
    "REVEAL_4",
    "REVEAL_5",
    "SOCIAL_CHAOS_5",
}


def card_text_fit(value: str) -> str:
    length = _visible_length(value)
    if length <= 100:
        return "short"
    if length <= 280:
        return "medium"
    if length <= 600:
        return "long"
    return "overflow"


def result_card_text_fit(value: str) -> str:
    length = _visible_length(value)
    if length <= 100:
        return "short"
    if length <= 320:
        return "long"
    return "overflow"


def card_text_pages(value: str, result_layout: bool = False) -> tuple[str, ...]:
    """Split Card copy into bounded, non-scrolling TV pages without dropping text."""
    width = CARD_TEXT_RESULT_LINE_WIDTH if result_layout else CARD_TEXT_NORMAL_LINE_WIDTH
    lines_per_page = CARD_TEXT_RESULT_LINES if result_layout else CARD_TEXT_NORMAL_LINES
    normalized = value.replace("[CR]", "\n")
    if not normalized:
        return ("",)
    wrapped: list[str] = []
    for paragraph in normalized.split("\n"):
        if not paragraph:
            wrapped.append("")
            continue
        wrapped.extend(
            textwrap.wrap(
                paragraph,
                width=width,
                expand_tabs=False,
                replace_whitespace=False,
                drop_whitespace=False,
                break_long_words=True,
                break_on_hyphens=False,
            )
        )
    return tuple(
        "\n".join(wrapped[index : index + lines_per_page])
        for index in range(0, len(wrapped), lines_per_page)
    ) or ("",)


def adaptive_tone(atmosphere: str) -> str:
    return "light" if atmosphere in LIGHT_TEXT_ATMOSPHERES else "dark"


def _visible_length(value: str) -> int:
    return len(value.replace("[CR]", "\n"))
