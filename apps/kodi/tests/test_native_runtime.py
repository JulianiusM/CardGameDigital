from __future__ import annotations

import ast
import importlib
import sys
import tempfile
import threading
import time
import types
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from support import RESOURCES_ROOT  # noqa: F401 - adds resources to sys.path
from lib.native_preferences import (
    discovery_is_enabled,
    merge_preferences,
    preference_values,
    preferred_server_origin,
)
from lib.state import Preferences
from lib.worker_pool import BoundedWorkerPool


class NativePreferenceTests(unittest.TestCase):
    def test_native_settings_override_and_serialize_validated_preferences(self) -> None:
        merged = merge_preferences(
            Preferences(locale="de-DE", display_name="Saved TV"),
            {
                "locale": "en-GB",
                "display_name": " Living room ",
                "auto_page_seconds": "99",
            },
        )
        self.assertEqual(merged.locale, "en-GB")
        self.assertEqual(merged.display_name, "Living room")
        self.assertEqual(merged.auto_page_seconds, 15)
        self.assertNotIn("large_text", preference_values(merged))
        self.assertNotIn("reduced_motion", preference_values(merged))
        self.assertNotIn("weak_hardware", preference_values(merged))
        self.assertNotIn("sound_effects", preference_values(merged))

    def test_network_settings_are_bounded_and_default_to_discovery(self) -> None:
        self.assertEqual(
            preferred_server_origin({"preferred_server_url": " https://game.example.test "}),
            "https://game.example.test",
        )
        self.assertIsNone(preferred_server_origin({"preferred_server_url": "   "}))
        self.assertTrue(discovery_is_enabled({}))
        self.assertFalse(discovery_is_enabled({"discovery_enabled": "false"}))


class WorkerPoolTests(unittest.TestCase):
    def test_shutdown_is_bounded_while_a_daemon_worker_is_blocked(self) -> None:
        started = threading.Event()
        release = threading.Event()
        pool = BoundedWorkerPool(1, "test-worker", queue_capacity=2)

        def blocked() -> None:
            started.set()
            release.wait(2.0)

        self.assertTrue(pool.submit(blocked))
        self.assertTrue(started.wait(1.0))
        before = time.monotonic()
        remaining = pool.shutdown(join_timeout=0.05)
        elapsed = time.monotonic() - before
        release.set()

        self.assertEqual(remaining, 1)
        self.assertLess(elapsed, 0.5)


