# Multiplayer Party Card Game — Blueprint-to-MVP Migration Guideline

**Document purpose:** Concrete migration plan from the supplied Node.js Blueprint to the first complete product version defined by the canonical Technical Architecture Document (TAD) and Game Design Document (GDD).  
**Implementation style:** Incremental migration; preserve and refactor useful blueprint infrastructure; do not perform a greenfield rewrite.  
**Primary audience:** Junior developers and autonomous coding agents.  
**Source basis:** NodeJs-Blueprint(1).zip, TAD v1.0, GDD v1.1.

---

# 1. How to use this guideline

This document is an execution guide, not a replacement for the TAD or GDD. The TAD remains authoritative for architecture, deployment, persistence, networking, security, client/server boundaries and protocol design. The GDD remains authoritative for gameplay, card semantics, profiles, history, multiplayer behavior from the player's perspective and UX behavior.

When this guideline appears to conflict with either canonical document, stop and follow the canonical document. Do not “resolve” a conflict by inventing a third rule.

## 1.1 Meaning of “MVP” in this guideline

Neither supplied canonical document formally defines a separate feature set called “MVP”. The GDD defines a **Core Release Scope** for the first complete public product. Therefore this guideline uses **MVP** to mean:

1. the complete GDD Core Release Scope;
2. the architectural behavior needed to satisfy the TAD acceptance criteria; and
3. the local and public deployment capabilities required by the TAD;

while excluding only capabilities that the source documents explicitly classify as post-core, future, optional, or not initially required.

This means the MVP includes the four game modes, three device modes, normalized content semantics, Profiles, Rooms, Sessions, Groups, history and repeat behavior, browser multiplayer, QR/room-code joining, reconnect, core UX screens, responsive presentation, sound/animation/reduced-motion support, local SQLite operation and the public deployment/authentication path.

Native phone applications are not required. Kodi and Android-family TV clients are architectural targets but are not necessary to prove the MVP because the TAD explicitly states that native phone apps are not initially required and defines the Svelte browser application as the general-purpose client. The browser client must therefore cover Couch, Personal and Party Screen device roles for the MVP.

## 1.2 Migration rule that governs every task

**Do not delete a blueprint subsystem merely because the final architecture looks different.**

For every blueprint component, first classify it as one of the following:

- **KEEP:** it already matches the TAD closely and should remain.
- **KEEP + EXTEND:** retain the implementation and add game-specific behavior.
- **REFACTOR IN PLACE:** preserve the working responsibility, but change names, configuration, security behavior or boundaries.
- **REPLACE BEHIND A SEAM:** introduce the target implementation beside the old one, switch callers, then retire the old implementation.
- **LEGACY / DO NOT EXTEND:** existing code may remain temporarily, but new game functionality must not depend on it.
- **RETIRE AFTER PARITY:** delete only after the replacement is working, tested and no production code imports it.
- **STALE REFERENCE:** the referenced Surveyor feature is already absent from the supplied blueprint; removing the dangling import/route is cleanup, not deletion of retained infrastructure.

A coding agent must never perform a repository-wide cleanup before completing this classification.

---

# 2. Canonical migration principles

The following rules are non-negotiable during the migration.

## 2.1 Preserve the blueprint infrastructure explicitly named by the TAD

The TAD says the existing Node blueprint is infrastructure source material and explicitly identifies the following concepts for retention/refactoring:

- Node/TypeScript bootstrap;
- Express lifecycle;
- settings hierarchy;
- TypeORM migration discipline;
- user accounts;
- local authentication;
- OIDC;
- account sessions;
- mail infrastructure;
- centralized error handling;
- health endpoint;
- Vitest;
- Playwright;
- integration-test discipline.

Any implementation plan that deletes these wholesale is incorrect.

## 2.2 Do not propagate blueprint concepts the TAD rejects

The TAD also names concepts that must not become the game architecture merely because they exist in the blueprint:

- Pug as the primary UI;
- Bootstrap/jQuery-oriented page structure;
- Surveyor-specific entity inheritance;
- generic `Profile` ownership naming;
- entity-assignment permissions as the realtime Room authorization model;
- controller-contained business logic;
- MariaDB-only persistence assumptions.

“Not retained” does **not** mean “delete on day one”. It means new code must not deepen the dependency. Existing code is migrated or retired after replacement.

## 2.3 Use additive migration before structural relocation

The TAD recommends a monorepo but explicitly allows the existing blueprint to be migrated into that structure incrementally. Therefore:

- do not move the entire current `src/` tree into `apps/server/` as the first change;
- first restore a clean baseline;
- add target packages beside the current server;
- move stable code only after package boundaries and imports are proven;
- keep each refactor buildable and testable.

## 2.4 Keep one server implementation

Local and public operation must remain the same game server codebase. Deployment differences are selected through configuration and infrastructure adapters, not through copied servers or separate gameplay implementations.

## 2.5 Preserve server authority from the first game feature

Clients send commands. The server validates commands, changes authoritative state, commits required persistence, increments the Session revision and broadcasts the authoritative result. Do not put card selection, turn rotation, voting outcome, group history or state-transition logic in Svelte components.

## 2.6 Keep gameplay domain free of Express and TypeORM

New domain code must not import Express, `ws`, TypeORM, Svelte, account session infrastructure, email infrastructure or environment configuration. Persistence entities are not domain objects.

## 2.7 No destructive “schema reset” development path as the architecture

The blueprint contains convenience scripts around schema synchronization/reset. The target production model requires versioned migrations. Keep reset/sync only as clearly labeled disposable-development tooling if useful; never make it the application upgrade mechanism.

---

# 3. Actual starting state of the supplied Node.js Blueprint

The supplied ZIP is a **stripped Surveyor application stump**. It contains substantial reusable infrastructure, but some Surveyor feature files have already been removed while references to them remain.

A developer should understand this state before editing anything.

## 3.1 Reusable infrastructure that is physically present

The baseline contains, among other things:

- `src/server.ts` with asynchronous settings → database → Express bootstrap using a Node `http.Server`;
- `src/app.ts` with Express middleware, account session storage, health endpoint and centralized error middleware;
- `src/modules/settings.ts` with defaults, optional CSV settings and environment overrides;
- TypeORM data-source and migration helper infrastructure;
- persisted HTTP account sessions through `connect-typeorm`;
- account entities and account service code;
- local password login flows;
- activation and password-reset flows;
- OIDC implementation including PKCE/state and nonce support;
- mailer infrastructure;
- generic error middleware;
- Vitest and Playwright configuration and scripts;
- E2E database setup scaffolding;
- legacy Pug views and client-side assets.

These are migration assets, not disposable boilerplate.

## 3.2 Known baseline defects/gaps that must not be misinterpreted as a rewrite signal

The supplied `src/app.ts` imports Surveyor routes such as `activity`, `drivers`, `event`, `guests`, `packing` and `survey`, but those route files are absent. `userController.ts` also imports missing Surveyor services used for the old dashboard. These are dangling references left by stripping the original application.

The ZIP also contains Vitest/Playwright configuration and test scripts but no `tests/` directory. The testing architecture is therefore present as a stump and must be repopulated rather than thrown away.

The root package has no lockfile in the supplied archive even though the TAD requires locked production dependencies. Generate and commit the lockfile as part of stabilization.

The current persistence configuration is MariaDB/MySQL-only. This is a refactor target, not a reason to replace TypeORM.

