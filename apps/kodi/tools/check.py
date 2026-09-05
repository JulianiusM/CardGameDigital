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
REPOSITORY_ROOT = CLIENT_ROOT.parents[1]
PYTHON_ROOT = CLIENT_ROOT / "resources" / "lib"
LANGUAGE_ROOT = CLIENT_ROOT / "resources" / "language"
LOCALIZATION_SOURCE = REPOSITORY_ROOT / "packages" / "localization" / "kodiCatalog.json"
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


def check_python() -> dict[str, int]:
    localization_constants: dict[str, int] = {}
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
            if isinstance(node, ast.Assign):
                if isinstance(node.value, ast.Constant) and isinstance(node.value.value, int):
                    value = node.value.value
                    if path.name == "strings.py" and 32000 <= value <= 32999:
                        for target in node.targets:
                            if isinstance(target, ast.Name):
                                localization_constants[target.id] = value
                    elif 32000 <= value <= 32999:
                        fail(path, "localization IDs must reference generated strings constants")
    return localization_constants


def po_entries(path: Path) -> dict[int, tuple[str, str]]:
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
    entries: dict[int, tuple[str, str]] = {}
    pattern = re.compile(
        r'^msgctxt "#(\d+)"\r?\nmsgid ("(?:\\.|[^"\\])*")'
        r'\r?\nmsgstr ("(?:\\.|[^"\\])*")$',
        re.MULTILINE,
    )
    for match in pattern.finditer(content):
        message_id = int(match.group(1))
        try:
            entries[message_id] = (json.loads(match.group(2)), json.loads(match.group(3)))
        except json.JSONDecodeError as error:
            fail(path, f"invalid PO string for {message_id}: {error}")
    if set(found) != set(entries):
        fail(path, "all PO entries must use single-line escaped msgid and msgstr values")
    return entries


def placeholders(value: str) -> list[str]:
    return sorted(
        token
        for token in re.findall(r"%%|%(?:\d+\$)?[sdif]", value)
        if token != "%%"
    )


