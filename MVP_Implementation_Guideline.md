# MVP Implementation Guideline
## Transforming the Node.js Blueprint into the Multiplayer Party Card Game — Version 0.1

**Status:** Implementation baseline for the first playable MVP  
**Audience:** Junior developers and autonomous coding agents  
**Source basis:** Multiplayer Party Card Game — Technical Architecture Document v1.0 (TAD), Multiplayer Party Card Game — Game Design Document v1.1 (GDD), and the attached NodeJs-Blueprint archive  
**Primary implementation language:** TypeScript / Node.js  
**MVP deployment target:** Local/LAN-first, browser clients, SQLite  

---

## 1. Purpose and how to use this guideline

This document is an execution guide. It is intentionally more prescriptive than the TAD and GDD. The canonical documents define the product and architectural rules; this guide translates them into concrete implementation steps starting from the supplied Node.js Blueprint.

A developer or coding agent should be able to work through the phases in order and reach a testable first version without inventing architecture along the way. Where the canonical documents intentionally leave an implementation choice open, this guide makes a concrete MVP choice and labels it as such. Those choices are implementation decisions, not replacements for the canonical documents.

When a rule in this guide conflicts with a MUST-level rule in the TAD, follow the TAD and correct this guide. When gameplay behavior conflicts with the GDD, follow the GDD.

### 1.1 Normative keywords

- **MUST**: required for the MVP implementation.
- **SHOULD**: expected unless there is a documented technical reason not to.
- **MAY**: optional.
- **DEFERRED**: intentionally outside the MVP, but the implementation must not block it.

### 1.2 Source traceability convention

References such as **TAD §47** or **GDD §40** refer to sections in the attached canonical documents. The most important governing sections for this implementation are:

- TAD §§4–5: server authority, LAN-first behavior, framework-independent domain, canonical stack.
- TAD §§8–10: repository/package responsibilities and explicit composition.
- TAD §§11–20: deployment, configuration, offline assets, SQLite/MariaDB portability.
- TAD §§25–40: DataSpace, identity, Room participants, authorization, WebSocket authentication.
- TAD §§41–60: game domain, selection, state machine, revisioning, persistence, repositories, migrations.
- TAD §§62–70: HTTP/WebSocket responsibilities, protocol, resynchronization, browser client.
- TAD §§82–99: validation, privacy, observability, testing and CI.
- TAD §§116–120: what to retain and not retain from the Node.js Blueprint.
- GDD §§16–17: normalized card semantics and stable identifiers.
- GDD §§20–29: device modes and the four game modes.
- GDD §§30–43: rotation, rounds, history, repeat behavior, eligibility and pool exhaustion.
- GDD §§44–56: profiles, boundaries, skip/veto.
- GDD §§93–97: performance, localization, release scope and recommended development order.

---

## 2. MVP definition

The canonical documents do not define a feature set called “MVP”. The GDD defines a larger **Core Release Scope** that includes all device modes, presentation polish and broader product features. This guideline therefore defines a smaller engineering MVP that validates the complete architectural spine and delivers a genuinely playable local multiplayer game.

### 2.1 MVP product statement

The MVP is a **local/LAN-first browser game** that can be started on one computer, played either on that shared screen or with phones connected over the local network, and can run all four canonical game modes using normalized card content. The server remains authoritative, tracks Session and Group history, prevents accidental repeats, and recovers connected clients through snapshots/reconnect tokens.

### 2.2 In-scope features

| Area | MVP requirement |
|---|---|
| Deployment | Local mode only (`DEPLOYMENT_MODE=local`) |
| Database | SQLite via TypeORM + `better-sqlite3`, WAL enabled |
| Server | One Node.js/TypeScript Express 5 server with `ws` WebSockets |
| Web client | Svelte + TypeScript + Vite, served locally by the Node server |
| Device modes | Couch Mode and Party Screen Mode |
| Game modes | Classic Wahrheit oder Pflicht, Random Wahrheit oder Pflicht, Ich hab noch nie, Let's Talk |
| Content model | QuestionCategory, DareType, DareAffinityCategory, YesNoAnswerPossible, Intensity, repeat fields, required operational flags |
| Profiles | Built-in curated profiles needed by the MVP; use conservative non-explicit defaults |
| Groups | Create/select Group or play without persistent Group history |
| History | Session history, Group history, AlwaysEligible, RepeatableInSession, cooldown |
| Rooms | Create Room, short code, QR join URL, guest display name, host/player/display roles |
| Realtime | Versioned protocol, `client.hello`, state snapshot, commands/events, revision checks |
| Reconnect | Temporary participant credential; snapshot recovery after reconnect |
| Host controls | Start game, manage lobby roster, skip/advance where allowed, end game |
| UX | Main menu, setup, lobby, gameplay, basic settings, end screen |
| Accessibility | Keyboard usable, responsive layout, reduced-motion mode, readable contrast |
| Packaging | Offline runtime assets; one documented portable packaging path and smoke test |
| Testing | Domain/unit, persistence, protocol, WebSocket integration, Playwright E2E |

### 2.3 Explicitly deferred features

The following are not required for MVP acceptance:

- public deployment;
- MariaDB as an executed runtime target (the adapter seam must exist, but public deployment is deferred);
- registration/login/password reset/OIDC/email flows in the active MVP runtime;
- Personal Mode;
- Kodi client;
- Android TV / Google TV / Fire TV client;
- custom GameProfiles;
- custom cards;
- per-player private content boundaries;
- private veto;
- explicit-adult profile/content enablement such as `Paare – Spicy`;
- advanced target-aware dare filtering;
- sophisticated game phases/escalation;
- ambient music and final sound design;
- advanced animation/theming;
- content administration UI;
- analytics/statistics;
- mDNS discovery;
- horizontal scaling.

These are scope deferrals, not architectural removals. Keep interfaces and naming compatible with the future capabilities.

### 2.4 Why this is the correct MVP cut

The GDD recommends implementing normalized content and the core engine first, then validating all four game modes in Couch Mode before adding multiplayer Rooms, followed by Party Screen/Personal interaction. This MVP follows that dependency order but stops after the flagship Party Screen vertical slice. It also uses the GDD’s allowance that private boundaries may be post-core, and avoids shipping explicit adult profiles until those controls and product gating are ready.

---

## 3. Blueprint baseline assessment

The attached Node.js Blueprint is useful infrastructure, but it must not be treated as the target architecture. It is currently a Surveyor application scaffold with application-specific naming and assumptions.

### 3.1 What to retain

Retain and refactor these concepts:

- Node.js + TypeScript bootstrap;
- Express 5 application lifecycle;
- creation of a shared Node `http.Server`;
- centralized error handling pattern;
- async route-handler helper;
- TypeORM initialization and migration workflow concept;
- HTTP session infrastructure for future public accounts;
- OIDC and mail modules as future public-mode infrastructure, after security refactoring;
- `/healthz` endpoint concept;
- strict TypeScript configuration;
- Vitest and Playwright tooling patterns;
- generated TypeORM entity/migration index concept if it remains reliable;
- release scripts/build discipline where still applicable.

This matches TAD §116: reuse infrastructure, not Surveyor domain behavior.

### 3.2 What must be replaced or removed

Do not carry these Blueprint concepts into game architecture:

- Pug as the primary UI;
- Bootstrap/jQuery page structure;
- Surveyor routes (`survey`, `packing`, `activity`, `drivers`, `event`, etc.);
- Surveyor-specific controllers and domain services;
- Surveyor entity inheritance hierarchy as the basis for game entities;
- generic entity assignment/permission engine for Room gameplay;
- ownership concept named `Profile`;
- MariaDB-only persistence assumptions and `information_schema` helpers;
- controller-contained business rules;
- `NODE_ENV`-driven security behavior;
- Joi/Express-validator as the canonical contract-validation system;
- bcrypt-based password storage when public authentication is reactivated;
- raw activation/reset tokens stored in the database.

These exclusions follow TAD §§117–120 and the authentication requirements in TAD §§29–32.

### 3.3 Immediate baseline defects to resolve before feature work

The supplied archive contains stale imports in `src/app.ts` and `src/routes/api.ts` for Surveyor route modules that are not present in the archive. The first implementation commit should remove those obsolete routes rather than reconstructing Surveyor features.

The Blueprint also includes a `settings.csv` artifact containing environment-specific values. Treat all such values as potentially sensitive. Do not copy them into the new project. Remove the file from the working tree, keep it ignored, create a sanitized example configuration, and rotate any real credentials if the archive ever contained live secrets.

The Blueprint’s current `src/modules/settings.ts` can auto-create a settings CSV and the current `app.ts` sets secure cookies from `NODE_ENV`. Both behaviors must be replaced because the TAD requires explicit deployment configuration and prohibits `NODE_ENV` from determining security behavior on its own.

