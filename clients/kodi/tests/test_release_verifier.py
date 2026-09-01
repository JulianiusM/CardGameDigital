from __future__ import annotations

import shutil
import subprocess
import unittest
import uuid
import zipfile
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
CLIENT_ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS_ROOT = REPOSITORY_ROOT / "artifacts"
ADDON_ID = "script.partycard.tv"


class ReleaseVerifierTests(unittest.TestCase):
    def _verify(
        self,
        manifest: str,
        include_game_entry: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        npm = shutil.which("npm")
        if npm is None:
            self.fail("npm is required to exercise the Kodi release verifier")
        ARTIFACTS_ROOT.mkdir(parents=True, exist_ok=True)
        archive = ARTIFACTS_ROOT / f"kodi-verifier-test-{uuid.uuid4().hex}.zip"
        try:
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
                bundle.writestr(f"{ADDON_ID}/addon.xml", manifest)
                bundle.writestr(f"{ADDON_ID}/addon.py", "pass\n")
                if include_game_entry:
                    bundle.writestr(f"{ADDON_ID}/game.py", "pass\n")
            return subprocess.run(
                [npm, "run", "kodi:package:verify", "--", str(archive)],
                cwd=REPOSITORY_ROOT,
                check=False,
                capture_output=True,
                text=True,
            )
        finally:
            archive.unlink(missing_ok=True)

    def test_accepts_the_production_dual_entry_manifest(self) -> None:
        manifest = (CLIENT_ROOT / "addon.xml").read_text(encoding="utf-8")

        result = self._verify(manifest)

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_rejects_an_unexpected_third_runtime_extension(self) -> None:
        manifest = (CLIENT_ROOT / "addon.xml").read_text(encoding="utf-8")
        folder_extension = """
    <extension point="xbmc.python.pluginsource" library="addon.py">
        <provides>game</provides>
    </extension>
"""
        invalid_manifest = manifest.replace(
            '    <extension point="xbmc.addon.metadata">',
            folder_extension + '    <extension point="xbmc.addon.metadata">',
        )

        result = self._verify(invalid_manifest)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "exactly the Game plugin and script",
            result.stdout + result.stderr,
        )

    def test_rejects_an_archive_missing_the_game_plugin_entry_point(self) -> None:
        manifest = (CLIENT_ROOT / "addon.xml").read_text(encoding="utf-8")

        result = self._verify(manifest, include_game_entry=False)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "missing its manifest, Game plugin, or script entry point",
            result.stdout + result.stderr,
        )


if __name__ == "__main__":
    unittest.main()