The current `Profile` entity represents ownership. The TAD explicitly requires this concept to become `DataSpace`, while reserving `GameProfile` for gameplay presets.

The current TypeORM `Session` entity is the **HTTP account-session storage table**. It must not be confused with the game Session. Rename it to make the distinction explicit before adding game Session persistence.

---

# 4. Blueprint preservation and migration matrix

The following table is the primary guardrail against destructive rewrites.

| Blueprint path / concept | Classification | Required migration action | Do not do |
|---|---|---|---|
| `src/server.ts` | KEEP + EXTEND | Preserve bootstrap order and `http.Server`. Add validated composition, WebSocket attachment, graceful shutdown and structured startup logging. | Do not replace with a second server entry point for game traffic. |
| `src/app.ts` | REFACTOR IN PLACE | Keep Express lifecycle, middleware composition, account sessions, static hosting, health/error pipeline. Remove only stale feature route registrations; later split HTTP transport composition into modules. | Do not delete Express and rebuild on another framework. |
| `src/modules/settings.ts`, `settings.csv` | KEEP + REFACTOR | Preserve defaults → optional config file → env override hierarchy. Add `DEPLOYMENT_MODE`, `AUTH_MODE`, SQLite settings, bind/port/public URL, proxy/log settings and startup validation. | Do not replace the hierarchy with scattered `process.env` reads. |
| `src/modules/database/dataSource.ts` | REFACTOR IN PLACE | Turn MariaDB-only construction into a data-source factory supporting SQLite and MariaDB/MySQL; keep TypeORM. | Do not fork domain logic based on DB engine. |
| `migrationDataSource.ts`, migration scripts | KEEP + EXTEND | Preserve migration workflow and make it driver-aware. Add migration tests for both databases. | Do not use schema synchronization as production upgrades. |
| `src/modules/database/entities/session/Session.ts` | RENAME + RETAIN | Rename class/table to `AccountSession` / `account_sessions`; continue using it for `express-session`. | Do not reuse it as the game Session. |
| `User`, account service, account routes | KEEP + SECURITY REFACTOR | Preserve registration/login/logout/reset/delete/account-session responsibilities for public mode; harden hashing/tokens and detach ownership `Profile`. | Do not remove public accounts because guests can play without accounts. |
| `src/modules/oidc.ts` | KEEP + HARDEN | Retain existing PKCE/state/nonce flow; enforce verified-email rules before automatic linking and keep provider-specific behavior behind auth composition. | Do not rewrite OIDC from scratch without a concrete deficiency. |
| `src/modules/email.ts` | KEEP + ADAPT | Reuse SMTP abstraction for activation/reset/public account workflows; disable/omit in local auth-none composition. | Do not make local gameplay depend on SMTP. |
| `Profile` ownership entity and profile management flows | REFACTOR / MIGRATE | Migrate ownership concept and persistent data boundary to `DataSpace`; reserve `GameProfile` for gameplay presets. | Do not keep the name `Profile` for ownership. Do not simply drop the table. |
| `Guest` persistent pseudo-account | LEGACY / DO NOT REPURPOSE | Keep only while legacy account/profile migration depends on it. Introduce `RoomParticipant` separately. Retire Guest after all callers are migrated. | Do not treat `Guest` as the new RoomParticipant. |
| `permissionEngine`, permission middleware | LEGACY / LIMITED REUSE | May remain for account/DataSpace admin screens while callers exist. Implement Room capabilities separately in application commands. | Do not use generic entity permissions as realtime Room authorization. |
| `errors.ts`, generic error middleware | KEEP + REFACTOR | Preserve centralized error flow; introduce stable application/domain error codes and HTTP/WS adapters. | Do not let every controller invent response formats. |
| `asyncHandler` and common request middleware | KEEP | Continue using where relevant. | Do not remove merely because routes are reorganized. |
| Pug views / renderer | REPLACE BEHIND A SEAM | Keep as a temporary compatibility/auth shell. Add Svelte/Vite beside it. Migrate screens one flow at a time. | Do not delete all Pug pages before Svelte equivalents work. |
| Bootstrap/jQuery/SASS/esbuild client pipeline | LEGACY / RETIRE AFTER PARITY | Keep for legacy pages only. New game UI uses Svelte/Vite. Remove dependencies when no retained page imports them. | Do not build new game screens on this stack. |
| `src/public` assets | KEEP SELECTIVELY | Continue serving local assets from server. Reuse logo/icons if appropriate; move game assets into Svelte/public or shared asset layout gradually. | Do not introduce CDN dependencies. |
| Vitest configuration/scripts | KEEP + REPOPULATE | Preserve runner and scripts, recreate unit/integration/protocol/simulation suites. | Do not replace test tooling merely because test files were stripped. |
| Playwright config/scripts | KEEP + ADAPT | Preserve E2E runner. Change setup for dual DB/local/public flows and new Svelte URLs. | Do not postpone browser E2E until the end. |
| `docs/` | KEEP + UPDATE | Preserve useful engineering docs, mark Surveyor-specific text as legacy or update it as migration proceeds. | Do not delete repository documentation wholesale. |
| `dist/` | GENERATED | Treat as generated build output; regenerate from source. | Do not use stale compiled Surveyor output as source of truth. |
| Missing Surveyor route/service references | STALE REFERENCE | Remove dangling imports/registrations and any controller methods whose only dependencies are already-absent Surveyor features. | Do not interpret this cleanup as permission to delete auth/settings/database infrastructure. |

---

# 5. Migration safety rules for humans and AI agents

Every change set must follow these rules.

## 5.1 Deletion gate

A file or subsystem may be deleted only when all of the following are true:

1. it is not explicitly listed by the TAD as infrastructure to retain/refactor, **or** its retained responsibility has already moved to a replacement;
2. repository search shows no production import/caller remains;
3. persistent data, if any, has a migration path;
4. tests prove the replacement behavior;
5. the application builds and relevant E2E flows pass without it.

If any item is false, do not delete it.

## 5.2 No bulk replacement of `package.json`

Modify dependencies and scripts incrementally. Preserve current useful scripts until their replacements are operational. Do not overwrite the package manifest with a minimal greenfield manifest.

## 5.3 No bulk replacement of `src/`

New packages may be added. Existing source is moved only after callers are migrated. Never start by removing `src/` and creating `apps/server` from scratch.

## 5.4 No “fix by commenting out everything”

The stabilization phase may remove imports of files that are already absent, but retained infrastructure must remain executable. Temporary compatibility routes are acceptable; a hollow server that compiles but has discarded auth/settings/session behavior is not.

## 5.5 One conceptual migration per commit/PR

Examples of acceptable units:

- remove dangling stripped-Surveyor routes and restore build;
- introduce validated deployment configuration;
- add SQLite data-source adapter;
- rename account-session entity;
- migrate `Profile` ownership to `DataSpace`;
- add `game-core` package and first eligibility tests;
- add WebSocket handshake without gameplay commands.

Avoid a single change that simultaneously moves directories, replaces auth, changes DB engines, introduces Svelte and implements gameplay.

---

# 6. Repository evolution: intermediate and final structure

The target structure is the TAD monorepo, but reach it in two steps.

## 6.1 Intermediate migration structure

Keep the current root server package intact while adding new architecture beside it:

