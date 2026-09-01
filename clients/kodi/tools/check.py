#!/usr/bin/env python3
"""Zero-dependency static checks suitable for CPython and release CI."""

from __future__ import annotations

import ast
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


CLIENT_ROOT = Path(__file__).resolve().parents[1]
PYTHON_ROOT = CLIENT_ROOT / "resources" / "lib"
LANGUAGE_ROOT = CLIENT_ROOT / "resources" / "language"
ALLOWED_KODI_IMPORTS = {
    CLIENT_ROOT / "addon.py",
    CLIENT_ROOT / "game.py",
    CLIENT_ROOT / "tools" / "visual_fixture_launcher.py",
    PYTHON_ROOT / "kodi_runtime.py",
    PYTHON_ROOT / "screens" / "main_window.py",
}
RUNTIME_GENERIC_NAMES = {"dict", "list", "set", "tuple", "type"}
errors: list[str] = []


def fail(path: Path, message: str) -> None:
    errors.append(f"{path.relative_to(CLIENT_ROOT)}: {message}")


def check_python() -> set[int]:
    localization_ids: set[int] = set()
    for path in sorted(CLIENT_ROOT.rglob("*.py")):
        content = path.read_text(encoding="utf-8")
        try:
            tree = ast.parse(content, filename=str(path), feature_version=(3, 8))
        except SyntaxError as error:
            fail(path, f"Python 3.8 syntax error on line {error.lineno}: {error.msg}")
            continue
        if "\t" in content:
            fail(path, "tab indentation is not allowed")
        if any(line.rstrip() != line for line in content.splitlines()):
            fail(path, "trailing whitespace is not allowed")
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Assign)
                and isinstance(node.value, ast.Subscript)
                and isinstance(node.value.value, ast.Name)
                and node.value.value.id in RUNTIME_GENERIC_NAMES
            ):
                fail(
                    path,
                    f"runtime-evaluated {node.value.value.id}[...] is incompatible with Kodi's Python 3.8",
                )
            if isinstance(node, ast.Call) and any(
                keyword.arg == "cancel_futures" for keyword in node.keywords
            ):
                fail(path, "cancel_futures is unavailable in Kodi's Python 3.8")
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                names = [entry.name for entry in node.names]
                module = node.module or "" if isinstance(node, ast.ImportFrom) else ""
                if (
                    any(
                        name in {"xbmc", "xbmcaddon", "xbmcgui", "xbmcplugin", "xbmcvfs"}
                        for name in names
                    )
                    or module in {"xbmc", "xbmcaddon", "xbmcgui", "xbmcplugin", "xbmcvfs"}
                ) and path not in ALLOWED_KODI_IMPORTS:
                    fail(path, "Kodi imports must remain inside runtime/screen adapters")
            if path.name == "strings.py" and isinstance(node, ast.Assign):
                if isinstance(node.value, ast.Constant) and isinstance(node.value.value, int):
                    value = node.value.value
                    if 32000 <= value <= 32999:
                        localization_ids.add(value)
    return localization_ids


def po_ids(path: Path) -> set[int]:
    content = path.read_text(encoding="utf-8")
    found = [int(value) for value in re.findall(r'^msgctxt "#(\d+)"$', content, re.MULTILINE)]
    if len(found) != len(set(found)):
        fail(path, "localization identifiers must be unique")
    for match in re.finditer(r"^msgctxt ", content, re.MULTILINE):
        if match.start() and not content[: match.start()].endswith("\n\n"):
            fail(path, "Kodi PO entries must be separated by a blank line")
            break
    for block in re.split(r"(?=^msgctxt )", content, flags=re.MULTILINE):
        if block.startswith("msgctxt") and 'msgstr ""' in block:
            fail(path, "translated messages must not have an empty msgstr")
    return set(found)


def check_localization(required: set[int]) -> None:
    language_sets: list[tuple[Path, set[int]]] = []
    for path in sorted(LANGUAGE_ROOT.glob("*/strings.po")):
        language_sets.append((path, po_ids(path)))
    if len(language_sets) != 2:
        errors.append("resources/language: exactly English and German catalogs are required")
    for path, identifiers in language_sets:
        missing = sorted(required - identifiers)
        if missing:
            fail(path, f"missing localization IDs: {missing}")
    if language_sets and any(values != language_sets[0][1] for _, values in language_sets[1:]):
        errors.append("resources/language: English and German IDs differ")


