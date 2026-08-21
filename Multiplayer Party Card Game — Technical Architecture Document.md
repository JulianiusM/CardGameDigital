# Multiplayer Party Card Game — Technical Architecture Document

**Document status:** Canonical technical architecture / single source of truth  
**Version:** 1.0  
**Companion document:** Multiplayer Party Card Game — Game Design Document  
**Primary runtime language:** TypeScript / Node.js  
**Primary architecture:** Server-authoritative, LAN-first client/server application  
**Supported deployment classes:** Portable/local and publicly hosted  
**Primary database engines:** SQLite locally, MariaDB/MySQL publicly

---

# 1. Purpose

This document defines the authoritative technical architecture for the Multiplayer Party Card Game.

It translates the functional and gameplay requirements of the Game Design Document into a maintainable implementation architecture and establishes the technical rules that future implementation work must follow.

It defines:

- system boundaries;
- runtime topology;
- source-code organization;
- backend technology;
- client technology;
- networking;
- persistence;
- authentication and authorization;
- local and public deployment;
- portability;
- game-state management;
- card-selection architecture;
- protocol design;
- testing;
- configuration;
- migrations;
- observability;
- security;
- extensibility;
- update and compatibility policies.

The purpose is not to prescribe every class or function name. It establishes the boundaries within which implementation decisions should be made.

Where this document and implementation differ, the implementation should normally be corrected unless this document is deliberately revised.

---

# 2. Relationship to the Game Design Document

The Game Design Document is authoritative for:

- gameplay;
- game modes;
- card behavior;
- categories;
- DareTypes;
- profiles;
- repetition rules;
- UX requirements;
- player boundaries;
- multiplayer behavior from the player's perspective.

This Architecture Document is authoritative for:

- software structure;
- runtime responsibilities;
- deployment;
- networking;
- persistence;
- security;
- API/protocol design;
- client/server boundaries;
- infrastructure.

The technical architecture must implement the Game Design Document without duplicating gameplay definitions unnecessarily.

---

# 3. Normative Language

The following terms are used throughout this document:

**MUST** — architectural requirement.

**SHOULD** — preferred implementation unless a documented reason exists to do otherwise.

**MAY** — optional feature or implementation choice.

Any deliberate deviation from a MUST-level architectural rule should be recorded as an Architecture Decision Record and accompanied by an update to this document if the deviation becomes permanent.

---

# 4. Core Architectural Principles

## 4.1 One authoritative server implementation

There MUST be exactly one game-server codebase.

The portable/local edition and the public hosted edition MUST NOT be separate server implementations.

Differences between deployment environments are implemented through:

- configuration;
- infrastructure adapters;
- authentication providers;
- persistence drivers;
- packaging.

The game engine and application logic remain identical.

---

## 4.2 Server authority

The server is authoritative for all game state.

Clients MUST NOT independently determine:

- the current card;
- active player;
- turn order;
- card eligibility;
- random selections;
- group history;
- session history;
- voting outcome;
- game-state transitions.

Clients send **commands**.

The server validates those commands, changes authoritative state and broadcasts the resulting state or events.

---

## 4.3 LAN-first rather than cloud-dependent

The system MUST be fully playable without internet connectivity when a local game server and local network are available.

A valid offline topology is:

```text
Internet
   ✕

Local Wi-Fi / Ethernet
   │
Game Server
   │
├── TV client
├── phone client
├── phone client
└── browser display
```

No gameplay dependency may require:

- cloud APIs;
- remote fonts;
- remote music;
- CDN libraries;
- remote QR generation;
- public authentication services.

---

## 4.4 Clients are replaceable

Kodi, Android TV, Fire TV and browser clients are presentation/input adapters.

None of them owns the game engine.

Removing one client platform MUST NOT require changes to:

- game rules;
- database model;
- session engine;
- card selection;
- history;
- other clients.

---

## 4.5 Framework-independent game domain

The core game domain MUST NOT depend directly on:

- Express;
- TypeORM;
- WebSocket libraries;
- Svelte;
- email infrastructure;
- authentication frameworks.

The game domain contains business rules only.

---

## 4.6 Infrastructure is replaceable

The architecture MUST allow infrastructure implementations to change without rewriting the game engine.

Examples:

```text
Persistence
├── SQLite
└── MariaDB

Identity
├── Local
├── Password account
└── OIDC

Client
├── Web
├── Kodi
└── Android-family TV
```

---

## 4.7 Local and public deployments share domain semantics

Groups, GameProfiles, card history, cards and other persisted game concepts MUST have the same logical meaning on both SQLite and MariaDB.

A user moving data from a local instance to a public instance should not require semantic conversion of the game model.

---

# 5. Technology Stack

The canonical stack is:

## Server

- Node.js
- TypeScript
- Express 5
- `ws` for WebSockets
- TypeORM
- Zod for runtime schema validation
- structured logging through a logger abstraction, with Pino as the preferred implementation

## Portable persistence

- SQLite
- TypeORM `better-sqlite3` adapter
- WAL mode

## Public persistence

- MariaDB or MySQL
- TypeORM `mysql2` adapter

MariaDB is the preferred public database when provided by the hosting environment.

## Browser client

- Svelte
- TypeScript
- Vite

## Kodi

- Python Kodi add-on
- native Kodi UI and remote/focus handling

## Android TV / Google TV / Fire TV

- Kotlin
- Jetpack Compose for TV
- shared Android-family TV client codebase wherever practical

---

# 6. Why Express Is Retained

The existing Node.js blueprint already provides useful infrastructure around Express, including:

- application bootstrap;
- middleware;
- sessions;
- authentication;
- OIDC;
- account handling;
- centralized errors;
- database initialization;
- testing.

Migrating to another HTTP framework would not provide enough benefit to justify replacing proven infrastructure.

Express handles ordinary HTTP traffic.

The same Node `http.Server` hosts WebSockets through `ws`.

Conceptually:

```text
                 Node HTTP Server
                       │
              ┌────────┴────────┐
              │                 │
           Express              ws
              │                 │
      HTTP / REST / Web     realtime game
```

---

# 7. High-Level Runtime Architecture

