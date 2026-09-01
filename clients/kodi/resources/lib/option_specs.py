"""Shared option and numeric-editor contracts for the native setup UI."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Tuple

from . import strings


SENSITIVITY_VALUES = (
    "GENERAL",
    "PERSONAL",
    "CLOSE_PERSONAL",
    "DEEP_PERSONAL",
    "INTIMATE",
    "EXPLICIT",
)

CONFIGURATION_CHOICES: Mapping[str, Tuple[object, ...]] = {
    "startingIntensity": (1, 2, 3, 4, 5),
    "maximumIntensity": (1, 2, 3, 4, 5),
    "maximumSocialSensitivity": SENSITIVITY_VALUES,
    "intensityProgressionUnit": ("CARDS", "ROUNDS"),
    "intensityProgressionIncrement": (0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4),
    "randomQuestionRatio": tuple(value / 10 for value in range(11)),
}

PREDICATE_CHOICES: Mapping[str, Tuple[object, ...]] = {
    "yesNoAnswerPossible": (None, True, False),
    "alwaysEligible": (None, True, False),
    "repeatableInSession": (None, True, False),
    "lifecycle": (None, "ACTIVE", "RETIRED"),
}

DIRECTIVE_CHOICES: Mapping[str, Tuple[object, ...]] = {
    "availability": (None, "INCLUDE", "EXCLUDE"),
    "alwaysEligible": (None, "ENABLE", "DISABLE"),
    "repeatableInSession": (None, "ENABLE", "DISABLE"),
    "repeatCooldown": (None, "CATALOG", "SET"),
    "intensity": (None, "CATALOG", "SET"),
    "weight": (None, "CATALOG", "SET"),
    "socialSensitivity": (None, "CATALOG", "SET"),
    "playerCount": (None, "CATALOG", "SET"),
}

DIRECTIVE_DEFAULTS = {
    "repeatCooldown": 0,
    "intensity": 1,
    "weight": 1,
    "socialSensitivity": "GENERAL",
    "playerCount": {"minimum": 2, "maximum": None},
}


@dataclass(frozen=True)
class NumericSpec:
    heading_id: int
    minimum: float
    maximum: float
    integer: bool


CONFIGURATION_NUMBERS: Mapping[str, NumericSpec] = {
    "intensityProgressionInterval": NumericSpec(strings.PROGRESSION_INTERVAL, 1, 100, True),
    "maximumTypeStreak": NumericSpec(strings.TYPE_STREAK, 1, 10, True),
    "letsTalkMetaInterval": NumericSpec(strings.META_INTERVAL, 1, 100, True),
}

PREDICATE_NUMBERS: Mapping[str, NumericSpec] = {
    "minimumIntensity": NumericSpec(strings.MIN_INTENSITY, 1, 5, True),
    "maximumIntensity": NumericSpec(strings.MAX_INTENSITY, 1, 5, True),
    "minimumRepeatCooldown": NumericSpec(strings.MIN_REPEAT_COOLDOWN, 0, 10000, True),
    "maximumRepeatCooldown": NumericSpec(strings.MAX_REPEAT_COOLDOWN, 0, 10000, True),
    "minimumWeight": NumericSpec(strings.MIN_WEIGHT, 0.01, 10000, False),
    "maximumWeight": NumericSpec(strings.MAX_WEIGHT, 0.01, 10000, False),
    "minimumPlayerCountAtLeast": NumericSpec(strings.MIN_PLAYER_COUNT, 2, 100, True),
    "maximumPlayerCountAtMost": NumericSpec(strings.MAX_PLAYER_COUNT, 2, 100, True),
}

DIRECTIVE_NUMBERS: Mapping[str, NumericSpec] = {
    "repeatCooldown": NumericSpec(strings.REPEAT_COOLDOWN, 0, 10000, True),
    "intensity": NumericSpec(strings.INTENSITY, 1, 5, True),
    "weight": NumericSpec(strings.WEIGHT, 0.01, 10000, False),
    "playerMinimum": NumericSpec(strings.MIN_PLAYER_COUNT, 2, 100, True),
    "playerMaximum": NumericSpec(strings.MAX_PLAYER_COUNT, 2, 100, True),
}


def encode_option(value: object) -> str:
    if value is None:
        return "none"
    if value is True:
        return "true"
    if value is False:
        return "false"
    return str(value)


def decode_option(token: str, choices: Tuple[object, ...]) -> object:
    return next(value for value in choices if encode_option(value) == token)


def format_number(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)