```text
repository/
├── src/                         # existing Express server, migrated in place
├── apps/
│   └── web/                     # new Svelte + Vite browser client
├── packages/
│   ├── game-core/
│   ├── application/
│   ├── protocol/
│   ├── persistence/
│   ├── configuration/
│   └── design-tokens/
├── tooling/
│   ├── card-import/
│   └── catalog-build/
├── tests/
│   ├── simulation/
│   ├── protocol/
│   ├── integration/
│   └── e2e/
├── packaging/
├── docs/
└── package.json                 # workspace root + current server scripts
```

This lets the blueprint server keep running while the new packages become real.

## 6.2 Final structural cleanup

Only after the server imports the new packages cleanly and the Svelte client is the primary UI should the current server source be moved to `apps/server/`. Treat that relocation as a mechanical refactor with no gameplay behavior changes.

Final target:

```text
party-game/
├── apps/
│   ├── server/
│   └── web/
├── packages/
│   ├── game-core/
│   ├── application/
│   ├── protocol/
│   ├── persistence/
│   ├── configuration/
│   └── design-tokens/
├── clients/
│   ├── kodi/                    # later/native target
│   └── android-tv/              # later/native target
├── tooling/
├── packaging/
├── tests/
└── docs/
```

Do not make the final directory layout a prerequisite for implementing the first working game flow.

---

# 7. Phase 0 — Stabilize the blueprint stump without changing architecture

**Goal:** produce a buildable/testable baseline that still contains the infrastructure the TAD says to reuse.

## 7.1 Create a migration branch and baseline record

Record:

- current package version/name;
- current file tree;
- current dependency list;
- current settings keys;
- current entities/tables;
- known missing Surveyor modules;
- known build failures.

Do not modify behavior in this inventory commit.

## 7.2 Remove only dangling references to already-removed Surveyor features

In `src/app.ts`, remove imports and route registrations for files that are not in the supplied repository:

- activity;
- drivers;
- event;
- guests route if absent;
- packing;
- survey.

Keep:

- Express app construction;
- cookie parsing;
- HTTP account session middleware;
- account/session validation;
- `/users` routes;
- `/api` routes that still compile;
- `/help`/index temporarily if useful;
- `/healthz`;
- centralized error handling;
- static serving.

In `userController.ts`, split out or remove only old dashboard aggregation functions that import already-missing Surveyor services. Preserve the registration/login/reset/OIDC/account-management code.

In `src/routes/users.ts`, replace the Surveyor entity dashboard route with a temporary neutral landing page or redirect to the new web shell once it exists. Do not delete the entire users router.

## 7.3 Regenerate build output; do not hand-edit `dist/`

Delete/regenerate stale `dist` only as build output. Never patch compiled JavaScript as the migration source.

## 7.4 Generate and commit dependency lockfile

Run the package manager install against the existing package manifest, resolve only genuine compatibility issues, and commit the lockfile. Do not opportunistically upgrade all dependencies in the same change.

## 7.5 Recreate the test directory skeleton

Create:

```text
tests/
├── unit/
├── integration/
├── frontend/
├── e2e/
├── support/
├── factories/
└── fixtures/
```

Add minimal smoke tests for:

- settings can load;
- database can initialize in the configured test mode;
- `/healthz` returns 200;
- retained account route composition does not throw at startup.

This restores the blueprint's test discipline before game code is introduced.

### Phase 0 exit criteria

- `npm run build` succeeds;
- fast Vitest smoke tests succeed;
- Playwright can start the server and hit `/healthz`;
- account/OIDC/email modules remain in repository;
- no game architecture has yet been implemented in legacy Surveyor controllers.

---

# 8. Phase 1 — Refactor configuration and persistence composition

**Goal:** preserve the blueprint settings/data-source lifecycle while making it conform to local/public deployment rules.

## 8.1 Preserve the existing settings hierarchy

The current settings module already implements defaults, optional CSV and environment overrides. Keep that concept.

Refactor settings into the TAD terminology. Add at minimum:

```text
DEPLOYMENT_MODE=local|public
AUTH_MODE=none|password|oidc|password+oidc
HTTP_BIND
HTTP_PORT
PUBLIC_URL
DB_TYPE=sqlite|mariadb|mysql
DB_FILE
DB_HOST
DB_PORT
DB_NAME
DB_USER
DB_PASSWORD
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
OIDC_ENABLED
OIDC_ISSUER
OIDC_CLIENT_ID
OIDC_CLIENT_SECRET
TRUST_PROXY
LOG_LEVEL
```

Remove Surveyor-only settings only after verifying no retained path uses them. Do this key-by-key, not by replacing the settings module.

## 8.2 Add schema validation before database initialization

Introduce Zod in `packages/configuration` or as an initial local module that is later moved there. Parse the merged settings object before `initDataSource()`.

Required validations include:

- public deployment cannot use `AUTH_MODE=none`;
- SQLite must use a DB file rather than DB host credentials;
- public mode must not assume insecure external HTTP;
- OIDC-required settings must be present when OIDC is enabled;
- SMTP-required settings must be present when email workflows are enabled;
- port ranges and URLs must be valid.

The bootstrap must fail with an actionable configuration error before opening the database.

## 8.3 Stop deriving security behavior from `NODE_ENV`

The blueprint currently uses `NODE_ENV === production` for secure account cookies and hardcodes proxy trust. Replace those decisions with the validated deployment/security settings.

`NODE_ENV` may still control tooling concerns such as test configuration or build optimization. It must not be the sole source for secure-cookie, HTTPS or proxy behavior.

## 8.4 Generalize the TypeORM data source, do not replace TypeORM

Create a factory:

```ts
createDataSource(settings): DataSource
```

with two adapter branches:

- SQLite using `better-sqlite3`, WAL mode and a configured data file;
- MariaDB/MySQL using `mysql2`.

Keep common entity metadata and migrations where possible. Driver-specific settings stay inside the persistence adapter.

During migration, the existing exported `AppDataSource` may remain as a compatibility facade so retained account code does not need to be rewritten all at once.

## 8.5 Migration-only schema changes

Create real migrations for every new or renamed table. Remove `schema: "surveyor"` assumptions as entities are migrated, because SQLite does not support the same schema concept.

Do not introduce new game entities through `synchronize: true`.

### Phase 1 exit criteria

- the same server starts with SQLite/local config and MariaDB/public-test config;
- configuration is validated before DB initialization;
- account cookies/proxy settings use deployment config, not `NODE_ENV` alone;
- `/healthz` still works;
- add `/readyz` for DB readiness and `/api/v1/server-info` for non-secret capabilities;
- migration tests start from an empty DB on both engines.

---

# 9. Phase 2 — Migrate identity concepts without deleting account infrastructure

**Goal:** separate Account, DataSpace, RoomParticipant and Client identities while preserving working public account features.

## 9.1 Rename HTTP session persistence before creating game Session

The current `Session` entity belongs to `express-session`. Rename:

```text
Session -> AccountSession
session table -> account_sessions
```

Update `connect-typeorm` wiring and migrations. Keep HTTP account sessions operational.

Never reuse this entity for game Sessions.

## 9.2 Migrate ownership `Profile` to `DataSpace`

The current `Profile` entity is an ownership container. The TAD explicitly requires that concept to become `DataSpace`.

Migration approach:

1. introduce a `DataSpace` persistence entity with UUID identity;
2. migrate existing profile rows/ownership relations to DataSpaces;
3. update `User` relation from `profiles` to primary/owned DataSpace semantics;
4. update account session shape so it refers to account identity and, where needed, resolved DataSpace identity;
5. change account/profile routes and service names to DataSpace terminology;
6. keep compatibility aliases only temporarily if needed to make the change incremental;
7. remove the old `Profile` table/class only after all reads/writes have switched and the data migration has been tested.