```text
                           CLIENTS

       Browser         Kodi       Android/Fire TV
     Svelte/TS        Python          Kotlin
         │               │              │
         └───────────────┬──────────────┘
                         │
                HTTP + WebSocket
                         │
              ┌──────────▼──────────┐
              │  Transport Layer    │
              │                     │
              │ Express             │
              │ WebSocket           │
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │ Application Layer   │
              │                     │
              │ commands            │
              │ orchestration       │
              │ authorization       │
              └──────────┬──────────┘
                         │
              ┌──────────▼──────────┐
              │     Game Domain     │
              │                     │
              │ game modes          │
              │ sessions            │
              │ eligibility         │
              │ profiles            │
              │ history             │
              │ repetition          │
              │ voting              │
              └──────────┬──────────┘
                         │
                  Repository APIs
                         │
              ┌──────────▼──────────┐
              │ Infrastructure      │
              │                     │
              │ TypeORM             │
              │ identity            │
              │ email               │
              │ configuration       │
              └──────┬────────┬─────┘
                     │        │
                 SQLite    MariaDB
                  local      public
```

---

# 8. Source Repository Structure

The project SHOULD use a monorepo.

Recommended layout:

```text
party-game/
│
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── bootstrap/
│   │   │   ├── transport/
│   │   │   │   ├── http/
│   │   │   │   └── websocket/
│   │   │   ├── auth/
│   │   │   └── infrastructure/
│   │   └── tests/
│   │
│   └── web/
│       ├── src/
│       └── public/
│
├── packages/
│   ├── game-core/
│   ├── application/
│   ├── protocol/
│   ├── persistence/
│   ├── configuration/
│   └── design-tokens/
│
├── clients/
│   ├── kodi/
│   └── android-tv/
│
├── tooling/
│   ├── card-import/
│   ├── catalog-build/
│   └── migrations/
│
├── packaging/
│   ├── windows-x64/
│   ├── linux-x64/
│   ├── linux-arm64/
│   ├── macos-x64/
│   └── macos-arm64/
│
├── tests/
│   ├── simulation/
│   ├── protocol/
│   └── e2e/
│
└── docs/
    ├── architecture/
    └── protocol/
```

The existing Node blueprint MAY initially be migrated into this structure incrementally rather than reorganized in one large refactoring.

---

# 9. Package Responsibilities

## 9.1 `game-core`

Contains pure domain logic.

Examples:

- GameSession aggregate;
- turn state;
- game-mode rules;
- card eligibility;
- weighted card selection;
- repetition rules;
- profile rules;
- intensity/phasing;
- round handling;
- vote calculations;
- meta-card scheduling.

It MUST NOT import Express or TypeORM.

---

## 9.2 `application`

Contains use cases and orchestration.

Examples:

- CreateRoom;
- JoinRoom;
- StartSession;
- ChooseTruth;
- ChooseDare;
- SkipCard;
- SubmitVote;
- ChangeGameSettings;
- EndSession.

Application services call domain objects and repository interfaces.

---

## 9.3 `protocol`

Contains the canonical wire-level contract.

It defines:

- HTTP DTO schemas;
- WebSocket messages;
- protocol versions;
- error codes;
- client capabilities.

The TypeScript implementation SHOULD use Zod schemas as runtime validation and TypeScript type sources.

JSON Schema SHOULD be generated for non-TypeScript clients.

---

## 9.4 `persistence`

Contains:

- repository interfaces;
- persistence entities;
- TypeORM mappings;
- SQLite configuration;
- MariaDB configuration;
- migrations.

Domain objects MUST NOT be TypeORM entities.

---

## 9.5 `configuration`

Contains:

- settings schema;
- defaults;
- environment/file merging;
- deployment-mode validation.

---

## 9.6 `design-tokens`

Contains common presentation values that can be shared across client implementations.

Examples:

- semantic theme names;
- visual category keys;
- spacing references;
- animation timings;
- card appearance metadata.

Not every native platform must consume these mechanically, but they provide a canonical design reference.

---

# 10. Application Composition

The application uses explicit composition rather than a large dependency-injection framework.

Startup chooses adapters according to validated configuration.

Conceptually:

```text
Settings
   │
   ├── PersistenceProvider
   ├── IdentityProvider
   ├── EmailProvider
   ├── SecurityPolicy
   └── DiscoveryProvider
          │
          ▼
   Application Services
          │
          ▼
      Game Domain
```

The domain remains unaware of the selected deployment mode.

---

# 11. Deployment Modes

Two canonical deployment modes exist.

## 11.1 Local

```text
DEPLOYMENT_MODE=local
```

Characteristics:

- internet not required;
- SQLite;
- no permanent user-account login required;
- local DataSpace;
- LAN HTTP and WebSocket permitted;
- all frontend/media assets served locally;
- optional LAN discovery;
- portable redistributable package.

---

## 11.2 Public

```text
DEPLOYMENT_MODE=public
```

Characteristics:

- MariaDB/MySQL;
- HTTPS/WSS required externally;
- persistent user accounts;
- authentication;
- account ownership;
- email workflow;
- optional OIDC;
- public abuse protection;
- proxy-aware networking.

---

# 12. Configuration Architecture

Configuration resolution uses:

```text
built-in defaults
        ↓
optional configuration file
        ↓
environment variables
```

Later sources override earlier sources.

Configuration MUST be validated before database initialization.

Invalid combinations MUST prevent server startup.

Examples of invalid configuration:

```text
DEPLOYMENT_MODE=public
AUTH_MODE=none
```

or:

```text
DB_TYPE=sqlite
DB_HOST=database.example.com
```

---

# 13. Recommended Core Settings

Examples:

```text
DEPLOYMENT_MODE
AUTH_MODE

HTTP_BIND
HTTP_PORT
PUBLIC_URL

DB_TYPE
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

Secrets MUST NOT be stored in version control.

---

# 14. Runtime Environment vs Deployment Mode

`NODE_ENV` MUST NOT determine security behavior on its own.

A portable release is a production build but may intentionally use:

```text
http://192.168.x.x
```

Therefore behavior such as:

- secure cookies;
- proxy trust;
- HTTPS assumptions

must be controlled by actual deployment configuration.

---

# 15. Local Portable Distribution

A local user MUST NOT be required to install:

- Node.js;
- npm;
- TypeScript;
- SQLite;
- build tools;
- internet dependencies.

Portable releases are produced per OS/architecture.

Example:

```text
PartyGame-Windows-x64/
├── PartyGame.exe
├── runtime/
│   └── node.exe
├── app/
│   └── server.bundle.js
├── native/
│   └── better-sqlite3 binding
├── public/
│   └── compiled web assets
├── data/
└── config/
```

Equivalent distributions are produced for supported Linux and macOS targets.

A future Node Single Executable Application MAY replace this packaging mechanism once sufficiently mature, but application architecture MUST NOT depend on SEA.

---

# 16. Portable Build Strategy

Build-time dependencies are allowed to require internet access.

Runtime dependencies are not.

A release pipeline SHOULD:

1. install locked dependencies;
2. compile TypeScript;
3. build Svelte;
4. bundle server JavaScript;
5. include the correct Node runtime;
6. include platform-specific SQLite native binding;
7. include all fonts/audio/images;
8. include initial catalog;
9. run automated smoke tests;
10. produce versioned archive.

The lockfile MUST be committed.

---

# 17. Public Deployment

The public Node deployment uses the same compiled server application.

It differs through:

- configuration;
- MariaDB driver;
- account provider;
- email provider;
- HTTPS proxy environment.

Typical topology:

```text
Internet
   │
