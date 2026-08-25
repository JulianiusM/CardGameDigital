# MVP migration progress

Statuses mean: **NOT STARTED**, **IN PROGRESS**, **BLOCKED**, **IMPLEMENTED**, or
**VERIFIED**. `VERIFIED` is used only after the listed checks pass.

| Phase                              | Status          | Evidence                                                                                                                                                                                                                                                                      | Tests / caveats                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Blueprint stabilization        | **VERIFIED**    | `docs/implementation/current-state.md`; dangling imports removed from `src/app.ts`, `src/routes/api.ts`, and account dashboard orchestration; legacy account guards retained.                                                                                                 | Strict server build and the restored account-guard baseline tests pass. Broader suites remain later-phase work.                                                                                                                                                                                                                                                                  |
| 1 — Architectural seams            | **VERIFIED**    | `src/modules/settings.ts`; `src/modules/database/dataSource.ts`; `src/migrations/1787330000000-IntroduceDataSpaces.ts`; `src/packages/*`; `AccountSession` and `DataSpace` entities/callers.                                                                                  | Configuration, protocol, strict build, empty-SQLite migration/WAL, and the complete MariaDB 10.11 migration chain pass.                                                                                                                                                                                                                                                          |
| 2 — Bundled Card catalog           | **IMPLEMENTED** | `catalog/card-catalog.json`; `src/packages/card-catalog-contract`; `applyCardCatalogSnapshot`; migrations `1787331000000` and `1787339000000`; runtime catalog APIs.                                                                                                          | Strict multilingual contract, producer UUIDs, immutable sequence/digest decisions, transactional FULL reconciliation, soft disable/reactivation, exact-locale selection, UI/Card locale independence, build validation, startup apply, and the MariaDB advisory lock pass. The canonical production artifact is still absent.                                                    |
| 3 — Core game engine               | **VERIFIED**    | `src/packages/game-core/{eligibility,history,profiles,random,selection,sessions}`; `tests/unit/game-core-eligibility.spec.ts`; `tests/unit/game-session.spec.ts`; `tests/simulation/game-modes.simulation.spec.ts`.                                                           | Pure Vitest suites cover independent question/dare eligibility, profile/boundary filtering, history/repetition/cooldown, weighted choice, rounds, revisions, invalid states, both reveal modes, all four game modes, Random ratio/streak behavior, Let's Talk scheduling, and explicit exhaustion. Active runtime persistence is implemented by the Couch and Room repositories. |
| 4 — Couch Mode                     | **VERIFIED**    | `apps/web`; `CouchSessionService`; `TypeOrmCouchSessionRepository`; `/api/v1/couch`; Express `/play`; unit, integration, and Playwright Couch coverage.                                                                                                                       | The bundled Svelte/Vite client uses the authoritative shared engine for all four modes. `EPHEMERAL` is memory-only with no durable rows; authenticated `DATASPACE` mutations are serialized and persisted transactionally before cache publication and recover after restart. The current Playwright suite passes.                                                               |
| 5 — Rooms and protocol             | **VERIFIED**    | `1787332000000-AddRealtimeRooms`, `RoomService`, `/api/v1/rooms`, `/ws`, protocol schemas; room-service, protocol, migration, and four-client WS tests.                                                                                                                       | SQLite and MariaDB 10.11 migrations, repository behavior, protocol contracts, payload/rate boundaries, and realtime integration tests pass.                                                                                                                                                                                                                                      |
| 6 — Party Screen and Personal Mode | **VERIFIED**    | Svelte `/play/room` role projections and `/play/couch`; local QR join; presence; participant-specific snapshots; reconnect; private choice/vote/veto controls; four-client WS and Party Screen Playwright coverage.                                                           | HOST, PLAYER, and DISPLAY use one Room route and bundle. Historical role-specific URLs redirect to the canonical Room route. Both SQLite and MariaDB-backed Playwright suites pass.                                                                                                                                                                                              |
| 7 — Profiles and boundaries        | **IMPLEMENTED** | Built-in profile catalog/API; `1787333000000-AddParticipantBoundaries`; private boundary protocol/UI/persistence; profile, protocol, privacy, eligibility, and persistence tests.                                                                                             | Built-in presets are immutable `PUBLISHED` application data with conservative operational defaults. The GDD still requires them to be reviewed alongside the real production Card release; public adult-content policy/legal review remains a release gate.                                                                                                                      |
| 8 — Public-mode completion         | **VERIFIED**    | Account-secret/DataSpace migrations plus `1787345000000`–`1787350000000`; Argon2id; hash-only one-time tokens; indexed minimal AccountSessions; public origin/rate controls; scoped Group/quick defaults; DataSpace-owned Couch/Room persistence; complete Svelte account UI. | Clean MariaDB 10.11 integration and public-mode Playwright cover anonymous all-mode quick play, activation/login/reset, DataSpaces, scoped Custom/Card-language defaults, persistence/export, session revocation, and deletion cascades. Real SMTP, reverse-proxy TLS, and provider OIDC remain staging/manual gates.                                                            |
| 9 — Presentation/release           | **IMPLEMENTED** | Local audio, animation/reduced-motion/accessibility controls, German message catalog, canonical browser CSS tokens, portable/public packaging scripts, SBOM/schema/license output, release workflow, offline and packaging smoke checks; ADR-010.                             | Portable server archives must still be produced on every supported OS/architecture. Kodi and Android-family clients are deferred from this release scope; the responsive browser provides Couch, Personal, and Party Screen presentations.                                                                                                                                       |
| 10 — Cleanup                       | **IMPLEMENTED** | Legacy controllers, Pug renderer/views, persistent Guest accounts, Surveyor-only modules and browser bundles removed; native Svelte account/help flows, JSON APIs, localized email catalog, dependency audit and architecture tests.                                          | Cleanup is intentionally gated on replacement parity and caller/test audits.                                                                                                                                                                                                                                                                                                     |

