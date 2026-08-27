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
- **Party screen:** the setup browser opens the Room as a DISPLAY and players join on
  phones. Displays receive the public card/session projection and no command actions.

Ordinary creation assigns the creator HOST. Display-bootstrap creation assigns the
creator DISPLAY and deliberately has no Host until the first authenticated PLAYER
WebSocket activation commits. The HTTP join contract still accepts only PLAYER or
DISPLAY and cannot reserve Host. Session settings and start/end authority remain Host
capabilities. Private boundary configuration is a separate per-player capability, not a
Room setting.

After an ended hosted Session, **New Game** reuses the Room. The Host clears the
Room's current-Session pointer and reopens its in-Room game settings; PLAYER and
DISPLAY participants remain attached and see the lobby until the next Session
starts. This transition never routes clients through join screens or replaces
participant credentials.

The Host may instead close the Room from Session settings or the end screen.
Closing first persists an authoritative end for active play, marks the Room
closed, marks every participant `LEFT`, and terminally closes all Room sockets.
Every client then clears its reconnect credential and returns to the canonical
main menu; a closed Room code cannot be joined or reclaimed.

A host can add device-local players to any Room topology. Their IDs are generated
by the server and are not RoomParticipant credentials. The host may act only for
itself and those local players; it cannot make private choices or votes for a
PLAYER represented by another authenticated device.

The same device-player mechanism applies to every PLAYER device, not just the
host. Participant records persist their server-generated device-player IDs so
reconnect, voting authority, boundaries, and host transfer do not require a
mode-specific or UI-only ownership rule.

When a PLAYER device joins during active play, Room authentication serializes an
idempotent Session-roster expansion with ordinary Room commands. The participant
and its device-local players become eligible from the next authoritative turn;
reconnecting an existing participant does not duplicate people or reset the
current card. DISPLAY devices remain presentation-only and never enter the roster.

Session start time is authoritative Session runtime state. It is persisted and
projected as an epoch-millisecond `startedAt` value so summaries remain correct
across reload, reconnect, process restart, and Room reuse. A browser observation
time is never treated as the beginning of play.

Hosting is a transferable Room responsibility. The current host can explicitly
promote a PLAYER device; persistence atomically demotes the old host so exactly
one HOST remains. If the host socket disappears, the adapter waits through a
reconnect grace period and promotes the oldest connected PLAYER. If nobody is connected
yet but another Player remains inside their own grace period, the Room remains orphaned
until that Player reconnects and is then promoted. A currently connected DISPLAY keeps
an otherwise player-empty Room and its code live so new Players can join; it never becomes
Host. The first eligible Player is promoted. When the final Host/Player and display are
no longer connected or reconnectable, the server closes the abandoned Room and ends
active runtime without deleting durable DataSpace history. Reconnect grace defaults to
180 seconds and is configurable with a minimum of 120 seconds.

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

Topology calculation in `roomParticipants.ts` builds Session players, expands device
boundaries, and calculates per-device control. Every initial assignment, explicit
transfer, leave, disconnect expiry, and recovery Host decision is centralized separately
in `roomHostSelection.ts`. Controllers, repositories, WebSockets, and Svelte components
do not implement their own election rules or branch on game mode.