HTTPS / WSS
   │
Hosting reverse proxy
   │
Node.js application
   │
MariaDB
```

The hosting environment MUST support:

- persistent Node processes;
- WebSocket upgrades;
- long-lived WebSocket connections;
- environment secrets;
- MariaDB/MySQL;
- outbound email or an SMTP provider.

A hosting service that merely advertises Node but prevents WebSockets is not a valid deployment target.

---

# 18. Browser Assets and Offline Behavior

The server MUST host all assets required for gameplay.

Runtime pages MUST NOT rely on:

- CDN JavaScript;
- Google Fonts;
- external images;
- internet-hosted sound;
- third-party QR-generation services.

A local phone connects directly to the host:

```text
http://192.168.1.20:8080
```

and receives the complete client application.

Offline gameplay MUST NOT depend on a service worker.

A public deployment MAY additionally provide installable PWA behavior.

---

# 19. Database Strategy

The application supports two canonical database engines.

## Local

SQLite.

Recommended:

```text
journal_mode = WAL
```

Only the Node server accesses the SQLite file.

Clients never access the database directly.

---

## Public

MariaDB/MySQL.

The public database supports:

- accounts;
- persistent DataSpaces;
- game data;
- history;
- auth sessions.

---

# 20. TypeORM Portability Rules

Core persistence MUST use the common subset of SQLite and MariaDB capabilities.

Preferred column concepts:

- UUID/string;
- varchar;
- text;
- integer;
- boolean;
- timestamp/datetime;
- foreign key;
- index;
- unique constraint.

Core domain persistence SHOULD avoid dependence on:

- stored procedures;
- DB-specific enum implementations;
- MariaDB-only expressions;
- database triggers containing business logic;
- DB-specific JSON operators.

Where migration DDL necessarily differs, the migration MAY branch based on the active driver.

Business logic MUST NOT branch based on database type.

---

# 21. Identifier Strategy

Externally meaningful game entities SHOULD use UUIDs.

This particularly applies to:

- Group;
- GroupMember;
- GameProfile;
- custom Card;
- Session;
- Room;
- Player.

System card identifiers should remain stable across installations.

The imported Access `ID` is retained as source metadata, not relied upon as the globally portable identifier.

System-card UUIDs SHOULD be generated deterministically from a fixed namespace plus stable source/card identity.

This allows:

- portable history;
- import/export;
- local-to-public migration;
- consistent references across installations.

Custom cards use randomly generated UUIDs.

---

# 22. Source Card Import

The production server MUST NOT directly depend on Access.

The existing Access database is a content-authoring/import source.

Recommended pipeline:

```text
Access database
      ↓
development import tool
      ↓
validation / normalization
      ↓
versioned card catalog
      ↓
application/catalog migration
```

The importer should preserve:

- source ID;
- Origin;
- OriginCategory;
- original text;
- normalization warnings.

---

# 23. Card Catalog Versioning

System content is versioned independently from user history.

The database SHOULD track:

```text
catalog_version
```

Application updates MAY:

- add cards;
- correct card metadata;
- deactivate cards;
- correct wording.

Catalog updates MUST NOT erase:

- Group history;
- custom GameProfiles;
- custom cards;
- Session records.

Removing a system card should normally mean marking it inactive rather than deleting history references.

---

# 24. Core Data Ownership

Persistent user-controlled data belongs to a **DataSpace**.

The term `Profile` MUST NOT be used for this ownership container because `GameProfile` has a specific gameplay meaning.

---

# 25. DataSpace

A DataSpace is the ownership boundary for persistent game data.

It may own:

- Groups;
- custom GameProfiles;
- custom cards;
- persistent preferences;
- historical data.

## Local deployment

Exactly one local DataSpace is created automatically.

No account login is required to own it.

## Public deployment

Each user receives one primary DataSpace.

The schema MAY later be generalized to multiple DataSpaces per account, but the initial application behavior assumes one primary DataSpace per account.

---

# 26. GameProfile

`GameProfile` exclusively means a gameplay preset such as:

- Kollegen;
- Freunde;
- Beste Freunde;
- Paare;
- Paare – Spicy.

GameProfile and DataSpace are unrelated concepts except that custom GameProfiles may be owned by a DataSpace.

---

# 27. Principal Model

Authorization distinguishes several identities.

```text
Account identity
    Who owns persistent data?

Room identity
    Who is this person within the current game?

Client identity
    What connected device is this?