def check_localization(constants: dict[str, int]) -> None:
    try:
        catalog = json.loads(LOCALIZATION_SOURCE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        errors.append(f"packages/localization/kodiCatalog.json: invalid catalog: {error}")
        return
    if catalog.get("schemaVersion") != 1:
        errors.append("packages/localization/kodiCatalog.json: schemaVersion must be 1")
        return
    source_locale = catalog.get("sourceLocale")
    locales = catalog.get("locales")
    messages = catalog.get("messages")
    if not isinstance(source_locale, str) or not isinstance(locales, list) or not isinstance(messages, list):
        errors.append("packages/localization/kodiCatalog.json: sourceLocale, locales, and messages are required")
        return

    source_constants: dict[str, int] = {}
    source_messages: dict[int, dict[str, object]] = {}
    shared_keys: set[str] = set()
    previous_id = -1
    for message in messages:
        if not isinstance(message, dict):
            errors.append("packages/localization/kodiCatalog.json: every message must be an object")
            continue
        constant = message.get("constant")
        message_id = message.get("id")
        if not isinstance(constant, str) or not isinstance(message_id, int):
            errors.append("packages/localization/kodiCatalog.json: malformed message definition")
            continue
        if "sharedKey" in message:
            shared_key = message.get("sharedKey")
            if (
                not isinstance(shared_key, str)
                or shared_key != constant
                or "source" in message
                or "translations" in message
                or shared_key in shared_keys
            ):
                errors.append(
                    "packages/localization/kodiCatalog.json: "
                    f"malformed shared message definition for {constant}"
                )
                continue
            shared_keys.add(shared_key)
        elif not isinstance(message.get("source"), str) or not isinstance(
            message.get("translations"), dict
        ):
            errors.append("packages/localization/kodiCatalog.json: malformed message definition")
            continue
        if constant in source_constants or message_id in source_messages:
            errors.append(
                f"packages/localization/kodiCatalog.json: duplicate message {constant} ({message_id})"
            )
            continue
        if message_id <= previous_id:
            errors.append("packages/localization/kodiCatalog.json: messages must be sorted by id")
        source_constants[constant] = message_id
        source_messages[message_id] = message
        previous_id = message_id

    if constants != source_constants:
        missing = sorted(set(source_constants.items()) - set(constants.items()))
        extra = sorted(set(constants.items()) - set(source_constants.items()))
        errors.append(
            "resources/lib/strings.py: generated constants differ from the catalog "
            f"(missing={missing}, extra={extra})"
        )

    addon = ET.parse(CLIENT_ROOT / "addon.xml").getroot()
    expected_project = f'{addon.attrib.get("name")} {addon.attrib.get("version")}'
    expected_directories: set[str] = set()
    locale_tags: set[str] = set()
    resolved_shared_sources: dict[int, str] = {}
    for locale in locales:
        if not isinstance(locale, dict):
            errors.append("packages/localization/kodiCatalog.json: every locale must be an object")
            continue
        tag = locale.get("tag")
        directory = locale.get("directory")
        po_language = locale.get("poLanguage")
        if not all(isinstance(value, str) for value in (tag, directory, po_language)):
            errors.append("packages/localization/kodiCatalog.json: malformed locale definition")
            continue
        assert isinstance(tag, str)
        assert isinstance(directory, str)
        assert isinstance(po_language, str)
        expected_directories.add(directory)
        locale_tags.add(tag)
        path = LANGUAGE_ROOT / directory / "strings.po"
        if not path.is_file():
            fail(path, "generated localization catalog is missing")
            continue
        entries = po_entries(path)
        if set(entries) != set(source_messages):
            missing = sorted(set(source_messages) - set(entries))
            extra = sorted(set(entries) - set(source_messages))
            fail(path, f"IDs differ from source catalog (missing={missing}, extra={extra})")
        content = path.read_text(encoding="utf-8")
        if f'"Project-Id-Version: {expected_project}\\n"' not in content:
            fail(path, f"Project-Id-Version must be {expected_project}")
        if f'"Language: {po_language}\\n"' not in content:
            fail(path, f"Language header must be {po_language}")
        for message_id, message in source_messages.items():
            if message_id not in entries:
                continue
            actual_source, actual_translation = entries[message_id]
            if "sharedKey" in message:
                previous_source = resolved_shared_sources.get(message_id)
                if previous_source is not None and actual_source != previous_source:
                    fail(path, f"shared message {message_id} has inconsistent source text")
                resolved_shared_sources[message_id] = actual_source
                if tag == source_locale and actual_translation != actual_source:
                    fail(path, f"shared source message {message_id} is not translated verbatim")
                if placeholders(actual_source) != placeholders(actual_translation):
                    fail(path, f"shared message {message_id} has a placeholder mismatch")
                continue
            source = message["source"]
            translations = message["translations"]
            assert isinstance(source, str)
            assert isinstance(translations, dict)
            expected_translation = source if tag == source_locale else translations.get(tag)
            if not isinstance(expected_translation, str):
                errors.append(
                    "packages/localization/kodiCatalog.json: "
                    f"missing {tag} translation for {message['constant']}"
                )
                continue
            if actual_source != source or actual_translation != expected_translation:
                fail(path, f"message {message_id} differs from the source catalog")
            if placeholders(source) != placeholders(expected_translation):
                errors.append(
                    "packages/localization/kodiCatalog.json: "
                    f"placeholder mismatch for {message['constant']} in {tag}"
                )

    if source_locale not in locale_tags:
        errors.append("packages/localization/kodiCatalog.json: sourceLocale is not defined")
    actual_directories = {path.parent.name for path in LANGUAGE_ROOT.glob("*/strings.po")}
    if actual_directories != expected_directories:
        errors.append(
            "resources/language: catalogs differ from the catalog locale definitions "
            f"(expected={sorted(expected_directories)}, actual={sorted(actual_directories)})"
        )


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
            try:
                source = json.loads(LOCALIZATION_SOURCE.read_text(encoding="utf-8"))
                native_source = source["nativeSettings"]
                expected_section_id = native_source["sectionId"]
                expected_settings = {
                    setting["id"]
                    for category in native_source["categories"]
                    for setting in category["settings"]
                }
            except (KeyError, OSError, TypeError, json.JSONDecodeError) as error:
                fail(path, f"native settings source is invalid: {error}")
                continue
            if section is None or section.attrib.get("id") != expected_section_id:
                fail(path, "native settings section is missing or uses the wrong add-on ID")
                continue
            settings = {entry.attrib.get("id") for entry in section.findall(".//setting")}
            if settings != expected_settings:
                missing = sorted(expected_settings - settings)
                extra = sorted(settings - expected_settings)
                fail(path, f"native settings differ from source (missing={missing}, extra={extra})")


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
    localization_constants = check_python()
    check_localization(localization_constants)
    check_xml()
    check_generated_data()
    check_assets_and_hygiene()
    if errors:
        print("Kodi client checks failed:")
        for current in errors:
            print(f"- {current}")
        return 1
    print(
        f"Kodi static checks passed ({len(localization_constants)} localized messages, "
        f"{len(list(PYTHON_ROOT.rglob('*.py')))} library modules)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
