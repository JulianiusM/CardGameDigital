# WebSocket protocol v3 contract

> Retired by [WebSocket v4](websocket-v4.md). This document records the earlier
> enrollment protocol, including its interim capacity correction. Old native v3
> receivers do not provide the capacity guarantee required by the current server.

## Connection and identity

Connect to `/ws`. Every strict envelope contains `protocol: 3`, `type`, `requestId`,
`revision`, and `payload`. The first message is `client.hello` with
`supportedProtocolVersions: [3]`, Room code, and the participant reconnect credential.
The server authenticates the credential and ignores claimed role/capability authority.
It returns `server.hello` with the authoritative participant ID and role, followed by a
viewer-specific `room.snapshot` and presence.

For a `DISPLAY_WAITING_FOR_HOST` Room, no Host exists at HTTP creation time. The first
credential-authenticated `PLAYER` whose activation commits while the Room is hostless is
atomically promoted before `server.hello`; that message therefore already reports
`HOST`. The server then sends that socket `room.roleChanged` with
`{previousRole:"PLAYER",role:"HOST",reason:"INITIAL_HOST_ASSIGNED"}`, followed by the
fresh snapshot and presence. Concurrent activations serialize through the same Room
lifecycle decision, so at most one wins. A `DISPLAY` is never eligible. Reconnecting the
same participant preserves its persisted role.

Messages are JSON text, processed sequentially per socket, and limited to 4 MiB.
Binary messages are rejected and WebSocket compression is disabled. These transport
limits are independent from the participant-stable command and pairing rate limits.
The command/pairing rate limits and required configured Origin apply under enforced
public runtime security; the explicit public development policy disables them for
administrator testing on a trusted network.

Participant credentials are bearer secrets. They are never valid in URLs or QR codes.
A reload reconnects the same RoomParticipant; it does not create another participant.
If the same credential authenticates from a second socket, the new authenticated socket
replaces the old one and the old transport closes with code `4002`; it does not create a
second presence or trigger Host fallback.

After authentication, browser clients send `client.ping` with an empty payload and
`revision:null` while the connection is otherwise idle. The server answers
`server.pong` with `{serverTime}`. Missing application heartbeat responses cause the
client to enter reconnecting state without waiting for user input. The server also uses
WebSocket ping/pong control frames to terminate half-open transports and start the normal
participant disconnect grace period.

## Commands

| Type                         | Revision        | Payload/meaning                                                                                   |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| `room.snapshot.request`      | current or null | `{}`                                                                                              |
| `command.updateRoomSettings` | `null`          | `{expectedRevision,settings}`; Host-only, pre-session optimistic update.                          |
| `command.startSession`       | `null`          | `{}`; Host-only. Uses persisted authoritative Room settings.                                      |
| `command.startTurn`          | current         | `{}`                                                                                              |
| `command.chooseCardType`     | current         | `{cardType:"QUESTION" or "DARE"}`                                                                 |
| `command.skipCard`           | current         | `{}`                                                                                              |
| `command.vetoCard`           | current         | `{}`                                                                                              |
| `command.advanceSession`     | current         | `{}`                                                                                              |
| `command.submitVote`         | current         | `{vote:"YES" or "NO",playerId?}` for a player controlled by this participant.                     |
| `command.setBoundaries`      | `null`          | Private exclusions in the lobby or first-time enrollment while outside the active Session roster. |
| `command.setDevicePlayers`   | `null`          | `{names:[...]}`; pre-session only.                                                                |
| `command.transferHost`       | current or null | `{participantId}`; current Host only.                                                             |
| `command.endSession`         | current         | `{}`; Host only.                                                                                  |
| `command.resetSession`       | current ended   | `{}`; Host only. Clears the current Session pointer while retaining the Room.                     |
| `command.closeRoom`          | current or null | `{}`; Host only. Ends active play, invalidates all membership, and closes all Room sockets.       |
| `command.leaveRoom`          | current or null | `{}`; authoritative leave and reconnect-credential invalidation.                                  |

Room settings use the canonical engine configuration: mode, profile ID, optional Group,
adult confirmation, card locale, explicit ordered Card fallback policy, enabled Question
Categories, enabled DareTypes, blocked operational flags, an explicit maximum social
sensitivity, intensity progression, random question ratio, maximum type streak, Let's
Talk meta interval, and sparse Session Card policy. Room snapshots expose versioned
public settings to every participant. They never
expose private participant boundaries.
Each snapshot also contains authoritative
`capacity:{maximumParticipants,maximumPlayers}`. Clients may display the represented
player count against `maximumPlayers`, but the repository transaction remains the
enforcement boundary for joins and device-player changes.
Every snapshot also contains `bootstrapMode` (`CREATOR_HOST` or
`DISPLAY_WAITING_FOR_HOST`) and the derived `hostStatus`:

```text
{state,participantId,displayName,deadline}
state = AWAITING_FIRST_HOST | CONNECTING | CONNECTED | RECONNECTING |
        AWAITING_REPLACEMENT_HOST
```

