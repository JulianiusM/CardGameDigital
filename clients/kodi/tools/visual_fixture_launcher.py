#!/usr/bin/env python3
"""Temporary Kodi Games plugin entry point for deterministic visual QA.

Copy this file over ``game.py`` only in an unpacked development deployment. Kodi's
``Addons.ExecuteAddon`` passes private fixture arguments to the same plugin entry used
by native Game-add-on selection. Every normal launch enters the production runtime. Release
packaging excludes the complete ``tools/`` directory.
"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path
from typing import Optional, Sequence
from urllib.parse import parse_qs, unquote_plus


FIXTURE_QUERY_KEY = "partycard_visual_fixture"
FIXTURE_LOCALE_QUERY_KEY = "partycard_visual_locale"
FIXTURE_LOCALES = ("en-GB", "de-DE")


def _fixture_path() -> Path:
    directory = Path(__file__).resolve().parent
    installed = directory / "tools" / "visual_fixture.py"
    if installed.is_file():
        return installed
    source = directory / "visual_fixture.py"
    if source.is_file():
        return source
    raise SystemExit("The visual fixture entry point is not installed.")


def _run_production() -> int:
    addon_root = Path(__file__).resolve().parent
    resources_root = str(addon_root / "resources")
    if resources_root not in sys.path:
        sys.path.insert(0, resources_root)

    from lib.kodi_runtime import run

    run()
    return 0


def _run_fixture(scenario: str, locale: str) -> int:
    fixture = _fixture_path()
    sys.argv = [str(fixture), scenario, locale]
    runpy.run_path(str(fixture), run_name="__main__")
    return 0


def _query_text(argument: str) -> str:
    return argument[1:] if argument.startswith("?") else argument


def _fixture_scenario(arguments: Sequence[str]) -> Optional[str]:
    matches = []
    for argument in arguments:
        query = unquote_plus(_query_text(argument))
        if not query or "=" not in query:
            continue
        values = parse_qs(query, keep_blank_values=True).get(FIXTURE_QUERY_KEY, [])
        matches.extend(value.strip() for value in values)
    if not matches:
        return None
    if len(set(matches)) != 1 or not matches[0]:
        raise SystemExit("Kodi provided an invalid visual fixture query.")
    return matches[0]


def _fixture_locale(arguments: Sequence[str]) -> str:
    matches = []
    for argument in arguments:
        query = unquote_plus(_query_text(argument))
        if not query or "=" not in query:
            continue
        values = parse_qs(query, keep_blank_values=True).get(
            FIXTURE_LOCALE_QUERY_KEY,
            [],
        )
        matches.extend(value.strip() for value in values)
    if not matches:
        return "en-GB"
    if len(set(matches)) != 1 or matches[0] not in FIXTURE_LOCALES:
        raise SystemExit("Kodi provided an invalid visual fixture locale.")
    return matches[0]


def _trace_arguments(
    arguments: Sequence[str],
    fixture_requested: bool,
    fixture_locale: str,
) -> None:
    import xbmc

    shapes = []
    for index, argument in enumerate(arguments):
        kind = "argument"
        if index == 0:
            kind = "script-path"
        elif (
            FIXTURE_QUERY_KEY in unquote_plus(argument)
            or FIXTURE_LOCALE_QUERY_KEY in unquote_plus(argument)
        ):
            kind = "fixture-query"
        shapes.append(f"{index}:{kind}:{len(argument)}")
    xbmc.log(
        "Party Game TV visual launcher: "
        f"argv_shape={','.join(shapes)} fixture_requested={fixture_requested} "
        f"fixture_locale={fixture_locale if fixture_requested else '-'}",
        level=xbmc.LOGINFO,
    )


def _finish_plugin_directory(arguments: Sequence[str]) -> None:
    import xbmcplugin

    if len(arguments) < 2:
        raise SystemExit("Kodi did not provide the Games plugin handle.")
    try:
        handle = int(arguments[1])
    except ValueError as error:
        raise SystemExit("Kodi provided an invalid Games plugin handle.") from error
    xbmcplugin.endOfDirectory(
        handle,
        succeeded=True,
        updateListing=False,
        cacheToDisc=False,
    )


def main(arguments: Sequence[str]) -> int:
    scenario = _fixture_scenario(arguments)
    locale = _fixture_locale(arguments)
    _trace_arguments(arguments, scenario is not None, locale)
    _finish_plugin_directory(arguments)
    if scenario is not None:
        return _run_fixture(scenario, locale)
    return _run_production()


if __name__ == "__main__":
    sys.exit(main(sys.argv))