## Baseline checks

- `npm run build:server` — passing after Phase 0 stabilization.
- `npm test` — passing with restored account authorization smoke coverage.
- `tests/integration/sqlite-migrations.spec.ts` — empty database migration,
  SQLite WAL, and DataSpace persistence pass.
- `tests/integration/public-mode-mariadb.spec.ts` — clean public MariaDB migration,
  anonymous all-mode play, account lifecycle, persistence ownership, and cascades pass.
- `tests/e2e/public-account.spec.ts` — public SPA login-to-saved-play and return to
  anonymous Quick Round pass on loopback public E2E configuration.

## Phase 1 architectural decisions

- Configuration is resolved as built-in defaults, optional CSV file, then
  environment variables and is validated before TypeORM options are built.
- `DEPLOYMENT_MODE=local` requires SQLite and `AUTH_MODE=none` is supported. Public
  deployment defaults to `PUBLIC_RUNTIME_SECURITY=enforced`, which requires
  MariaDB/MySQL and account authentication. The explicit unsafe `development` policy
  permits administrator testing of public behavior without those infrastructure gates.
- The runtime and migration CLI share `dataSourceOptions`; runtime migration is
  explicit and automatic schema synchronization remains disabled.
- The fresh schema creates `users`, `data_spaces`, and `session` directly; no
  compatibility tables or persistent anonymous identities are created.
- `AccountSession` uses the `session` table while gameplay uses the explicitly
  separate `game_sessions` table.
- Early package seams live under `src/packages` to avoid a premature monorepo
  move. `game-core` contains no Express, TypeORM, WebSocket, or UI imports.

## Material assumptions

- Surveyor-only capabilities were not reconstructed. Replacement parity was
  established before their controllers, templates and browser helpers were removed.
- Account, DataSpace, gameplay and help screens now share one Svelte presentation.
- Built-in profile values are published application presets but still require review
  against the supplied production Card catalog, as required by the GDD.

## Phase 2 notes

- Producer UUIDs are authoritative in code and persistence; localized wording never
  participates in identity.
- QuestionCategory, DareType, and optional DareAffinityCategory remain independent
  fields and filters; their labels are runtime catalog data.
- The single producer artifact contains only release-ready content. Invalid artifacts
  fail atomically before mutation; no raw/editorial rows are staged by the game.
- Startup is offline, applies only newer immutable FULL snapshots, and never rolls a
  database back to an older bundled sequence.

## Phase 3 notes

- One `GameSession` aggregate owns transitions for all four modes; modes do not
  have separate engines or persistence paths.
- Production randomness uses Node's cryptographic generator through a domain
  interface. Simulations inject a deterministic sequence source.
- A card is appended to Session history when committed for display. A revealed
  skipped card remains in history and is marked skipped before its replacement.
- `AlwaysEligible` bypasses only Group history. Session repetition additionally
  requires `RepeatableInSession` and the number of other shown cards specified
  by `RepeatCooldown`.
- Profile Question Categories and DareTypes are separate sets. Dare Affinity is
  not used as a hard dare filter. Disabled DareTypes and operational flags are
  never reintroduced by intensity or weighted selection.
- Eligibility derives an internal global score from overlapping hard-coded taxonomy
  ranges and the relative Card level. Settings control start/end intensity and increase
  intervals measured in completed rounds or displayed Cards, plus the half-point score
  increment applied at each interval.
- Built-in profile selections remain an editorial Phase 7 concern. Phase 3 uses
  validated, data-driven `GameProfile` values and does not guess those defaults.

## Phase 4 notes