The participant fields and deadline are nullable. `AWAITING_FIRST_HOST` is distinct
from replacement after a Room has previously had a Host. Clients render this projection
but never infer authority from it.

Intensity settings include public 1–5 `startingIntensity` and `maximumIntensity`, plus
`intensityProgressionUnit` (`ROUNDS` or `CARDS`) and a positive
`intensityProgressionInterval`. `intensityProgressionIncrement` accepts half-steps from
0.5 through 4 internal score points. The Session increases its score ceiling by that
increment after each interval and caps at the end. Omitted progression fields default to
Card-based pacing every two Cards with an increment of 1, so the addition is
backward-compatible within protocol v3; snapshots always include them.
`configuration.maximumSocialSensitivity` is the ordinary SocialSensitivity ceiling and
uses `GENERAL`, `PERSONAL`, `CLOSE_PERSONAL`, `DEEP_PERSONAL`, `INTIMATE`, or `EXPLICIT`.
It is independent from intensity and taxonomy. The selected profile and Card policies
carry any separate taxonomy or operational restrictions. Omission defaults to
`EXPLICIT`, which preserves the pre-field behavior; snapshots always include the
resolved value.
The additive `currentCard.cardIntensity` is the Card's relative 1–5 position within its
Question Category or DareType. The existing `currentCard.intensity` remains the derived
global 1–5 display band. Clients should use `cardIntensity` to tune category/type-specific
visual families and may present both values to players.

`cardFallbackEnabled` and `cardFallbackLocales` are additive protocol-v3 settings and
default to `false` and `[]` when omitted. Enabling fallback requires a non-empty unique
order of active Card locales excluding the primary locale. The server, not the client,
validates the locales and applies that order.

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

Every outward voting field follows that same reveal decision. The retained `voteResult`
field is `{yes:0,no:0,total:0}` before reveal and after advance/end; at reveal it mirrors
only the canonical result's counts. It never contains named answers. This is a privacy
correction within protocol v3: field names/types and the documented privacy semantics
are unchanged. Existing web and Kodi decoders remain compatible.

An active Session projection includes `startedAt`, expressed as Unix epoch milliseconds.
It is the authoritative start instant persisted with the Session; clients derive elapsed
play time from it instead of starting a local timer when they first observe the Session.
Its `availableActions` projection includes `START_SESSION` for the Host alongside the
currently applicable turn, vote, skip, veto, advance, and end capabilities; this is
display guidance only and never replaces server authorization.

## Synchronization and lifecycle

Skip and veto always commit refusal when a Card is shown or answers are being collected.
If a replacement of the same type is unavailable, the current Card, votes and voter IDs
are cleared, the appearance remains seen and skipped/vetoed, and the revision advances.
Classic returns to `CHOOSING_CARD_TYPE`; other modes return to `WAITING_FOR_PLAYER`.
No turn is consumed and no filter is relaxed. Clients offer another type/next draw when
available, or end the game when `remainingCardCount` is zero. Only successful replacement
draws emit `session.cardReplaced`; clearing a refused Card broadcasts snapshots directly.

Adult confirmation is evaluated from effective settings and captured policy before
Session start, as defined in [ADR-007](../implementation/adr-007-profiles-and-private-boundaries.md).
The eligibility preview reports the same requirement without using private boundaries.

Every successful Room command commits before the server broadcasts viewer-specific
snapshots. Settings use their own optimistic `expectedRevision`; game commands use the
Session revision. Stable failures include `STALE_SESSION_REVISION`, `NOT_AUTHORIZED`,
`INVALID_GAME_STATE`, `ROOM_FULL`, `CARD_LOCALE_UNAVAILABLE`, and `CARD_POOL_EXHAUSTED`.

Socket loss changes the participant to `TEMPORARILY_DISCONNECTED`. Reauthentication
during the configured grace period (180 seconds by default; never below 120) restores
`CONNECTED` and preserves role. Browser clients continue automatic retries long enough
to bridge an ordinary one-to-two-minute outage. After expiry the
participant becomes `LEFT`; a disconnected Host may then be reassigned to an eligible
connected Player. Explicit Host transfer updates server authorization immediately and
broadcasts `room.roleChanged` plus fresh snapshots.

New Rooms and newly joined participants begin unactivated. The first successful
WebSocket authentication records `firstConnectedAt` and activates the Room regardless
of role. A Room that never authenticates closes after the configured initial activation
lease (300 seconds by default). An HTTP-only participant expires after its separate
unactivated-participant TTL and receives no reconnect grace. Every activation,
disconnect, leave, transfer, expiry, and scheduled/restart reconciliation uses the same
central Host-selection decision and persisted lifecycle transaction.

If no active Host or Player remains after an explicit leave or all reconnect grace
periods expire, the server closes the Room unless a DISPLAY connection is currently
`CONNECTED`. A connected display keeps the join code live for new Players but never
receives host authority. The first eligible Player to connect is promoted. Once that
display also disconnects and exhausts grace, the abandoned Room closes. Transient
disconnects inside the grace period never trigger cleanup. Durable DataSpace Session
history is retained; only the live Room becomes unavailable.

