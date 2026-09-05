#!/usr/bin/env python3
"""Kodi entry point. Runtime imports stay out of CPython-only unit tests."""

from __future__ import annotations

import os
import sys


ADDON_ROOT = os.path.dirname(os.path.abspath(__file__))
RESOURCES_ROOT = os.path.join(ADDON_ROOT, "resources")
if RESOURCES_ROOT not in sys.path:
    sys.path.insert(0, RESOURCES_ROOT)

from lib.kodi_runtime import run  # noqa: E402


if __name__ == "__main__":
    run()