### 3.4 Concrete Blueprint transformation map

| Blueprint item | MVP action | Target |
|---|---|---|
| `src/server.ts` | **RETAIN + REFACTOR** | Bootstrap validated configuration, DataSource, Express app, WebSocket server, graceful shutdown |
| `src/app.ts` | **SPLIT** | HTTP app factory under `apps/server/src/transport/http/`; remove Surveyor routes/views |
| `src/modules/settings.ts` | **REPLACE** | `packages/configuration` with Zod schema and layered defaults/file/env resolution |
| `settings.csv` | **DELETE** | sanitized `.env.example` / optional config file only |
| `src/modules/database/dataSource.ts` | **REFACTOR** | driver factory supporting SQLite now and MariaDB later |
| `migrationDataSource.ts` | **REFACTOR** | reuse canonical configuration and entity/migration lists |
| `Session` TypeORM entity used by `connect-typeorm` | **RENAME** | `AccountSessionEntity`; avoid collision with game `Session` |
| `Profile` ownership entity | **REPLACE/RENAME** | `DataSpaceEntity`; `GameProfile` reserved for gameplay preset |
| `User`, `Guest`, `UserService`, OIDC, email | **PARK** | move under future/public auth module; not wired in local MVP |
| `permissionEngine.ts`, permission middleware/types | **DELETE FROM GAME PATH** | Room capabilities implemented separately |
| Surveyor controllers/routes/views | **DELETE** | game HTTP/WebSocket transport and Svelte UI |
| `src/public/js`, Pug views, Bootstrap/jQuery | **REPLACE** | `apps/web` Svelte/Vite app |
| generic error handler | **RETAIN + ADAPT** | map stable application error codes to HTTP/WS responses |
| `asyncHandler.ts` | **RETAIN** | HTTP adapter utility only |
| generated DB index script | **RETAIN IF USEFUL** | adapt paths to new persistence package |
| migration helpers querying `information_schema` | **REPLACE** | portable TypeORM schema APIs or driver-branching only inside migrations |
| Vitest/Playwright setup | **RETAIN + REPOINT** | new unit/integration/e2e suites |
| README/docs | **REWRITE** | game-specific setup, architecture and protocol docs |

---

## 4. Target repository structure for the MVP

Use an npm-workspace monorepo. The TAD allows incremental migration, so do not move every retained Blueprint file in one commit. Create the target structure first, then move/refactor one subsystem at a time while keeping builds green.

```text
party-game/
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── bootstrap/
│   │   │   ├── transport/
│   │   │   │   ├── http/
│   │   │   │   └── websocket/
│   │   │   ├── auth/                 # dormant in local MVP
│   │   │   └── infrastructure/
│   │   └── tests/
│   └── web/
│       ├── src/
│       │   ├── lib/
│       │   ├── routes-or-views/
│       │   ├── state/
│       │   └── i18n/
│       └── public/
├── packages/
│   ├── game-core/
│   │   └── src/
│   │       ├── cards/
│   │       ├── eligibility/
│   │       ├── history/
│   │       ├── modes/
│   │       ├── profiles/
│   │       ├── random/
│   │       ├── repetition/
│   │       ├── rounds/
│   │       ├── sessions/
│   │       └── voting/
│   ├── application/
│   │   └── src/
│   │       ├── commands/
│   │       ├── ports/
│   │       ├── services/
│   │       └── errors/
│   ├── protocol/
│   │   └── src/
│   │       ├── http/
│   │       ├── websocket/
│   │       ├── errors/
│   │       └── schema-export/
│   ├── persistence/
│   │   └── src/
│   │       ├── entities/
│   │       ├── repositories/
│   │       ├── datasource/
│   │       ├── migrations/
│   │       └── catalog/
│   ├── configuration/
│   └── design-tokens/
├── tooling/
│   ├── card-import/
│   └── catalog-build/
├── tests/
│   ├── simulation/
│   ├── protocol/
│   ├── persistence-contract/
│   └── e2e/
├── packaging/
├── docs/
└── package.json
```

### 4.1 Package dependency rule

Enforce this dependency direction:

```text
web client -> protocol types only
server transport -> application + protocol
application -> game-core + repository/port interfaces
persistence -> application port interfaces + TypeORM
configuration -> no application/domain dependency
game-core -> Node standard library types only where unavoidable; no Express/TypeORM/ws/Svelte
```

`game-core` MUST NOT import Express, TypeORM, `ws`, Svelte, email or authentication code.

### 4.2 Incremental migration sequence

1. Keep the existing root project compiling while creating `apps/` and `packages/`.
2. Extract configuration first.
3. Extract persistence configuration second.
4. Create `game-core`, `application` and `protocol` as empty packages with tests.
5. Move Express bootstrap into `apps/server` after the new packages compile.
6. Add `apps/web` and remove Pug only after the Svelte shell is served successfully.
7. Delete old Surveyor modules only when no retained code imports them.

Do not perform a large path-only refactor and a gameplay implementation in the same commit.

---

## 5. Dependency changes

### 5.1 Keep for MVP

- `express`
- `typeorm`
- `dotenv` (only as one optional environment source; Zod performs validation)
- `express-session` and `connect-typeorm` only if the dormant public-auth code still compiles; do not use them for game Sessions
- `openid-client` and `nodemailer` only in a dormant public-auth package if keeping them is cheaper than removing/re-adding
- `http-errors` only at the HTTP adapter boundary if useful
- `typescript`
- `vitest`
- `@playwright/test`
- `concurrently` / `cross-env` if still needed by scripts

### 5.2 Add

- `ws`
- `zod`
- `pino`
- `pino-http` or a very small Express request-logging adapter around Pino
- `better-sqlite3`
- `svelte`
- `vite`
- `@sveltejs/vite-plugin-svelte`
- a local QR-generation package bundled into the web client (choose one actively maintained dependency and pin it)

### 5.3 Remove after equivalent code is gone

- `pug`
- `bootstrap`
- `jquery`
- `sass` if no longer used
- `morgan`
- `joi`
- `express-validator`
- `bcryptjs` from the active dependency path; public auth later uses Node `scrypt`
- `pdfmake`
- Surveyor-specific dependencies that become unused (`csv-reader`, `multer`, etc.)

Run `npm ls --depth=0` and a dead-dependency check after migration. Do not keep dependencies “just in case” unless they are explicitly parked for the public-auth module.

---

## 6. Phase 0 — Make the Blueprint a clean game baseline

**Goal:** one buildable, testable Express application with no Surveyor feature dependencies.

### Tasks

1. Create a new working branch/repository from the Blueprint.
2. Preserve the Apache-2.0 license and existing copyright notices where legally required.
3. Delete stale Surveyor route imports from `src/app.ts` and `src/routes/api.ts`.
4. Temporarily keep only:
   - `/healthz`;
   - a simple root page or static placeholder;
   - the central error handler.
5. Remove Surveyor-specific routes/controllers/views/entities/services that are not needed by retained account infrastructure.
6. Rename the HTTP-session persistence entity from `Session` to `AccountSessionEntity` immediately.
7. Remove `settings.csv` from the project and create sanitized `.env.example`.
8. Ensure generated artifacts (`dist`, generated JS/CSS, DB index) are not the source of truth.
9. Run TypeScript strict compile.
10. Create one smoke test for `/healthz`.

### Acceptance criteria

- `npm install` succeeds from a clean checkout.
- TypeScript compiles with strict mode.
- The server starts without requiring MariaDB.
- `GET /healthz` returns HTTP 200 and `ok`.
- There are no imports of absent Surveyor route modules.
- No real secret is present in committed configuration.
- The term `Profile` is no longer used for future game-data ownership.

---

## 7. Phase 1 — Configuration and application bootstrap

**Goal:** startup behavior is explicit, validated and deployment-mode aware before any database initialization.

### 7.1 Implement `packages/configuration`

Create a Zod schema with these MVP settings:

```text
DEPLOYMENT_MODE = local | public
AUTH_MODE       = none | password | oidc | password_oidc
HTTP_BIND       = string
HTTP_PORT       = integer 1..65535
PUBLIC_URL      = URL (optional in local mode)
DB_TYPE         = sqlite | mariadb | mysql
DB_FILE         = path (required for sqlite)
DB_HOST         = string (public DB)
DB_PORT         = integer
DB_NAME         = string
DB_USER         = string
DB_PASSWORD     = string
TRUST_PROXY     = boolean
LOG_LEVEL       = trace|debug|info|warn|error|fatal
DATA_DIR        = path
CATALOG_FILE    = path or packaged resource location
ROOM_TTL_MINUTES = positive integer
PARTICIPANT_RECONNECT_TTL_MINUTES = positive integer
```

MVP defaults:

```text
DEPLOYMENT_MODE=local
AUTH_MODE=none
HTTP_BIND=0.0.0.0
HTTP_PORT=8080
DB_TYPE=sqlite
DB_FILE=./data/party-game.sqlite
TRUST_PROXY=false
LOG_LEVEL=info
ROOM_TTL_MINUTES=480
PARTICIPANT_RECONNECT_TTL_MINUTES=30
```

### 7.2 Resolution order

Implement exactly:

```text
built-in defaults
  -> optional local configuration file
  -> environment variables
```

Environment variables override the file. Validate the merged object before creating the DataSource.

### 7.3 Invalid combinations

Startup MUST fail with a clear error for at least:

- `DEPLOYMENT_MODE=public` + `AUTH_MODE=none`;
- `DB_TYPE=sqlite` + populated remote DB host credentials that imply a conflicting configuration;
- `DEPLOYMENT_MODE=local` + missing/invalid SQLite path;
- `HTTP_PORT` outside range;
- invalid `PUBLIC_URL`;
- public mode with `TRUST_PROXY` not explicitly configured by the deployment environment.

Do not silently “fix” invalid configuration.

### 7.4 Refactor bootstrap

Target flow in `apps/server/src/bootstrap/main.ts`:

```text
load + validate settings
-> initialize logger
-> initialize DataSource
-> run/verify migrations according to mode
-> ensure local DataSpace exists
-> ensure catalog version is installed
-> compose repositories and application services
-> create Express app
-> create Node http.Server
-> attach WebSocket server to same http.Server
-> listen
-> register graceful shutdown handlers
```

### 7.5 Security corrections from Blueprint

- Remove `secure: process.env.NODE_ENV === "production"`.
- Cookie security, proxy trust and HTTPS assumptions must come from deployment configuration.
- Do not initialize account sessions in local mode unless a later local-admin implementation actually needs them.

### Acceptance criteria

- Configuration unit tests cover valid local mode and invalid combinations.
- Database initialization cannot run before configuration validation.
- Local startup requires no SMTP/OIDC/account variables.
- The same bootstrap has extension points for public adapters; there is no second server implementation.

---

## 8. Phase 2 — Persistence foundation and schema

**Goal:** establish the normalized game database before implementing gameplay.

### 8.1 DataSource factory

Create `createDataSource(settings)` in `packages/persistence`.

For SQLite:

- TypeORM driver: `better-sqlite3`;
- DB path from `DB_FILE`;
- `synchronize: false`;
- migrations enabled;
- enable WAL after initialization with `PRAGMA journal_mode = WAL`;
- optionally set `foreign_keys = ON` explicitly;
- only the Node server opens the DB file.

For MariaDB/MySQL:

- keep the adapter implementation compilable but do not make it an MVP runtime requirement;
- use the same entities and repository contracts;
- never branch business logic on DB type.

### 8.2 Entity naming

Use explicit `*Entity` persistence names to avoid confusing persistence with domain objects, for example `CardEntity` vs domain `Card`.

### 8.3 MVP schema

Implement migrations for the following tables. UUID columns are stored as portable strings.

#### `data_spaces`

```text
id              varchar UUID primary key
kind            varchar (LOCAL, ACCOUNT)
created_at      datetime
updated_at      datetime
```

On first local startup create exactly one `LOCAL` DataSpace and retain its stable ID.

#### `question_categories`

```text
code            varchar primary key
label_de        varchar
sort_order      integer
active          boolean
```

Seed canonical stable codes from the GDD, including `CAT_EVERYDAY`, `CAT_CHILDHOOD`, `CAT_PERSONALITY`, `CAT_SCENARIO`, `CAT_INTOXICATION`, `CAT_FRIENDSHIP`, `CAT_RELATIONSHIP`, `CAT_BODY`, `CAT_SEXUALITY`, `CAT_SEX_OPENNESS`, `CAT_SEX_TENSION`, `CAT_SEX_EXPERIENCE`.

#### `dare_types`

```text
code            varchar primary key
label_de        varchar
sort_order      integer
active          boolean
```

Seed all canonical DareType codes from the GDD. The MVP profiles may leave sensitive types disabled, but the taxonomy should exist.

#### `cards`

```text
id                         varchar UUID primary key
source_id                  integer nullable
card_text                  text not null
card_type                  varchar not null      # QUESTION | DARE | CONVERSATION
origin                     varchar nullable
origin_category            varchar nullable
yes_no_answer_possible     boolean not null
question_category_code     varchar nullable FK
dare_type_code             varchar nullable FK
dare_affinity_category_code varchar nullable FK
intensity                  integer not null      # 1..5
always_eligible            boolean not null
repeatable_in_session      boolean not null
repeat_cooldown            integer nullable
weight_milli               integer not null      # MVP implementation decision: 1000 = weight 1.0
active                     boolean not null
created_at                 datetime
updated_at                 datetime
```

Validation invariants:

- QUESTION: `question_category_code` required; dare fields null.
- DARE: `dare_type_code` required; question category null; affinity optional.
- CONVERSATION: no DareType; optional question category allowed for editorial purposes.
- intensity is 1–5.
- `weight_milli > 0`.
- repeat cooldown is null or non-negative.

The integer `weight_milli` choice avoids cross-database floating-point ambiguity while preserving the GDD’s conceptual weight. Keep conversion inside the domain mapper.

#### `card_flags`

```text
card_id          varchar FK
flag_code        varchar
PRIMARY KEY(card_id, flag_code)
```

Start with flags required by actual imported content. The engine must never infer operational behavior by parsing card text.

#### `game_profiles`

```text
id               varchar UUID primary key
stable_code      varchar unique not null
owner_data_space_id varchar nullable FK
name_de          varchar not null
built_in         boolean not null
max_intensity    integer not null
random_question_ratio_permille integer not null
meta_every_n_questions integer nullable
active           boolean not null
```

Use join tables:

```text
game_profile_question_categories(profile_id, category_code)
game_profile_dare_types(profile_id, dare_type_code)
game_profile_blocked_flags(profile_id, flag_code)
```

For MVP, built-in profiles are immutable and seeded. Do not ship `Paare – Spicy` as selectable until explicit-content controls are implemented.

#### `groups`

```text
id               varchar UUID primary key
data_space_id    varchar FK not null
name             varchar not null
created_at       datetime
updated_at       datetime
```

#### `group_members`

Optional for MVP UI but create the table so persistent player names do not need a later breaking migration:

```text
id               varchar UUID primary key
group_id         varchar FK not null
display_name     varchar not null
active           boolean not null
created_at       datetime
```

#### `rooms`

```text
id               varchar UUID primary key
room_code        varchar unique not null
status           varchar not null       # LOBBY | ACTIVE | ENDED | EXPIRED
host_participant_id varchar nullable
created_at       datetime
expires_at       datetime
ended_at         datetime nullable
```

Room code is an identifier, not an authorization secret.

#### `room_participants`

```text
id               varchar UUID primary key
room_id          varchar FK not null
display_name     varchar not null
role             varchar not null       # HOST | PLAYER | DISPLAY
token_hash       varchar not null
created_at       datetime
last_seen_at     datetime
left_at          datetime nullable
```

Generate the raw credential with a cryptographically secure random source. Store only a hash. Return the raw token once to the client.

#### `game_sessions`

Do not name this table/entity merely `Session`, because account HTTP sessions exist separately.

```text
id                    varchar UUID primary key
room_id               varchar FK not null
group_id              varchar nullable FK
game_profile_id       varchar FK not null
mode                  varchar not null
device_mode           varchar not null
revision              integer not null
runtime_state_version integer not null
runtime_state_json    text not null
started_at            datetime
ended_at              datetime nullable
```

`runtime_state_json` must validate against a versioned Zod schema before use.

#### `card_appearances`

```text
id               varchar UUID primary key
session_id       varchar FK not null
group_id         varchar nullable FK
card_id          varchar FK not null
player_id        varchar nullable
shown_at         datetime not null
round_number     integer nullable
skipped          boolean not null
completed        boolean not null
vetoed           boolean not null
```

Create indexes at least on `(session_id, card_id)`, `(group_id, card_id)`, and `(session_id, shown_at)`.

#### `catalog_meta`

```text
key              varchar primary key
value            varchar not null
```

Store `catalog_version` here or use a dedicated one-row catalog table.

### 8.4 Migrations

- Create schema only through versioned TypeORM migrations.
- Never enable `synchronize` in production or packaged builds.
- Remove Blueprint migration helpers that assume MariaDB `information_schema` from common migration code.
- If a migration truly needs driver-specific DDL, branch inside that migration only.

### Acceptance criteria

- Empty SQLite DB -> all migrations -> valid schema.
- Restarting server does not recreate or destroy data.
- WAL mode is confirmed in an integration test or readiness diagnostic.
- One local DataSpace exists after startup.
- All externally meaningful game entities use UUID strings.
- `GameProfile`, `DataSpace`, `AccountSession`, and `GameSession` terminology is unambiguous in code and DB.

