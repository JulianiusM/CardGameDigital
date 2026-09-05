"""Shared option and numeric-editor contracts for the native setup UI."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Tuple

from . import strings
from .contract_data import generated_enums


_ENUMS = generated_enums()
_ROOM_LIMITS = _ENUMS["constraints"]["roomGameSettings"]
_INTENSITY_LEVELS = tuple(_ENUMS["intensityLevels"])
_CARD_LIFECYCLES = tuple(_ENUMS["cardLifecycles"])
SENSITIVITY_VALUES = tuple(_ENUMS["socialSensitivities"])
_PROGRESSION_UNITS = tuple(reversed(_ENUMS["intensityProgressionUnits"]))
_AVAILABILITY_VALUES = tuple(
    value for value in _ENUMS["availabilityDirectives"] if value != "INHERIT"
)
_BOOLEAN_VALUES = tuple(value for value in _ENUMS["booleanDirectives"] if value != "INHERIT")
_SCALAR_VALUES = tuple(value for value in _ENUMS["scalarDirectiveModes"] if value != "INHERIT")
_INCREMENT = _ROOM_LIMITS["intensityProgressionIncrement"]
_INCREMENT_STEPS = int(round((_INCREMENT["maximum"] - _INCREMENT["minimum"]) / _INCREMENT["step"]))
_INCREMENT_VALUES = tuple(
    _INCREMENT["minimum"] + index * _INCREMENT["step"]
    for index in range(_INCREMENT_STEPS + 1)
)

CONFIGURATION_CHOICES: Mapping[str, Tuple[object, ...]] = {
    "startingIntensity": _INTENSITY_LEVELS,
    "maximumIntensity": _INTENSITY_LEVELS,
    "maximumSocialSensitivity": SENSITIVITY_VALUES,
    "intensityProgressionUnit": _PROGRESSION_UNITS,
    "intensityProgressionIncrement": _INCREMENT_VALUES,
    "randomQuestionRatio": tuple(value / 10 for value in range(11)),
}

PREDICATE_CHOICES: Mapping[str, Tuple[object, ...]] = {
    "yesNoAnswerPossible": (None, True, False),
    "alwaysEligible": (None, True, False),
    "repeatableInSession": (None, True, False),
    "lifecycle": (None, *_CARD_LIFECYCLES),
}

DIRECTIVE_CHOICES: Mapping[str, Tuple[object, ...]] = {
    "availability": (None, *_AVAILABILITY_VALUES),
    "alwaysEligible": (None, *_BOOLEAN_VALUES),
    "repeatableInSession": (None, *_BOOLEAN_VALUES),
    "repeatCooldown": (None, *_SCALAR_VALUES),
    "intensity": (None, *_SCALAR_VALUES),
    "weight": (None, *_SCALAR_VALUES),
    "socialSensitivity": (None, *_SCALAR_VALUES),
    "playerCount": (None, *_SCALAR_VALUES),
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
    "intensityProgressionInterval": NumericSpec(
        strings.PROGRESSION_INTERVAL,
        _ROOM_LIMITS["intensityProgressionInterval"]["minimum"],
        _ROOM_LIMITS["intensityProgressionInterval"]["maximum"],
        True,
    ),
    "maximumTypeStreak": NumericSpec(
        strings.TYPE_STREAK,
        _ROOM_LIMITS["maximumTypeStreak"]["minimum"],
        _ROOM_LIMITS["maximumTypeStreak"]["maximum"],
        True,
    ),
    "letsTalkMetaInterval": NumericSpec(
        strings.META_INTERVAL,
        _ROOM_LIMITS["letsTalkMetaInterval"]["minimum"],
        _ROOM_LIMITS["letsTalkMetaInterval"]["maximum"],
        True,
    ),
}

PREDICATE_NUMBERS: Mapping[str, NumericSpec] = {
    "minimumIntensity": NumericSpec(
        strings.MIN_INTENSITY, min(_INTENSITY_LEVELS), max(_INTENSITY_LEVELS), True
    ),
    "maximumIntensity": NumericSpec(
        strings.MAX_INTENSITY, min(_INTENSITY_LEVELS), max(_INTENSITY_LEVELS), True
    ),
    "minimumRepeatCooldown": NumericSpec(strings.MIN_REPEAT_COOLDOWN, 0, 10000, True),
    "maximumRepeatCooldown": NumericSpec(strings.MAX_REPEAT_COOLDOWN, 0, 10000, True),
    "minimumWeight": NumericSpec(strings.MIN_WEIGHT, 0.01, 10000, False),
    "maximumWeight": NumericSpec(strings.MAX_WEIGHT, 0.01, 10000, False),
    "minimumPlayerCountAtLeast": NumericSpec(strings.MIN_PLAYER_COUNT, 2, 100, True),
    "maximumPlayerCountAtMost": NumericSpec(strings.MAX_PLAYER_COUNT, 2, 100, True),
}

DIRECTIVE_NUMBERS: Mapping[str, NumericSpec] = {
    "repeatCooldown": NumericSpec(strings.REPEAT_COOLDOWN, 0, 10000, True),
    "intensity": NumericSpec(
        strings.INTENSITY, min(_INTENSITY_LEVELS), max(_INTENSITY_LEVELS), True
    ),
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