```

These identities MUST NOT be conflated.

---

# 28. Public User Accounts

Public deployment supports persistent accounts.

Required account capabilities:

- registration;
- login;
- logout;
- activation/email verification if configured;
- forgotten password;
- password reset;
- password change;
- account deletion;
- account-session management;
- optional OIDC.

The existing blueprint account/OIDC infrastructure SHOULD be refactored and reused rather than replaced without reason.

---

# 29. Password Authentication

Password authentication MUST use a modern adaptive password hashing algorithm.

The preferred implementation is Node's built-in `scrypt`, avoiding additional native password-hashing dependencies.

Each password hash MUST use:

- unique random salt;
- configured work parameters;
- versioned hash metadata.

Password comparison MUST be constant-time where applicable.

---

# 30. One-Time Authentication Tokens

Activation and password-reset tokens MUST:

- use cryptographically secure random values;
- have finite expiration;
- be single-use;
- be stored server-side only as hashes.

The raw usable token MUST not be stored in the database.

---

# 31. OIDC

OIDC support is optional by deployment.

OIDC flows MUST use:

- state;
- nonce where applicable;
- PKCE where applicable.

Automatic linking to an existing account by email MUST only occur when the provider supplies trustworthy verified-email information.

Otherwise linking requires an authenticated user action.

---

# 32. Account Sessions

Browser account login uses HTTP sessions.

Account sessions:

- are independent from game Sessions;
- use opaque session IDs;
- are stored server-side;
- use HttpOnly cookies;
- use Secure cookies on public HTTPS deployment;
- use appropriate SameSite settings.

Public account session storage MUST NOT use process memory as its only persistence mechanism.

---

# 33. Local Deployment Identity

Local mode has:

```text
AUTH_MODE=none
```

for persistent account ownership.

This means:

- no registration;
- no password;
- no OIDC;
- no email requirement.

It does **not** mean every LAN client has unrestricted control.

---

# 34. Local Administrative Capability

Local DataSpace administration uses a lightweight installation-level capability rather than a user-account system.

The server SHOULD generate a local administration credential on first startup.

Possible access methods include:

- loopback access;
- one-time pairing code;
- locally stored administration token.

LAN clients that have not been granted local administration access MUST not be allowed to perform destructive DataSpace operations merely because they are connected to the LAN.

An optional local PIN/password MAY be added later without changing the identity architecture.

---

# 35. Room Participants

Party participants normally do not require accounts.

When joining a Room, the server creates a `RoomParticipant`.

Conceptual fields:

```text
id
room_id
display_name
role
token_hash
created_at
last_seen_at
```

The actual participant credential is given to the client.

The stored database value is a hash.

---

# 36. Room Roles

Canonical room roles:

```text
HOST
PLAYER
DISPLAY
```

A client MAY hold more than one effective capability.

Examples:

## Phone player

```text
PLAYER
PRIVATE_INPUT
```

## Host laptop

```text
HOST
DISPLAY
```

## Kodi television

```text
DISPLAY
HOST_CONTROLS
```

where explicitly authorized.

---

# 37. Room Authorization

Room authorization is intentionally simpler than persistent account authorization.

Typical capabilities include:

- JOIN_ROOM;
- DISPLAY_SESSION;
- CHOOSE_CARD_TYPE;
- SUBMIT_VOTE;
- SKIP_CARD;
- ADVANCE_SESSION;
- CHANGE_SESSION_SETTINGS;
- MANAGE_PLAYERS;
- END_SESSION.

Room capabilities MUST be checked by application commands.

The existing generic blueprint entity-permission system SHOULD NOT be used as the realtime Room permission engine.

---

# 38. Room Credentials and WebSocket Authentication

Browser WebSocket APIs do not reliably allow arbitrary authorization headers.

Therefore the canonical connection flow is:

1. client opens WebSocket;
2. only protocol handshake messages are accepted;
3. client sends `client.hello`;
4. hello includes room/player credential;
5. server validates it;
6. connection becomes authenticated;
7. unauthenticated sockets are closed after a short timeout.

Credentials MUST NOT be placed in reusable URLs where they can leak through logs/history.

Public deployments use WSS.

---

# 39. Room Codes

Human-readable Room codes are identifiers, not authorization credentials.

A Room code allows a player to request to join.

It does not grant host access.

Room codes SHOULD:

- be short;
- avoid ambiguous characters;
- use sufficient randomness;
- expire when the Room expires.

Public deployments MUST rate-limit Room-code guessing.

---

# 40. Game Session vs Account Session

These two concepts MUST remain separate.

## Account Session

Answers:

> Who is logged into the public application?

Implemented through HTTP authentication sessions.

## Game Session

Answers:

> What game is currently being played?

Implemented through the game domain and persistent Session state.

---

# 41. Game Domain Structure

Recommended conceptual modules:

```text
game-core/
├── cards/
├── categories/
├── dare-types/
├── profiles/
├── sessions/
├── modes/
│   ├── classic-truth-or-dare/
│   ├── random-truth-or-dare/
│   ├── never-have-i-ever/
│   └── lets-talk/
├── eligibility/
├── history/
├── repetition/
├── intensity/
├── rounds/
├── voting/
├── boundaries/
└── random/
```

---

# 42. Game Mode Extension Contract

New game modes MUST plug into the common Session engine rather than implement their own independent persistence/network stack.

Conceptually, a mode provides behaviors such as:

```text
initializeSession()
allowedCommands()
handleCommand()
determineNextState()
buildCardRequest()
resolveCard()
```

Exact interfaces may change during implementation.

The invariant is that a Game Mode controls rules, not infrastructure.

---

# 43. Card Selection Architecture

Card selection is composed from explicit policies.

For questions:

```text
CardType
→ game-mode constraints
→ Yes/No requirement
→ QuestionCategory
→ GameProfile
→ player boundaries
→ intensity/phase
→ active status
→ Session history
→ Group history
→ repeat rules
→ weight
→ random choice
```

For dares:

```text
CardType
→ DareType
→ GameProfile
→ player boundaries
→ operational flags
→ optional Dare Affinity
→ intensity/phase
→ active status
→ Session history
→ Group history
→ repeat rules
→ weight
→ random choice
```

These rules MUST be individually testable.

---

# 44. Randomness

Production random selection SHOULD use a cryptographically strong random source supplied through a domain abstraction.

Tests MUST be able to inject deterministic randomness.

The game domain MUST NOT call `Math.random()` directly.

This allows:

- reproducible tests;
- deterministic simulations;
- fair weighted selection.

---

# 45. Session State Machine

Every active Session is modeled as an explicit state machine.

Examples include:

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

Invalid commands for the current state MUST be rejected.

---

# 46. Session Revision

Each committed game-state transition increments a monotonically increasing:

```text
revision
```

Clients include the revision against which an action was made.

A stale command MAY be rejected with:

```text
STALE_SESSION_REVISION
```

and the client receives/resolves the current authoritative state.

This prevents delayed phone actions from mutating newer game state.

---

# 47. Per-Room Command Serialization

Commands for the same active Room MUST be processed sequentially.

A per-Room command queue or equivalent mutex SHOULD guarantee:

```text
command N
commit
broadcast
command N+1
```

Concurrent commands from different Rooms may execute independently.

This prevents races such as:

- two users advancing the card simultaneously;
- votes applied after a round transition;
- duplicate card selection.

---

# 48. State Commit Rule

The server MUST NOT broadcast a state transition before its required persistent changes have committed successfully.

Canonical flow:

```text
receive command
      ↓
validate principal + revision
      ↓
domain calculates proposed transition
      ↓
database transaction
      ↓
commit
      ↓
update active runtime state
      ↓