---

## 9. Phase 3 — Catalog import and normalized content

**Goal:** load production-shaped card data through a reproducible validated pipeline.

The actual Access card database/export is not attached to the implementation request. Therefore this phase can implement and test the importer, but final production catalog ingestion requires the real source export as an external input.

### 9.1 Import boundary

The production server MUST NOT read Access directly. Implement a development/build-time importer:

```text
Access export (CSV/JSON)
-> raw input parser
-> normalization
-> validation report
-> deterministic UUID assignment
-> versioned normalized catalog artifact
-> catalog install migration/service
```

### 9.2 Required source fields

Accept at minimum:

```text
ID
CardText
Type
Origin
OriginCategory
YesNoAnswerPossible
Category
DareType
```

### 9.3 Normalization rules

- Trim surrounding whitespace but preserve original text for audit metadata if text is corrected.
- Map `Type` to stable codes `QUESTION`, `DARE`, `CONVERSATION`.
- For QUESTION, map source `Category` to canonical QuestionCategory.
- For DARE, map source `DareType` to canonical DareType and source `Category` to DareAffinityCategory.
- Never treat a dare affinity category as the primary dare filter.
- Preserve `Origin`, `OriginCategory`, source ID and warnings.
- Assign deterministic UUIDs to system cards from a fixed namespace + stable source identity. Commit the namespace constant and never change it after release.
- Set default `intensity`, flags, repeat behavior and weight only from curated mapping/input rules. Do not infer sensitive flags by keyword scanning unless it is explicitly a tooling warning requiring human review; the game runtime must not depend on such inference.

### 9.4 Validation report

Importer exits non-zero when a hard error exists. Generate a report containing:

- total rows;
- imported rows;
- invalid rows;
- unmapped card types;
- unmapped question categories;
- unmapped DareTypes;
- missing required classification;
- duplicate source IDs;
- duplicate deterministic UUIDs;
- empty text;
- invalid intensity/repeat values;
- normalization warnings.

### 9.5 MVP fallback catalog

Until the real export is supplied, commit a small **test-only fixture catalog** that covers every game mode and taxonomy branch. Clearly label it non-production. Do not invent ~2,000 production cards.

### Acceptance criteria

- Same input produces byte-for-byte stable card IDs and semantically identical normalized output.
- Invalid classification fails the build/import.
- QUESTION and DARE taxonomy invariants are tested.
- Catalog install can be re-run idempotently for the same version.
- Updating catalog content never deletes Group history or old CardAppearance references; cards are deactivated rather than destructively removed when necessary.

---

## 10. Phase 4 — Pure game domain (`game-core`)

**Goal:** implement all gameplay without HTTP, WebSocket or TypeORM.

### 10.1 Core domain types

Create explicit types/value objects:

```text
CardId
PlayerId
RoomId
SessionId
GroupId
GameProfileId
Revision
RoundNumber
CardType
QuestionCategoryCode
DareTypeCode
CardFlagCode
GameMode
DeviceMode
```

Stable code enums/constants use English internal identifiers. German strings belong in UI/catalog metadata.

### 10.2 Domain `Card`

Domain Card is immutable for the duration of a selection operation. It contains only gameplay-relevant fields, not TypeORM decorators.

### 10.3 `GameProfile`

A GameProfile contains:

- allowed QuestionCategory codes;
- allowed DareType codes;
- blocked operational flags;
- maximum intensity;
- Random-mode target ratio;
- Let's Talk meta-card pacing configuration.

For the MVP, omit custom ownership mutation behavior from the domain; built-in profiles are loaded as data.

### 10.4 Random abstraction

Define:

```ts
interface RandomSource {
  nextInt(maxExclusive: number): number;
}
```

Production implementation uses Node cryptographic randomness. Test implementation is deterministic/seeded. `game-core` MUST NOT call `Math.random()`.

### 10.5 Eligibility input

Do not let the domain query the database. Application/persistence loads candidate cards/history and supplies a `CardSelectionContext` containing all facts needed for a selection.

Recommended shape:

```text
mode
requestedCardType (if applicable)
profile
activePlayer
participatingPlayers
candidateCards
sessionAppearances
recentAppearanceOrder
groupSeenCardIds
currentRound
modeRuntime
```

Private boundaries are not part of MVP behavior, but reserve an optional effective-boundary field so adding them later does not rewrite selection APIs.

### 10.6 Question eligibility pipeline

Implement each stage as a separately testable policy/function in this order:

1. card type is QUESTION;
2. mode constraints;
3. `YesNoAnswerPossible` for Ich hab noch nie;
4. enabled QuestionCategory;
5. GameProfile restrictions;
6. effective player boundaries (MVP: no additional restriction);
7. intensity;
8. active flag;
9. current Session history;
10. Group history;
11. AlwaysEligible rule;
12. repeat cooldown;
13. weight;
14. random choice.

After the card is selected, **selection is not complete until persistence commits the CardAppearance**.

### 10.7 Dare eligibility pipeline

Implement in this order:

1. card type is DARE;
2. enabled DareType;
3. GameProfile DareType restrictions;
4. effective player DareType boundaries (MVP: no additional restriction);
5. operational flags;
6. optional DareAffinity weighting/rules;
7. intensity;
8. active flag;
9. current Session history;
10. Group history;
11. AlwaysEligible;
12. repeat cooldown;
13. weight;
14. random choice.

QuestionCategory must never be used as the primary Dare filter.

### 10.8 Repeat logic

Implement exactly the GDD matrix:

- normal card: excluded by Session history and Group history;
- AlwaysEligible only: ignores Group history, still once per current Session;
- RepeatableInSession only: still subject to Group history, may repeat in current Session after cooldown;
- both: may return in later Sessions and in current Session after cooldown.

Default repeat cooldown: 10 other displayed cards unless card-specific override exists.

### 10.9 Pool exhaustion

Never silently relax filters. Domain returns a typed `CardPoolExhaustedError`/result. UI offers only explicit user choices later; the engine does not auto-enable categories or previously seen cards.

### 10.10 Player rotation and rounds

For turn-based modes:

- choose random starting player once;
- retain stable player order;
- skip inactive/removed players;
- complete round when every active player has had one turn;
- increment round after the final player resolves their turn.

### 10.11 Mode contract

Use a common interface concept similar to:

```ts
interface GameModeHandler {
  initialize(context: InitializeModeContext): ModeState;
  allowedCommands(state: GameSessionState): readonly CommandType[];
  handleCommand(command: DomainCommand, state: GameSessionState, context: DomainContext): DomainTransition;
}
```

Exact names may differ; do not create separate persistence/network engines per mode.

### 10.12 Classic Wahrheit oder Pflicht

Stable committed states:

```text
CHOOSING_CARD_TYPE
SHOWING_CARD
WAITING_FOR_RESOLUTION
ENDED
```

Flow:

1. active player exists;
2. state `CHOOSING_CARD_TYPE`;
3. active player/authorized shared host chooses QUESTION or DARE;
4. build only the chosen pool;
5. select card;
6. application commits CardAppearance + new runtime state;
7. state becomes `WAITING_FOR_RESOLUTION` with visible card;
8. resolve/skip;
9. advance player/round;
10. return to `CHOOSING_CARD_TYPE`.

Do not select both truth and dare cards in advance.

### 10.13 Random Wahrheit oder Pflicht

- No player choice of type.
- Keep counters for question/dare appearances in mode runtime state.
- Default target 60/40 unless profile overrides.
- Choose next type by deficit toward target while avoiding >3 identical types where pool availability permits.
- If one type pool is exhausted, use the other only if it is still valid under the profile; do not relax content filters.

### 10.14 Ich hab noch nie

- Select only QUESTION cards with `YesNoAnswerPossible=true`.
- No active-player rotation.
- After card commit, enter `COLLECTING_ANSWERS`.
- Expected voter set is the active PLAYER participants at the time voting starts.
- Keep individual answers ephemeral in runtime memory, not long-term tables.
- MVP result mode: anonymous aggregate only (`n of total`).
- Once every expected voter answered (or host closes voting if a disconnected player cannot return), transition to `SHOWING_RESULTS`.
- Advancing selects the next card.
- Never rewrite question text into “Ich habe noch nie …”.

### 10.15 Let's Talk

- Only QUESTION cards in ordinary flow.
- CONVERSATION cards are selected by a scheduler, not the normal question pool.
- MVP scheduler: insert an eligible conversation card after `meta_every_n_questions` ordinary questions. Use profile value; if null, use a conservative built-in default.
- Conversation cards obey history/repeat rules.
- If meta pool is exhausted, continue normal questions without silently repeating meta cards.

### 10.16 Domain tests required before transport work

At minimum cover:

- each eligibility stage;
- QuestionCategory vs DareType independence;
- repeat matrix and cooldown;
- Group history vs Session history;
- AlwaysEligible behavior;
- pool exhaustion;
- deterministic weighted/random selection;
- Classic state transitions and invalid commands;
- Random ratio/streak constraints;
- NHIE yes/no filtering and voting completion;
- Let's Talk scheduler and meta exhaustion;
- rotation and round completion;
- skip counts card as seen.

---

## 11. Phase 5 — Application layer and repository ports

**Goal:** orchestrate domain behavior, authorization and transactions without putting business rules in Express or WebSocket handlers.

### 11.1 Repository ports

Define focused interfaces under `packages/application/src/ports`:

```text
CardRepository
GameProfileRepository
GroupRepository
RoomRepository
RoomParticipantRepository
GameSessionRepository
CardHistoryRepository
DataSpaceRepository
TransactionManager
Clock
RandomSource
```

Avoid `GenericRepository<T>`.

Example application-oriented methods:

```text
CardRepository.findCandidates(criteria)
CardHistoryRepository.getSessionAppearances(sessionId)
CardHistoryRepository.getGroupSeenCardIds(groupId)
GameSessionRepository.getActiveByRoom(roomId)
RoomParticipantRepository.findByCredential(roomId, tokenHash)
```

### 11.2 Principal model

Create an application-level Principal:

```text
AccountPrincipal      # future public mode
RoomPrincipal         # participant + role/capabilities
ClientIdentity        # device/client information
```

For MVP, commands use `RoomPrincipal`; local persistent DataSpace is installation-owned.

### 11.3 Room capabilities

Implement explicit capability calculation, not Blueprint generic permissions:

```text
JOIN_ROOM
DISPLAY_SESSION
CHOOSE_CARD_TYPE
SUBMIT_VOTE
SKIP_CARD
ADVANCE_SESSION
CHANGE_SESSION_SETTINGS
MANAGE_PLAYERS
END_SESSION
```

Recommended MVP mapping:

- HOST: all host controls + display + advance/skip.
- PLAYER: display + vote; active player gets choose-card-type where applicable.
- DISPLAY: display only.

The application command must check both role capability and contextual rules (for example only the active player may choose card type in Party Screen).

### 11.4 Application commands

Implement one class/function per use case:

```text
CreateRoom
JoinRoom
StartSession
ChooseCardType
ResolveCurrentCard
SkipCurrentCard
SubmitVote
AdvanceAfterResults
EndSession
GetSessionSnapshot
ReconnectParticipant
CreateGroup
ListGroups
```

### 11.5 Stable application errors

Create typed errors with machine codes:

```text
VALIDATION_ERROR
ROOM_NOT_FOUND
ROOM_EXPIRED
ROOM_FULL
INVALID_GAME_STATE
NOT_ACTIVE_PLAYER
CARD_POOL_EXHAUSTED
STALE_SESSION_REVISION
NOT_AUTHORIZED
INVALID_PARTICIPANT_CREDENTIAL
PROTOCOL_VERSION_UNSUPPORTED
```

HTTP and WebSocket adapters map these errors; application/domain code does not format HTTP responses.

### 11.6 Session revision rule

Every mutating realtime command carries the client’s current revision.

Application flow:

1. load authoritative Session;
2. compare command revision;
3. reject stale revision with `STALE_SESSION_REVISION` and current snapshot;
4. execute domain transition;
5. write all durable changes in one transaction;
6. increment revision exactly once for the committed transition;
7. return committed state/event for broadcast.

### 11.7 Per-Room command serialization

Create `RoomCommandQueue` in server/application composition. A simple Promise chain or mutex per Room is sufficient for a single-process MVP.

Invariant:

```text
command N
-> validate/execute
-> DB transaction commits
-> runtime state updates
-> broadcast
-> command N+1
```

Different Rooms may process concurrently.

### 11.8 Card commit transaction

Card display is the most important transaction. It MUST atomically:

- load/validate the current Session revision;
- choose the card based on authoritative history;
- insert CardAppearance immediately;
- update `game_sessions.runtime_state_json` to contain the visible card/state;
- increment `revision`;
- commit;
- only then return the broadcast payload.

If the transaction fails, do not show the card to clients.

---

## 12. Phase 6 — HTTP API

**Goal:** use HTTP only for non-continuous operations and initial Room establishment.

All game API routes use `/api/v1`.

### 12.1 Required endpoints

#### Health and capabilities

```text
GET /healthz
GET /readyz
GET /api/v1/server-info
```

`server-info` returns only non-secret data:

```json
{
  "serverVersion": "0.1.0",
  "deploymentMode": "local",
  "authMode": "none",
  "protocolVersions": [1],
  "features": {
    "couchMode": true,
    "partyScreenMode": true,
    "personalMode": false
  }
}
```

#### Groups

```text
GET  /api/v1/groups
POST /api/v1/groups
```

MVP group creation payload:

```json
{ "name": "WG Freitag" }
```

#### Room creation

```text
POST /api/v1/rooms
```

Request:

```json
{
  "hostDisplayName": "Host",
  "deviceMode": "PARTY_SCREEN"
}
```

Response returns:

- room ID;
- room code;
- participant ID;
- one-time raw host participant credential;
- join URL (without embedding host credentials);
- expiry.

#### Room join

```text
POST /api/v1/rooms/:roomCode/join
```

Request:

```json
{
  "displayName": "Anna",
  "requestedRole": "PLAYER"
}
```

Response returns participant ID and one-time raw participant credential.

Room code alone does not authorize gameplay actions.

### 12.2 QR generation

The QR code should encode the normal Room join URL containing only the human-readable Room code, for example:

```text
http://192.168.1.20:8080/join/XK7P2Q
```

Do not put participant or host tokens in the QR URL.

Generate QR locally in the bundled web client or server; no third-party service call is allowed.

### 12.3 Validation

Every request body/path/query parameter uses Zod schemas from `packages/protocol`. Transport parses; application receives already validated data.

### 12.4 Thin controller rule

A controller does exactly:

1. parse/validate transport data;
2. create Principal/context;
3. call application command;
4. map result/error to HTTP.

No card selection, history logic, permission rules or mode logic in routes.

---

## 13. Phase 7 — WebSocket protocol and realtime server

**Goal:** one versioned realtime protocol shared by every browser role and future native client.

### 13.1 Server attachment

Attach `ws.WebSocketServer` to the same Node `http.Server` used by Express. Use a single WebSocket endpoint such as:

```text
/ws
```

Do not run a second port unless a documented operational reason emerges.

### 13.2 Canonical envelope

Every message uses:

```json
{
  "protocol": 1,
  "type": "...",
  "requestId": "nullable client correlation id",
  "revision": 0,
  "payload": {}
}
```

Use Zod discriminated unions for all message variants. Generate JSON Schema fixtures for future non-TypeScript clients.

### 13.3 Handshake

Unauthenticated sockets may send only `client.hello`.

Example:

```json
{
  "protocol": 1,
  "type": "client.hello",
  "requestId": "hello-1",
  "revision": 0,
  "payload": {
    "supportedProtocols": [1],
    "appVersion": "0.1.0",
    "clientType": "WEB_MOBILE",
    "requestedRole": "PLAYER",
    "capabilities": ["PERSONAL_DISPLAY", "TOUCH_INPUT", "PRIVATE_INPUT", "PRIVATE_VOTING"],
    "roomId": "...",
    "participantId": "...",
    "participantToken": "raw-token-from-join"
  }
}
```

Server:

1. validates protocol envelope;
2. negotiates protocol version;
3. hashes provided token and validates participant record;
4. binds socket to Room/participant/client identity;
5. updates `last_seen_at`;
6. sends `server.hello` + current `session.snapshot` or lobby snapshot;
7. closes unauthenticated sockets after a short timeout.

Never put reusable credentials in the WebSocket URL.

### 13.4 Required client commands

```text
command.startSession
command.chooseCardType
command.resolveCard
command.skipCard
command.submitVote
command.advanceAfterResults
command.endSession
command.requestSnapshot
```

Host/player management may initially use:

```text
command.removePlayer
command.setPlayerActive
```

only if the MVP lobby UX requires them.

### 13.5 Required server events

Prefer a small event set plus snapshots:

```text
room.snapshot
room.participantJoined
room.participantLeft
session.snapshot
session.stateChanged
session.cardShown
session.voteProgress
session.resultsShown
session.ended
error
```

Events are informational. Clients must be able to recover from missed events by requesting/receiving `session.snapshot`.

### 13.6 Snapshot privacy

Build snapshot DTOs per effective client role. Do not blindly serialize runtime state.

Examples:

- shared DISPLAY sees the public card and aggregate voting status;
- active PLAYER may see private choice controls;
- non-active PLAYER does not receive a hidden preselected card;
- individual NHIE answers are never included in public snapshots;
- participant tokens are never echoed.