Private boundary values belong only to active recovery and a continuing Room lobby.
Ending a Session scrubs its runtime copy, including historical rows retained after
`command.resetSession`. The still-open Room retains each eligible participant's separate
boundary row for its next game. Leave, credential invalidation, activation/reconnect
expiry, and Room closure/expiry remove the participant's row and all represented-player
runtime copies. Temporary disconnect/restart within grace retains them. See the
[database retention contract](./infrastructure.md#private-boundary-retention-and-backups).

A PLAYER participant that authenticates while a Session is active remains outside the
authoritative Session roster until `command.setBoundaries` accepts their private choices
(empty arrays explicitly mean no exclusions). Enrollment commits the participant's
boundary row, roster entries and runtime restrictions in one optimistic transaction.
Clients detect their own pending enrollment by their participant ID being absent from
`session.players`; they offer the private choices before gameplay. Existing Session
players cannot edit these frozen choices, even if `boundaryConfigured` is false. A
reconnect never duplicates an existing Session player, and DISPLAY participants are not
game players. The committed Session revision and fresh snapshots make the expanded roster
visible to every client.

Server messages are `server.hello`, `server.pong`, `room.snapshot`, `room.presence`,
`room.roleChanged`, `room.participantLeft`, `session.cardReplaced`, and `error`.
`room.roleChanged` contains `{role,previousRole,reason}`. Reason is one of
`INITIAL_HOST_ASSIGNED`, `HOST_TRANSFERRED`, `HOST_LEFT`,
`HOST_DISCONNECT_EXPIRED`, `HOST_REVOKED`, or `HOST_ACTIVATION_EXPIRED`.
`room.participantLeft` contains `{participantId,displayName,reason}` where `reason` is
`LEFT` or `DISCONNECT_EXPIRED`; it is sent to remaining connected Room devices after
the leave/removal commits. In turn-based modes, if the leaving participant controlled
the active player and a Card was already shown, the following snapshot clears that Card,
selects the next active player, and returns to the mode's pre-draw state. A shown Card is
never silently transferred to another player. `session.cardReplaced` contains `{reason}` where `reason` is
`SKIPPED` or `VETOED`; it precedes the fresh snapshot so clients can explain and animate
the authoritative Card transition. Neither event grants authority or replaces the
snapshot. Error `code` is stable; localized `message` is not a programmatic contract.
Clients must ignore additive response fields.

The Session projection includes additive `remainingCardCount`, the number of distinct
Cards that the authoritative engine can still draw for the current Session state after
profile, boundaries, progression, policy, Session history, and Group history are
applied. It is projected by the server and is never accepted from a client.

## Compatibility impact

Protocol v3 replaces v2 because joining active play now requires private enrollment.
The `command.setBoundaries` payload is unchanged, but first-time late joiners must send it
before becoming Session players. Web and Kodi ship updated negotiation together. Clients
supporting only v1/v2 receive `PROTOCOL_VERSION_UNSUPPORTED` and must upgrade. There is
no legacy auto-enrollment path. This v3 transport change is independent of the persistence runtime version.
The `currentCard.cardIntensity` response field is additive within v3; existing clients
continue to receive the unchanged global meaning of `currentCard.intensity`.
The defaulted `settings.cardPolicy` is additive within v3. Catalogs and captured
persistent policy inputs are never sent as Session data. Clients that omit them inherit the DataSpace, Group, Catalog,
and built-in profile behavior selected by the server.
The defaulted `configuration.maximumSocialSensitivity` field is likewise additive;
older clients that omit it retain the former unrestricted (`EXPLICIT`) ceiling.
`session.remainingCardCount` is an additive display-only field within v3.
`bootstrapMode`, `hostStatus`, and the expanded `room.roleChanged` payload are additive
within v3. Role authority was already server-owned; clients must use `server.hello` and
the latest snapshot instead of assuming that every Room creator is Host.

### Capacity correction (2026-09-06)

Server, web and generated Kodi definitions use a 4 MiB message allowance. The JSON
message shapes and protocol version remain v3. Install matching current clients to use
the expanded allowance; older native v3 builds may reject messages above their former
64 KiB limit. Input queues and send buffers are bounded as specified in the
[infrastructure contract](infrastructure.md). Slow/overloaded connections close with
1013, and oversized outgoing messages close with 1009. `SESSION_CAPACITY_EXCEEDED`
reports temporary work admission pressure.

Room broadcasts share one count/rendering projection. Shared voting-progress broadcasts
coalesce over 50 ms. The submitting voter receives a request-correlated authoritative
snapshot immediately, unless already superseded by a newer delivered snapshot.
No client performs Card selection or cooldown scheduling.

A snapshot whose Session revision (within the same Session) or settings revision is
older than one already sent to that socket is superseded and omitted, including a
request-correlated snapshot. Clients already have the newer state. This keeps delayed
broadcasts from undoing a newer direct reply without retaining per-viewer payload copies.
