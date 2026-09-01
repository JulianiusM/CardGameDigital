"""Validation and mapping for Kodi's native add-on settings surface."""

from __future__ import annotations

from dataclasses import replace
from typing import TYPE_CHECKING, Mapping, Optional

if TYPE_CHECKING:
    from .state import Preferences


PREFERRED_SERVER_URL = "preferred_server_url"
DISCOVERY_ENABLED = "discovery_enabled"
LOCALE = "locale"
DISPLAY_NAME = "display_name"
AUTO_PAGE_SECONDS = "auto_page_seconds"

SETTING_IDS = (
    PREFERRED_SERVER_URL,
    DISCOVERY_ENABLED,
    LOCALE,
    DISPLAY_NAME,
    AUTO_PAGE_SECONDS,
)


def merge_preferences(preferences: "Preferences", values: Mapping[str, str]) -> "Preferences":
    locale = values.get(LOCALE, preferences.locale)
    if locale not in {"auto", "en-GB", "de-DE"}:
        locale = preferences.locale

    display_name = values.get(DISPLAY_NAME, preferences.display_name).strip()
    if not display_name:
        display_name = preferences.display_name

    try:
        page_seconds = int(values.get(AUTO_PAGE_SECONDS, str(preferences.auto_page_seconds)))
    except (TypeError, ValueError):
        page_seconds = preferences.auto_page_seconds
    page_seconds = max(5, min(15, page_seconds))

    return replace(
        preferences,
        locale=locale,
        display_name=display_name[:40],
        auto_page_seconds=page_seconds,
    )


def preference_values(preferences: "Preferences") -> Mapping[str, str]:
    return {
        LOCALE: preferences.locale,
        DISPLAY_NAME: preferences.display_name,
        AUTO_PAGE_SECONDS: str(preferences.auto_page_seconds),
    }


def preferred_server_origin(values: Mapping[str, str]) -> Optional[str]:
    value = values.get(PREFERRED_SERVER_URL, "").strip()
    return value[:2048] if value else None


def discovery_is_enabled(values: Mapping[str, str]) -> bool:
    return _boolean(values, DISCOVERY_ENABLED, True)


def _boolean(values: Mapping[str, str], key: str, default: bool) -> bool:
    if key not in values:
        return default
    normalized = str(values[key]).strip().casefold()
    if normalized in {"true", "1", "yes", "on"}:
        return True
    if normalized in {"false", "0", "no", "off"}:
        return False
    return default