### 13.7 Broadcast rule

Broadcast only after persistence succeeds. The WebSocket layer receives an already committed application result and sends it to the relevant connections.

### 13.8 Reconnect

Web client stores:

- server origin;
- room ID/code;
- participant ID;
- participant token;
- device ID;
- UI preferences.

On reconnect:

1. open WebSocket;
2. `client.hello` with stored participant credential;
3. server authenticates;
4. send authoritative snapshot;
5. client replaces local game state with snapshot.

If token expired, return a clear rejoin path.

### 13.9 Race tests

Write integration tests that send simultaneous commands from two clients. Verify exactly one state transition commits and the other receives stale/invalid-state behavior. Especially test double “next”, double choose-card-type and late vote after results transition.

---

## 14. Phase 8 — Svelte web client foundation

**Goal:** replace Pug/Bootstrap/jQuery with one Svelte application that can act as host, shared display or phone client.

### 14.1 Vite build and serving

- Build `apps/web` with Vite.
- Output compiled assets to a directory copied/linked into the server release.
- Express serves the built SPA and local assets.
- No CDN JavaScript, Google Fonts, remote images, remote audio or QR services.
- Offline LAN play must work without a service worker.

### 14.2 Client route/state roles

Use routes similar to:

```text
/                  main menu
/setup             host setup
/room/:code        lobby/shared host view
/join/:code        player join form
/play/:roomId      role-aware gameplay client
```

Do not create separate frontend projects for phone and TV. The route chooses a presentation role within one Svelte codebase.

### 14.3 Client state stores

Keep separate stores/modules for:

```text
connectionStore     # WS status, reconnect
identityStore       # participant/device credentials
roomStore           # lobby participants, room metadata
sessionStore        # authoritative snapshot/revision
uiStore             # local modal/reduced-motion/preferences
audioStore          # deferred/basic
```

The UI never calculates authoritative next player, eligible card or vote result.

### 14.4 German UI strings

Initial UI is German. Put strings in a dedicated localization module from day one:

```ts
messages.de.ts
```

Do not scatter user-facing German text through business logic or protocol definitions.

### 14.5 Core reusable components

Implement:

```text
CardView
ActivePlayerBanner
PrimaryActionBar
LobbyPlayerList
RoomJoinQr
ConnectionStatus
VoteControls
VoteResult
RoundTransition
SettingsDialog
PoolExhaustedDialog
```

### 14.6 Accessibility baseline

- usable by keyboard;
- semantic buttons and headings;
- focus visible;
- touch targets suitable for phones;
- no action available only by hover;
- support `prefers-reduced-motion` and an in-app reduced-motion toggle;
- animations must not block game actions;
- text remains readable on TV-sized display and mobile screen.

---

## 15. Phase 9 — Couch Mode vertical slice

**Goal:** validate all four game modes before relying on networking UX.

Even though the WebSocket infrastructure may already exist, Couch Mode should be usable with one browser and no phones.

### 15.1 Setup flow

1. Main menu -> `Neues Spiel`.
2. Choose game mode.
3. Choose `Couch Mode`.
4. Choose built-in GameProfile.
5. Choose Group:
   - existing Group;
   - new Group;
   - without persistent history.
6. Enter player names.
7. Start.

Keep advanced settings out of the critical path.

### 15.2 Shared-screen input behavior

Because there are no private devices:

- Classic choice buttons appear on the shared screen;
- NHIE responses may be collected sequentially or by a simple shared counter input in Couch MVP; do not pretend they are private;
- skip is always available;
- all state still goes through the server application command path, even if client and server are on one machine.

### 15.3 Couch acceptance tests

Playwright should cover:

- create game and complete one Classic round;
- Random mode shows both types over a deterministic fixture sequence;
- NHIE selects only yes/no cards and shows aggregate result;
- Let's Talk inserts a conversation card at configured cadence;
- skip marks card seen and advances;
- same Session does not repeat ordinary cards;
- Group A does not receive an already-seen normal card in the next Session while Group B still can;
- pool exhaustion produces explicit UI.

Do not begin Party Screen polish until these flows are stable.

---

## 16. Phase 10 — Party Screen Mode

**Goal:** deliver the flagship local multiplayer experience using the same game engine and web client.

### 16.1 Host flow

1. Host chooses Party Screen Mode.
2. Server creates Room and host participant.
3. Lobby displays Room code and QR join URL.
4. Phones join without accounts.
5. Host starts when roster is ready.
6. Shared display presents public state; phones present private/action state.

### 16.2 Classic Party Screen behavior

- Shared display: “ANNA IST DRAN – Wahrheit oder Pflicht?”
- Only Anna’s authorized player client shows QUESTION/DARE actions.
- Choosing sends `command.chooseCardType` with current revision.
- Server selects and commits card.
- Shared display receives card event/snapshot after commit.
- All clients stay synchronized.
- Host may use skip/advance fallback controls if the active phone disconnects.

### 16.3 Random Party Screen behavior

- Shared display shows active player then server-selected card.
- No phone gets a truth/dare choice.
- Active phone may show resolve/skip controls.

### 16.4 NHIE Party Screen behavior

- Shared display shows card.
- Every active PLAYER phone shows two answer buttons.
- Server keeps individual answers ephemeral.
- Shared display shows only answer progress count until all have voted, then anonymous aggregate result.
- A reconnecting phone can still vote if voting is open and it has not already answered.

### 16.5 Let's Talk Party Screen behavior

- Shared display carries the conversation flow.
- Phones normally have minimal controls so attention stays on the group.
- Host can advance/skip.

### 16.6 Disconnection behavior

- Brief disconnect: participant remains in roster; UI shows connection state discreetly.
- Reconnect within token TTL: same participant identity is reclaimed.
- Active player disconnects during Classic: host can wait, skip or use host fallback control. Do not automatically advance immediately.
- NHIE voter disconnect: keep voting open for a reasonable period; host may close/continue. Do not persist private answer identity long-term.

### 16.7 Party Screen acceptance tests

Use real WebSocket clients and Playwright browser contexts to verify:

- host + 2 players join;
- only active player can choose Classic card type;
- display receives selected card after persistence;
- stale command is rejected;
- simultaneous advances do not duplicate cards;
- NHIE aggregate is synchronized;
- phone reconnect receives authoritative snapshot;
- room participant token is not present in logs or broadcast payloads.

---

## 17. Phase 11 — Persistence, restart recovery and lifecycle

**Goal:** committed state survives browser refresh and server restart as specified by the architecture.

### 17.1 Runtime state schema version

Start with `runtime_state_version = 1` and a Zod schema containing common fields:

```text
version
state
mode
deviceMode
playerOrder
activePlayerId
roundNumber
cardsShownCount
currentCardId/currentCardPublicData where applicable
modeState
settingsSnapshot
```

Persist only what is required to reconstruct authoritative play. Do not persist individual NHIE answers as permanent history.

### 17.2 Server startup recovery

On startup:

1. find Rooms with non-expired active GameSessions;
2. validate `runtime_state_version` and JSON;
3. reconstruct in-memory Room runtime handles/queues;
4. keep Session revision unchanged;
5. allow participants to reconnect with valid tokens.

If runtime state is invalid/incompatible, mark the Session non-resumable and expose an actionable error; do not guess how to interpret it.

### 17.3 Graceful shutdown

On SIGINT/SIGTERM:

1. stop accepting new Rooms;
2. stop accepting new WebSocket connections;
3. let currently executing Room commands finish;
4. ensure committed DB writes are complete;
5. close WebSockets;
6. close HTTP server;
7. close DataSource.

### 17.4 History guarantees

- CardAppearance is inserted when a card is committed for display, not after completion.
- A skipped revealed card remains seen.
- Session and Group histories are separate.
- Browser storage is never the sole source of history.

---

## 18. Phase 12 — Logging, readiness, security and privacy

### 18.1 Structured logging

Replace `morgan` with Pino-based structured logging.

Common fields where relevant:

```text
timestamp
level
message
requestId
roomId
sessionId
participantId (only if appropriate; avoid unnecessary persistence)
eventType
errorCode
```

Never log:

- participant tokens;
- account/auth cookies;
- passwords;
- reset/activation tokens;
- OIDC client secrets;
- private boundaries;
- individual NHIE answers.

### 18.2 Request IDs

Assign/generate a request ID for HTTP requests and carry WebSocket `requestId` through command logs and error responses.

### 18.3 Readiness endpoint

`GET /readyz` returns success only when:

- configuration is valid;
- DB is initialized;
- migrations/catalog installation are complete enough to serve games.

### 18.4 Input limits

Set explicit size limits for JSON bodies and WebSocket frames. Reject oversized payloads before expensive parsing/processing.

### 18.5 Local security

