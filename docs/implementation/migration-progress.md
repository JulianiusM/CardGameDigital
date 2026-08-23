# MVP migration progress

Statuses mean: **NOT STARTED**, **IN PROGRESS**, **BLOCKED**, **IMPLEMENTED**, or
**VERIFIED**. `VERIFIED` is used only after the listed checks pass.

| Phase                              | Status          | Evidence                                                                                                                                                                                                                                                  | Tests / caveats                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Blueprint stabilization        | **VERIFIED**    | `docs/implementation/current-state.md`; dangling imports removed from `src/app.ts`, `src/routes/api.ts`, and account dashboard orchestration; legacy account guards retained.                                                                             | Strict server build and the restored account-guard baseline tests pass. Broader suites remain later-phase work.                                                                                                                                                                                                                                                                                                                                                   |
| 1 — Architectural seams            | **IMPLEMENTED** | `src/modules/settings.ts`; `src/modules/database/dataSource.ts`; `src/migrations/1787330000000-IntroduceDataSpaces.ts`; `src/packages/*`; `AccountSession` and `DataSpace` entities/callers.                                                              | Configuration, protocol, strict build, and empty-SQLite migration/WAL tests pass. MariaDB execution of the new migration still requires the CI service before this phase is `VERIFIED`.                                                                                                                                                                                                                                                                           |
| 2 — Bundled Card catalog           | **IMPLEMENTED** | `catalog/card-catalog.json`; `src/packages/card-catalog-contract`; `applyCardCatalogSnapshot`; migrations `1787331000000` and `1787339000000`; runtime catalog APIs.                                                                                      | Strict multilingual contract, producer UUIDs, immutable sequence/digest decisions, transactional FULL reconciliation, soft disable/reactivation, exact-locale selection, UI/Card locale independence, build validation, and startup apply have focused tests. MariaDB advisory-lock execution remains a CI verification gate.                                                                                                                                     |
| 3 — Core game engine               | **VERIFIED**    | `src/packages/game-core/{eligibility,history,profiles,random,selection,sessions}`; `tests/unit/game-core-eligibility.spec.ts`; `tests/unit/game-session.spec.ts`; `tests/simulation/game-modes.simulation.spec.ts`.                                       | Pure Vitest suites cover independent question/dare eligibility, profile/boundary filtering, history/repetition/cooldown, weighted choice, rounds, revisions, invalid states, voting, all four modes, Random ratio/streak behavior, Let's Talk scheduling, and explicit exhaustion. Active-Session persistence and built-in editorial profile defaults remain later phases.                                                                                        |
| 4 — Couch Mode                     | **IMPLEMENTED** | `apps/web`; `src/packages/application/couchSessionService.ts`; `src/routes/api/couch.ts`; Express `/play`; `tests/unit/couch-session-service.spec.ts`; `tests/integration/couch-api.spec.ts`; `tests/e2e/couch-mode.spec.ts`.                             | The locally bundled Svelte/Vite client builds and all four modes pass service and HTTP integration tests against the authoritative shared engine. A Playwright workflow is present, but browser execution and screenshot capture are blocked locally because the Playwright CDN returned HTTP 403; CI must run it before `VERIFIED`. Active Couch Sessions are server-memory authoritative in this phase and gain durable restart recovery with Room persistence. |
| 5 — Rooms and protocol             | **IMPLEMENTED** | `1787332000000-AddRealtimeRooms`, `RoomService`, `/api/v1/rooms`, `/ws`, protocol schemas; room-service, protocol, migration, and four-client WS tests.                                                                                                   | MariaDB contract execution remains a CI/environment verification before this phase is marked VERIFIED.                                                                                                                                                                                                                                                                                                                                                            |
| 6 — Party Screen and Personal Mode | **IMPLEMENTED** | Svelte `/play/{host,display,mobile,couch}` roles; local QR join; presence; participant-specific snapshots; reconnect; private choice/vote/veto controls; four-client WS and Party Screen Playwright coverage.                                             | Vitest/build verification passes. The Playwright workflow requires an installed browser before this phase can be marked VERIFIED.                                                                                                                                                                                                                                                                                                                                 |
| 7 — Profiles and boundaries        | **IMPLEMENTED** | Built-in profile catalog/API; `1787333000000-AddParticipantBoundaries`; private boundary protocol/UI/persistence; profile, protocol, privacy, eligibility, and persistence tests.                                                                         | Defaults remain explicitly editorial drafts pending production-catalog review. Public adult-content policy/legal review remains a Phase 8 release gate.                                                                                                                                                                                                                                                                                                           |
| 8 — Public-mode completion         | **IMPLEMENTED** | `1787334000000-HardenAccountSecrets`; Argon2id; hash-only one-time tokens; verified-email OIDC linking; public origin/rate controls; `1787335000000-AddAccountGroupsAndSettings`; DataSpace-scoped Group/settings APIs; AccountSession management/export. | MariaDB, SMTP, reverse-proxy, provider OIDC, and public browser E2E remain staging/CI verification gates.                                                                                                                                                                                                                                                                                                                                                         |
| 9 — Presentation/release           | **IMPLEMENTED** | Local audio, animation/reduced-motion/accessibility controls, German message catalog, design tokens, portable/public packaging scripts, release workflow, offline and packaging smoke checks; ADR-010.                                                    | Cross-platform native archive generation and browser screenshots remain CI release gates before `VERIFIED`.                                                                                                                                                                                                                                                                                                                                                       |
| 10 — Cleanup                       | **IMPLEMENTED** | Legacy controllers, Pug renderer/views, persistent Guest accounts, Surveyor-only modules and browser bundles removed; native Svelte account/help flows, JSON APIs, localized email catalog, dependency audit and architecture tests.                      | Cleanup is intentionally gated on replacement parity and caller/test audits.                                                                                                                                                                                                                                                                                                                                                                                      |

## Baseline checks

- `npm run build:server` — passing after Phase 0 stabilization.
- `npm test` — passing with restored account authorization smoke coverage.
- `tests/integration/sqlite-migrations.spec.ts` — empty database migration,
  SQLite WAL, and DataSpace persistence pass.

## Phase 1 architectural decisions

- Configuration is resolved as built-in defaults, optional CSV file, then
  environment variables and is validated before TypeORM options are built.
- `DEPLOYMENT_MODE=local` requires SQLite and `AUTH_MODE=none` is supported;
  public deployment requires MariaDB/MySQL and account authentication.
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
- No unresolved editorial profile defaults have been encoded.

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
  intensity, ratio, streak, and meta-card settings. Their selections are marked as
  editorial drafts rather than claimed as final catalog decisions.
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
- AccountSession listing/revocation and account metadata export use authenticated,
  account-scoped APIs. Game Sessions and AccountSessions remain distinct.
- Groups and gameplay defaults are persisted per DataSpace. Public Room creation is
  tied to the authenticated account's active DataSpace, and Group selection loads
  durable history into the same authoritative Session engine.
- Room creation defaults to anonymous/ephemeral play and opts into DataSpace
  persistence explicitly. Couch, Personal, and Party Screen presentation rules,
  host-only settings, shared-device players, and concurrent LAN Rooms are recorded
  in `adr-009-play-topologies-and-ephemeral-rooms.md`.
- `1787336000000-AddDevicePlayers` persists additional players controlled by any
  participant device. Explicit host delegation and WebSocket disconnect fallback
  preserve the active Session while maintaining exactly one host.