Do not create gameplay `GameProfile` until ownership `Profile` is no longer ambiguous.

## 9.3 Local DataSpace creation

In local deployment:

- create exactly one local DataSpace automatically on first initialization;
- no account login is required to own it;
- keep a lightweight local administrative capability for destructive DataSpace operations;
- do not treat every LAN participant as an administrator.

This local admin capability can reuse token-generation/session utility concepts from the blueprint, but it is not a public user account.

## 9.4 Public account to DataSpace relationship

In public deployment:

- each account receives one primary DataSpace initially;
- registration/login/OIDC still identify the account;
- DataSpace owns Groups, custom GameProfiles/custom cards when those features are supported, preferences and historical data.

Do not require accounts for Room joining.

## 9.5 Do not repurpose the blueprint `Guest` entity

The blueprint Guest is a persistent pseudo-account tied to an ownership Profile. The TAD's party participant is a different identity.

Introduce a new `RoomParticipant` model with fields conceptually including:

```text
id
room_id
display_name
role
token_hash
created_at
last_seen_at
```

The raw participant token is given to the client. Only its hash is persisted.

Keep the old `Guest` code only while an existing account/DataSpace migration path needs it. Once no account or ownership flow uses it, retire it with a migration. Do not make `RoomParticipant extends Guest`.

## 9.6 Preserve and harden password authentication

The blueprint currently uses bcrypt. The TAD prefers Node's built-in `scrypt` and versioned metadata.

Use a compatibility migration rather than invalidating users:

- new passwords are stored with the new versioned scrypt format;
- existing bcrypt hashes remain verifiable during a transition;
- successful login with a legacy hash triggers rehash to scrypt;
- constant-time comparison is used where applicable;
- after the migration window, remove bcrypt only when no legacy hashes remain or a deliberate policy expires them.

## 9.7 Preserve activation/reset workflows, change token storage

The blueprint currently persists usable activation/reset token values. The TAD requires one-time authentication tokens to be stored only as hashes.

Refactor token handling:

- generate cryptographically secure raw token;
- hash it server-side (for example SHA-256 for lookup of random high-entropy tokens);
- persist only the hash and expiration;
- email the raw token;
- hash the presented token before lookup;
- clear token hash on successful use.

To preserve outstanding links during migration, a one-time data migration may hash existing raw tokens into the new hash columns and then remove the raw values.

## 9.8 Preserve OIDC implementation, fix linking policy

The existing OIDC code already contains PKCE, state and nonce support. Retain it.

Audit and modify automatic email linking so that an OIDC identity is linked to an existing account by email only when the provider's claims establish trustworthy verified email. Otherwise require an authenticated linking action.

### Phase 2 exit criteria

- `AccountSession` and game `Session` terminology can no longer be confused;
- ownership is called `DataSpace` in DB, TypeScript, API and docs;
- local mode starts with one local DataSpace and no account login;
- public accounts still register/login/reset/OIDC successfully;
- new password/token storage complies with TAD requirements;
- RoomParticipant is a new concept, not a renamed Guest.

---

# 10. Phase 3 — Add target package boundaries beside the existing server

**Goal:** establish the TAD architecture without moving the existing server wholesale.

Create workspace packages:

```text
packages/game-core
packages/application
packages/protocol
packages/persistence
packages/configuration
packages/design-tokens
```

## 10.1 `game-core`

Start with pure types and policies only. It must not import Express, `ws`, TypeORM or account infrastructure.

Initial modules:

```text
game-core/
├── cards/
├── categories/
├── dare-types/
├── profiles/
├── sessions/
├── modes/
├── eligibility/
├── history/
├── repetition/
├── intensity/
├── rounds/
├── voting/
├── boundaries/
└── random/
```

## 10.2 `application`

Create command/use-case orchestration such as:

- `CreateRoom`;
- `JoinRoom`;
- `StartSession`;
- `ChooseTruth` / `ChooseDare` or a shared choose-card-type command;
- `SkipCard`;
- `SubmitVote`;
- `ChangeGameSettings`;
- `EndSession`.

Application commands accept a resolved Principal/capabilities and repository interfaces. They do not accept Express Request objects.

## 10.3 `protocol`

Add Zod schemas for HTTP DTOs and WebSocket messages. Define protocol version, message envelope, stable error codes and client capabilities here.

Generate JSON Schema fixtures for future non-TypeScript clients.

## 10.4 `persistence`

Place game repository interfaces, TypeORM persistence entities/mappers, migration helpers and SQLite/MariaDB adapters here as they are introduced.

During the incremental period, account entities may still physically live under the legacy server tree. Do not move them solely for aesthetics. New game persistence should start in the package.

## 10.5 `configuration`

Move or wrap the refactored settings schema here once the compatibility import surface is stable. Keep a facade at the old import path until server callers have migrated.

### Phase 3 exit criteria

- game-core compiles with no framework imports;
- server can import application/protocol packages;
- legacy account code still runs;
- no mass relocation of server files has occurred.

---

# 11. Phase 4 — Normalize card content and build persistence model

**Goal:** implement the GDD content semantics before gameplay randomization.

The source Access database itself was not supplied here. Therefore the importer implementation must be prepared against an exported fixture/contract and completed when the real export is provided. Do not invent missing source values.

## 11.1 Preserve raw source data

Tooling pipeline:

```text
Access/export
    -> raw import representation
    -> validation + normalization
    -> versioned catalog artifact
    -> database catalog migration/seed
```

Preserve source ID, Origin, OriginCategory, original text and normalization warnings.

## 11.2 Normalize card semantics

Implement stable internal identifiers rather than German display-string business logic.

Core Card fields should support:

```text
id
source_id
card_text
card_type
origin
origin_category
yes_no_answer_possible
question_category_id
dare_type_id
dare_affinity_category_id
intensity
always_eligible
repeatable_in_session
repeat_cooldown
weight
active
```

Operational flags are separate from taxonomy.

For Questions:

- QuestionCategory required;
- DareType null;
- DareAffinityCategory null.

For Dares:

- DareType required;
- QuestionCategory null;
- DareAffinityCategory optional/recommended.

For Gespräch:

- ordinary question pool is not the scheduling mechanism;
- optional editorial category does not change meta-card scheduling.

## 11.3 Stable IDs

Use deterministic UUIDs for system cards based on a fixed namespace plus stable source identity. Preserve original Access ID as source metadata, not as the globally meaningful ID.

## 11.4 Catalog versioning

Track `catalog_version`. Catalog updates may add, correct or deactivate system cards but must not erase history, Groups, Sessions or custom data.

## 11.5 Core persistence entities

Introduce at least:

- DataSpace;
- Group;
- GameProfile;
- Card and taxonomy tables;
- Room;
- RoomParticipant;
- game Session;
- CardAppearance / shown-card history;
- any relation tables needed for Profiles and operational flags.

Keep Group history logically separate from Session history.

### Phase 4 exit criteria

- catalog fixture can be imported idempotently;
- validation errors/warnings match GDD semantics;
- QuestionCategory and DareType are independent in schema and code;
- a system card has stable identity across SQLite and MariaDB;
- history schema can represent Session and Group behavior separately.

---

# 12. Phase 5 — Implement the pure game engine before networking