Local mode has no permanent user accounts, but LAN access is not equivalent to administrator access. For MVP:

- game Room capabilities are enforced by participant credentials;
- destructive DataSpace operations beyond ordinary Group creation can be omitted from UI;
- reserve an installation admin token mechanism for later backup/reset/admin features;
- host privilege comes from host participant credential, never from Room code.

---

## 19. Phase 13 — Build, packaging and offline behavior

### 19.1 Build pipeline

Root scripts should converge on:

```text
npm run build
  -> build packages
  -> build Svelte/Vite web app
  -> compile/bundle server
  -> copy local assets/catalog

npm test
  -> fast unit + protocol tests

npm run test:integration
  -> SQLite repository + WebSocket integration

npm run e2e
  -> Playwright critical flows

npm run test:all
  -> tests + build + migrations + e2e
```

### 19.2 Portable package layout

MVP target layout:

```text
PartyGame-<platform>/
├── launcher
├── runtime/
│   └── node executable
├── app/
│   └── server bundle
├── native/
│   └── better-sqlite3 binding
├── public/
│   └── compiled Svelte assets
├── catalog/
│   └── versioned normalized catalog
├── data/
└── config/
```

The end user must not install Node.js, npm, TypeScript, SQLite or build tools.

### 19.3 MVP packaging scope decision

Implement the packaging scripts so platform-specific runtime/native bindings are parameters. Produce and smoke-test at least the primary project platform in the MVP pipeline. Additional OS/architecture archives can follow using the same packaging mechanism; do not introduce platform-specific game code.

### 19.4 Offline smoke test

A release smoke test should run with outbound internet disabled and verify:

- server starts;
- web client loads;
- fonts/images/QR generation work;
- Room can be created;
- a second LAN/browser client can join;
- gameplay does not request external resources.

---

## 20. Concrete test plan

### 20.1 Unit/domain suite

Fast and database-free. Must run on every change.

High-value cases:

- category/DareType separation;
- intensity bounds;
- profile filtering;
- session history exclusion;
- group history exclusion;
- AlwaysEligible matrix;
- RepeatableInSession cooldown;
- weighted choice with deterministic RNG;
- Classic transitions;
- Random ratio correction/streak protection;
- NHIE filtering and vote aggregation;
- Let's Talk meta cadence;
- player rotation and rounds;
- pool exhaustion.

### 20.2 Simulation suite

Run deterministic simulations (architecture target: large runs such as 10,000 sessions) and assert invariants:

- disabled DareType never appears;
- disabled QuestionCategory never appears;
- no unexpected duplicates;
- repeat cooldown is respected;
- Random ratio converges within a documented tolerance;
- meta cards do not exceed scheduler behavior;
- exhausted pool never silently relaxes filters.

### 20.3 Persistence contract suite

Create one repository contract test set. Run against SQLite in MVP CI. Keep the adapter boundary compatible with later MariaDB execution.

Verify:

- create/load Group;
- save/load GameSession snapshot;
- atomic CardAppearance + Session revision transaction;
- history queries;
- token hash lookup;
- catalog upsert/deactivation;
- migration from empty DB.

Before public release, run the same suite against MariaDB as required by the TAD.

### 20.4 Protocol suite

- parse every valid message fixture;
- reject malformed envelope/payload;
- protocol negotiation;
- `client.hello` auth;
- unauthorized command rejection;
- stale revision response;
- snapshot serialization per role;
- no sensitive field leakage.

### 20.5 WebSocket integration suite

Simulate host, player A, player B, display. Verify synchronization and races without browser UI.

### 20.6 Playwright E2E suite

Minimum release-blocking flows:

1. Couch Classic one full round.
2. Couch Group history across two Sessions.
3. Party Screen host creates Room, two phones join, Classic turn succeeds.
4. Party Screen phone reconnects and recovers state.
5. NHIE multiplayer anonymous aggregate.
6. Pool exhaustion UI.
7. Reduced-motion setting prevents nonessential transition animation.

### 20.7 CI merge gates

Block merge/release on:

- TypeScript compile failure;
- lint failure;
- unit/protocol test failure;
- SQLite migration failure;
- integration failure;
- critical Playwright failure.

---

## 21. Implementation backlog in execution order

The following backlog is ordered. A junior developer/agent should not skip ahead unless the dependency is already completed.

### Milestone A — Baseline cleanup

- **MVP-001** Remove stale/missing Surveyor route wiring.
- **MVP-002** Rename account session entity to `AccountSessionEntity`.
- **MVP-003** Remove committed settings artifact and add sanitized examples.
- **MVP-004** Reduce app to health endpoint + error handling.
- **MVP-005** Restore green strict TypeScript build and basic test.

**Exit:** clean, runnable non-game server.

### Milestone B — Architecture skeleton

- **MVP-010** Add npm workspaces and target directories.
- **MVP-011** Create configuration package with Zod.
- **MVP-012** Create protocol package skeleton and error codes.
- **MVP-013** Create game-core package skeleton.
- **MVP-014** Create application package skeleton.
- **MVP-015** Move/refactor server bootstrap into `apps/server`.
- **MVP-016** Add Pino logger and `/readyz`/`server-info`.

**Exit:** server boots through composed packages with no game behavior.

### Milestone C — SQLite persistence

- **MVP-020** Add `better-sqlite3` driver factory and WAL.
- **MVP-021** Create DataSpace/taxonomy/Card entities + migration.
- **MVP-022** Create GameProfile/Group entities + migration.
- **MVP-023** Create Room/Participant/GameSession/CardAppearance entities + migration.
- **MVP-024** Implement repository adapters and SQLite contract tests.
- **MVP-025** Ensure local DataSpace on startup.

**Exit:** durable schema + repository API.

### Milestone D — Catalog

- **MVP-030** Implement source row parser and normalized card schema.
- **MVP-031** Implement deterministic system UUID function.
- **MVP-032** Implement taxonomy mapping and validation report.
- **MVP-033** Produce versioned normalized catalog artifact.
- **MVP-034** Implement catalog installer/updater.
- **MVP-035** Add test fixture catalog until real export is provided.

**Exit:** normalized cards queryable by repositories.

### Milestone E — Game core

- **MVP-040** Domain Card/Profile/Session state types.
- **MVP-041** Deterministic RandomSource abstraction.
- **MVP-042** Question eligibility policies.
- **MVP-043** Dare eligibility policies.
- **MVP-044** History/repeat/cooldown policies.
- **MVP-045** Player rotation/rounds.
- **MVP-046** Classic mode.
- **MVP-047** Random mode.
- **MVP-048** NHIE mode.
- **MVP-049** Let's Talk mode.
- **MVP-050** Simulation tests.

**Exit:** all four modes pass pure tests.

### Milestone F — Application orchestration

- **MVP-060** Principal/capability model.
- **MVP-061** CreateRoom/JoinRoom.
- **MVP-062** StartSession.
- **MVP-063** realtime game command handlers.
- **MVP-064** revision enforcement.
- **MVP-065** per-Room command queue.
- **MVP-066** atomic card commit transaction.
- **MVP-067** snapshot builder per role.

**Exit:** application service tests can play a game without HTTP/WS.

### Milestone G — Transport

- **MVP-070** HTTP `/api/v1` endpoints.
- **MVP-071** Room participant credential hashing.
- **MVP-072** `ws` server attachment and handshake.
- **MVP-073** message schema parsing/error mapping.
- **MVP-074** broadcasts and presence.
- **MVP-075** snapshot resync/reconnect.
- **MVP-076** race integration tests.

**Exit:** scripted WebSocket clients can complete all modes.

### Milestone H — Svelte + Couch

- **MVP-080** Vite/Svelte app scaffold and server asset serving.
- **MVP-081** connection/identity/session stores.
- **MVP-082** main menu/setup/player entry.
- **MVP-083** reusable CardView/gameplay shell.
- **MVP-084** Couch Classic/Random.
- **MVP-085** Couch NHIE/Let's Talk.
- **MVP-086** Group/history UI.
- **MVP-087** Couch Playwright suite.

**Exit:** complete single-screen game.

### Milestone I — Party Screen

- **MVP-090** lobby with Room code and local QR.
- **MVP-091** mobile join flow/token storage.
- **MVP-092** role-aware shared display/mobile UI.
- **MVP-093** Classic private choice.
- **MVP-094** multiplayer NHIE voting.
- **MVP-095** reconnect UX.
- **MVP-096** host fallback controls.
- **MVP-097** multi-context Playwright suite.

**Exit:** flagship local multiplayer playable.

### Milestone J — Release hardening

- **MVP-100** restart recovery.
- **MVP-101** graceful shutdown.
- **MVP-102** log redaction tests.
- **MVP-103** reduced motion/accessibility pass.
- **MVP-104** portable build script.
- **MVP-105** offline smoke test.
- **MVP-106** rewrite README/operator instructions.

