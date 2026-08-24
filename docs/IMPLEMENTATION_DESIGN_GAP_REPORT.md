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
- The current WebSocket contract and documentation use protocol v2. Protocol v1 is
  retained only as a retired historical contract.
- Couch, account, help, HOST, PLAYER, and DISPLAY presentations use the single Svelte
  client. The old Pug renderer/pages are removed; `/play/room` is the canonical hosted
  route and historical role-specific URLs redirect there.
- Built-in profile presets are immutable `PUBLISHED` application data. They use the
  conservative defaults recorded in the GDD and must still be reviewed alongside the
  real production Card release.
- The implemented intensity-offset table is the current canonical table and is now
  identical in game-core, the GDD, and its tests.

## Open release blockers and external gates

- The repository contains only a four-Card development fixture, not the producer-owned,
  editorially approved production catalog. Public startup and public packaging refuse
  that fixture.
- The complete migration chain, catalog advisory lock, and browser suite pass against
  MariaDB 10.11; release CI is configured to repeat those checks for each candidate.
- SMTP delivery, a real OIDC provider, the deployed TLS/reverse-proxy topology, DNS,
  certificates, firewall policy, backups, monitoring, and public browser account flows
  require staging/operations verification.
- Portable server archives contain platform-native Node dependencies and must be built
  and smoke-tested on each supported operating system and architecture.
- Public adult-content policy/legal review and final profile-to-catalog review remain
  product release gates.

Kodi and Android-family native clients remain future architecture targets but are
explicitly outside this release scope. The responsive web client implements the initial
Couch, Personal, and Party Screen device modes.

## Deliberately later or optional design items

Named reusable custom GameProfile CRUD, custom Card authoring, statistics, content and
language administration, mDNS discovery, and additional Card-language releases are not
part of the current core web release. Their reserved domain/repository boundaries must
remain compatible when those later features are scheduled.
