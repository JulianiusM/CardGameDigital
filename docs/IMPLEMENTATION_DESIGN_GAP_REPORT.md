# Implementation and design gap resolution record

**Comparison target:** GDD v1.3, TAD v1.2, Visual & Interaction Design v1.1, and
the current external contracts.

This record replaces the earlier documentation-only gap report after the source,
tests, assets, and release automation were inspected together.

## Resolved in the current implementation

- Never Have I Ever supports immutable pre-Session `ANONYMOUS_AGGREGATE` and
  `NAMED_ANSWERS` reveal modes in Couch and Room play.
- Every presentation receives the frozen voter roster with per-player `PENDING` /
  `VOTED` progress. No answer value is projected before all required voters finish;
  named values appear only in the configured named-result state.
- The current WebSocket contract and documentation use protocol v3. Protocols v1/v2
  are retained only as retired historical contracts.
- Couch, account, help, HOST, PLAYER, and DISPLAY presentations use the single Svelte
  client. The old Pug renderer/pages are removed; `/play/room` is the canonical hosted
  route and historical role-specific URLs redirect there.
- Built-in profile presets are immutable `PUBLISHED` application data. They use the
  conservative defaults recorded in the GDD and must still be reviewed alongside the
  real production Card release.
- The implemented intensity-offset table is the current canonical table and is now
  identical in game-core, the GDD, and its tests.
- Every publicly served media file has a runtime consumer: scene audio is selected by
  `presentation.ts`, Card-family SVGs by `GameCard`, and the two symbol sprites by the
  adaptive backdrop and UI icon components. The offline-assets test compares the exact
  public directory inventory, so an unreferenced extra or missing expected asset fails.
- Public mode keeps anonymous Quick Round available for Couch, Personal, and Party
  Screen play. Durable Couch/Room selection is an explicit authenticated DataSpace
  decision, and the same themed SPA covers activation recovery, password login/reset,
  DataSpaces, login sessions, export, logout, and deletion.
- The clean MariaDB 10.11 public integration suite verifies every game mode without an
  account plus authenticated persistence, ownership/cascades, activation, reset,
  session revocation, and privacy-safe export. A public-mode Playwright workflow covers
  the corresponding browser experience.
- No-Group quick rounds and every saved Group own separate complete Custom and
  Card-language defaults. Browser regression coverage switches between two Groups and
  No Group to prove values do not leak across scopes.
- Configured imprint and privacy-policy destinations are startup-validated, exposed as
  public configuration only, and rendered as themed main-menu and Settings actions that
  do not replace an active SPA game.

## Open release blockers and external gates

- The repository contains only a four-Card development fixture, not the producer-owned,
  editorially approved production catalog. Enforced public startup and public packaging
  refuse that fixture; the explicit unsafe public development runtime accepts it only
  for administrator testing.
- The complete migration chain, catalog advisory lock, and browser suite pass against
  MariaDB 10.11; release CI is configured to repeat those checks for each candidate.
- SMTP delivery, a real OIDC provider, the deployed TLS/reverse-proxy topology, DNS,
  certificates, firewall policy, backups, and monitoring require staging/operations
  verification. The browser account flow itself is automated on public-mode loopback.
- Portable server archives contain platform-native Node dependencies and must be built
  and smoke-tested on each supported operating system and architecture.
- Public adult-content policy/legal review and final profile-to-catalog review remain
  product release gates.

The native Kodi client is implemented with Couch, display-bootstrap Room hosting,
existing-Room display joining, discovery/manual endpoints, recovery, localization,
generated protocol/design assets, privacy validation, and an independent reproducible
release artifact. Clean Kodi platform/skin/remote/network verification remains an
external release gate, and native account linking is capability-gated but disabled by
the current server. Android-family native clients remain a future architecture target.

## Deliberately later or optional design items

Named reusable custom GameProfile CRUD, custom Card authoring, statistics, content and
language administration, and additional Card-language releases are not part of the
current core release. Their reserved domain/repository boundaries must remain compatible
when those later features are scheduled. Privacy-minimal mDNS advertising and bounded
native-client discovery are implemented.
