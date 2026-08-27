# ADR-005: Persistent realtime Rooms on the existing HTTP server

## Status

Implemented. Protocol v1 was later retired when Room settings ownership changed;
protocol v2 is the current transport contract.

## Decision

- Temporary Rooms, participants, game Sessions, and committed card appearances are persisted with TypeORM migrations.
- A Room code identifies a Room but does not authorize it. Joining creates an independent participant credential; only its SHA-256 hash is stored, while the raw high-entropy credential is returned once.
- `ws` attaches to the same Node HTTP server as Express at `/ws`. A socket accepts only
  `client.hello` until its Room and participant credential are verified. Role and
  capabilities come from persisted participant state; the client role field is not
  authoritative.
- Version 2 envelopes and commands are validated with Zod at the WebSocket boundary.
  Reconnect and explicit resynchronization return a complete authoritative Room
  snapshot. The retired v1 contract remains only as historical documentation.
- `RoomService` serializes commands per Room. It restores a proposed `GameSession`, validates and transitions it, commits the runtime and card appearances transactionally, then publishes the new runtime for broadcast. Failed persistence never becomes visible to clients.
- The persisted runtime has an explicit serialization version. Domain `Set` and `Map` values are converted to arrays rather than relying on implicit JSON behavior.
- A Room stores an explicit nullable `currentSessionId`. Ended Session rows and
  their appearances remain durable history. The Host's revisioned
  `command.resetSession` clears only that pointer after the current Session is
  ended, retaining RoomParticipant identities, reconnect credentials, sockets,
  boundaries, and Room settings. A subsequent start inserts a new Session row.
- Room bootstrap provenance and participant activation/reconnect/terminal timestamps are
  persistent authoritative state. Scheduled cleanup and restart recovery call the same
  serialized lifecycle transition as live sockets.
- Display-bootstrap create retries use an installation/principal/route/key uniqueness
  record in the Room transaction. Only HMAC digests are indexed; the original response
  credential is protected with authenticated encryption and erased to a tombstone when
  its creator identity becomes terminal.

## Consequences

- Different Rooms can progress independently, while stale same-Room commands receive `STALE_SESSION_REVISION`.
- HTTP remains responsible for Room creation and joining; WebSockets carry active state and commands.
- HTTP joining never reserves Host. WebSocket activation may commit an initial or
  replacement promotion through the centralized Host-selection decision.
- Room role capabilities are independent from the retained Blueprint entity-permission subsystem.
- Phase 6 can add private/role-specific projections without forking the Session engine or transport.
- Duplicate `command.endSession` requests against an already-ended current
  Session are idempotent and return the authoritative ended snapshot.
