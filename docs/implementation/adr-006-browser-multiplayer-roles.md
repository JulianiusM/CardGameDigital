# ADR-006: One Svelte client for Party Screen and Personal Mode

## Status

Accepted for Phase 6.

## Decision

- The Svelte application provides canonical `/play/room` and `/play/couch`
  presentations rather than introducing topology-specific web bundles. The browser
  derives HOST, PLAYER, or DISPLAY presentation from its credential-authenticated Room
  snapshot. Historical `/play/host`, `/play/mobile`, and `/play/display` URLs redirect
  inside the client to `/play/room`.
- Room creation and joining remain HTTP operations. Active presence, commands, private controls, snapshots, and reconnect use the Phase 5 WebSocket connection.
- The server projects an authoritative snapshot separately for each participant. Only the active participant receives the Classic choice control and displays receive no command capabilities. Never-Have-I-Ever completion is public, but answer values are withheld during collection and broadcast only after completion when the Session's immutable reveal mode is `NAMED_ANSWERS`.
- A vote is attributed from the authenticated participant credential rather than a client-supplied player identifier. Private veto messages contain no participant identity in the public snapshot.
- Room credentials are retained only in `sessionStorage` to allow the same browser tab/session to reclaim its participant identity. They are not placed in join URLs.
- QR images are produced locally in the bundled browser application. The QR payload contains only the Room code join URL, never a participant credential.
- The setup wizard's **TV + phones** selection creates
  `DISPLAY_WAITING_FOR_HOST`, saves the DISPLAY credential in the same session-scoped
  store, and opens `/play/room` immediately. Its UUIDv4 create key and exact JSON body
  remain in `sessionStorage` until a response succeeds, so a lost response is retried
  without opening a second Room. The first joined player phone receives Host authority
  from `server.hello`.
- The main-menu **Display only** flow retains its separate meaning: join an existing
  code as DISPLAY. It never invokes Room creation.

## Consequences

- Party Screen and Personal Mode use the same Room, Session engine, protocol, and Svelte bundle.
- The shared display uses the same Card, participant-roster, settings, and voting-result
  components as active devices, projected into a bounded read-only public-stage layout.
  Variable rosters automatically page and wrap when they exceed the measured display
  region; fixed Card and result/progress context never depends on manual scrolling.
- Phase 7 can add private boundaries to the same participant-specific projection without changing the transport architecture.
