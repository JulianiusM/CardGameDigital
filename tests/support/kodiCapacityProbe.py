"""Exercise the actual native HTTP/WebSocket receivers against an integration server."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "kodi" / "resources"))

from lib.protocol.validation import MAX_MESSAGE_BYTES
from lib.transport.websocket import WebSocketConnection, envelope
from lib.protocol.validation import validate_couch_snapshot
from lib.transport.http import JsonHttpClient


def snapshot(connection, request_id):
    while True:
        message = connection.receive_json()
        if message["type"] == "error":
            raise AssertionError(message["payload"]["code"])
        if message["type"] == "room.snapshot" and (request_id is None or message["requestId"] == request_id):
            return message


def main():
    # Node writes UTF-8; the Windows console code page must not alter Unicode fixtures.
    configuration = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    origin = configuration["origin"]
    if "couch" in configuration:
        client = JsonHttpClient(origin)
        created = validate_couch_snapshot(client.request("POST", "/api/v1/couch/sessions", configuration["couch"]).body)
        endpoint = "/api/v1/couch/sessions/" + created["id"]
        recovered = validate_couch_snapshot(client.request("GET", endpoint).body)
        assert created == recovered
        encoded = json.dumps(recovered, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        policy = recovered["settings"]["cardPolicy"]
        print(json.dumps({"bytes": len(encoded), "players": len(recovered["players"]),
                          "rules": len(policy["conditionalRules"]), "exactCards": len(policy["exactCards"])}))
        client.request("POST", endpoint + "/end", {"revision": recovered["revision"]})
        return
    connection = WebSocketConnection(origin.replace("http:", "ws:") + "/ws", origin)
    try:
        connection.connect()
        from lib.protocol.validation import PROTOCOL_VERSION
        connection.send_json(envelope("client.hello", {
            "supportedProtocolVersions": [PROTOCOL_VERSION], "applicationVersion": "capacity-test",
            "role": "DISPLAY", "capabilities": [], "roomCode": configuration["roomCode"],
            "participantCredential": configuration["credential"],
        }))
        first = snapshot(connection, None)
        request = envelope("room.snapshot.request", {}, first["revision"])
        connection.send_json(request)
        recovered = snapshot(connection, request["requestId"])
        assert first["payload"] == recovered["payload"]
        data = recovered["payload"]
        session = data["session"]
        encoded = json.dumps(recovered, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        assert len(encoded) <= MAX_MESSAGE_BYTES
        result = session["neverHaveIEverVoting"]["result"]
        print(json.dumps({
            "bytes": len(encoded), "participants": len(data["participants"]),
            "players": len(session["players"]), "rules": len(data["settings"]["cardPolicy"]["conditionalRules"]),
            "exactCards": len(data["settings"]["cardPolicy"]["exactCards"]),
            "cardBytes": len(session["currentCard"]["cardText"].encode("utf-8")),
            "result": None if result is None else {"total": result["total"], "namedAnswers": len(result["namedAnswers"])},
        }))
    finally:
        connection.close()


if __name__ == "__main__":
    main()