def check_xml() -> None:
    for path in sorted(CLIENT_ROOT.rglob("*.xml")):
        try:
            root = ET.parse(path).getroot()
        except ET.ParseError as error:
            fail(path, f"XML parse error: {error}")
            continue
        if path.name == "addon.xml":
            if root.attrib.get("id") != "script.partycard.tv":
                fail(path, "add-on ID differs from the release root")
            version_source = (PYTHON_ROOT / "version.py").read_text(encoding="utf-8")
            version_match = re.search(
                r'^APPLICATION_VERSION = "([0-9]+\.[0-9]+\.[0-9]+)"$',
                version_source,
                re.MULTILINE,
            )
            if not version_match or version_match.group(1) != root.attrib.get("version"):
                fail(path, "manifest and Python application versions differ")
            runtime_extensions = [
                entry
                for entry in root.findall("extension")
                if entry.attrib.get("point") != "xbmc.addon.metadata"
            ]
            if len(runtime_extensions) != 2:
                fail(path, "exactly the Game plugin and script runtime extensions are required")
            plugin = root.find("extension[@point='xbmc.python.pluginsource']")
            if plugin is None:
                fail(path, "native Game plugin extension is missing")
            elif plugin.attrib.get("library") != "game.py":
                fail(path, "native Game plugin must launch game.py")
            elif (plugin.findtext("provides") or "").split() != ["game"]:
                fail(path, "native Game plugin must provide only game content")
            script = root.find("extension[@point='xbmc.python.script']")
            if script is None:
                fail(path, "automation script extension is missing")
            elif script.attrib.get("library") != "addon.py":
                fail(path, "automation script must launch addon.py")
            elif (script.findtext("provides") or "").split() != ["executable"]:
                fail(path, "automation script must provide only executable content")
            all_extensions = root.findall("extension")
            expected_points = ["xbmc.python.pluginsource", "xbmc.python.script"]
            if [entry.attrib.get("point") for entry in all_extensions[:2]] != expected_points:
                fail(path, "Game plugin and automation script must be the first extensions")
            if root.find("extension[@point='xbmc.service']") is not None:
                fail(path, "release one must not install a permanent service")
            if not (CLIENT_ROOT / "game.py").is_file():
                fail(path, "native Game plugin entry point is missing")
        if path.name == "script-partycard-tv-main.xml":
            if root.findall(".//include"):
                fail(path, "fallback WindowXML must not depend on active-skin includes")
            if "LargeText" in path.read_text(encoding="utf-8"):
                fail(path, "removed large-text mode is still referenced by the skin")
            for tag in (
                "texture",
                "texturefocus",
                "texturenofocus",
                "texturesliderbar",
                "textureslidernib",
                "textureslidernibfocus",
            ):
                for texture in root.findall(f".//{tag}"):
                    name = (texture.text or "").strip()
                    if not name or name.startswith("$INFO["):
                        continue
                    if not name.startswith("partycard-tv-"):
                        fail(path, f"fallback texture is not add-on-unique: {name}")
                    if not (path.parent.parent / "media" / name).is_file():
                        fail(path, f"fallback texture is missing: {name}")
            for control in root.findall(".//control"):
                if control.attrib.get("type") not in {"button", "list", "panel"}:
                    continue
                control_id = control.attrib.get("id", "unknown")
                for direction in ("onup", "ondown", "onleft", "onright"):
                    if control.find(direction) is None:
                        fail(path, f"focusable control {control_id} has no {direction}")
        if path.name == "settings.xml":
            section = root.find("section")
            if section is None or section.attrib.get("id") != "script.partycard.tv":
                fail(path, "native settings section is missing or uses the wrong add-on ID")
                continue
            settings = {entry.attrib.get("id") for entry in section.findall(".//setting")}
            required = {
                "preferred_server_url",
                "discovery_enabled",
                "locale",
                "display_name",
                "auto_page_seconds",
            }
            missing = sorted(required - settings)
            if missing:
                fail(path, f"native settings are missing: {missing}")


def check_generated_data() -> None:
    data_root = CLIENT_ROOT / "resources" / "data"
    for path in sorted(data_root.rglob("*.json")):
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            fail(path, f"invalid generated JSON: {error}")
    manifest_path = data_root / "protocol" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for name in manifest.get("schemas", ()):
        if not (manifest_path.parent / name).is_file():
            fail(manifest_path, f"missing generated schema {name}")
    fixture_manifest = json.loads((data_root / "fixtures" / "manifest.json").read_text("utf-8"))
    for group in ("roomSnapshotFixtures", "transportFixtures", "httpFixtures"):
        for name in fixture_manifest.get(group, ()):
            if not (data_root / "fixtures" / name).is_file():
                fail(data_root / "fixtures" / "manifest.json", f"missing fixture {name}")


def check_assets_and_hygiene() -> None:
    for path in sorted(CLIENT_ROOT.rglob("*")):
        if path.is_dir():
            if path.name == "__pycache__":
                fail(path, "Python cache directory must not be committed")
            continue
        content = path.read_bytes()
        if path.suffix == ".png" and not content.startswith(b"\x89PNG\r\n\x1a\n"):
            fail(path, "PNG signature is invalid")
        if path.suffix in {".py", ".xml", ".po", ".md", ".txt", ".json"}:
            try:
                text = content.decode("utf-8")
            except UnicodeDecodeError:
                fail(path, "text file is not UTF-8")
                continue
            blocked_remote_hosts = ("fonts." + "googleapis.com", "cdnjs" + ".")
            if any(host in text for host in blocked_remote_hosts):
                fail(path, "remote font/CDN dependency is forbidden")


def main() -> int:
    required_ids = check_python()
    check_localization(required_ids)
    check_xml()
    check_generated_data()
    check_assets_and_hygiene()
    if errors:
        print("Kodi client checks failed:")
        for current in errors:
            print(f"- {current}")
        return 1
    print(
        f"Kodi static checks passed ({len(required_ids)} localized messages, "
        f"{len(list(PYTHON_ROOT.rglob('*.py')))} library modules)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
