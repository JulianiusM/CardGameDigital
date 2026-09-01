"""Small catalog loader for the add-on's explicit Auto/English/German preference."""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Callable


LOCALE_DIRECTORIES = {
    "en-GB": "resource.language.en_gb",
    "de-DE": "resource.language.de_de",
}


class CatalogLocalizer:
    def __init__(self, addon_root: str | Path) -> None:
        self.addon_root = Path(addon_root).resolve()
        self._catalogs: dict[str, dict[int, str]] = {}
        self._lock = threading.Lock()

    def template(
        self,
        message_id: int,
        locale: str,
        kodi_fallback: Callable[[int], str],
    ) -> str:
        if locale == "auto":
            return kodi_fallback(message_id)
        directory = LOCALE_DIRECTORIES.get(locale)
        if not directory:
            return kodi_fallback(message_id)
        with self._lock:
            catalog = self._catalogs.get(locale)
            if catalog is None:
                path = self.addon_root / "resources" / "language" / directory / "strings.po"
                catalog = load_po_catalog(path)
                self._catalogs[locale] = catalog
        return catalog.get(message_id, kodi_fallback(message_id))


def load_po_catalog(path: str | Path) -> dict[int, str]:
    result: dict[int, str] = {}
    context: int | None = None
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if line.startswith('msgctxt "#') and line.endswith('"'):
            try:
                context = int(line[10:-1])
            except ValueError:
                context = None
        elif context is not None and line.startswith("msgstr "):
            try:
                translated = json.loads(line[7:])
            except json.JSONDecodeError:
                context = None
                continue
            if translated:
                result[context] = translated
            context = None
    return result
