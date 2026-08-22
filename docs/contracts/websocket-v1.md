# WebSocket protocol v1 contract

## Connection and security

Connect to `ws://host/ws` or `wss://host/ws`. Public deployments require an allowed
`Origin`. A client has five seconds to authenticate and may send at most 30 commands
per ten-second window. The participant credential is a bearer secret obtained from the
Room HTTP API; it must be sent only inside the initial WebSocket message.

Every message is a strict envelope:

```json
{
    "protocol": 1,
    "type": "client.hello",
    "requestId": "client-generated-correlation-id",
    "revision": null,
    "payload": {}
}
```

Unknown top-level fields are rejected. `requestId` correlates replies; it does not imply
idempotency. `revision` provides optimistic concurrency for game commands.

## Handshake

The first message must be `client.hello`:

```json
{
    "protocol": 1,
    "type": "client.hello",
    "requestId": "hello-1",
    "revision": null,
    "payload": {
        "supportedProtocolVersions": [1],
        "applicationVersion": "0.2.3",
        "role": "PLAYER",
        "capabilities": ["JOIN_ROOM", "DISPLAY_SESSION", "SUBMIT_VOTE"],
        "roomCode": "ABC234",
        "participantCredential": "secret-from-http-join"
    }
}
```

The server authenticates the credential rather than trusting the claimed role or
capabilities. It responds with `server.hello`, a viewer-specific `room.snapshot`, and
presence updates. Unsupported versions fail with `PROTOCOL_VERSION_UNSUPPORTED`.

## Client messages

| Type                       | Revision        | Payload/meaning                                                                                       |
| -------------------------- | --------------- | ----------------------------------------------------------------------------------------------------- |
| `room.snapshot.request`    | current or null | `{}`; request fresh viewer projection.                                                                |
| `command.startSession`     | `null`          | Mode, profile/group, adult confirmation, intensity, ratios, interval, BCP 47 `cardLocale`. Host only. |
| `command.startTurn`        | current         | `{}`                                                                                                  |
| `command.chooseCardType`   | current         | `{cardType:"QUESTION"                                                                                 | "DARE"}`                                               |
| `command.skipCard`         | current         | `{}`                                                                                                  |
| `command.vetoCard`         | current         | `{}`                                                                                                  |
| `command.advanceSession`   | current         | `{}`                                                                                                  |
| `command.submitVote`       | current         | `{vote:"YES"                                                                                          | "NO",playerId?}`; player must be controlled by device. |
| `command.setBoundaries`    | `null`          | Arrays of stable category, dare-type, and operational-flag codes. Pre-game only.                      |
| `command.setDevicePlayers` | `null`          | `{names:[...]}`; pre-game only.                                                                       |
| `command.transferHost`     | current or null | `{participantId}`; current host only.                                                                 |
| `command.endSession`       | current         | `{}`; host only.                                                                                      |
| `command.leaveRoom`        | current or null | `{}`; intentionally leave and clear reconnect eligibility.                                            |

The authoritative service serializes commands per Room. A stale revision returns
`STALE_SESSION_REVISION`; clients should discard speculative state, request/use the
latest snapshot, then ask the player to retry when appropriate.

## Server messages

- `server.hello`: negotiated version, authoritative participant ID and role.
- `room.snapshot`: viewer-specific Room/session state and available actions. Private
  boundary values are never included.
- `room.presence`: currently connected participant identities and roles.
- `room.roleChanged`: authoritative role after transfer or fallback promotion.
- `error`: `{code,message}`; `code` is stable, `message` is localized.

The server may add payload fields in protocol v1. Clients must ignore unknown response
fields. It will not add required client fields or change existing meanings without a
new protocol version.

## Host disconnect behavior

A disconnected host has a reconnect grace period (15 seconds by default). Reconnecting
with the same credential cancels reassignment. After the grace period, the oldest
connected eligible player device becomes host. If nobody is connected, reassignment
occurs when an eligible player reconnects. Explicit `command.transferHost` does not
wait for this timer.

Participant snapshots include `connectionStatus`. A closed socket first becomes
`TEMPORARILY_DISCONNECTED`; reconnecting with the same credential restores `CONNECTED`.
After grace expiry the participant becomes `LEFT`, is removed from active projections,
and the credential is no longer accepted.

## Close/error behavior

Application close codes currently include `4401` (handshake timeout) and `4403`
(disallowed origin). Command errors normally use an `error` envelope without closing
the connection. Clients should reconnect with bounded backoff, reuse their participant
credential, and wait for the fresh snapshot before enabling controls.
