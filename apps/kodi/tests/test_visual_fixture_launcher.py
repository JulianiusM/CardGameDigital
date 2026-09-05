from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


CLIENT_ROOT = Path(__file__).resolve().parents[1]
LAUNCHER_PATH = CLIENT_ROOT / "tools" / "visual_fixture_launcher.py"
DRIVER_PATH = CLIENT_ROOT / "tools" / "kodi_visual_driver.ps1"
VISUAL_FIXTURE_PATH = CLIENT_ROOT / "tools" / "visual_fixture.py"
RELEASE_SCRIPT_PATH = CLIENT_ROOT.parents[1] / "tooling" / "kodi" / "release.ts"


def _load_launcher():
    specification = importlib.util.spec_from_file_location(
        "partycard_visual_fixture_launcher_test",
        LAUNCHER_PATH,
    )
    if specification is None or specification.loader is None:
        raise AssertionError("Visual fixture launcher could not be loaded")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


class VisualFixtureLauncherTests(unittest.TestCase):
    def test_normal_game_plugin_launch_finishes_directory_then_runs_production(self) -> None:
        launcher = _load_launcher()
        calls = []
        fake_runtime = types.ModuleType("lib.kodi_runtime")
        fake_runtime.run = lambda: calls.append("run")
        fake_xbmc = types.ModuleType("xbmc")
        fake_xbmc.LOGINFO = 1
        fake_xbmc.log = lambda message, level: calls.append(("log", message, level))
        fake_xbmcplugin = types.ModuleType("xbmcplugin")
        fake_xbmcplugin.endOfDirectory = lambda handle, **kwargs: calls.append(
            ("end", handle, kwargs)
        )

        with patch.dict(
            sys.modules,
            {
                "lib.kodi_runtime": fake_runtime,
                "xbmc": fake_xbmc,
                "xbmcplugin": fake_xbmcplugin,
            },
        ):
            self.assertEqual(
                launcher.main(["plugin://script.partycard.tv/", "7", ""]),
                0,
            )

        self.assertEqual(calls[-1], "run")
        self.assertEqual(calls[0][0], "log")
        self.assertEqual(calls[1][0:2], ("end", 7))
        self.assertEqual(calls[1][2]["cacheToDisc"], False)

    def test_private_script_arguments_dispatch_scenario(self) -> None:
        launcher = _load_launcher()
        fixture = CLIENT_ROOT / "tools" / "visual_fixture.py"
        invoked = []
        fake_xbmc = types.ModuleType("xbmc")
        fake_xbmc.LOGINFO = 1
        fake_xbmc.log = lambda *_args, **_kwargs: None
        fake_xbmcplugin = types.ModuleType("xbmcplugin")
        fake_xbmcplugin.endOfDirectory = lambda *_args, **_kwargs: None

        def record_run(path: str, run_name: str) -> None:
            invoked.append(("fixture", Path(path), run_name, list(sys.argv)))

        with patch.dict(
            sys.modules,
            {"xbmc": fake_xbmc, "xbmcplugin": fake_xbmcplugin},
        ), patch.object(
            launcher,
            "_fixture_path",
            return_value=fixture,
        ), patch.object(
            launcher.runpy,
            "run_path",
            side_effect=record_run,
        ), patch.object(sys, "argv", ["outer"]):
            result = launcher.main(
                [
                    "plugin://script.partycard.tv/",
                    "9",
                    f"?{launcher.FIXTURE_QUERY_KEY}=named-first&"
                    f"{launcher.FIXTURE_LOCALE_QUERY_KEY}=de-DE",
                ]
            )

        self.assertEqual(result, 0)
        self.assertEqual(
            invoked,
            [
                (
                    "fixture",
                    fixture,
                    "__main__",
                    [str(fixture), "named-first", "de-DE"],
                ),
            ],
        )

    def test_parser_accepts_kodi_script_argument_forms(self) -> None:
        launcher = _load_launcher()
        key = launcher.FIXTURE_QUERY_KEY
        cases = (
            ["plugin://script.partycard.tv/", "1", f"{key}=named-first"],
            ["plugin://script.partycard.tv/", "1", f"?{key}=named-first"],
            ["plugin://script.partycard.tv/", "1", f"{key}%3Dnamed-first"],
        )

        for arguments in cases:
            with self.subTest(arguments=arguments):
                self.assertEqual(launcher._fixture_scenario(arguments), "named-first")

    def test_parser_defaults_to_english_and_accepts_explicit_german_fixture_locale(
        self,
    ) -> None:
        launcher = _load_launcher()
        key = launcher.FIXTURE_LOCALE_QUERY_KEY

        self.assertEqual(
            launcher._fixture_locale(["plugin://script.partycard.tv/", "1", "ordinary=value"]),
            "en-GB",
        )
        self.assertEqual(
            launcher._fixture_locale(["plugin://script.partycard.tv/", "1", f"{key}=de-DE"]),
            "de-DE",
        )
        with self.assertRaisesRegex(SystemExit, "invalid visual fixture locale"):
            launcher._fixture_locale(["plugin://script.partycard.tv/", "1", f"{key}=fr-FR"])

    def test_development_trace_never_logs_argument_values(self) -> None:
        launcher = _load_launcher()
        logs = []
        fake_xbmc = types.ModuleType("xbmc")
        fake_xbmc.LOGINFO = 1
        fake_xbmc.log = lambda message, level: logs.append((message, level))
        arguments = [
            "plugin://script.partycard.tv/",
            "4",
            "token=never-log-this",
            f"{launcher.FIXTURE_QUERY_KEY}=private-choice",
        ]

        with patch.dict(sys.modules, {"xbmc": fake_xbmc}):
            launcher._trace_arguments(arguments, True, "de-DE")

        self.assertEqual(len(logs), 1)
        self.assertNotIn("never-log-this", logs[0][0])
        self.assertNotIn("private-choice", logs[0][0])
        self.assertIn("fixture_requested=True", logs[0][0])
        self.assertIn("fixture_locale=de-DE", logs[0][0])

    def test_unpacked_deployment_finds_the_fixture_below_tools(self) -> None:
        launcher = _load_launcher()
        with tempfile.TemporaryDirectory() as directory:
            addon_root = Path(directory) / "script.partycard.tv"
            fixture = addon_root / "tools" / "visual_fixture.py"
            fixture.parent.mkdir(parents=True)
            fixture.touch()
            deployed_entry_point = addon_root / "game.py"
            deployed_entry_point.touch()

            with patch.object(launcher, "__file__", str(deployed_entry_point)):
                self.assertEqual(launcher._fixture_path(), fixture)

    def test_driver_and_launcher_share_the_private_query_key(self) -> None:
        launcher = _load_launcher()
        driver = DRIVER_PATH.read_text(encoding="utf-8")
        self.assertIn(
            f'$script:FixtureQueryKey = "{launcher.FIXTURE_QUERY_KEY}"',
            driver,
        )
        self.assertIn(
            f'$script:FixtureLocaleQueryKey = "{launcher.FIXTURE_LOCALE_QUERY_KEY}"',
            driver,
        )
        self.assertIn("$fixtureParameters[$script:FixtureQueryKey] = $Scenario", driver)
        self.assertIn("$fixtureParameters[$script:FixtureLocaleQueryKey] = $Locale", driver)
        self.assertIn("params = $fixtureParameters", driver)
        self.assertIn('$script:DirectLaunchQueryKey = "partycard_direct_launch"', driver)
        self.assertIn("$launchParameters[$script:DirectLaunchQueryKey]", driver)
        self.assertIn('[ValidateSet("en-GB", "de-DE")]', driver)
        self.assertIn("[int]$TimeoutSeconds = 60", driver)

    def test_driver_exposes_the_final_voter_fixture_and_audit_properties(self) -> None:
        driver = DRIVER_PATH.read_text(encoding="utf-8")

        self.assertIn('"couch-voters-1000-final"', driver)
        self.assertIn('"couch-voter-page-complete"', driver)
        self.assertIn('"private-choice-anonymous"', driver)
        self.assertIn('"setup-card-policy"', driver)
        self.assertIn('"setup-card-rule-values"', driver)
        self.assertIn('"room-ended-open"', driver)
        self.assertIn('locale = $Locale', driver)
        self.assertIn('"room-game-marquee-timing"', driver)
        for property_name in (
            "CardText",
            "HasVoters",
            "VoterPagination",
            "PageStatus",
            "PagePreviousLabel",
            "PageNextLabel",
            "PagePreviousEnabled",
            "PageNextEnabled",
            "VotingStageLabel",
            "Atmosphere",
            "AtmosphereTexture",
            "ResultVisible",
            "HasNamedResults",
        ):
            with self.subTest(property_name=property_name):
                self.assertIn(f'"{property_name}"', driver)

    def test_driver_allowlists_every_visual_fixture(self) -> None:
        result = subprocess.run(
            [sys.executable, "-B", str(VISUAL_FIXTURE_PATH), "--list"],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        driver = DRIVER_PATH.read_text(encoding="utf-8")
        scenarios = tuple(line.strip() for line in result.stdout.splitlines() if line.strip())
        self.assertTrue(scenarios)
        for scenario in scenarios:
            with self.subTest(scenario=scenario):
                self.assertIn(f'"{scenario}"', driver)

    def test_visual_check_covers_the_final_thousand_voter_page(self) -> None:
        result = subprocess.run(
            [sys.executable, "-B", str(VISUAL_FIXTURE_PATH), "--check"],
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(
            "couch-voters-1000-final: COUCH_GAME / card",
            result.stdout,
        )
        self.assertIn(
            "couch-voter-page-complete: COUCH_GAME / card",
            result.stdout,
        )
        self.assertIn(
            "room-game-marquee-timing: ROOM_GAME_DISPLAY / card",
            result.stdout,
        )
        self.assertIn("Validated explicit de-DE projections for every fixture.", result.stdout)
        self.assertIn("deterministic visual fixtures.", result.stdout)

    def test_visual_check_covers_distinct_player_stage_host_and_card_states(self) -> None:
        result = subprocess.run(
            [sys.executable, "-B", str(VISUAL_FIXTURE_PATH), "--check"],
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        expected_projections = {
            "setup-player-profile-hostile": "SETUP_PLAYER / player-profile",
            "group-member-profile-hostile": "GROUP_MEMBER / player-profile",
            "couch-menu-four-actions": "COUCH_MENU / active-menu",
            "couch-sync-required": "COUCH_GAME / card",
            "couch-waiting": "COUCH_GAME / card",
            "couch-choice": "COUCH_GAME / card",
            "couch-pool-exhausted": "COUCH_GAME / card",
            "room-waiting": "ROOM_GAME_DISPLAY / card",
            "room-choice": "ROOM_GAME_DISPLAY / card",
            "room-pool-exhausted": "ROOM_GAME_DISPLAY / card",
            "room-reconnecting": "ROOM_GAME_DISPLAY / card",
            "room-host-awaiting-first": "ROOM_LOBBY_DISPLAY / lobby",
            "room-host-reconnecting": "ROOM_LOBBY_DISPLAY / lobby",
            "room-host-awaiting-replacement": "ROOM_LOBBY_DISPLAY / lobby",
            "anonymous-aggregate-result": "COUCH_GAME / card",
            "conversation-meta-card": "COUCH_GAME / card",
        }
        for scenario, projection in expected_projections.items():
            with self.subTest(scenario=scenario):
                self.assertIn(f"{scenario}: {projection}", result.stdout)

    def test_release_keeps_every_fixture_tool_outside_the_addon_zip(self) -> None:
        production_script = (CLIENT_ROOT / "game.py").read_text(encoding="utf-8")
        release_script = RELEASE_SCRIPT_PATH.read_text(encoding="utf-8")

        self.assertNotIn("visual_fixture", production_script)
        self.assertTrue((CLIENT_ROOT / "game.py").is_file())
        self.assertIn("xbmcplugin.endOfDirectory", production_script)
        self.assertEqual(LAUNCHER_PATH.parent.name, "tools")
        self.assertIn('!relative.startsWith("tools/")', release_script)
        self.assertIn('!relative.startsWith(".test-profile/")', release_script)
        self.assertIn('name.includes("/tools/")', release_script)
        self.assertIn('names.includes(`${addonId}/game.py`)', release_script)


if __name__ == "__main__":
    unittest.main()