broadcast authoritative result
```

If persistence fails, clients remain on the previous committed revision.

---

# 49. Persistence Model for Active Sessions

The system does not use full event sourcing.

Canonical state is:

- current Session record;
- versioned serialized runtime state;
- related durable entities such as CardAppearance.

A Session SHOULD contain:

```text
id
room_id
group_id
mode
revision
runtime_state_version
runtime_state_json
started_at
ended_at
```

`runtime_state_json` SHOULD be stored as text containing validated JSON rather than relying on database-specific JSON query behavior.

---

# 50. Session Runtime State Versioning

Serialized Session state MUST contain a version.

When runtime-state structure changes between application versions, migration code MUST either:

- transform previous state to the new schema;
- or mark incompatible active Sessions as non-resumable with a clear error.

Silent misinterpretation of old Session state is not allowed.

---

# 51. Restart Recovery

Committed game state SHOULD survive a server restart.

After restart:

- Room metadata may be restored;
- clients may reconnect;
- current Session state can be reconstructed;
- Session revision remains authoritative.

Ephemeral information may require re-entry.

---

# 52. Ephemeral Sensitive State

The following SHOULD NOT be persisted long-term by default:

- individual Never-Have-I-Ever answers;
- individually attributed private content boundaries;
- private veto identity.

The server may hold them in memory while needed.

For player boundaries:

- the effective allowed content set may be persisted;
- the identity of the player responsible for an exclusion should not be persisted unnecessarily.

If a restart makes private-boundary reconstruction impossible, the Session SHOULD request boundary reconfirmation before displaying new sensitive content.

---

# 53. Card Appearance Persistence

A card becomes "shown" when it is committed for presentation.

`CardAppearance` is persisted at that point.

Conceptual fields:

```text
id
session_id
group_id
card_id
player_id
shown_at
round_number
skipped
completed
vetoed
```

This table supports:

- Session deduplication;
- Group deduplication;
- repeat cooldowns;
- aggregate statistics.

---

# 54. Group History

Group history MUST remain separate from Session history.

Card selection uses:

```text
Session history
+
Group history
+
AlwaysEligible
+
RepeatableInSession
```

according to the Game Design Document.

History is never stored solely in browser state.

---

# 55. Question Categories and DareTypes

The normalized schema MUST preserve the semantic distinction defined in the GDD.

For questions:

```text
QuestionCategory
```

is primary.

For dares:

```text
DareType
```

is primary.

A dare's secondary category becomes:

```text
DareAffinityCategory
```

The data model and APIs MUST not treat QuestionCategory and DareType as equivalent classifications.

---

# 56. Operational Card Flags

Operational behavior SHOULD be modeled independently from thematic taxonomy.

Examples:

```text
REQUIRES_TARGET_PLAYER
INVOLVES_THIRD_PARTY
REQUIRES_PHYSICAL_CONTACT
REMOVES_CLOTHING
REQUIRES_NUDITY
INVOLVES_ALCOHOL
INVOLVES_RECREATIONAL_DRUGS
```

Flags MAY be represented through a join table or normalized bit/record structure.

Business logic MUST not infer such behavior solely from text parsing.

---

# 57. Repositories

Domain/application code accesses persistence through focused repository interfaces.

Examples:

```text
CardRepository
SessionRepository
RoomRepository
GroupRepository
GameProfileRepository
CardHistoryRepository
AccountRepository
DataSpaceRepository
```

Repository interfaces describe application needs, not generic CRUD.

Avoid interfaces such as:

```text
GenericRepository<T>
```

where domain-specific behavior would be clearer.

---

# 58. TypeORM Entities

TypeORM entities live in the persistence layer.

They SHOULD map closely to database tables but MUST NOT be passed directly into game-domain logic as mutable domain objects.

Mapping occurs between:

```text
PersistenceEntity
↔
DomainModel
```

This prevents ORM concerns from leaking into the game engine.

---

# 59. Database Migrations

All schema changes MUST use versioned migrations.

Automatic schema synchronization MUST NOT be used in production.

## Local deployment

Local startup MAY automatically apply pending migrations, but SHOULD create a pre-migration database backup first.

## Public deployment

Public migrations SHOULD run as an explicit deployment step before the new application version begins serving traffic.

---

# 60. SQLite Backup

The portable application SHOULD expose a safe backup operation using SQLite's supported backup/checkpoint mechanisms.

Users should not be instructed to copy a potentially active WAL database arbitrarily.

Recommended UX:

> Daten sichern

which produces a consistent backup/export artifact.

---

# 61. Data Export and Import

Local-to-public migration should be supported by a future versioned export format.

Export may contain:

- Groups;
- Group members;
- history;
- custom GameProfiles;
- custom cards;
- preferences.

System cards are referenced through stable UUIDs rather than fully duplicated unless required.

The public import endpoint MUST treat imported files as untrusted input.

It validates:

- format version;
- object schema;
- ownership fields;
- IDs;
- maximum sizes;
- references.

An imported package can never grant administrative permissions.

---

# 62. HTTP API Responsibilities

HTTP is used for operations that are not dependent on a continuous realtime Session stream.

Examples:

- authentication;
- account management;
- Group management;
- GameProfile management;
- server information;
- Room creation;
- initial Room join;
- exports;
- imports;
- admin/card management.

Routes SHOULD be versioned:

```text
/api/v1/...
```

---

# 63. WebSocket Responsibilities

WebSockets are used for active game state.

Examples:

- Room presence;
- player joins/leaves;
- turn actions;
- Wahrheit/Pflicht choices;
- card display;
- votes;
- card completion;
- Session settings;
- state resynchronization.

HTTP polling is not the canonical realtime mechanism.

---

# 64. Canonical WebSocket Envelope

All WebSocket messages use a common envelope.

Example:

```json
{
  "protocol": 1,
  "type": "session.cardShown",
  "requestId": null,
  "revision": 184,
  "payload": {}
}
```

Client command:

```json
{
  "protocol": 1,
  "type": "command.chooseCardType",
  "requestId": "req-123",
  "revision": 183,
  "payload": {
    "cardType": "DARE"
  }
}
```

---

# 65. Protocol Handshake

Every connection begins with `client.hello`.

It declares:

- client type;
- supported protocol versions;
- application version;
- requested role;
- capabilities;
- Room credential where applicable.

Example conceptual capabilities:

```text
SHARED_DISPLAY
PERSONAL_DISPLAY
TOUCH_INPUT
REMOTE_INPUT
PRIVATE_INPUT
PRIVATE_VOTING
HOST_CONTROLS
AUDIO
ANIMATION
```

The server selects a compatible protocol version or rejects the client clearly.

---

# 66. Protocol Versioning

Native TV clients may update less frequently than the server.

Therefore the public server SHOULD support:

- current protocol major version;
- immediately previous supported protocol version

where practical.

Breaking protocol changes require a major version increase.

Local portable distributions ship matching web/server versions and therefore do not require broad backward compatibility internally.

---

# 67. State Resynchronization

Clients MUST NOT depend on receiving every realtime event.

A reconnecting client can request a complete current Session snapshot.

The server returns:

- revision;
- current state;
- active player;
- current card where visible;
- voting status;
- relevant settings.

A phone waking from sleep can therefore recover safely.

---

# 68. Error Protocol

Application errors use stable machine-readable codes.

Examples:

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

Human-readable translated UI messages remain a client responsibility.

---

# 69. Browser Client Architecture

The Svelte application is the primary general-purpose client.

It supports multiple presentation roles within one codebase:

```text
/mobile
/display
/host
```

or equivalent route/state modes.

The web client supports:

- phones;
- tablets;
- desktop browser;
- laptop shared screen;
- generic TV browser fallback.

---

# 70. Browser State

The browser may store:

- server URL;
- Room participant token;
- device ID;
- UI preferences.

The browser MUST NOT be the only owner of:

- game history;
- Group data;
- current Session state.

---

# 71. Kodi Client

Kodi is a thin native television client.

It handles:

- native remote navigation;
- focus;
- card display;
- shared-screen lobby;
- QR presentation;
- sounds/animations supported by Kodi;
- host actions when authorized.

It communicates through the same public protocol as every other client.

Kodi Python code MUST NOT contain independent card-selection rules.

---

# 72. Android TV / Google TV / Fire TV

The Android-family TV client uses:

- Kotlin;
- Compose for TV;
- remote/D-pad input;
- the canonical game protocol.

Android TV, Google TV and Fire TV SHOULD share one application core.

Platform-specific adaptations may exist for:

- distribution;
- device APIs;
- store requirements.

---

# 73. Additional Client Platforms

A future client only needs to implement:

- protocol handshake;
- authentication/pairing;
- Session snapshot;
- supported commands;
- display state.

Possible future clients include:

- Apple TV;
- Samsung Tizen;
- LG webOS;
- desktop native application.

No server-domain changes should be required solely because another client exists.

---

# 74. Local Server Discovery

Local networking SHOULD support:

1. QR joining;
2. displayed numeric IP/URL;
3. optional mDNS discovery.

QR is the primary phone connection method.

mDNS is convenience only and MUST have a manual-IP fallback.

---

# 75. TV Server Discovery

Native TV clients SHOULD support:

- remembered last server;
- mDNS-discovered local servers;
- manual server URL entry;
- public server URL.

The user should not have to re-enter an IP address every game night under normal conditions.

---

# 76. Public TV Pairing

Typing account credentials with a television remote SHOULD be avoided.

A public TV client MAY use pairing:

```text
TV shows short pairing code
       ↓