class NativeLifecycleTests(unittest.TestCase):
    def test_runtime_and_fixture_use_the_dialog_constructor_signature(self) -> None:
        client_root = RESOURCES_ROOT.parent
        cases = (
            (client_root / "resources" / "lib" / "kodi_runtime.py", "MainWindow"),
            (client_root / "tools" / "visual_fixture.py", "FixtureWindow"),
        )
        for path, constructor in cases:
            tree = ast.parse(path.read_text(encoding="utf-8"))
            calls = [
                node
                for node in ast.walk(tree)
                if isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == constructor
            ]
            self.assertEqual(len(calls), 1, path)
            self.assertEqual(len(calls[0].args), 4, path)

    def test_confirmed_exit_shuts_down_and_closes_exactly_once(self) -> None:
        applications = []
        windows = []
        monitors = []
        runtime_events = []

        class FakeApplication:
            def __init__(self, *_args, **_kwargs) -> None:
                self.state = SimpleNamespace(
                    lifecycle="CREATED",
                    preferences=SimpleNamespace(locale="auto"),
                )
                self.shutdown_calls = 0
                self.stop_calls = 0
                applications.append(self)

            def start(self) -> None:
                self.state.lifecycle = "RUNNING"

            def tick(self) -> None:
                return

            def confirm_exit(self) -> None:
                if self.state.lifecycle == "STOPPING":
                    return
                self.state.lifecycle = "STOPPING"
                self.shutdown_calls += 1

            def stop(self) -> None:
                self.stop_calls += 1
                if self.state.lifecycle == "STOPPING":
                    return
                self.state.lifecycle = "STOPPING"
                self.shutdown_calls += 1

        class FakeWindow:
            def __init__(self, *_args, **_kwargs) -> None:
                self.init_args = _args
                self.application = None
                self.close_calls = 0
                self.release_calls = 0
                windows.append(self)

            def show(self) -> None:
                return

            def attach_application(self, application) -> None:
                self.application = application

            def render_if_changed(self) -> None:
                self.application.confirm_exit()

            def release_runtime_inhibitors(self) -> None:
                self.release_calls += 1

            def close(self) -> None:
                self.close_calls += 1
                runtime_events.append("window.close")

        class FakeMonitor:
            def __init__(self) -> None:
                self.waits = []
                monitors.append(self)

            def abortRequested(self) -> bool:  # noqa: N802 - Kodi API name
                return False

            def waitForAbort(self, timeout: float) -> bool:  # noqa: N802
                self.waits.append(timeout)
                return False

        with tempfile.TemporaryDirectory() as directory:
            class FakeAddon:
                def getAddonInfo(self, key: str) -> str:  # noqa: N802
                    values = {
                        "name": "Party Game TV",
                        "version": "test",
                        "path": directory,
                        "profile": directory,
                    }
                    return values.get(key, "")

                def getSetting(self, _key: str) -> str:  # noqa: N802
                    return ""

                def setSetting(self, _key: str, _value: str) -> None:  # noqa: N802
                    return

                def getLocalizedString(self, message_id: int) -> str:  # noqa: N802
                    return str(message_id)

            fake_xbmc = types.ModuleType("xbmc")
            fake_xbmc.LOGINFO = 1
            fake_xbmc.LOGERROR = 4
            fake_xbmc.ISO_639_1 = 0
            fake_xbmc.Monitor = FakeMonitor
            fake_xbmc.getLanguage = lambda *_args, **_kwargs: "en-GB"
            fake_xbmc.log = lambda *_args, **_kwargs: None
            fake_xbmc.executebuiltin = lambda command: runtime_events.append(command)
            fake_addon = types.ModuleType("xbmcaddon")
            fake_addon.Addon = FakeAddon
            fake_gui = types.ModuleType("xbmcgui")
            fake_gui.NOTIFICATION_ERROR = 0
            fake_gui.Dialog = lambda: SimpleNamespace(notification=lambda *_args: None)
            fake_vfs = types.ModuleType("xbmcvfs")
            fake_vfs.translatePath = lambda path: path
            fake_main_window = types.ModuleType("lib.screens.main_window")
            fake_main_window.MainWindow = FakeWindow

            previous_runtime = sys.modules.pop("lib.kodi_runtime", None)
            try:
                with patch.dict(
                    sys.modules,
                    {
                        "xbmc": fake_xbmc,
                        "xbmcaddon": fake_addon,
                        "xbmcgui": fake_gui,
                        "xbmcvfs": fake_vfs,
                        "lib.screens.main_window": fake_main_window,
                    },
                ):
                    runtime = importlib.import_module("lib.kodi_runtime")
                    with patch.object(runtime, "_application_class", return_value=FakeApplication), patch.object(
                        runtime,
                        "_native_preference_functions",
                        return_value=(
                            (),
                            lambda _settings: True,
                            lambda _preferences: {},
                            lambda _settings: None,
                        ),
                    ):
                        runtime.run()
            finally:
                sys.modules.pop("lib.kodi_runtime", None)
                if previous_runtime is not None:
                    sys.modules["lib.kodi_runtime"] = previous_runtime

        self.assertEqual(len(applications), 1)
        self.assertEqual(applications[0].shutdown_calls, 1)
        self.assertEqual(applications[0].stop_calls, 1)
        self.assertEqual(len(windows), 1)
        self.assertEqual(windows[0].release_calls, 1)
        self.assertEqual(windows[0].close_calls, 1)
        self.assertEqual(len(windows[0].init_args), 4)
        self.assertEqual(monitors[0].waits, [0.05])
        self.assertEqual(
            runtime_events,
            ["window.close", "ActivateWindow(Home)"],
        )


if __name__ == "__main__":
    unittest.main()
