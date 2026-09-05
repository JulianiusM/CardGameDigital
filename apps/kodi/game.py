#!/usr/bin/env python3
"""Kodi Games entry point backed by the same native WindowXMLDialog runtime."""

from __future__ import annotations

import os
import sys

import xbmcplugin


ADDON_ROOT = os.path.dirname(os.path.abspath(__file__))
RESOURCES_ROOT = os.path.join(ADDON_ROOT, "resources")
if RESOURCES_ROOT not in sys.path:
    sys.path.insert(0, RESOURCES_ROOT)

from lib.kodi_runtime import run  # noqa: E402


if __name__ == "__main__":
    # Finish the plugin directory transaction before opening the native window.
    # This prevents Kodi from treating the Python add-on as a RetroPlayer ROM.
    xbmcplugin.endOfDirectory(
        int(sys.argv[1]),
        succeeded=True,
        updateListing=False,
        cacheToDisc=False,
    )
    run()