**Goal:** complete GDD phases 1–3: content normalization, core engine and Couch Mode foundation.

## 12.1 Explicit Session state machine

Represent active game Session as an explicit state machine. Exact state names can evolve, but typical states include:

```text
WAITING_FOR_PLAYER
CHOOSING_CARD_TYPE
SELECTING_CARD
SHOWING_CARD
WAITING_FOR_RESOLUTION
COLLECTING_ANSWERS
SHOWING_RESULTS
TRANSITION
NEXT_PLAYER
ENDED
```

Invalid commands for current state are rejected.

## 12.2 Revision number

Every committed state transition increments a monotonically increasing revision. Even Couch Mode should use the revision model so multiplayer does not introduce a second behavior later.

## 12.3 Inject randomness

Do not call `Math.random()` directly in the domain. Define a random-source interface. Use a cryptographically strong production implementation and deterministic test implementation.

## 12.4 Implement eligibility as composable policies

Question pipeline:

```text
CardType
-> mode constraints
-> YesNo requirement
-> QuestionCategory
-> GameProfile
-> player boundaries
-> intensity/phase
-> active
-> Session history
-> Group history
-> repeat rules
-> weight
-> selection
```

Dare pipeline:

```text
CardType
-> DareType
-> GameProfile
-> player boundaries
-> operational flags
-> optional Dare Affinity
-> intensity/phase
-> active
-> Session history
-> Group history
-> repeat rules
-> weight
-> selection
```

Each policy must be independently unit-testable.

## 12.5 History behavior

Persist a CardAppearance as soon as a card is committed for presentation. A revealed card counts as shown even if skipped. Implement:

- ordinary no-repeat within Session;
- Group-specific history exclusion;
- `AlwaysEligible` bypass of Group history only;
- `RepeatableInSession` behavior;
- cooldown behavior;
- explicit pool exhaustion rather than silent filter relaxation.

## 12.6 Four game modes

Implement all four on the shared engine:

### Classic Wahrheit oder Pflicht

- choose active player;
- ask Truth/Dare before card selection;
- select only after choice;
- reveal and commit card;
- skip always available;
- advance stable rotation and rounds.

### Random Wahrheit oder Pflicht

- server chooses question/dare;
- target ratio rather than independent coin flips;
- avoid long same-type streaks where pool permits;
- respect pool availability.

### Ich hab noch nie

- use Questions only;
- require `YesNoAnswerPossible=true`;
- do not rewrite arbitrary card text;
- collect answers ephemerally by default;
- support configured result visibility;
- group event, normally no active-player rotation.

### Let's Talk

- Questions only for normal flow;
- schedule Gespräch cards through a meta-card scheduler;
- respect meta-card history/repeat rules;
- continue normal questions if meta pool is exhausted.

### Phase 5 exit criteria

- all domain tests run without DB/HTTP/WebSocket;
- deterministic simulation tests prove key invariants;
- all four modes can run in an in-memory test harness;
- Couch Mode can later bind to the same application commands without new rules.

---

# 13. Phase 6 — Introduce Svelte/Vite beside Pug and deliver Couch Mode

**Goal:** make Svelte the primary game UI without prematurely deleting legacy account pages.

## 13.1 Add `apps/web`

Create Svelte + TypeScript + Vite application. Serve its compiled assets from the existing Express server in production/local portable mode.

Do not make runtime gameplay depend on Vite dev server or any CDN.

## 13.2 Keep Pug as compatibility shell during migration

At this stage:

- retained account pages may still use Pug;
- existing generic error pages may still use Pug;
- new game UI must be Svelte;
- no new gameplay page should be added to Pug.

Once Svelte equivalents cover the retained flows and no production route requires Pug, retire Pug/Bootstrap/jQuery/esbuild client pieces in a dedicated cleanup change.

## 13.3 Svelte route/role model

One web application supports roles such as:

```text
/host
/display
/mobile
```

or equivalent state-driven routes.

For Couch Mode, a single host/display role provides all controls on one screen.

## 13.4 Required Couch Mode screens

Implement:

- main menu;
- setup flow;
- Group selection/creation or play-without-history;
- game mode selection;
- GameProfile selection/settings;
- lobby/start state;
- gameplay card view;
- settings modal;
- end screen.

Keep the current card visually dominant.

## 13.5 HTTP boundary

Use versioned HTTP routes for setup/non-realtime operations:

```text
/api/v1/...
```

Examples:

- server info;
- Group management;
- GameProfile management;
- Room creation;
- initial join;
- account endpoints;
- imports/exports/admin where included.

Transport validates Zod DTOs, resolves Principal and calls application services. No gameplay business logic belongs in Express handlers.

### Phase 6 exit criteria

- all four game modes are playable in Couch Mode using Svelte;
- server remains authoritative even though client and server are on one machine;
- legacy Pug auth remains functional where still needed;
- no full-page reload is needed between turns;
- browser E2E covers at least one full Couch flow for each mode.

---

# 14. Phase 7 — Add Rooms and WebSocket synchronization to the existing HTTP server

**Goal:** implement GDD multiplayer rooms using the same Node `http.Server` already created by the blueprint.

## 14.1 Attach `ws` to the existing server

Extend `src/server.ts` composition:

```text
validated settings
-> data source
-> Express app
-> node:http Server
-> ws WebSocketServer attached to same server
-> listen
```

Do not run a second independent game server process.

## 14.2 Protocol envelope

All WebSocket messages use the protocol package envelope with fields equivalent to:

```json
{
  "protocol": 1,
  "type": "...",
  "requestId": "... or null",
  "revision": 0,
  "payload": {}
}
```

## 14.3 Handshake first

Before accepting game commands:

1. socket opens;
2. only handshake message is accepted;
3. client sends `client.hello` with supported protocol versions, client type, app version, requested role/capabilities and Room credential;
4. server validates credential/version;
5. connection becomes authenticated;
6. unauthenticated sockets time out and close.

Do not put participant credentials in reusable URLs.

## 14.4 Room codes are identifiers, not authority

A short Room code lets a user request to join. It does not grant host rights. Public mode rate-limits code guessing.

## 14.5 Per-Room serialization

Implement a Room runtime registry with a queue/mutex per Room. Commands for a given Room run sequentially:

```text
command N
-> validate principal + revision
-> domain transition proposal
-> DB transaction
-> commit
-> runtime update
-> broadcast
-> command N+1
```

Different Rooms may process concurrently.

## 14.6 Commit before broadcast

Do not broadcast a state transition before required persistence succeeds. If persistence fails, clients remain on the previous committed revision.

## 14.7 Resynchronization and reconnect

Clients must be able to request a current Session snapshot containing revision, state, active player, visible card, voting state and relevant settings. A reconnecting phone must not depend on having received every prior event.

### Phase 7 exit criteria

- host, player and display connections use the same protocol;
- stale revisions are rejected/resynchronized;
- simultaneous advance commands cannot show two cards;
- server restart can recover committed Session state to the documented extent;
- WebSocket integration tests simulate host + players + display.

---

# 15. Phase 8 — Deliver Party Screen and Personal Mode

**Goal:** complete all three GDD device modes using the Svelte client.

## 15.1 Party Screen Mode

Shared display shows:

- lobby;
- QR code and room code;
- active player;
- cards;
- aggregate answers;
- round transitions;
- session status;
- animations/audio where enabled.

Phones provide supporting controls:

- join/display name;
- active-player Truth/Dare choice;
- voting;
- private boundary/settings input where implemented;
- skip/veto/host controls according to capability.

The display remains the social focal point.

## 15.2 Personal Mode

No central display is required. Every client remains synchronized, and the active player may receive different controls from other players.

## 15.3 QR generation

Generate QR locally/server-side or in bundled client code. Do not use a third-party QR web service.

## 15.4 Disconnect handling

If a phone disconnects:

- Session remains active;
- reconnect token reclaims participant identity;
- client receives authoritative snapshot;
- host may wait/remove/temporarily control where GDD permits;
- disconnected client never owns state.

### Phase 8 exit criteria

- Couch, Personal and Party Screen modes all work in browsers;
- guest participants need no public account;
- QR and room-code join work on LAN without internet;
- reconnect works after phone sleep/brief loss;
- Playwright covers the Party Screen join and control flow.

---

# 16. Phase 9 — Complete GameProfiles, boundaries and safety behavior

**Goal:** implement the full profile/boundary system after the core engine and multiplayer paths are stable.

## 16.1 Create `GameProfile` only for gameplay presets

Built-in GameProfiles include the canonical social presets from the GDD. Exact enabled categories/types are editorial data and must be validated against the real catalog.

Do not hard-code German labels into game logic. Use stable internal IDs.

## 16.2 Independent question and dare configuration

GameProfile must keep separate:

- allowed QuestionCategories;
- allowed DareTypes;
- maximum intensity / pacing configuration;
- operational restrictions;
- optional Dare Affinity weighting;
- mode-specific behavior such as Random ratio or meta-card frequency.

Disabling a QuestionCategory must not disable a DareType with matching affinity metadata.

## 16.3 Private player boundaries

Where included in the first release, support separate private restrictions for QuestionCategories, DareTypes and relevant operational flags.

Resolution rules follow GDD:

- turn-based question: active player's question boundary applies;
- group-answer questions: combined participating-player restrictions apply;
- DareTypes: safe default is group-wide intersection;
- shared display never attributes who excluded a sensitive item.

If private per-player boundaries are intentionally deferred under the GDD post-core allowance, the implementation must still have the boundary abstraction and must not claim to support the feature.

## 16.4 Skip and veto

Skip is always available with no default penalty. A revealed skipped/replaced card counts as seen.

## 16.5 Explicit adult content

If explicit adult profiles/content are enabled in the public MVP, implement deliberate eligibility and the required age/content gating, platform-policy handling and legal review path before exposing the content. Explicit content must never leak into lower profiles.

### Phase 9 exit criteria

- QuestionCategory and DareType toggles are independent;
- disabled DareTypes cannot reappear through escalation;
- `Unbeteiligte Dritte` is independently configurable;
- skip is always available;
- private exclusions are never publicly attributed;
- profile defaults are data-driven and editorially reviewable.

---

# 17. Phase 10 — Public deployment, retained account infrastructure and security hardening

**Goal:** finish the public deployment without changing game-domain semantics.

## 17.1 Same server, different adapters

Public mode uses:

- same compiled server application;
- MariaDB/MySQL driver;
- account authentication;
- account-owned DataSpace;
- email provider;
- optional OIDC;
- reverse-proxy/HTTPS configuration;
- rate limiting and origin checks.

Local mode continues using SQLite, local DataSpace and no persistent account login.

## 17.2 Keep account Sessions separate from game Sessions

HTTP browser account login uses server-side AccountSession storage. Game Session state uses the game persistence model and revisioned runtime snapshot. Never put game state into the HTTP auth session as the authoritative store.

## 17.3 CSRF and rate limiting

Add appropriate CSRF protection to cookie-authenticated HTTP mutations in public deployment. Rate-limit at least login, registration, password reset, room-code joining, pairing/import/activation attempts where present.

## 17.4 WebSocket origin and credentials

Public browser WebSockets validate Origin where applicable. Room participant credentials are validated through handshake. Do not broadcast private command payloads indiscriminately.

## 17.5 Logging

Preserve the centralized logging concept but introduce a logger abstraction with Pino as preferred implementation. Ensure logs never include passwords, reset/activation tokens, participant credentials, auth cookies, OIDC secrets, private boundary choices or individual Never-Have-I-Ever answers.

### Phase 10 exit criteria

- public deployment adds authentication without changing game rules;
- public login/reset/OIDC tests pass;
- Room guests can still join without accounts;
- sensitive rate limits and security tests exist;
- same application build can be configured for local and public deployment.

---

# 18. Phase 11 — Presentation, offline assets, packaging and final structural cleanup

**Goal:** satisfy the complete Core Release presentation and portability requirements.

## 18.1 Offline asset audit

All required runtime assets must be bundled locally:

- JavaScript/CSS;
- fonts;
- images;
- QR logic;
- sound effects;
- ambient music;
- card catalog.

No essential CDN runtime dependency is allowed.

## 18.2 Presentation requirements

Complete:

- responsive card layout;
- animated backgrounds;
- ambient music;
- sound effects;
- reduced motion;
- accessibility behavior;
- German UI strings separated from code.

## 18.3 Portable packaging

Produce local archives including Node runtime, server bundle, Svelte assets, SQLite native binding, catalog and writable data/config directories. End users must not install Node/npm/SQLite/build tools.

## 18.4 Final server relocation

When the root server is already modular and tests are green, move it mechanically into `apps/server/` and update workspace scripts/imports. No domain behavior changes should be mixed into this relocation.

## 18.5 Retire legacy UI and Surveyor remnants only now

After verifying no callers remain, retire:

- Pug pages that have Svelte replacements;
- renderer helpers used only by removed Pug screens;
- Bootstrap/jQuery/SASS/esbuild client dependencies with no remaining consumer;
- legacy Guest ownership code if fully migrated;
- entity permission infrastructure with no retained administrative consumer;
- Surveyor-only static files/settings/docs.

This is the correct point for cleanup—not Phase 0.

---

# 19. Concrete target domain/persistence contracts

This section gives enough detail for an autonomous implementer to avoid inventing incompatible shapes.

## 19.1 Repository interfaces

Prefer focused interfaces based on application needs, for example:

```ts
interface CardRepository {
  findEligibleCandidates(request: CardCandidateRequest): Promise<Card[]>;
  getById(id: CardId): Promise<Card | null>;
}

interface SessionRepository {
  get(id: SessionId): Promise<GameSessionSnapshot | null>;
  saveCommittedTransition(input: CommittedTransition): Promise<void>;
}

interface GroupRepository {
  get(id: GroupId): Promise<Group | null>;
  listByDataSpace(dataSpaceId: DataSpaceId): Promise<Group[]>;
}

interface CardHistoryRepository {
  getSessionHistory(sessionId: SessionId): Promise<CardAppearance[]>;
  getGroupHistory(groupId: GroupId): Promise<CardAppearance[]>;
}
```

Do not introduce a generic CRUD repository when a domain-specific contract is clearer.

## 19.2 Runtime Session snapshot

Persist a versioned serialized runtime state as text, alongside relational durable entities. A game Session record should contain concepts equivalent to:

```text
id
room_id
group_id nullable
mode
revision
runtime_state_version
runtime_state_json
started_at
ended_at
```

Validate runtime-state JSON on load. When schema version changes, migrate or explicitly mark incompatible active Sessions non-resumable; never silently reinterpret old data.

## 19.3 CardAppearance

Persist when committed for display, with concepts equivalent to:

```text
id
session_id
group_id nullable
card_id
player_id nullable
shown_at
round_number
skipped
completed
vetoed
```

This supports both Session and Group history; do not store history only in browser state.

---

# 20. Protocol contract to implement first

Implement protocol messages in small steps.

## 20.1 Initial message set

Start with:

- `client.hello`;
- `server.hello` / compatible protocol response;
- `room.snapshot.request`;
- `room.snapshot`;
- `room.presence`;
- `command.startSession`;
- `command.chooseCardType`;
- `command.skipCard`;
- `command.advanceSession`;
- `command.submitVote`;
- `session.stateChanged` or explicit state events;
- `error` with stable code.

Do not create a unique ad-hoc envelope per game mode.

## 20.2 Stable error codes

At minimum support canonical codes such as:

```text
ROOM_NOT_FOUND
ROOM_FULL
INVALID_GAME_STATE
NOT_ACTIVE_PLAYER
CARD_POOL_EXHAUSTED
STALE_SESSION_REVISION
NOT_AUTHORIZED
PROTOCOL_VERSION_UNSUPPORTED
```

Map domain/application errors to HTTP or WebSocket response forms at transport boundaries.

---

# 21. Testing migration plan

Keep the blueprint's Vitest/Playwright tooling and expand it to the TAD levels.

## 21.1 Domain unit tests

No HTTP, WebSocket, TypeORM or real DB. Cover:

- taxonomy filtering;
- history/repetition;
- weighted choice;
- mode transitions;
- rounds;
- profiles;
- intensity;
- boundaries;
- meta-card scheduling;
- voting calculations.

## 21.2 Simulation tests

Run deterministic large simulations and prove invariants such as:

- disabled DareType never appears;
- disabled QuestionCategory never appears;
- no ordinary Session duplicates;
- Group history works;
- cooldown works;
- AlwaysEligible behavior is correct;
- Random ratio converges appropriately;
- meta-card scheduler behavior is correct;
- pool exhaustion is explicit.

## 21.3 Persistence contract tests

Run the same repository contract suite against SQLite and MariaDB/MySQL.

## 21.4 Migration tests

Test:

```text
empty DB -> all migrations
```

and important upgrade paths, including:

- blueprint `Profile` -> DataSpace;
- account `Session` -> AccountSession;
- raw auth token -> token hash representation;
- schema additions for game persistence.

## 21.5 Protocol tests

Test valid/invalid parsing, protocol negotiation, authorization, stale revision, reconnect snapshot and capability handling.

## 21.6 WebSocket integration tests

Simulate host, player A, player B and display. Include intentional simultaneous commands.

## 21.7 Playwright E2E

Cover critical flows:

- local game creation;
- all four modes in Couch Mode;
- QR/room-code join;
- Party Screen Truth/Dare choice;
- Ich hab noch nie voting;
- reconnect;
- Group history across Sessions;
- public login/reset where applicable;
- settings changes.

---

# 22. Recommended first commits / work packages

An autonomous agent should implement the migration in approximately this order. Each item should leave the repository buildable.

1. **Stump stabilization:** remove only dangling stripped-Surveyor imports/routes; preserve account/settings/session/error infrastructure; restore smoke tests and lockfile.
2. **Configuration validation:** add deployment/auth/db settings and Zod validation while keeping settings hierarchy.
3. **Dual database composition:** add SQLite adapter and driver-aware migration data source; test both DBs.
4. **Identity naming:** rename HTTP `Session` persistence to `AccountSession` with migration.
5. **DataSpace migration:** introduce DataSpace and migrate ownership Profile without dropping user accounts.
6. **Auth hardening:** scrypt compatibility path, hashed one-time tokens, verified-email OIDC linking.
7. **Workspace skeleton:** add packages and `apps/web` without moving root server.
8. **Protocol foundation:** Zod envelope, error codes, capabilities and handshake schemas.
9. **Card normalization:** taxonomy entities, catalog fixture/import validator and stable card IDs.
10. **Game persistence:** Group, GameProfile, Room, RoomParticipant, game Session, CardAppearance repositories.
11. **Pure game-core:** state machine, eligibility policies, history/repeat/randomness and tests.
12. **Four mode implementations:** Classic, Random, Ich hab noch nie, Let's Talk with simulations.
13. **Svelte Couch Mode:** setup/lobby/game/end flow through application commands.
14. **WebSocket server:** attach `ws`, handshake/auth, snapshots and per-Room command queue.
15. **Party Screen:** QR join, phone controller, display synchronization, reconnect.
16. **Personal Mode:** synchronized phone-only role behavior.
17. **Profiles/boundaries:** built-ins, independent taxonomy filters, private/effective boundaries and safety rules.
18. **Public deployment:** retained account UI/API integration, security/rate limits, MariaDB path.
19. **Presentation/offline:** animation/audio/reduced motion, local assets, accessibility.
20. **Portable packaging:** bundled Node/SQLite/web/catalog and smoke tests.
21. **Final relocation/cleanup:** move server to `apps/server` and retire only unreferenced legacy UI/Surveyor remnants.

---

# 23. File-by-file starting instructions for an AI coding agent

When beginning from the supplied ZIP, apply the following concrete decisions.

## `package.json`

Keep current Express/TypeORM/auth/test dependencies initially. Add target dependencies incrementally (`ws`, `zod`, Pino, `better-sqlite3`, Svelte/Vite tooling). Keep `mysql2`, `express-session`, `connect-typeorm`, OIDC and nodemailer while public auth remains. Do not remove Pug/Bootstrap/jquery/esbuild until legacy pages have no callers.

Rename project metadata only after the first baseline build is green.

## `src/server.ts`

Keep this file as the bootstrap entry point initially. Preserve settings read before DB init. Refactor it to obtain a composition object and attach WebSocket to the same `http.Server`. Add shutdown hooks only after connection lifecycle is tested.

## `src/app.ts`

Remove imports to already-missing Surveyor routes. Keep session middleware and health/error chain. Replace hardcoded proxy/secure-cookie logic with config. Gradually replace the monolithic route list with transport modules. Do not delete the file until the final `apps/server` relocation.

## `src/controller/userController.ts`

Remove/split functions whose only purpose is aggregating missing Surveyor entities. Keep account operations. Over time move account orchestration under `auth`/application boundaries and leave Express handlers thin.

## `src/routes/users.ts`

Keep registration/login/logout/reset/activation/OIDC/account-delete paths for public mode. Replace Surveyor dashboard/profile-ownership flows with DataSpace-aware equivalents. Pug rendering can remain temporarily.

## `src/modules/settings.ts`

Preserve loader structure. Replace Surveyor-only settings gradually. Add TAD settings and validation facade. Eliminate security decisions based solely on `NODE_ENV`.

## `src/modules/database/dataSource.ts`

Preserve exported compatibility surface initially. Internally select SQLite or MariaDB adapter from validated settings. Keep `synchronize:false`.

## `migrationDataSource.ts`

Generalize to selected driver/config and keep as migration CLI integration. Never make it a separate schema model from runtime.

## `src/modules/database/entities/session/Session.ts`

Rename to AccountSession and migrate table. Keep `connect-typeorm` contract.

## `src/modules/database/entities/user/Profile.ts`

Treat as a migration source for DataSpace, not as a gameplay Profile. Introduce DataSpace, migrate data and callers, then retire this class.

## `src/modules/database/entities/user/User.ts`