- Express serves the Svelte/Vite build at `/play`; account and help experiences
  are native routes in that same frontend and communicate through `/api/v1`.
- Couch commands cross a validated `/api/v1/couch` boundary and execute through
  `CouchSessionService`; the browser never selects an authoritative card.
- The Couch snapshot exposes the current revision and the same privacy-safe
  Never-Have-I-Ever voting projection as hosted Rooms. Vote values remain hidden
  during collection; completed named answers are exposed only when the Session's
  explicit reveal policy allows them.
- Required gameplay assets are bundled locally. The gameplay client introduces
  no CDN, external font, image, sound, QR, or authentication dependency.
- The Phase 4 service is deliberately in-process and server-authoritative. Phase
  5 replaces its runtime store with Room/Session persistence and reconnect while
  preserving the same `GameSession` engine.

## Phase 5 notes

- Room codes are identifiers only. Participant credentials contain 256 bits of
  cryptographic entropy, are returned only by create/join responses, and only
  SHA-256 credential hashes are persisted.
- `ws` is attached to the application's Node HTTP server. Every socket
  starts unauthenticated and must complete the versioned `client.hello`
  handshake before snapshots or commands are accepted.
- Commands are queued independently per Room. A proposed domain transition is
  persisted transactionally before the in-memory runtime changes or the
  WebSocket adapter broadcasts its authoritative snapshot.
- Versioned `GameSession` serialization allows restart/reconnect recovery while
  keeping the domain model independent of TypeORM and WebSocket libraries.
- The Room capability model is intentionally separate from the retained legacy
  entity permission engine.

## Phase 6 notes

- One Svelte bundle renders host, shared-display, personal-phone, and Couch
  presentations. Party Screen and Personal Mode do not fork the game engine.
- Join QR codes are generated from a locally bundled library and contain only a
  Room-code URL. Reusable participant credentials remain in browser session
  storage and are supplied only in the WebSocket handshake.
- Snapshot projections are calculated per authenticated participant. Display
  clients receive presentation state but no command capabilities; Classic
  choices and votes are available only to the relevant participant.
- Never-Have-I-Ever commands derive voter identity from the authenticated Room
  participant instead of accepting an authoritative player ID from the client.
  The Session freezes the ordered voter set when a card enters vote collection,
  so reconnects preserve pending votes and mid-card joiners participate starting
  with the next card.
- Presence and reconnect are server-authoritative. Reusing the participant
  credential reclaims the same identity and returns the current full snapshot.

## Phase 7 notes

- Built-in GameProfiles have stable IDs and independent question, dare, operational,
  intensity, ratio, streak, and meta-card settings. They are immutable `PUBLISHED`
  application presets and remain subject to review alongside each production Card
  release.
- Private boundaries are sent only through an authenticated participant command,
  persisted separately, and loaded into the shared Session engine at start.
- Snapshots expose only the requesting participant's configured/not-configured
  status. They never contain private selections or attribute a group restriction.
- The explicit couples profile requires deliberate adult-content confirmation in
  both the client and application layer. Public policy/legal validation remains.

## Phase 8 notes

- Passwords use OWASP's Argon2id profile. Unsupported legacy formats are not carried
  into this fresh product schema.
- Activation/reset tokens are stored only as hashes; raw token columns are removed.
- OIDC email linking requires a verified provider email. Public HTTP and WebSocket
  traffic enforce configured-origin boundaries and sensitive route/command rates.
- AccountSession listing/revocation and privacy-safe gameplay export use authenticated,
  account-scoped APIs. Indexed user ownership avoids serialized-session scans;
  password reset revokes every login. Game Sessions and AccountSessions remain distinct.
- Groups and gameplay defaults are persisted per DataSpace. Public Room creation is
  tied to the authenticated account's active DataSpace, and Group selection loads
  durable history into the same authoritative Session engine.
- `1787348000000-SaveCustomGameSettings` isolates the complete last-applied Custom
  configuration from preferred built-in profile defaults.
- Room creation defaults to anonymous/ephemeral play and opts into DataSpace
  persistence explicitly. Couch, Personal, and Party Screen presentation rules,
  host-only settings, shared-device players, and concurrent LAN Rooms are recorded
  in `adr-009-play-topologies-and-ephemeral-rooms.md`.
- `1787336000000-AddDevicePlayers` persists additional players controlled by any
  participant device. Explicit host delegation and WebSocket disconnect fallback
  preserve the active Session while maintaining exactly one host.
- After every remaining Host/Player has left or exhausted reconnect grace and no display
  is connected, the Room is closed automatically while durable account-owned Session
  history remains intact.
- Couch creation makes the same `EPHEMERAL`/`DATASPACE` decision. Ephemeral Couch play
  writes no database history; durable access is bound to the authenticated current
  DataSpace for creation, reads, and commands.
