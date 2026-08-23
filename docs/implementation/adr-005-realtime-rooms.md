# ADR-005: Persistent realtime Rooms on the existing HTTP server

## Status

Accepted for Phase 5.

## Decision

- Temporary Rooms, participants, game Sessions, and committed card appearances are persisted with TypeORM migrations.
- A Room code identifies a Room but does not authorize it. Joining creates an independent participant credential; only its SHA-256 hash is stored, while the raw high-entropy credential is returned once.
- `ws` attaches to the same Node HTTP server as Express at `/ws`. A socket accepts only `client.hello` until its participant credential and declared role are verified.
- Version 1 envelopes and commands are validated with Zod at the WebSocket boundary. Reconnect and explicit resynchronization return a complete authoritative Room snapshot.
- `RoomService` serializes commands per Room. It restores a proposed `GameSession`, validates and transitions it, commits the runtime and card appearances transactionally, then publishes the new runtime for broadcast. Failed persistence never becomes visible to clients.
- The persisted runtime has an explicit serialization version. Domain `Set` and `Map` values are converted to arrays rather than relying on implicit JSON behavior.
- A Room stores an explicit nullable `currentSessionId`. Ended Session rows and
  their appearances remain durable history. The Host's revisioned
  `command.resetSession` clears only that pointer after the current Session is
  ended, retaining RoomParticipant identities, reconnect credentials, sockets,
  boundaries, and Room settings. A subsequent start inserts a new Session row.

## Consequences

- Different Rooms can progress independently, while stale same-Room commands receive `STALE_SESSION_REVISION`.
- HTTP remains responsible for Room creation and joining; WebSockets carry active state and commands.
- Room role capabilities are independent from the retained Blueprint entity-permission subsystem.
- Phase 6 can add private/role-specific projections without forking the Session engine or transport.
- Duplicate `command.endSession` requests against an already-ended current
  Session are idempotent and return the authoritative ended snapshot.
