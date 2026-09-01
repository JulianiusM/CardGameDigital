# Core release conformance audit

This audit compares the current implementation with the GDD Core Release Scope
and TAD acceptance boundaries. **IMPLEMENTED** means code and passing automated
coverage exist. **EXTERNAL VERIFICATION** means the implementation exists but the
required service/platform is unavailable in this repository environment.
**BLOCKED** means canonical source material is absent and must not be invented.

## Verified in this repository

- One framework-independent Session engine implements all four game modes.
- Couch, Personal and Party Screen presentations use the same Room, protocol and
  game engine; clients render authoritative snapshots and never select cards.
- Room commands use revision checks and per-Room serialization; persistence is
  committed before broadcast.
- Question Category, DareType and Dare Affinity remain separate concepts.
- Session history, Group history, repeatability, cooldown and AlwaysEligible are
  covered by deterministic unit/simulation tests.
- Room credentials, roles, reconnect snapshots, host transfer/fallback and
  shared-device players have unit/integration coverage.
- DataSpace ownership and GameProfile presets are distinct; AccountSession and
  game Session persistence are distinct.
- Local SQLite uses migrations, WAL and foreign keys. Gameplay UI, QR logic,
  JavaScript, styles and audiovisual assets are bundled locally.
- The complete migration chain, catalog advisory lock, and browser gameplay suite pass
  against MariaDB 10.11 as well as SQLite.
- Public account login/reset, Argon2id, hash-only one-time tokens, OIDC linking
  checks and DataSpace-scoped groups/settings are retained behind one server.
- Scoped Card policy compiles once into the authoritative Session, persists sparse
  DataSpace/Group decisions with optimistic revisions, and exposes one bounded,
  localized management workspace in local none-auth and authenticated public modes.
- Browser scale coverage holds DataSpace and policy lists to bounded rendered pages;
  deterministic simulation covers 50,000 Cards with 200 ordered rules.
- The native Kodi thin client implements remote-only Couch and Room-display flows,
  display-bootstrap hosting, bounded discovery, recovery, localization, generated
  protocol/design boundaries, privacy checks, and deterministic independent packaging.

## External verification gates

- SMTP delivery, a real OIDC provider, HTTPS reverse proxy behavior and public
  browser account flows require staging infrastructure.
- Playwright browser workflows must pass in release CI; public account, OIDC, and proxy
  browser flows additionally require staging configuration.
- The server-web release workflow is configured to produce both editions independently
  on Linux, Windows, and macOS x64/arm64. A successful manual release run remains the
  external proof that all native runners and bindings are available.
- Kodi release QA must install and launch the generated ZIP on the supported
  version/platform/skin/remote/network matrix, including offline LAN and representative
  low-powered hardware. CPython/XML/package validation does not replace that gate.

The Kodi client now has its independent `kodi-client-v{version}` release unit and is
never added to server-web. Native account linking remains capability-gated and is
explicitly disabled by the current server. Android-family native clients remain a
longer-term architecture target with a separate future release unit.

## Canonical content blocker

The GDD identifies an existing German source database of roughly 2,000 cards as
canonical product content. That source database is not present in this repository.
The bundled catalog contract and transactional runtime reconciliation are complete,
but a production catalog cannot be fabricated without violating the GDD's content
lineage and editorial requirements. Consequently the repository must not label the
entire Core Release **VERIFIED** until the producer publishes, editorially validates,
and supplies the canonical `game-card-catalog/v2` artifact. Development fixtures remain
non-production content.

## Phase 10 cleanup decision

Removed modules had no runtime callers and represented legacy entity, permission,
upload, dashboard, controller, Pug or browser infrastructure. Account and help flows
now use the Svelte application and versioned JSON APIs. Anonymous quick play is a Room
lifecycle concern, so the unused persistent Guest account model was removed. Email
copy lives in the localization package and only game account messages remain.