Keep account identity. Replace `profiles` relation with DataSpace ownership semantics. Migrate password/token columns safely. Numeric account ID may remain unless a separate requirement mandates change; TAD UUID guidance focuses externally meaningful game entities.

## `src/modules/database/entities/user/Guest.ts`

Do not rename to RoomParticipant. Quarantine as legacy ownership/account behavior and retire after callers are removed.

## `src/modules/database/services/UserService.ts`

Keep account service behavior but split ownership-Profile methods into DataSpace service. Implement scrypt compatibility upgrade and hashed tokens. Tighten OIDC link behavior.

## `src/modules/oidc.ts`

Preserve PKCE/state/nonce logic. Update verified-email linking and configuration naming only.

## `src/modules/email.ts`

Preserve transport abstraction. Make it conditional by deployment/auth configuration and adapt templates/URLs.

## `src/modules/lib/errors.ts` and error middleware

Keep centralized architecture. Introduce transport-neutral error codes and map them to JSON/Pug/WS as appropriate during migration.

## `src/modules/permissionEngine.ts` / permission middleware

Do not delete while legacy account routes use them. Do not use for Room commands. Implement Room capabilities in the application layer. Remove legacy permission code only when it has zero retained consumers.

## `src/views`, `src/public/js`, Bootstrap/SASS assets

Freeze as legacy UI. No new gameplay features. Add Svelte app next to them, migrate flow-by-flow, retire after parity.

## Vitest / Playwright files

Keep. Recreate missing tests and adapt DB/server setup rather than replacing the runners.

---

# 24. Anti-patterns that make an implementation non-compliant

Reject a change if it does any of the following:

- deletes the account/OIDC/email/session infrastructure at project start;
- deletes `src/` and recreates a new server without migration;
- creates separate local and public game servers;
- builds gameplay logic into Svelte components or Express route handlers;
- makes domain models TypeORM entities;
- names the ownership boundary `Profile` after migration;
- uses the account Session as the game Session;
- reuses blueprint Guest as RoomParticipant;
- uses generic entity permissions as realtime Room authorization;
- stores raw participant/reset/activation tokens;
- trusts Room code as host credential;
- broadcasts before persistence commits;
- uses `Math.random()` directly in game-core;
- silently relaxes card filters on pool exhaustion;
- uses QuestionCategory as the primary Dare filter;
- ties secure cookies/proxy behavior only to `NODE_ENV`;
- relies on MariaDB-specific behavior in game business logic;
- introduces CDN runtime dependencies;
- performs the monorepo move and gameplay rewrite in one change;
- removes Pug/legacy assets before replacement routes are proven;
- uses schema sync/reset as the production migration strategy.

---

# 25. MVP Definition of Done

The migration is complete when all items below are true.

## Architecture

- one Node/TypeScript server codebase supports local and public deployments;
- Express handles HTTP and the same Node HTTP server hosts raw `ws` WebSockets;
- game-core imports neither Express nor TypeORM;
- transport controllers are thin;
- Svelte/Vite is the primary browser client;
- monorepo/package boundaries match the TAD or are functionally equivalent with documented rationale.

## Blueprint migration

- retained blueprint infrastructure remains recognizably reused/refactored rather than replaced without reason;
- ownership `Profile` has become DataSpace;
- `GameProfile` means only gameplay preset;
- HTTP AccountSession and game Session are distinct;
- legacy Surveyor/Pug/permission components have been retired only where replacement parity exists.

## Deployment/persistence

- local mode uses SQLite WAL and requires no internet/account login;
- public mode uses MariaDB/MySQL, HTTPS/WSS externally and account auth;
- both DB adapters pass common repository contracts;
- all production schema changes use migrations;
- portable archive includes runtime, server, web assets, SQLite binding and catalog.

## Gameplay/content

- all four game modes work;
- Couch, Personal and Party Screen browser modes work;
- QuestionCategory is primary for questions;
- DareType is primary for dares;
- Dare Affinity remains secondary;
- YesNoAnswerPossible drives Ich hab noch nie eligibility;
- Gespräch cards use scheduler logic;
- Session/Group history, AlwaysEligible, RepeatableInSession and cooldown behavior are correct;
- skip is always available;
- pool exhaustion is explicit;
- disabled content cannot be reintroduced by escalation.

## Multiplayer

- QR and room-code joining work;
- participants require no account;
- participant credentials are hashed server-side;
- handshake/version negotiation works;
- Session revisions reject stale commands;
- Room commands serialize;
- persistent changes commit before broadcast;
- reconnect obtains authoritative snapshot.

## Accounts/security/privacy

- public registration/login/logout/activation/reset/change/delete/session management work as required;
- OIDC is optional and secure;
- password hashes use the target adaptive scheme with migration from legacy hashes;
- one-time token storage is hashed;
- local mode has a lightweight admin capability instead of user accounts;
- private answers/boundaries are not unnecessarily persisted or logged;
- explicit adult content is gated when enabled publicly;
- CSRF/rate limiting/origin checks are implemented where required.

## Quality

- TypeScript strict compilation passes;
- unit, simulation, persistence, migration, protocol, WebSocket and E2E suites pass;
- CI blocks on compile/test/migration/lint failures;
- all essential runtime assets are local;
- no stale Surveyor imports remain;
- no required blueprint infrastructure was removed merely for convenience.

---

# 26. Final instruction to an autonomous implementation agent

Start from the supplied blueprint **as a functioning infrastructure lineage**, not as an empty folder.

Your first objective is to make the stripped stump buildable while preserving auth, configuration, sessions, database lifecycle, errors and test tooling. Your second objective is to generalize those foundations for the TAD. Only then add the game packages, content model and Svelte client. Migrate one boundary at a time. Keep compatibility facades where they prevent unnecessary rewrites. Delete legacy code only after all callers have moved and tests prove parity.

When uncertain whether to delete or reuse a blueprint component, default to **reuse/refactor**, then check TAD §§116–120. When uncertain about a gameplay rule, stop and check the GDD rather than inventing behavior.

The migration should feel like the existing Node application gradually becoming the party game—not like the party game replacing the repository.

---

# Appendix A — Source anchors used by this guideline

Use these source sections during implementation reviews:

**TAD**

- §§4–10 — authority, domain separation, repository/package architecture and incremental monorepo migration;
- §§11–20 — deployment modes, configuration, packaging and database portability;
- §§21–39 — identifiers, content import, DataSpace, accounts, local identity, Room participants and authorization;
- §§41–56 — game-domain structure, selection policies, state machine, revisions, persistence/history;
- §§62–70 — HTTP/WebSocket responsibilities, protocol, reconnect and browser architecture;
- §§77–86 — security, validation, privacy and observability;
- §§90–104 — testing, CI, build/upgrade/protocol compatibility;
- §§115–126 — offline dependencies, blueprint reuse/non-reuse, Profile migration and acceptance criteria.

**GDD**

- §§3–17 — foundational semantics and normalized content model;
- §§18–24 — Room/Session/Player/Group/Profile terminology and device/join behavior;
- §§25–43 — game modes, rotation, history, repetition, eligibility and pool exhaustion;
- §§44–55 — Profiles, boundaries, escalation, skip and veto;
- §§56 onward — UX/presentation and operational behavior;
- §§83–94 — validation, disconnects, accounts, privacy, adult content, performance and localization;
- §§95–97 — Core Release Scope, post-core enhancements and recommended development order;
- §§98–105 — canonical examples, selection model and acceptance criteria.
