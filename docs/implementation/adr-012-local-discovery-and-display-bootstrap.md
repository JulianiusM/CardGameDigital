# ADR-012: Local installation discovery and display-bootstrap Rooms

## Status

Accepted and implemented.

## Decision

- A running game-server installation owns one persisted UUID. It is stable across
  restart and network changes, appears in additive `/api/v1/server-info` data, and never
  appears in multicast records.
- Local deployments publish `_partycard._tcp.local` through a compliant DNS-SD/mDNS
  responder after listener and database readiness. The fixed TXT-v1 profile contains
  only protocol, TLS, relative-path, and capability hints. Public deployment discovery
  is opt-in, interface-scoped, and warning-emitting.
- `POST /api/v1/rooms` accepts `CREATOR_HOST` or
  `DISPLAY_WAITING_FOR_HOST`. Display bootstrap creates one DISPLAY, zero Hosts, and
  requires UUIDv4 idempotency. Room creation, the replay record, settings, and credential
  hash commit together; replay ciphertext uses installation-scoped authenticated
  encryption.
- The first authenticated connected PLAYER in a hostless display-bootstrap Room is
  promoted transactionally by the shared `roomHostSelection.ts` decision. Displays are
  categorically ineligible. Lifecycle timestamps, reconnect grace, expiration,
  explicit close, reconciliation, and the one-Host persistence guard survive process
  restart. Recovery deterministically demotes excess Hosts if it encounters corrupt
  historical state.
- The wizard's **TV + phones** choice uses display bootstrap. Main-menu **Display only**
  keeps joining an existing Room.

## Consequences

- Discovery provides convenient location and deduplication, never server authenticity
  or weaker authorization.
- A lost create response can be retried without duplicating the Room or replacing its
  credential. Once that credential is terminal, the encrypted response is erased and a
  bounded tombstone returns `IDEMPOTENCY_RESULT_GONE`.
- Existing callers that omit `bootstrapMode` keep ordinary creator-Host behavior.
  Its snapshot and role-change fields were additive in WebSocket protocol v2. Mandatory
  late-join enrollment later introduced [protocol v3](../contracts/websocket-v3.md).
  Discovery advertises the current protocol from shared/generated definitions.
- Operators must retain the database and replay secret together. Installation identity
  reset is an explicit offline operation and refuses unsafe live-state rotation unless
  runtime invalidation is requested. Retained rows identify both derived purpose keys,
  so lookup-secret and replay-key mismatches fail closed at startup.
- Committed Room transitions feed fixed-label counters, hostless-duration observations,
  and redacted structured lifecycle events through an infrastructure observer.
