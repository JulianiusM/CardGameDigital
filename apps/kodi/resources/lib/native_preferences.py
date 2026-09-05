"""Validation and mapping for Kodi's native add-on settings surface."""

from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING, Mapping, Optional

from .native_settings_metadata import (
    AUTO_PAGE_SECONDS,
    DISCOVERY_ENABLED,
    DISPLAY_NAME,
    LOCALE,
    LOCALE_VALUES,
    PREFERRED_SERVER_URL,
    SETTING_DEFAULTS,
    SETTING_IDS,
    SETTING_INTEGER_RANGES,
    SETTING_MAXIMUM_LENGTHS,
)

if TYPE_CHECKING:
    from .state import Preferences


def merge_preferences(preferences: "Preferences", values: Mapping[str, str]) -> "Preferences":
    locale = values.get(LOCALE, preferences.locale)
    if locale not in LOCALE_VALUES:
        locale = preferences.locale

    display_name = values.get(DISPLAY_NAME, preferences.display_name).strip()
    if not display_name:
        display_name = preferences.display_name

    try:
        page_seconds = int(values.get(AUTO_PAGE_SECONDS, str(preferences.auto_page_seconds)))
    except (TypeError, ValueError):
        page_seconds = preferences.auto_page_seconds
    page_minimum, _page_step, page_maximum = SETTING_INTEGER_RANGES[AUTO_PAGE_SECONDS]
    page_seconds = max(page_minimum, min(page_maximum, page_seconds))

    return replace(
        preferences,
        locale=locale,
        display_name=display_name[: SETTING_MAXIMUM_LENGTHS[DISPLAY_NAME]],
        auto_page_seconds=page_seconds,
    )


def preference_values(preferences: "Preferences") -> Mapping[str, str]:
    return {
        LOCALE: preferences.locale,
        DISPLAY_NAME: preferences.display_name,
        AUTO_PAGE_SECONDS: str(preferences.auto_page_seconds),
    }


def preferred_server_origin(values: Mapping[str, str]) -> Optional[str]:
    value = values.get(
        PREFERRED_SERVER_URL, str(SETTING_DEFAULTS[PREFERRED_SERVER_URL])
    ).strip()
    maximum_length = SETTING_MAXIMUM_LENGTHS[PREFERRED_SERVER_URL]
    return value[:maximum_length] if value else None


def discovery_is_enabled(values: Mapping[str, str]) -> bool:
    return _boolean(
        values, DISCOVERY_ENABLED, bool(SETTING_DEFAULTS[DISCOVERY_ENABLED])
    )


def _boolean(values: Mapping[str, str], key: str, default: bool) -> bool:
    if key not in values:
        return default
    normalized = str(values[key]).strip().casefold()
    if normalized in {"true", "1", "yes", "on"}:
        return True
    if normalized in {"false", "0", "no", "off"}:
        return False
    return default
