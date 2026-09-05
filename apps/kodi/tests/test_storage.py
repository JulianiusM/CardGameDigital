from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from support import RESOURCES_ROOT
from lib.protocol.validation import PROTOCOL_VERSION
from lib.state import Preferences, RecoveryEnvelope, ServerRecord
from lib.storage import ProfileStore, SecretStore, StorageVersionError


class StorageTests(unittest.TestCase):
    def test_round_trips_versioned_profile_recovery_and_secret_reference(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            profile = ProfileStore(directory)
            secrets = SecretStore(directory)
            preferences = Preferences(locale="de-DE", display_name="Wohnzimmer")
            server = ServerRecord(
                "00000000-0000-4000-8000-000000000001",
                "http://192.168.1.20:3000",
                "Partybox",
                "local",
                "manual",
                1.0,
            )
            reference = secrets.put("x" * 43)
            recovery = RecoveryEnvelope(
                1,
                server.server_id,
                server.origin,
                "ROOM",
                10.0,
                11.0,
                room_code="ABC234",
                participant_id="00000000-0000-4000-8000-000000000002",
                credential_reference=reference,
                protocol_version=PROTOCOL_VERSION,
            )
            profile.save(preferences, (server,))
            profile.save_recovery(recovery)
            loaded = profile.load()
            self.assertEqual(loaded.preferences.display_name, "Wohnzimmer")
            self.assertEqual(loaded.servers[0].server_id, server.server_id)
            self.assertEqual(loaded.recovery, recovery)
            self.assertEqual(secrets.get(reference), "x" * 43)
            self.assertNotIn("x" * 20, (Path(directory) / "client.json").read_text("utf-8"))

    def test_unknown_newer_file_is_not_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "client.json"
            original = '{"schemaVersion":99,"future":true}\n'
            target.write_text(original, encoding="utf-8")
            with self.assertRaisesRegex(StorageVersionError, "newer"):
                ProfileStore(directory).load()
            self.assertEqual(target.read_text("utf-8"), original)

    def test_legacy_zero_shape_migrates_in_memory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "client.json"
            target.write_text(
                json.dumps({"settings": {"display_name": "TV"}, "servers": []}),
                encoding="utf-8",
            )
            self.assertEqual(ProfileStore(directory).load().preferences.display_name, "TV")

    def test_corrupt_non_secret_profile_is_quarantined_and_reset(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "client.json"
            target.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "servers": [
                            {
                                "server_id": "not-a-uuid",
                                "origin": "https://example.com/path?token=x",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            loaded = ProfileStore(directory).load()
            self.assertEqual(loaded.servers, ())
            self.assertFalse(target.exists())
            self.assertEqual(len(tuple(Path(directory).glob("client.json.corrupt-*"))), 1)

    def test_secret_store_fails_closed_for_tampered_unbounded_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "secrets.json"
            target.write_text(
                json.dumps({"schemaVersion": 1, "values": {"room": "x" * 20_000}}),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(StorageVersionError, "content is invalid"):
                SecretStore(directory).get("room")


if __name__ == "__main__":
    unittest.main()