authenticated phone/browser enters code
       ↓
server authorizes display/device
```

Device credentials should be revocable from the user's account.

This capability is separate from Room participant tokens.

---

# 77. Security Boundaries

The architecture recognizes four major boundaries:

```text
Public internet
Local LAN
Authenticated DataSpace
Active Room
```

Security requirements vary by boundary but are never absent.

---

# 78. Public HTTPS

Public deployment MUST use HTTPS and WSS.

TLS may terminate at the hosting provider or reverse proxy.

The Node server trusts proxy information only when configured to do so.

---

# 79. CSRF

Public account-authenticated HTTP mutation endpoints using cookies MUST use CSRF protection appropriate to the selected request model.

Same-origin policy alone must not be treated as sufficient for every mutation endpoint.

---

# 80. WebSocket Origin Validation

Public WebSocket connections SHOULD validate browser Origin where applicable.

Native clients may not provide browser-style Origin headers and instead rely on their explicit credentials/protocol handshake.

---

# 81. Rate Limiting

Public deployment MUST rate-limit sensitive operations including:

- login;
- registration;
- password reset;
- Room-code joining;
- pairing;
- import;
- account activation attempts.

Realtime commands SHOULD also protect against abusive command rates per connection/Room.

---

# 82. Input Validation

Every externally supplied payload MUST be validated at the transport boundary.

This includes:

- HTTP request bodies;
- path/query parameters;
- WebSocket payloads;
- imported files;
- configuration files.

Validated data is then passed into the application layer.

---

# 83. Sensitive Logging

Logs MUST NOT contain:

- passwords;
- password-reset tokens;
- participant tokens;
- auth cookies;
- OIDC client secrets;
- private boundary selections;
- Never-Have-I-Ever individual answers.

Room codes MAY appear in diagnostic logs where useful, but public production logs should minimize unnecessary user data.

---

# 84. Realtime Privacy

Private player actions such as boundaries or vetoes MUST be sent only to server endpoints/messages intended for private input.

The server determines what result becomes public.

The broadcast layer MUST NOT blindly echo command payloads to all clients.

---

# 85. Observability

The server SHOULD provide:

```text
GET /healthz
GET /readyz
GET /api/v1/server-info
```

## `/healthz`

Indicates process availability.

## `/readyz`

Confirms dependencies required for serving traffic, particularly database connectivity.

## `/server-info`

Returns non-secret capabilities such as:

- deployment mode;
- account availability;
- protocol versions;
- server version.

---

# 86. Logging

Server logs SHOULD be structured.

Required common fields include where applicable:

```text
timestamp
level
message
roomId
sessionId
requestId
eventType
errorCode
```

Public production SHOULD use JSON output.

Portable/local mode MAY provide human-readable console/file output.

---

# 87. Request Correlation

HTTP requests SHOULD receive request IDs.

WebSocket commands SHOULD support `requestId`.

A request ID allows:

- command result correlation;
- diagnostic tracing;
- duplicate-command detection where needed.

---

# 88. Metrics

Formal metrics infrastructure is optional for portable installations.

Public installations SHOULD eventually expose operational metrics such as:

- active WebSocket connections;
- active Rooms;
- active Sessions;
- command latency;
- database errors;
- WebSocket reconnects.

Metrics MUST not contain sensitive answer content.

---

# 89. Graceful Shutdown

When shutting down, the server SHOULD:

1. stop accepting new Rooms;
2. stop accepting new connections;
3. allow currently executing commands to finish;
4. ensure committed Session state is durable;
5. close WebSockets;
6. close database connection.

No active state may exist solely in an unflushed queue during shutdown.

---

# 90. Testing Strategy

Testing is a first-class architectural requirement.

The project uses several levels.

---

# 91. Domain Unit Tests

`game-core` MUST have fast tests without:

- HTTP;
- WebSocket;
- TypeORM;
- real database.

Examples:

- card eligibility;
- repetition;
- mode transitions;
- rounds;
- profile filtering;
- intensity;
- weighting.

---

# 92. Simulation Tests

Large simulations MUST test invariants.

Examples:

```text
simulate 10,000 sessions
```

and verify:

- disabled DareType never appears;
- disabled QuestionCategory never appears;
- history rules remain correct;
- repeat cooldown works;
- AlwaysEligible behaves correctly;
- Random-mode ratio converges appropriately;
- meta-card scheduler behaves correctly;
- exhausted pools are handled explicitly.

Deterministic injected randomness makes failures reproducible.

---

# 93. Persistence Contract Tests

Repository behavior MUST be tested against both:

- SQLite;
- MariaDB.

The same repository contract suite should run against both adapters wherever practical.

This prevents portable/local mode from becoming a secondary untested implementation.

---

# 94. Migration Tests

CI SHOULD test:

```text
empty database
→ all migrations
```

and, where important:

```text
previous release schema
→ new release migrations
```

for both supported database engines.

---

# 95. Protocol Tests

The protocol package MUST test:

- valid message parsing;
- invalid payload rejection;
- protocol-version negotiation;
- stale revision behavior;
- reconnect snapshot behavior;
- authorization.

---

# 96. WebSocket Integration Tests

Tests SHOULD simulate multiple clients:

```text
host
player A
player B
display
```

and verify synchronized behavior.

Race tests should intentionally send simultaneous commands.

---

# 97. Browser End-to-End Tests

Playwright SHOULD cover critical workflows such as:

- local game creation;
- QR-style Room join flow;
- Classic Wahrheit oder Pflicht;
- Ich hab noch nie voting;
- Group history across Sessions;
- public login;
- account password reset where practical;
- settings changes.

---

# 98. Native Client Contract Tests

Kodi and Android-family TV clients SHOULD have protocol fixture tests.

Canonical JSON fixtures from the protocol package can verify that native clients correctly parse server messages.

The server is never changed merely to compensate for an undocumented native-client interpretation.

---

# 99. Code Quality

TypeScript compilation MUST use strict type checking.

Linting and formatting SHOULD be automated.

CI MUST block merges on:

- failed tests;
- compile failure;
- migration failure;
- lint errors configured as blocking.

---

# 100. Dependency Management

Dependencies SHOULD be intentionally limited.

The server should avoid accumulating unnecessary packages for functionality available through:

- Node standard library;
- existing infrastructure;
- small focused packages.

Production dependencies MUST be locked.

Regular dependency/security review is required for public deployments.

---

# 101. Build Artifacts

CI SHOULD produce:

- server application bundle;
- web-client assets;
- portable OS archives;
- public deployment bundle;
- protocol schema;
- optional source map artifacts;
- software bill of materials.

Portable and public artifacts originate from the same commit and source code.

---

# 102. Public vs Portable Distribution

Different release artifacts MAY contain different infrastructure drivers.

Example:

## Portable

Contains:

- Node runtime;
- SQLite adapter;
- SQLite native binding;
- web client;
- game server.

## Public

Contains:

- Node server bundle;
- MariaDB driver;
- web client.

This is still one server implementation.

Only deployment-specific runtime dependencies differ.

---

# 103. Upgrade Policy

Application releases use semantic versioning.

Before upgrading local data:

1. backup;
2. migrate database;
3. migrate catalog;
4. start new version.

If migration fails, startup stops with an actionable error.

It MUST NOT silently initialize an empty database over incompatible user data.

---

# 104. Protocol Compatibility Policy

Server and native-client versioning is independent from database schema versioning.

A server update MUST clearly communicate when a native client is:

- supported;
- outdated but compatible;
- incompatible.

An incompatible native client should display an update requirement rather than malfunction silently.

---

# 105. Card Content Administration

Future content-administration functionality uses the same application infrastructure.

Content tools should support:

- Card Type;
- QuestionCategory;
- DareType;
- DareAffinityCategory;
- intensity;
- operational flags;
- source metadata;
- repeat properties;
- active state.

The admin application does not bypass validation used by normal imports.

---

# 106. Custom Cards

Future user-created cards belong to a DataSpace.

They use the same domain representation as system cards where possible.

Card source identifies:

```text
SYSTEM
CUSTOM
```

Custom-card IDs are UUIDs.

Custom cards can participate in the same:

- filtering;
- profiles;
- history;
- repetition rules.

---

# 107. Extending Card Taxonomy

Adding a new QuestionCategory or DareType should primarily be a data/catalog operation.

The game engine SHOULD avoid hard-coded switch statements for every category unless a category genuinely requires special behavior.

Operational behavior belongs in:

- flags;
- profile rules;
- mode rules.

---

# 108. Extending Game Modes

Adding a game mode should require:

- new mode-domain implementation;
- new protocol states/commands only where necessary;
- UI representation.

It should not require:

- new persistence technology;
- separate Room subsystem;
- separate authentication;
- separate networking.

---

# 109. Extending Persistence

A future database adapter MAY replace or supplement MariaDB.

For example:

```text
PostgreSQL
```

Such an adapter implements the existing repository contracts.

The game domain does not change.

---

# 110. Horizontal Scaling

The initial canonical deployment uses one active Node server process for authoritative realtime Rooms.

This is sufficient for:

- portable instances;
- home servers;
- ordinary public deployment.

Horizontal multi-instance realtime scaling is not an initial requirement.

However, Room runtime state must remain encapsulated so that a future coordinator can introduce:

- sticky routing;
- distributed Room ownership;
- message broker;
- Redis or equivalent

without changing game-domain rules.

Do not add distributed infrastructure before it is required.

---

# 111. No Full Event Sourcing

The application intentionally does not use full event sourcing.

Reasons:

- additional complexity;
- privacy concerns;
- operational overhead;
- unnecessary replay burden.

The canonical persisted state consists of normal relational records plus the current versioned Session snapshot.

Domain events may exist internally during a command transaction, but the architecture does not depend on reconstructing Sessions from an immutable event log.

---

# 112. No Microservices

The server is a modular monolith.

This is deliberate.

The system does not require separate:

- auth service;
- Room service;
- game service;
- card service.

A modular monolith provides:

- straightforward portable distribution;
- simpler offline operation;
- transactional consistency;
- easier testing;
- easier deployment.

Modules remain separated internally so that future extraction is possible if ever justified.

---

# 113. No Client-Side Game Engine

Clients MAY implement presentation helpers.

They MUST NOT duplicate authoritative rules such as:

- eligibility;
- histories;
- randomization;
- round progression.

This avoids rule divergence between:

- Svelte;
- Kodi;
- Android TV.

---

# 114. No Database Access from Clients

No client connects directly to:

- SQLite;
- MariaDB.

All database access occurs through the game server.

This remains true even on a trusted home network.

---

# 115. No Runtime CDN Dependencies

No essential runtime asset may come from a third-party CDN.

This includes client libraries, fonts and game media.

This is a hard offline-support requirement.

---

# 116. Existing Node Blueprint — Reuse Strategy

The existing Node blueprint should be treated as infrastructure source material.

The following concepts SHOULD be retained/refactored:

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

---

# 117. Existing Blueprint — Concepts Not Retained

The following should not become part of the game architecture merely because they existed in the blueprint:

- Pug as the primary UI;
- Bootstrap/jQuery-oriented page structure;
- Surveyor-specific entity inheritance;
- generic `Profile` ownership naming;
- entity-assignment permission model for realtime gameplay;
- controller-contained business logic;
- MariaDB-only schema assumptions.

---

# 118. Blueprint Profile Migration

The blueprint's ownership `Profile` concept is renamed/replaced by:

```text
DataSpace
```

The name:

```text
GameProfile
```

is reserved exclusively for game presets.

This naming rule MUST remain consistent in:

- database;
- TypeScript;
- API;
- documentation.

---

# 119. Error Architecture

Domain/application errors use stable error classes/codes.

Transport adapters convert them into:

- HTTP errors;
- WebSocket error responses.

Examples:

```text
ValidationError
AuthenticationError
AuthorizationError
RoomNotFoundError
InvalidGameStateError
CardPoolExhaustedError
StaleRevisionError
```

Controllers do not manually invent arbitrary error response formats.

---

# 120. Application Service Rule

Transport controllers should remain thin.

They:

1. validate transport data;
2. establish Principal;
3. call application command/service;
4. serialize result.

Business rules belong in:

```text
application
+
game-core
```

not in Express route functions.

---

# 121. Security Review Requirements

Before public release, the project requires dedicated review of:

- password storage;
- reset flow;
- email verification;
- OIDC account linking;
- CSRF;
- WebSocket authentication;
- Room-code rate limiting;
- import validation;
- account deletion;
- data export;
- adult-content access rules.

Security-sensitive logic requires integration tests in addition to unit tests.

---

# 122. Privacy Principles

Persistent storage SHOULD minimize unnecessary personal information.

The system should not permanently store sensitive game answers merely because they are available.

The architecture distinguishes between:

```text
needed for game functionality
```

and:

```text
interesting for analytics
```

Only the first category is automatically justified.

Analytics are opt-in architectural additions, not implicit persistence.

---

# 123. Public Account Data

Public users should eventually be able to:

- export account-owned game data;
- delete account-owned game data.

Account deletion must define explicit handling for:

- DataSpace;
- Groups;
- history;
- custom GameProfiles;
- custom cards;
- auth sessions.

---

# 124. Local Data

Portable/local data remains under the control of the local installation.

The application SHOULD provide:

- backup;
- restore;
- export;
- delete/reset.

No cloud connection is required for any of these operations.

---

# 125. Architecture Decision Summary

The following decisions are canonical.

| Decision | Canonical choice |
|---|---|
| Backend language | TypeScript / Node.js |
| HTTP framework | Express 5 |
| Realtime | Raw WebSocket through `ws` |
| Architecture | Modular monolith |
| Game logic | Framework-independent domain |
| Local database | SQLite + WAL |
| Public database | MariaDB/MySQL |
| ORM | TypeORM |
| Web UI | Svelte + TypeScript + Vite |
| Kodi | Python client |
| Android/Fire TV | Kotlin + Compose for TV |
| Portable packaging | Bundled Node runtime + server + assets |
| Local authentication | No user accounts; local admin capability |
| Public authentication | Password and/or OIDC |
| Account sessions | Server-side HTTP sessions |
| Room identity | Short-lived Room participant credentials |
| Ownership container | DataSpace |
| Gameplay preset | GameProfile |
| Core API style | HTTP + versioned WebSocket protocol |
| Offline strategy | Local server serves all assets |
| Scaling model | Single authoritative server process initially |
| State model | Explicit Session state machine |
| Persistence model | Relational state + versioned Session snapshot |
| Event sourcing | No |
| Microservices | No |
| Native phone apps | Not initially required |

---

# 126. Architecture Acceptance Criteria

The technical architecture is being followed when:

- one server codebase runs both local and public deployments;
- portable play requires no internet and no installed Node runtime;
- public deployment adds authentication without changing game rules;
- the game domain imports neither Express nor TypeORM;
- SQLite and MariaDB repository behavior is covered by common tests;
- clients cannot choose authoritative cards;
- Kodi and Android TV use the same protocol as browser clients;
- questions and dares preserve their different taxonomy semantics;
- Room participants do not require public accounts;
- account Sessions and game Sessions remain separate;
- Group history survives server/client restarts;
- Session revisions prevent stale actions;
- Room commands execute sequentially;
- persistent changes commit before broadcast;
- private boundaries and votes are not unnecessarily persisted;
- all runtime assets are available locally;
- no CDN is required for local play;
- configuration determines local/public behavior instead of separate server implementations;
- migrations are the only supported production schema-change mechanism;
- GameProfile never means account/data ownership;
- DataSpace never means gameplay profile;
- newly added clients require protocol implementation, not game-engine duplication;
- newly added game modes reuse Rooms, Sessions, history and persistence infrastructure.

---

# 127. Final Architectural Model

The complete system can be summarized as:

```text
                     ┌────────────────────┐
                     │    GAME CLIENTS    │
                     │                    │
                     │ Web / Kodi / TV    │
                     └─────────┬──────────┘
                               │
                        HTTP / WebSocket
                               │
                     ┌─────────▼──────────┐
                     │ TRANSPORT LAYER    │
                     │ Express + ws       │
                     └─────────┬──────────┘
                               │
                     ┌─────────▼──────────┐
                     │ APPLICATION LAYER  │
                     │ Commands / authz   │
                     └─────────┬──────────┘
                               │
                     ┌─────────▼──────────┐
                     │    GAME DOMAIN     │
                     │                    │
                     │ Modes              │
                     │ Card selection     │
                     │ Sessions           │
                     │ History            │
                     │ Profiles           │
                     │ Voting             │
                     └─────────┬──────────┘
                               │
                       Repository contracts
                               │
                     ┌─────────▼──────────┐
                     │ INFRASTRUCTURE     │
                     │ TypeORM / Identity │
                     └──────┬───────┬─────┘
                            │       │
                     SQLite         MariaDB
                       │                │
                    LOCAL            PUBLIC
                       │                │
                 Local DataSpace    User Account
                                      │
                                   DataSpace
```

The core architectural objective is that **game rules, network clients, persistence technology and deployment environment remain cleanly separated**.

The portable LAN edition and authenticated public edition are two compositions of the same application.

The system favors a maintainable modular monolith over distributed complexity, explicit domain logic over controller-based business rules, protocol-driven clients over platform-specific game engines, and durable server authority over client-side state.

This architecture provides a stable technical foundation on which the complete Game Design Document can be implemented without preventing future additions such as new game modes, new clients, custom cards, cloud synchronization, additional database engines or larger public deployments.