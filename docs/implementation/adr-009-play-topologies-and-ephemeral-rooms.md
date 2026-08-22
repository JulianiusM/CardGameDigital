# ADR-009: Play topologies and ephemeral Rooms

## Status

Accepted.

## Decision

The shared `GameSession` engine supports three presentation topologies rather
than three gameplay implementations:

- **Couch:** one browser owns setup, player rotation, choices, voting, skip, and
  advance controls. It has no Room, WebSocket, or companion-client dependency.
- **Personal:** one unique host opens a Room and each network participant uses a
  PLAYER client. Every client receives the authoritative card projection and
  only the participant allowed by the current state receives the corresponding
  controls.
- **Party screen:** the Personal topology gains one or more DISPLAY clients.
  Displays receive the public card/session projection and no command actions.

Only the Room creator can be HOST; the join contract accepts PLAYER or DISPLAY.
Session settings and start/end authority remain host capabilities. Private
boundary configuration is a separate per-player capability, not a Room setting.

A host can add device-local players to any Room topology. Their IDs are generated
by the server and are not RoomParticipant credentials. The host may act only for
itself and those local players; it cannot make private choices or votes for a
PLAYER represented by another authenticated device.

The same device-player mechanism applies to every PLAYER device, not just the
host. Participant records persist their server-generated device-player IDs so
reconnect, voting authority, boundaries, and host transfer do not require a
mode-specific or UI-only ownership rule.

Hosting is a transferable Room responsibility. The current host can explicitly
promote a PLAYER device; persistence atomically demotes the old host so exactly
one HOST remains. If the host socket disappears, the adapter waits through a
reconnect grace period and promotes the oldest connected PLAYER. If nobody is
connected yet, the Room remains orphaned until the next PLAYER reconnects and is
then promoted. The active `GameSession` is not restarted or modified.

Room creation explicitly chooses `EPHEMERAL` or `DATASPACE` persistence:

- `EPHEMERAL` is the default, works anonymously in public mode, and never links
  the Room, Session appearances, Groups, or settings to an account DataSpace.
- `DATASPACE` requires server-verified ownership. It enables saved defaults,
  explicit Group selection, and durable Group history.

Active ephemeral Room runtime is still transactionally stored for authoritative
reconnect and expires with the temporary Room. This is transport continuity,
not account or Group history persistence.

Local mode uses the same Room service. Room IDs, codes, command queues, runtime,
and participants are isolated per Room, allowing unrelated groups to play
concurrently through one LAN server.

Topology calculation is centralized in `roomParticipants.ts`: it builds Session
players, expands device boundaries, calculates per-device control, and selects a
fallback host. Controllers, WebSockets, and Svelte components do not duplicate
these rules or branch on game mode.