**Exit:** candidate v0.1 release.

---

## 22. File-by-file first implementation actions

This section answers the practical question: “I have just unzipped the Blueprint. What do I edit first?”

### `package.json`

1. Rename package from Surveyor to the game working package name.
2. Add workspaces for `apps/*` and `packages/*`.
3. Add `ws`, `zod`, `pino`, `better-sqlite3`, Svelte/Vite dependencies.
4. Add workspace build/test scripts.
5. Keep a lockfile committed.
6. Remove Surveyor-only dependencies after deleting their code.

### `src/server.ts`

Use only as temporary bootstrap. Refactor its useful pattern into `apps/server/src/bootstrap/main.ts`.

Change from:

```text
settings.read -> initDataSource -> require app -> create http server -> listen
```

to the Phase 1 composition flow, including WebSocket attachment and graceful shutdown.

### `src/app.ts`

Do not add game logic here. Replace the current global app construction with an `createHttpApp(deps)` factory. Remove Pug and Surveyor route registration. Keep static-file serving, JSON parsing, request logging, versioned API router and error mapping.

### `src/modules/settings.ts`

Delete after `packages/configuration` is live. Do not preserve CSV auto-write behavior.

### `src/modules/database/dataSource.ts`

Move to `packages/persistence/src/datasource`. Replace MariaDB-only configuration with a driver factory. Keep `synchronize:false`.

### `migrationDataSource.ts`

Make CLI migration DataSource use the same validated DB configuration as the runtime, with a safe CLI-specific loader if required.

### `src/modules/database/entities/session/Session.ts`

Rename to `AccountSessionEntity`. It is HTTP auth-session storage, not the game Session. Move under `apps/server/src/auth/persistence` or a public-auth package.

### `src/modules/database/entities/user/Profile.ts`

Do not map this class into the gameplay `GameProfile`. Replace the ownership meaning with `DataSpace` when/if public account code is retained. If Surveyor entity relations make this expensive, park/remove the old auth model for local MVP and reintroduce a clean DataSpace/account model later.

### `src/modules/database/services/UserService.ts`

Do not wire into local MVP. Before public release it needs security changes: `scrypt` password hashing and hashed one-time tokens. Do not copy its raw activation/reset token persistence pattern.

### `src/modules/oidc.ts` / `src/modules/email.ts`

Move to dormant public-auth infrastructure. They must not initialize in local mode.

### `src/middleware/genericErrorHandler.ts`

Adapt to understand stable application errors. Keep transport formatting here/near HTTP adapter; do not expose stack traces in production-style output.

### `src/modules/lib/asyncHandler.ts`

Retain for Express adapters.

### `src/modules/permissionEngine.ts` and permission middleware/types

Remove from the gameplay path. Implement Room capability checks in application services.

### `src/routes/*`, `src/controller/*`

Delete Surveyor features. Create new versioned game routes under the server transport package.

### `src/views/*`, `src/public/js/*`, Bootstrap/Sass assets

Delete after Svelte shell is working. Keep only generic image assets that are deliberately reused and locally licensed.

### Test/tooling files

Reuse Vitest and Playwright configuration concepts, but create the new test directory structure. Do not retain tests that exist only for Surveyor behavior.

---

## 23. Definition of Done for the MVP

The MVP is complete only when all of the following are true.

### Architecture

- One authoritative Node server implementation exists.
- Domain imports neither Express nor TypeORM.
- Game logic does not branch on database type.
- Clients cannot select authoritative cards or advance state without server validation.
- HTTP and WebSocket transport handlers are thin.
- Game Session and account HTTP Session are separate concepts and names.
- `DataSpace` and `GameProfile` are separate concepts and names.

### Gameplay

- All four modes work in Couch Mode.
- All four modes are compatible with Party Screen; Classic and NHIE exercise private/mobile interaction.
- Question categories and DareTypes are independent.
- ordinary cards do not repeat accidentally in a Session.
- Group history persists across Sessions/restarts.
- AlwaysEligible and RepeatableInSession follow the documented matrix and cooldown.
- skip is always available and a revealed skipped card remains seen.
- pool exhaustion is explicit.
- NHIE uses only yes/no-capable questions and does not rewrite card text.
- Let's Talk schedules conversation cards separately.

### Multiplayer

- guest joins require no account.
- Room code is not a credential.
- participant credentials are random, stored only as hashes server-side, and not logged.
- WebSocket requires `client.hello` before commands.
- revisions reject stale commands.
- commands for one Room execute sequentially.
- DB commit occurs before broadcast.
- reconnect returns a full authoritative snapshot.

### Persistence

- SQLite is in WAL mode.
- schema is created by migrations only.
- catalog is versioned.
- system card IDs are stable/deterministic.
- Session runtime JSON has a version and is validated.
- CardAppearance is created at display commit time.

### UI

- German strings are separated from logic.
- card is the visual focus during play.
- no full page reload between turns.
- layout works on shared display and mobile.
- reduced-motion preference is respected.
- no gameplay runtime dependency requires the internet.

### Quality

- strict TypeScript passes.
- required unit/simulation/protocol/integration/E2E tests pass.
- migration test passes from empty DB.
- logs contain no secrets/private answers.
- local release smoke test works without internet.

---

## 24. Non-goals and guardrails for autonomous agents

An AI coding agent or junior developer MUST NOT “simplify” the project by doing any of the following:

- move card selection to the browser;
- use `Math.random()` in `game-core`;
- treat QuestionCategory and DareType as one generic category enum;
- use a dare’s affinity category as its primary eligibility filter;
- store Group history only in localStorage;
- broadcast state before DB commit;
- process concurrent Room commands without serialization;
- use Room code as host authorization;
- put participant token in query string/QR URL;
- persist individual NHIE answers by default;
- silently relax content filters when pool is exhausted;
- reintroduce Pug/Bootstrap because it is present in the Blueprint;
- build a second server for public deployment;
- build a separate game engine for a second game mode;
- add Redis/microservices/event sourcing for the MVP;
- enable TypeORM `synchronize` in packaged runtime;
- use `NODE_ENV` as the source of truth for security mode;
- call cloud APIs/CDNs for gameplay assets;
- invent production card content when the source catalog is unavailable.

---

## 25. Recommended commit strategy

Keep commits small enough that each is reviewable and buildable. A useful pattern is:

```text
chore: clean Surveyor baseline and restore build
refactor: add validated deployment configuration
feat: add SQLite persistence schema and migrations
feat: add normalized card catalog importer
feat: implement question/dare eligibility domain
feat: implement Classic game mode
feat: implement remaining game modes
feat: add Room application services and revisioning
feat: add WebSocket protocol and handshake
feat: add Svelte Couch Mode
feat: add Party Screen join and multiplayer controls
feat: add restart recovery and release packaging
```

Avoid commits that mix path migration, schema changes, protocol changes and UI behavior all at once.

---

## 26. Open input dependencies

The following cannot be completed from the currently attached artifacts alone and must be supplied or decided separately:

1. **Real card database/export.** The documents describe its schema, but the actual ~2,000-card dataset is not attached. The importer and test catalog can be implemented; production catalog generation requires the source data.
2. **Final curated built-in profile assignments.** The GDD explicitly states that exact defaults must be validated against real card content. Use conservative fixtures during development and perform editorial validation before enabling profiles in release.
3. **Primary portable packaging platforms.** The architecture supports multiple OS/architectures. The MVP build scripts should be parameterized; the release owner must choose which archives are release-blocking.
4. **Brand/visual assets and final audio.** They are polish, not blockers for the engineering MVP.

Do not guess these inputs silently. Keep placeholder/test data visibly marked until real inputs are provided.

---

## 27. Final implementation sequence summary

If starting today from the supplied Blueprint, execute this exact order:

1. Clean the broken/stale Surveyor wiring and restore a green strict build.
2. Replace settings with validated deployment-aware configuration.
3. Introduce the workspace/module boundaries without a big-bang rewrite.
4. Add SQLite/WAL and normalized migrations.
5. Implement the catalog import pipeline and a test fixture catalog.
6. Implement/test the pure game engine for all four modes.
7. Implement application commands, capabilities, transactions, revisions and Room serialization.
8. Add versioned HTTP API for groups/rooms and `ws` protocol for active game state.
9. Build Svelte Couch Mode and prove all four modes end to end.
10. Add Party Screen lobby, QR join, phone roles, voting and reconnect.
11. Add restart recovery, privacy/logging hardening, readiness and graceful shutdown.
12. Package all runtime assets locally and run an offline release smoke test.

At the end of this sequence, the Blueprint has been transformed into a coherent v0.1 product rather than merely having game routes added to Surveyor. The resulting codebase also preserves the architecture needed for later public accounts, MariaDB, Personal Mode and native TV clients without forcing those features into the MVP.
