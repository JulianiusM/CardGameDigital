from __future__ import annotations

import unittest

from support import RESOURCES_ROOT
from lib.discovery.registry import merge_records
from lib.state import ServerRecord


def server(origin: str, source: str, last_seen: float) -> ServerRecord:
    return ServerRecord(
        server_id="server-1",
        origin=origin,
        display_name="Party Game",
        deployment_mode="LOCAL",
        source=source,
        last_seen=last_seen,
    )


class ServerRegistryTests(unittest.TestCase):
    def test_lower_priority_mdns_address_cannot_replace_same_machine_origin(self) -> None:
        records = merge_records(
            (
                server("http://127.0.0.1:3000", "same-machine", 10),
                server("http://[fe80::1234]:3000", "mdns", 20),
            )
        )

        self.assertEqual(records[0].origin, "http://127.0.0.1:3000")
        self.assertEqual(records[0].source, "same-machine")

    def test_newer_record_replaces_an_older_record_at_the_same_priority(self) -> None:
        records = merge_records(
            (
                server("http://192.168.1.20:3000", "mdns", 10),
                server("http://192.168.1.21:3000", "mdns", 20),
            )
        )

        self.assertEqual(records[0].origin, "http://192.168.1.21:3000")


if __name__ == "__main__":
    unittest.main()
