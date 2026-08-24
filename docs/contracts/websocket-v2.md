# WebSocket protocol v2 contract

## Connection and identity

Connect to `/ws`. Every strict envelope contains `protocol: 2`, `type`, `requestId`,
`revision`, and `payload`. The first message is `client.hello` with
`supportedProtocolVersions: [2]`, Room code, and the participant reconnect credential.
The server authenticates the credential and ignores claimed role/capability authority.
It returns `server.hello` with the authoritative participant ID and role, followed by a
viewer-specific `room.snapshot` and presence.

Messages are JSON text, processed sequentially per socket, and limited to 64 KiB.
Binary messages are rejected and WebSocket compression is disabled. These transport
limits are independent from the participant-stable command and pairing rate limits.

Participant credentials are bearer secrets. They are never valid in URLs or QR codes.
A reload reconnects the same RoomParticipant; it does not create another participant.

After authentication, browser clients send `client.ping` with an empty payload and
`revision:null` while the connection is otherwise idle. The server answers
`server.pong` with `{serverTime}`. Missing application heartbeat responses cause the
client to enter reconnecting state without waiting for user input. The server also uses
WebSocket ping/pong control frames to terminate half-open transports and start the normal
participant disconnect grace period.

## Commands

| Type                         | Revision        | Payload/meaning                                                                             |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| `room.snapshot.request`      | current or null | `{}`                                                                                        |
| `command.updateRoomSettings` | `null`          | `{expectedRevision,settings}`; Host-only, pre-session optimistic update.                    |
| `command.startSession`       | `null`          | `{}`; Host-only. Uses persisted authoritative Room settings.                                |
| `command.startTurn`          | current         | `{}`                                                                                        |
| `command.chooseCardType`     | current         | `{cardType:"QUESTION" or "DARE"}`                                                           |
| `command.skipCard`           | current         | `{}`                                                                                        |
| `command.vetoCard`           | current         | `{}`                                                                                        |
| `command.advanceSession`     | current         | `{}`                                                                                        |
| `command.submitVote`         | current         | `{vote:"YES" or "NO",playerId?}` for a player controlled by this participant.               |
| `command.setBoundaries`      | `null`          | Private category, DareType, and operational-flag exclusions; pre-session only.              |
| `command.setDevicePlayers`   | `null`          | `{names:[...]}`; pre-session only.                                                          |
| `command.transferHost`       | current or null | `{participantId}`; current Host only.                                                       |
| `command.endSession`         | current         | `{}`; Host only.                                                                            |
| `command.resetSession`       | current ended   | `{}`; Host only. Clears the current Session pointer while retaining the Room.               |
| `command.closeRoom`          | current or null | `{}`; Host only. Ends active play, invalidates all membership, and closes all Room sockets. |
| `command.leaveRoom`          | current or null | `{}`; authoritative leave and reconnect-credential invalidation.                            |

Room settings use the canonical engine configuration: mode, profile ID, optional Group,
adult confirmation, card locale, enabled Question Categories, enabled DareTypes, blocked
operational flags, intensity progression, random question ratio, maximum type streak, and
Let's Talk meta interval. Room snapshots expose versioned public settings to every
participant. They never expose private participant boundaries.

Intensity settings include public 1–5 `startingIntensity` and `maximumIntensity`, plus
`intensityProgressionUnit` (`ROUNDS` or `CARDS`) and a positive
`intensityProgressionInterval`. `intensityProgressionIncrement` accepts half-steps from
0.5 through 4 internal score points. The Session increases its score ceiling by that
increment after each interval and caps at the end. Omitted progression fields default to
Card-based pacing every two Cards with an increment of 1, so the addition is
backward-compatible within protocol v2; snapshots always include them.
`currentCard.intensity` is the derived global display band rather than the producer's
relative per-taxonomy position.

Settings include `neverHaveIEverRevealMode` with values `ANONYMOUS_AGGREGATE` and
`NAMED_ANSWERS`; omission defaults to anonymous. The Host may change it only before
Session start. An active Never Have I Ever projection exposes:

```text
neverHaveIEverVoting
  revealMode
  progress[] = {playerId,displayName,status:PENDING|VOTED}
  result = null | {yes,no,total,namedAnswers?}
```

The voter set is frozen when the Card enters answer collection, so a late joiner is not
required for that Card. While collection is active, no viewer—including Host and
DISPLAY—receives an answer value. After completion, anonymous mode exposes counts only;
named mode additionally exposes ordered `{playerId,displayName,vote}` entries.

An active Session projection includes `startedAt`, expressed as Unix epoch milliseconds.
It is the authoritative start instant persisted with the Session; clients derive elapsed
play time from it instead of starting a local timer when they first observe the Session.

## Synchronization and lifecycle

Every successful Room command commits before the server broadcasts viewer-specific
snapshots. Settings use their own optimistic `expectedRevision`; game commands use the
Session revision. Stable failures include `STALE_SESSION_REVISION`, `NOT_AUTHORIZED`,
`INVALID_GAME_STATE`, `ROOM_FULL`, `CARD_LOCALE_UNAVAILABLE`, and `CARD_POOL_EXHAUSTED`.

Socket loss changes the participant to `TEMPORARILY_DISCONNECTED`. Reauthentication
during the grace period restores `CONNECTED` and preserves role. After expiry the
participant becomes `LEFT`; a disconnected Host may then be reassigned to an eligible
connected Player. Explicit Host transfer updates server authorization immediately and
broadcasts `room.roleChanged` plus fresh snapshots.

A PLAYER participant that authenticates while a Session is active is added once to the
authoritative Session roster, together with any people represented by that device. A
reconnect never duplicates an existing Session player, and DISPLAY participants are not
game players. The committed Session revision and fresh snapshots make the expanded roster
visible to every client.

Server messages are `server.hello`, `server.pong`, `room.snapshot`, `room.presence`,
`room.roleChanged`, `room.participantLeft`, `session.cardReplaced`, and `error`.
`room.participantLeft` contains `{participantId,displayName,reason}` where `reason` is
`LEFT` or `DISCONNECT_EXPIRED`; it is sent to remaining connected Room devices after
the leave/removal commits. `session.cardReplaced` contains `{reason}` where `reason` is
`SKIPPED` or `VETOED`; it precedes the fresh snapshot so clients can explain and animate
the authoritative Card transition. Neither event grants authority or replaces the
snapshot. Error `code` is stable; localized `message` is not a programmatic contract.
Clients must ignore additive response fields.

## Compatibility impact

Protocol v2 replaces v1 because Session start no longer accepts client-authoritative
settings. A v1 client is rejected with `PROTOCOL_VERSION_UNSUPPORTED` and must upgrade.
