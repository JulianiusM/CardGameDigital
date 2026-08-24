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

## External verification gates

- SMTP delivery, a real OIDC provider, HTTPS reverse proxy behavior and public
  browser account flows require staging infrastructure.
- Playwright browser workflows must pass in release CI; public account, OIDC, and proxy
  browser flows additionally require staging configuration.
- Portable server archives must be produced independently on every supported OS and
  architecture because native Node bindings cannot be cross-packaged safely.

Kodi and Android-family native clients remain part of the longer-term architecture but
are explicitly deferred from this release. The responsive browser client covers all
three initial device modes: Couch, Personal, and Party Screen.

## Canonical content blocker

The GDD identifies an existing German source database of roughly 2,000 cards as
canonical product content. That source database is not present in this repository.
The bundled catalog contract and transactional runtime reconciliation are complete,
but a production catalog cannot be fabricated without violating the GDD's content
lineage and editorial requirements. Consequently the repository must not label the
entire Core Release **VERIFIED** until the producer publishes, editorially validates,
and supplies the canonical `game-card-catalog/v1` artifact. Development fixtures remain
non-production content.

## Phase 10 cleanup decision

Removed modules had no runtime callers and represented legacy entity, permission,
upload, dashboard, controller, Pug or browser infrastructure. Account and help flows
now use the Svelte application and versioned JSON APIs. Anonymous quick play is a Room
lifecycle concern, so the unused persistent Guest account model was removed. Email
copy lives in the localization package and only game account messages remain.
