"""Kodi lifecycle adapter for the one-window, no-service add-on."""

from __future__ import annotations

import os
import time

import xbmc
import xbmcaddon
import xbmcgui
import xbmcvfs

from .screens.main_window import MainWindow


ADDON_START_FAILED = 32335


class StartupAborted(RuntimeError):
    pass


def _log(addon: xbmcaddon.Addon, message: str, level: int = xbmc.LOGINFO) -> None:
    prefix = f"{addon.getAddonInfo('name')} {addon.getAddonInfo('version')}"
    xbmc.log(f"{prefix}: {message}", level=level)


def _read_native_settings(addon: xbmcaddon.Addon, setting_ids: tuple) -> dict:
    return {setting_id: addon.getSetting(setting_id) for setting_id in setting_ids}


def _write_preferences(addon: xbmcaddon.Addon, preferences, preference_values) -> None:
    for setting_id, value in preference_values(preferences).items():
        if addon.getSetting(setting_id) != value:
            addon.setSetting(setting_id, value)


def _application_class():
    from .app import Application

    return Application


def _native_preference_functions():
    from .native_preferences import (
        SETTING_IDS,
        discovery_is_enabled,
        preference_values,
        preferred_server_origin,
    )

    return (
        SETTING_IDS,
        discovery_is_enabled,
        preference_values,
        preferred_server_origin,
    )


def _formatted_traceback() -> str:
    import traceback

    return traceback.format_exc()


def _load_with_abort(monitor: xbmc.Monitor, loader):
    # Monitor.abortRequested() crosses Kodi's Python/C++ boundary. Calling it for
    # every transitive import made a cold start take almost a minute on Kodi 21.
    # The import groups are bounded, so check once after each group instead.
    result = loader()
    if monitor.abortRequested():
        raise StartupAborted()
    return result


def run() -> None:
    started_at = time.monotonic()
    addon = xbmcaddon.Addon()
    application = None
    window = None
    monitor = xbmc.Monitor()
    exit_reason = "Kodi requested shutdown"
    return_to_kodi_home = False
    _log(addon, "starting")
    try:
        addon_path = xbmcvfs.translatePath(addon.getAddonInfo("path"))
        profile_path = xbmcvfs.translatePath(addon.getAddonInfo("profile"))
        os.makedirs(profile_path, exist_ok=True)
        holder = {}

        def locale() -> str:
            current = holder.get("application")
            if current and current.state.preferences.locale != "auto":
                return current.state.preferences.locale
            return xbmc.getLanguage(xbmc.ISO_639_1, region=True) or "en-GB"

        window = MainWindow(
            "script-partycard-tv-main.xml",
            addon_path,
            "Default",
            "1080i",
            addon_root=addon_path,
        )
        window.show()
        _log(addon, "loading window shown")

        (
            setting_ids,
            discovery_is_enabled,
            preference_values,
            preferred_server_origin,
        ) = _load_with_abort(monitor, _native_preference_functions)
        _log(addon, f"native preferences loaded after {time.monotonic() - started_at:.2f}s")
        native_settings = _read_native_settings(addon, setting_ids)
        Application = _load_with_abort(monitor, _application_class)
        _log(addon, f"application modules loaded after {time.monotonic() - started_at:.2f}s")
        application = Application(
            profile_path,
            locale,
            native_preferences=native_settings,
            preference_sink=lambda preferences: _write_preferences(
                addon,
                preferences,
                preference_values,
            ),
            configured_server_origin=preferred_server_origin(native_settings),
            discovery_enabled=discovery_is_enabled(native_settings),
        )
        holder["application"] = application
        window.attach_application(application)
        application.start()
        _log(addon, "application initialized")
        _log(addon, "main window ready")
        while not monitor.abortRequested() and application.state.lifecycle != "STOPPING":
            application.tick()
            window.render_if_changed()
            if monitor.waitForAbort(0.05):
                break
        if application.state.lifecycle == "STOPPING":
            exit_reason = "user left the add-on"
            return_to_kodi_home = True
    except StartupAborted:
        exit_reason = "Kodi requested shutdown during startup"
    except Exception as error:
        exit_reason = f"startup/runtime failure ({type(error).__name__})"
        _log(addon, f"{exit_reason}: {_formatted_traceback()}", xbmc.LOGERROR)
        if not monitor.abortRequested():
            xbmcgui.Dialog().notification(
                addon.getAddonInfo("name"),
                addon.getLocalizedString(ADDON_START_FAILED),
                xbmcgui.NOTIFICATION_ERROR,
                8000,
            )
    finally:
        if application is not None:
            application.stop()
        if window is not None:
            window.release_runtime_inhibitors()
            window.close()
        if return_to_kodi_home and not monitor.abortRequested():
            # A script launched from Kodi's Games browser otherwise exposes whichever
            # implementation folder happened to contain its executable entry. Home is
            # a stable native destination across skins and Kodi 21 platforms.
            xbmc.executebuiltin("ActivateWindow(Home)")
        elapsed = time.monotonic() - started_at
        _log(addon, f"stopped after {elapsed:.2f}s ({exit_reason})")
