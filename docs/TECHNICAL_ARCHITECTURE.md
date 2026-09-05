# Multiplayer Party Card Game — Technical Architecture Document

**Document status:** Canonical technical architecture / single source of truth  
**Version:** 1.2
**Companion document:** Multiplayer Party Card Game — Game Design Document  
**Primary runtime language:** TypeScript / Node.js  
**Primary architecture:** Server-authoritative, LAN-first modular monolith  
**Supported deployment classes:** Portable/local and publicly hosted  
**Primary persistence engines:** SQLite locally, MariaDB/MySQL publicly  
**Canonical source locale:** `de-DE`

---

# 1. Purpose

This document defines the authoritative technical architecture.

It translates the Game Design Document into implementation constraints covering:

- source-code boundaries;
- backend architecture;
- clients;
- networking;
- persistence;
- localization;
- content ingest;
- identity;
- authentication;
- deployment;
- portability;
- testing;
- security;
- versioning;
- extensibility.

Implementation should conform to this document unless a deliberate architecture change is recorded and this document is updated.

---

# 2. Relationship to the GDD

The Game Design Document is authoritative for:

- gameplay behavior;
- card semantics;
- Game Modes;
- Question Categories;
- DareTypes;
- history;
- localization behavior from the player's perspective;
- player boundaries;
- UX.

This document is authoritative for:

- software design;
- persistence;
- protocol;
- content catalog representation;
- localization implementation;
- ingest pipeline;
- deployment;
- security.

---

# 3. Normative Terms

**MUST** — required.

**SHOULD** — preferred unless there is a documented reason otherwise.

**MAY** — optional.

Permanent deviations from MUST-level decisions require an Architecture Decision Record and document revision.

---

# 4. Architectural Principles

## 4.1 One server implementation

Portable and public editions MUST use one server codebase.

That server and the Svelte browser client MUST form one `server-web` release unit. They
share one application version, build, manifest, archive, tag namespace, and release
workflow. Neither is released independently.

Differences are implemented through:

- configuration;
- database adapters;
- authentication providers;
- infrastructure services;
- packaging.

Game logic is never duplicated.

---

## 4.2 Server-authoritative gameplay

The server owns:

- Room state;
- Session state;
- current Card;
- turn order;
- card selection;
- history;
- randomization;
- voting outcome.

Clients send commands and render authoritative results.

---

## 4.3 LAN-first operation

A local server plus LAN must support full gameplay without internet.

No essential runtime component may depend on:

- external APIs;
- CDNs;
- remote fonts;
- remote game assets;
- cloud authentication.

---

## 4.4 Modular monolith

The server is intentionally a modular monolith.

Microservices are not part of the canonical architecture.

Reasons:

- portable distribution;
- offline operation;
- simpler transactions;
- simpler deployment;
- easier testing.

---

## 4.5 Framework-independent domain

The game domain MUST NOT depend directly on:

- Express;
- TypeORM;
- `ws`;
- Svelte;
- authentication libraries;
- email.

---

## 4.6 Language-independent domain identity

The domain MUST treat Cards, Categories, DareTypes and other catalog concepts by stable identifiers.

Translated labels and Card text are presentation/catalog resources.

Business logic MUST never depend on a translated string.

---

## 4.7 Content identity survives editing and localization

A text edit or new language MUST NOT generate a new Card identity.

Card identity changes only when the logical gameplay object changes.

---

# 5. Canonical Technology Stack

## Server

- Node.js
- TypeScript
- Express 5
- `ws`
- TypeORM
- Zod
- Pino or equivalent structured logger

## Local persistence

- SQLite
- `better-sqlite3` TypeORM driver
- WAL mode

## Public persistence

- MariaDB/MySQL
- `mysql2`

## Browser client

- Svelte
- TypeScript
- Vite

## Kodi

- Python 3 native Kodi 21/Omega script add-on
- one `WindowXMLDialog` shell with reducer/effect/event-queue state ownership
- generated JSON Schemas, fixtures, enums, Golden Mischief token data, WindowXML, and raster media

## Android-family TV

- Kotlin
- Jetpack Compose for TV

---

# 6. High-Level Architecture

```text id="m5yscu"
                    CLIENTS

 Web/Svelte      Kodi/Python      Android TV/Kotlin
      │               │                 │
      └───────────────┼─────────────────┘
                      │
               HTTP + WebSocket
                      │
             Transport Layer
             Express + ws
                      │
             Application Layer
                      │
                Game Domain
                      │
               Repository APIs
                      │
           Infrastructure Layer
              /              \
          SQLite            MariaDB
          local              public
```

Localization/content catalog services sit between application logic and persistence but do not redefine Card identity.

---

# 7. Repository Structure

```text id="qz59y2"
party-game/
│
├── apps/
│   ├── server/                 # Express/WebSocket composition and migrations
│   ├── web/                    # Svelte browser client
│   └── kodi/                   # independently packaged native client
│
├── packages/
│   ├── game-core/
│   ├── application/
│   ├── protocol/
│   ├── persistence/
│   ├── card-catalog-contract/
│   ├── localization/
│   └── design-tokens/
│
├── tooling/
│   ├── catalog/
│   ├── database/
│   ├── design/
│   ├── kodi/
│   ├── release/
│   └── testing/
│
├── tests/
│   ├── architecture/
│   ├── integration/
│   ├── unit/
│   ├── simulation/
│   └── e2e/
│
└── docs/
```

`apps/` is the single source taxonomy for deployable applications. Source placement
does not define release coupling: server and web remain one `server-web` release unit,
while Kodi keeps its independent manifest, version, workflow, and archive. Reusable
framework-independent decisions live under `packages/`; generators and maintenance
commands live under `tooling/`. See ADR-013.

---

# 8. `game-core`

Contains pure gameplay logic:

- Session state machine;
- Game Modes;
- card eligibility;
- history;
- repetition;
- GameProfile logic;
- voting and Never-Have-I-Ever reveal policy;
- intensity;
- rounds;
- randomization.

The domain works primarily with:

```text id="ve9ta1"
CardId
QuestionCategoryId
DareTypeId
GameProfileId
LocaleCode
```

It does not store translated labels.

---

# 9. `catalog`

Contains catalog-domain concepts:

- Card identity;
- Card metadata;
- producer-owned stable identity;
- lifecycle state;
- catalog version;
- taxonomy;
- built-in GameProfiles.

It does not perform transport rendering.

---

# 10. `localization`

Contains:

- locale definitions;
- Card localizations;
- taxonomy localization;
- publication state;
- source-revision compatibility;
- localization fallback policy;
- translation coverage calculation.

It does not determine gameplay history.

---

# 11. `application`

Contains use cases such as:

- CreateRoom;
- JoinRoom;
- StartSession;
- SelectCardLanguage;
- ChooseTruth;
- ChooseDare;
- SubmitVote;
- ConfigureNeverHaveIEverRevealMode;
- ChangeSettings;
- ImportCatalog;
- PublishLocalization.

---

# 12. `protocol`

Defines:

- HTTP DTOs;
- WebSocket envelopes;
- protocol versions;
- configured Room participant/player capacity;
- capability declarations;
- machine-readable errors.

Zod schemas are the canonical runtime validation definitions.

JSON Schema should be generated for native clients.

---

# 13. Deployment Modes

## Local

```text id="h11m4q"
DEPLOYMENT_MODE=local
```

Characteristics:

- SQLite;
- no mandatory user accounts;
- LAN HTTP/WS permitted;
- dual-stack IPv4/IPv6 all-interface HTTP and WebSocket bind by default;
- browser-origin Room QR links unless `PUBLIC_URL` explicitly overrides them;
- all assets local;
- portable package;
- internet not required.

## Public

```text id="3cq3pk"
DEPLOYMENT_MODE=public
PUBLIC_RUNTIME_SECURITY=enforced
```

Characteristics:

- MariaDB/MySQL;
- account system;
- HTTPS/WSS;
- email;
- optional OIDC;
- public abuse controls.

For administrator-controlled testing of the public SPA and server behavior without
production infrastructure, `PUBLIC_RUNTIME_SECURITY=development` is an explicit unsafe
override. It permits HTTP, SQLite, account-free quick play, the development Card fixture,
and incomplete proxy/SMTP/secret configuration, and disables public Origin enforcement,
HSTS, and HTTP/WebSocket abuse rate limits. Account authentication can remain enabled to exercise
the full persistent experience. The override does not weaken server-side ownership,
Room authority, password hashing, input validation, or OIDC callback validation. It must
not be exposed to an untrusted network.

---

# 14. Configuration

Resolution order:

```text id="q4zwko"
built-in defaults
→ config file
→ environment variables
```

Configuration must be validated before server startup.

Important settings include:

```text id="ctwnbv"
DEPLOYMENT_MODE
PUBLIC_RUNTIME_SECURITY
AUTH_MODE
DB_TYPE
DB_FILE
DB_HOST
DB_PORT
DB_NAME
DB_USER
DB_PASSWORD
HTTP_BIND
HTTP_PORT
PUBLIC_URL
LOG_LEVEL
LOG_ERROR_DETAILS
DEFAULT_UI_LOCALE
DEFAULT_CARD_LOCALE
SOURCE_LOCALE
```

---

# 15. Runtime vs Deployment Mode

`NODE_ENV` must not determine security topology.

Portable production may intentionally run via LAN HTTP.

Security behavior comes from:

- deployment mode;
- the explicit public runtime security policy;
- configured public URL;
- proxy settings;
- explicit cookie policy.

---

# 16. Server-Web Distribution

Users of a server-web archive must not install:

- Node;
- npm;
- TypeScript;
- SQLite;
- build tools.

Release archives include:

- Node runtime;
- compiled server;
- Svelte assets;
- SQLite native binding;
- catalog;
- media;
- migration code.

Portable and public editions are assembled from the same compiled server and Svelte
output. Both contain the runtime and production dependency graph. Packages are built
and smoke-tested natively for Linux, Windows, and macOS on x64 and arm64. The public
edition still requires its configured database, TLS/proxy, secret, authentication, and
mail services.

---

# 17. Public Deployment

The same compiled application runs through the Node runtime embedded in its
platform-specific server-web archive.

Requirements:

- persistent Node process;
- WebSocket support;
- HTTPS proxying;
- MariaDB/MySQL;
- environment secrets;
- outbound SMTP or equivalent.

---

# 18. Core Persistence Strategy

Two supported database engines:

```text id="xfyq2a"
SQLite
MariaDB/MySQL
```

Domain behavior must remain database-neutral.

TypeORM entities are infrastructure objects, not game-domain objects.

---

# 19. Database Portability Rules

Core schema should use the common relational subset:

- UUID/string;
- varchar;
- text;
- integer;
- boolean;
- datetime;
- foreign keys;
- indexes;
- unique constraints.

Avoid core dependence on:

- DB-specific enums;
- stored procedures;
- triggers containing game logic;
- MariaDB-only JSON queries.

---

# 20. Stable Identifiers

Externally meaningful entities use stable UUIDs.

This includes:

- Cards;
- Groups;
- GameProfiles;
- Sessions;
- custom Cards;
- DataSpaces.

System Card UUIDs MUST remain identical across:

- installations;
- catalog updates;
- languages.

---

# 21. Card UUID Assignment

Card UUIDs MUST NOT be derived from localized text.

The third-party Card management system assigns each UUID permanently and publishes it
in `game-card-catalog/v2`. The game persists that UUID unchanged and has no source-ID
mapping layer.

---

# 22. Catalog Producer Boundary

The external producer owns source integration, editorial workflow, localization review,
and immutable release assembly. The game consumes one normalized FULL snapshot and does
not retain producer-source identifiers or authoring state.

---

# 23. Logical Card Schema

Conceptual logical Card:

```text id="h5beyu"
Card
----
id UUID
card_type
question_category_id
dare_type_id
dare_affinity_category_id
yes_no_answer_possible
intensity
always_eligible
repeatable_in_session
repeat_cooldown
weight
lifecycle_state
created_at
updated_at
```

No primary player-facing Card text is stored directly on this entity.

---

# 24. Card Localization Schema

Conceptual:

```text id="iib8qf"
CardLocalization
----------------
card_id
locale_id
text
active
updated_at
```

Unique constraint:

```text id="jt8r4p"
(card_id, locale_id)
```

Only producer-approved localizations occur in the incoming snapshot. `active=true`
means present in the current snapshot; missing entries are soft-disabled.

---

# 25. Locale Schema

Conceptual:

```text id="k6irj4"
Locale
------
id
native_name
active
is_default
```

`code` uses canonical BCP 47 style identifiers such as:

```text id="ygstfz"
de-DE
en-GB
en-US
fr-FR
```

Exactly one active locale is the catalog default. This is not necessarily the UI locale.

The initial bundled default is:

```text id="qne1cd"
de-DE
```

---

# 26. Taxonomy Localization

Question Categories and DareTypes use stable language-neutral entities.

Example:

```text id="qs7vos"
DareType
--------
id
code
```

Localized labels:

```text id="zwwpt9"
DareTypeLocalization
--------------------
dare_type_id
locale_id
label
description
```

Equivalent localization tables exist for:

- QuestionCategory;
- built-in GameProfile;
- other catalog-defined labels.

Card catalog v2 retains the existing taxonomy intensity semantics. `game-core` owns an
independently tuned, hard-coded numeric base offset for each QuestionCategory and
DareType and derives an internal score as `base offset + Card intensity`. Fractional
offsets allow the overlap between each pair of five-score ranges to match their actual
content relationship while distant classifications remain separated. The browser
receives both the relative 1–5 Card level and the global 1–5 display level
`min(5, ceil(score / 4))`. The taxonomy selects the adaptive background family; the
derived global level tunes that family's atmosphere and remains active between Cards.

---

# 27. Custom GameProfiles

Custom GameProfiles are user-created content.

Their names are stored as user-entered text.

They are not automatically translated.

A later feature may allow optional localized names, but this is not required for core functionality.

---

# 28. UI Localization vs Content Localization

These are separate systems.

## UI localization

Contextual prose and client-specific flows are handled by each client. Stable product
terms with identical browser/native meaning may come from the shared client vocabulary;
each client still maps those terms into its own catalog structure.

Examples:

- buttons;
- menus;
- error text;
- settings.

## Content localization

Stored in the game catalog.

Examples:

- Card text;
- Question Category labels;
- DareType labels;
- catalog-defined labels.

Clients must never infer Card translations from UI resource bundles.

---

# 29. Session Locale Model

A Session stores:

```text id="dy16xi"
card_locale
```

This determines Card eligibility and display text.

Each client may separately maintain:

```text id="4ht92v"
ui_locale
```

The server does not require all clients to use the same UI locale.

---

# 30. Card Localization Resolution

Canonical card-content resolution:

1. obtain selected Session `card_locale`;
2. find CardLocalization for that locale;
3. require `active=true`;
4. if unavailable:
    - exclude Card by default;
    - or try the Session's explicit ordered Card fallback locales.

Silent fallback is not the default.

---

# 31. UI Fallback

Client UI localization may use normal fallback chains.

Example:

```text id="om1x24"
de-AT
→ de
→ default locale
```

This does not alter Card-content fallback rules.

The web localization composition root is the only registry of supported interface
languages. Browser negotiation and selectors enumerate that registry; selectors do not
maintain a second language list. User language preferences are nullable until the first
manual choice, live on `User` rather than a DataSpace, and contain system/manual mode,
explicit interface/Card locales, and a stable ordered fallback list.

---

# 32. Localized API Data

The server should expose taxonomy/catalog metadata for a requested locale.

Example:

```text id="mgai4z"
GET /api/v1/catalog/taxonomies?locale=en-GB
```

The returned objects contain:

- stable ID/code;
- localized label;
- localized description where available.

Business operations continue to submit stable IDs.

---

# 33. Card Display DTO

A displayed Card DTO includes stable identity plus resolved localized content.

Conceptual:

```json id="wvroog"
{
    "id": "8fc2...",
    "type": "DARE",
    "dareType": "DARE_KISS_SPICY",
    "cardIntensity": 4,
    "intensity": 3,
    "text": "..."
}
```

Clients do not need to own the complete Card translation database.

---

# 34. Producer Release Approval

Translation revision, review, and staleness are producer concerns. Runtime persistence
contains no draft/review/stale fields. An approved localization is present; an
unapproved localization is absent and therefore soft-disabled during FULL apply.

---

# 35. Artifact Immutability

The receiver computes SHA-256 over exact artifact bytes. A `(catalog_id, sequence)` may
not be reused with different bytes, and an installed newer sequence is never replaced
by an older bundled FULL snapshot.

---

# 36. Producer Content Changes

The producer decides whether wording changes require new localizations or a new logical
Card. The game applies final release-ready text without interpreting editorial intent.

---

# 37. Card Lifecycle

Canonical logical states:

```text id="5b7hox"
ACTIVE
RETIRED
```

A retired Card remains in persistence for:

- history;
- Session references;
- analytics;
- localization history.

It cannot be selected for new play.

---

# 38. Hard Deletion

Hard deletion of a canonical Card is exceptional.

It may occur only when:

- Card was created erroneously;
- no historical references exist;
- no external stable identity must be preserved.

Normal content removal uses `RETIRED`.

---

# 39. Meaning-Changing Replacement

If content changes enough to become a new gameplay concept:

1. old Card becomes RETIRED;
2. new Card gets new UUID;
3. editorial relation may record:
    - replaced_by;
    - derived_from.

History remains attached to the old Card.

---

# 40. One External Artifact

The producer delivers only `catalog/card-catalog.json`. The game validates and packages
those exact bytes; it has no raw/staging, Access, translation-pack, or intermediate
production format.

---

# 41. Build and Startup Pipeline

1. strict-parse and validate `game-card-catalog/v2`;
2. run semantic and coverage checks;
3. compute SHA-256 over exact bytes;
4. package those bytes unchanged;
5. at startup validate and hash again;
6. acquire the catalog-application lock;
7. re-read installed sequence/digest;
8. skip, apply, or reject according to immutable ordering;
9. reconcile the FULL snapshot in one transaction;
10. run post-apply consistency checks before readiness.

---

# 42. FULL Snapshot Removal

A stored Card missing from a newer FULL snapshot becomes inactive. Its UUID,
localizations, flags, appearances, and history remain. Reappearance of that UUID updates
and reactivates the same logical Card.

---

# 43. Producer UUID Stability

The producer is responsible for keeping UUIDs stable across its source-system changes.
The game never uses text similarity or external source IDs to redefine identity.

---

# 44. Localization Reconciliation

All release-approved languages arrive in the same snapshot. Incoming `(card_id, locale)`
rows are upserted and activated. A previously stored localization absent from an
incoming Card is soft-disabled; it is never treated as a new Card.

---

# 45. Locale Registry

The same FULL snapshot contains the runtime Card locale registry, Card localizations,
and taxonomy localizations. Adding a Card locale requires a catalog release, not an
application/UI translation build.

---

# 46. Catalog Versioning

The database tracks catalog ID, monotonic sequence, version label, exact artifact
digest, generation/application timestamps, default locale, and counts.

Catalog releases may:

- add Cards;
- retire Cards;
- update metadata;
- update translations;
- add locales;
- retire locale resources.

Catalog updates do not erase user data.

---

# 47. Translation Coverage

The catalog/localization layer should provide coverage metrics.

Examples:

```text id="bw38s7"
total active Cards
active localized Cards for locale
missing localizations
```

These metrics support:

- setup warnings;
- administration;
- release validation.

---

# 48. Eligibility and Locale

Card selection performs locale eligibility before random selection.

Questions:

```text id="xxlqcu"
Card type
→ active exact-locale localization
→ QuestionCategory
→ GameProfile
→ maximum social sensitivity
→ boundaries
→ derived global intensity / Session phase
→ history
→ repeat rules
→ weighting
```

Dares:

```text id="mx2x06"
Card type
→ active exact-locale localization
→ DareType
→ GameProfile
→ maximum social sensitivity
→ boundaries
→ flags
→ Dare Affinity
→ derived global intensity / Session phase
→ history
→ repeat rules
→ weighting
```

The Session ceiling begins at `startingIntensity × 4` and increases by the configured
`intensityProgressionIncrement` after each interval of either completed rounds or
displayed Cards. The increment accepts half-steps from 0.5 through 4 and never raises the
ceiling above `maximumIntensity × 4`. Built-ins use one point every two displayed Cards,
which crosses overlapping taxonomy thresholds gradually. Never Have I Ever treats one
completed all-player Card as a round; Card-based pacing uses authoritative CardAppearance
count. This calculation lives in `game-core`, is serialized in the versioned runtime, and is
shared by every topology.

`GameProfile.maximumSocialSensitivity` is a required ordered domain value independent
from intensity and taxonomy. Eligibility rejects a Card above that ceiling after policy
resolution, so a DataSpace/Group/Session sensitivity override is evaluated consistently.
Persisted runtime v4 records from before this additive field restore it as `EXPLICIT`,
which preserves their original unrestricted behavior.

---

# 49. History Model

History references:

```text id="j68vbd"
Card.id
```

not:

- localized text;
- locale-specific record.

Therefore the same logical Card remains seen across language changes.

---

# 50. CardAppearance

Conceptual:

```text id="uk3e4m"
CardAppearance
--------------
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

Locale may optionally be recorded for analytics/audit:

```text id="v8fe43"
card_locale
```

but history semantics remain Card-based.

---

# 51. DataSpace

Persistent user-controlled data belongs to a DataSpace.

Local deployment creates one automatic DataSpace.

Public deployment associates DataSpace with authenticated account ownership.

DataSpace game settings keep the last applied no-Group Custom profile configuration and
atomic Card-language settings value in dedicated validated snapshots. Each Group keeps
its own values with the same shape; Card-language settings contain the primary locale,
fallback switch, and ordered fallback locales. Completing grouped setup updates only that
Group's values; completing no-Group setup updates only the DataSpace values and
User/device primary Card-language preference. Built-in profile writes preserve Custom
snapshots, and anonymous public quick rounds never write persistent setup defaults.

`GameProfile` remains reserved for gameplay presets.

---

# 52. Public Authentication

Public deployment supports:

- registration;
- login;
- logout;
- activation;
- password reset;
- account deletion;
- optional OIDC.

The existing Node blueprint's account infrastructure should be reused and hardened rather than replaced unnecessarily.

---

# 53. Room Participants

Party players normally use short-lived Room credentials rather than persistent accounts.

Conceptual:

```text id="s76q0w"
RoomParticipant
---------------
id
room_id
display_name
role
token_hash
last_seen_at
first_connected_at
last_connected_at
connection_status
reconnect_deadline
activation_expires_at
left_at
revoked_at
```

Rooms persist `bootstrap_mode`, first-Host provenance, activation lease timestamps, and
the creator participant. `DISPLAY_WAITING_FOR_HOST` creation commits one DISPLAY and no
Host. `roomHostSelection.ts` is the sole decision owner for activation, transfer, leave,
explicit close, expiry, and recovery. It also produces a deterministic demotion plan if
recovery encounters multiple current Hosts. The Room transaction serializes the repair
or promotion, and a nullable unique active-Host guard supplies the database backstop.

Room creation idempotency is scoped by HMAC digests of installation/principal/route/key.
The original credential-bearing response is stored only as installation-scoped
AES-256-GCM ciphertext bound to its request fingerprint and resource metadata. Creator
credential invalidation erases ciphertext and leaves a bounded `RESOURCE_GONE`
tombstone. Persisted identifiers for both derived purpose keys let startup reject silent
lookup-key or replay-key rotation while ordinary retained rows still depend on them.

`roomObservability.ts` consumes only committed lifecycle results. It emits structured
Room events and fixed-label process metrics, including both hostless-duration phases;
Room identity is retained only in the bounded in-process duration tracker and never
becomes a metric label.

Server bootstrap awaits persisted Room connection recovery after binding HTTP/WebSocket
and before enabling mDNS. A restart therefore cannot advertise a ready endpoint whose
authoritative connection lifecycle is still stale.

---

# 54. Account Session vs Game Session

These remain separate.

Account Session:

> Who is logged in?

Game Session:

> What game is currently being played?

Neither may be reused as the other.

## Never Have I Ever Reveal Configuration

`Ich hab noch nie` remains one Game Mode. The canonical Session configuration includes:

```text
neverHaveIEverRevealMode:
    ANONYMOUS_AGGREGATE
    NAMED_ANSWERS
```

`ANONYMOUS_AGGREGATE` is the default.

The setting is part of pre-Session Room/Couch configuration and is copied into the
authoritative `GameSession` when the Session starts. It is immutable for the lifetime of
that active Session. A new Session is required to change it.

This setting is not a GameProfile taxonomy rule and must not be inferred from a profile.

## Never Have I Ever Voting Projection

The domain retains vote values keyed by the current eligible voter IDs while collecting
answers. The application projection separates **completion state** from **answer
visibility**.

During answer collection, every authorized presentation receives the public voter
progress for the current Card:

```text
playerId
displayName
status = PENDING | VOTED
```

No projection may expose another player's `YES`/`NO` value while the Session is in the
collection state, regardless of reveal mode.

The voter set is fixed for the current Card when collection begins. Existing Session
rules for late joins therefore apply from the next applicable Card.

After all required votes exist, the Session moves to the result state.

For `ANONYMOUS_AGGREGATE`, the public result contains aggregate counts only.

For `NAMED_ANSWERS`, the public result contains:

- aggregate counts;
- each voter ID/display name;
- each voter's final `YES`/`NO` answer.

Named values become public only in the result state.

Couch HTTP projections and Room WebSocket snapshots MUST use the same canonical voting
projection semantics so Couch, Personal, and Party Screen do not implement separate
privacy rules.

---

# 55. WebSocket Protocol

All messages use a versioned envelope.

Example:

```json id="qsd16b"
{
    "protocol": 2,
    "type": "session.cardShown",
    "requestId": null,
    "revision": 184,
    "payload": {}
}
```

---

# 56. Client Handshake

`client.hello` announces:

- supported protocol;
- client type;
- application version;
- requested role;
- capabilities;
- Room credential.

Capabilities may include:

```text id="azrsbk"
SHARED_DISPLAY
PERSONAL_DISPLAY
REMOTE_INPUT
TOUCH_INPUT
PRIVATE_INPUT
PRIVATE_VOTING
HOST_CONTROLS
AUDIO
ANIMATION
```

---

# 57. Session Revision

Every committed state transition increments a monotonic revision.

Commands may be rejected when based on stale state.

This protects against:

- sleeping phones;
- delayed messages;
- multiple advance actions.

---

# 58. Per-Room Serialization

Commands for one Room are processed sequentially.

Different Rooms may operate concurrently.

This prevents race conditions around:

- card advancement;
- votes;
- history;
- random selection.

---

# 59. Commit Before Broadcast

Canonical command lifecycle:

```text id="9msx7m"
receive
→ validate
→ domain transition
→ persistence transaction
→ commit
→ update runtime state
→ broadcast
```

Clients never receive uncommitted authoritative state.

---

# 60. Active Session Persistence

A Session stores a versioned runtime snapshot.

Conceptual:

```text id="u62dqm"
Session
-------
id
room_id
group_id
mode
card_locale
never_have_i_ever_reveal_mode
revision
runtime_state_version
runtime_state_json
compiled_card_policy_digest
group_history_digest
started_at
ended_at
```

The runtime JSON holds only small mutable state. Its catalog-sized compiled policy and
frozen Group-history inputs live in separate immutable payload storage. Each payload is
Brotli-compressed, identified by a kind-specific SHA-256 digest, and split into 24 KiB
binary chunks whose Base64 database values stay below 32 KiB. Identical inputs are
shared. Frozen Group history is an exact bitset indexed by the compiled Card order,
requiring one bit per current Card instead of a UUID list. Current-Session Card history
is loaded from normalized CardAppearance rows and is not duplicated in runtime JSON. These mappings preserve authoritative restart state
while keeping every write bounded independently of catalog, Group-history, and Session
length.

---

# 61. Sensitive Ephemeral Data

Do not persist as long-term history or analytics by default:

- individual private boundaries;
- individual Never-Have-I-Ever answers;
- veto identity.

Never-Have-I-Ever vote values may exist in active Session runtime state, including the
versioned active-Session snapshot when required for authoritative reconnect/restart
recovery. They must be cleared from active state when the Card is resolved/advanced and
must not be copied into `CardAppearance`, Group history, general analytics, or logs.

`NAMED_ANSWERS` changes only the result projection: it authorizes broadcasting the final
per-player answers after reveal. It does not make those answers durable history.

A restart may require sensitive boundary settings to be reconfirmed where they were not
persisted.

---

# 62. Repository Contracts

Focused interfaces include:

```text id="tzk929"
CardRepository
LocalizationRepository
CatalogRepository
SessionRepository
RoomRepository
GroupRepository
GameProfileRepository
CardHistoryRepository
DataSpaceRepository
```

Avoid broad generic CRUD repositories when domain-specific methods are clearer.

---

# 63. TypeORM Boundaries

TypeORM entities live only in infrastructure/persistence.

Domain models are mapped explicitly.

This prevents ORM annotations and lazy-loading behavior from leaking into game rules.

---

# 64. Database Migrations

All production schema changes use migrations.

Automatic schema synchronization is forbidden in production.

Local startup may apply migrations automatically after creating a backup.

Public migrations should run as a deployment step.

---

# 65. Catalog Migrations

Schema migrations and catalog/content updates are separate concepts.

A release may contain:

```text id="f52yma"
database schema migration
+
catalog update
+
translation update
```

Each is versioned and validated independently.

---

# 66. SQLite Backup

Local backup must use a safe database backup/checkpoint mechanism.

Users should not be instructed to copy an actively written WAL database manually.

---

# 67. Data Export

Versioned export may contain:

- Groups;
- history;
- custom GameProfiles;
- custom Cards;
- preferences.

System Cards are referenced by stable Card UUID.

Localized system Card text need not be duplicated in export unless required.

---

# 68. Data Import

Imports are untrusted input.

They must validate:

- export version;
- UUID formats;
- ownership;
- references;
- maximum size;
- custom Card localization data;
- locale identifiers.

Import must never grant administrative rights.

---

# 69. HTTP API

Versioned:

```text id="jjsquv"
/api/v1/
```

Used for:

- authentication;
- account management;
- Groups;
- GameProfiles;
- locales;
- taxonomy;
- Room creation;
- initial joining;
- catalog/admin management;
- import/export.

`POST /rooms` defaults to `CREATOR_HOST`. Explicit
`DISPLAY_WAITING_FOR_HOST` requires a canonical UUIDv4 `Idempotency-Key` and returns a
DISPLAY credential. Retries of the same parsed JSON replay the exact committed response.

---

# 70. WebSocket Responsibilities

Used for active gameplay:

- Room presence;
- turn actions;
- card display;
- voting, voter-completion progress, and configured result reveal;
- settings updates;
- resynchronization.
- participant activation and the atomic first/replacement Host decision.

WebSocket is the canonical realtime mechanism.

---

# 71. State Resynchronization

A reconnecting client can request a complete Session snapshot.

Snapshot includes:

- revision;
- current state;
- active player;
- current localized Card if visible;
- Card locale;
- voting state, including the current voter `PENDING`/`VOTED` roster;
- Never-Have-I-Ever reveal mode and any result currently authorized for this viewer;
- relevant Session settings.

---

# 72. Error Codes

Stable codes include:

```text id="opgan7"
ROOM_NOT_FOUND
ROOM_FULL
INVALID_GAME_STATE
NOT_ACTIVE_PLAYER
CARD_POOL_EXHAUSTED
CARD_TRANSLATION_UNAVAILABLE
STALE_SESSION_REVISION
NOT_AUTHORIZED
PROTOCOL_VERSION_UNSUPPORTED
```

Human-readable translations remain a client responsibility.

---

# 73. Web Client

Svelte client handles:

- phone mode;
- host browser;
- shared display fallback;
- account UI;
- settings;
- language selection.

UI string localization is client-owned.

Catalog text comes from server APIs/messages.

The compiled client is served by and released only with its matching server version.

---

# 74. Kodi Client

Kodi is an independently released thin client. `apps/kodi` implements one
`WindowXMLDialog` root shell, immutable application state, a pure reducer, bounded
effect workers, and a GUI-thread event queue. Network, DNS, schema parsing, QR generation, and
profile writes never run on the Kodi GUI thread, and late async results are rejected by
operation/server identity.

It:

- renders localized Cards and viewer-safe state received from the server;
- supports Couch Play for every server-supported mode and full pending-game setup;
- creates display-bootstrap Rooms and always joins hosted Rooms as `DISPLAY`;
- handles deterministic remote focus, Back/Context behavior, accessibility preferences,
  bounded lists, and display-mode screensaver inhibition;
- performs privacy-minimal DNS-SD discovery, manual server selection, readiness/capability
  validation, stable-ID deduplication, and local/global transport enforcement;
- sends revisioned HTTP/WebSocket commands, resynchronizes after ambiguity, and persists
  minimal recovery state before Room connection;
- displays credential-free QR/Room information and safe diagnostics;
- supports capability-gated native device authorization without inventing endpoints,
  scopes, or account authority.

Shared TypeScript protocol schemas and design tokens generate the Kodi JSON Schemas,
fixtures, manifests, self-contained WindowXML, and raster media. Shared client terms and
the Kodi locale/settings manifest generate Python string/settings metadata, PO catalogs,
and `settings.xml`. The add-on contains no independent Card catalog or game rules.
Participant/account secrets use a separate exact-origin store and are never included in
discovery, QR codes, fixtures, or diagnostics.

The deterministic `script.partycard.tv-{version}.zip` is an independent `kodi-client`
artifact with checksum, SBOM, provenance, workflow, and tag namespace. Repository tests
cover the pure Python/client boundary; clean Kodi version/platform/skin/remote/network
installation remains a release QA gate.

---

# 75. Android TV / Fire TV

Kotlin/Compose client behaves similarly.

It should share the Android-family application core across:

- Android TV;
- Google TV;
- Fire TV.

---

# 76. Native Client Localization

Native clients maintain their own UI resource shape and platform-specific prose. Stable
terms with the same product meaning as the browser use the shared bilingual client
vocabulary; native-only copy remains in the native catalog.

They request content/taxonomy localization from the server using locale identifiers.

This prevents the same Card translation database from being duplicated independently in every client release.

---

# 77. Local Discovery

Supported mechanisms:

1. QR URL;
2. displayed IP/URL;
3. DNS-SD/mDNS for compatible local discovery clients.

mDNS is convenience only and is not authenticated.

One installation advertises `_partycard._tcp.local` only after HTTP listening and
database readiness. TXT version 1 contains only `txtvers`, API/WS versions, TLS, the
relative API path, and fixed capability hints. It contains no installation ID, Room,
participant, account, credential, or mutable game data. `/api/v1/server-info` supplies
the stable installation UUID for deduplication, the sanitized display name, effective
capabilities, current advertising state, and credential-free relative endpoints.

The infrastructure advertiser filters against the actual HTTP listener and approved
interfaces/addresses, reconciles network changes, withdraws on sustained unready state,
uses bounded failure retry, and sends goodbye records before server shutdown. Local mode
enables it by default; every public deployment requires explicit opt-in and a warning.

Local Room discovery advertises the HTTP origins for eligible physical interfaces
covered by the configured bind. Virtual adapters and link-local IPv6 addresses are
excluded from the browser list; each interface contributes at most one IPv6 origin,
preferring global over unique-local. The browser uses its current origin for the QR
payload unless an administrator explicitly configured `PUBLIC_URL`; the displayed list
includes that payload origin, the current browser origin, and the selected interface
origins without duplicates. Public deployments require `PUBLIC_URL`, use it for both
the QR payload and the single displayed address, and never trust the browser origin for
either decision. IPv6 origins are bracketed. CSP uses the exact request-visible
WebSocket origin for domain/IPv4 hosts and the matching WebSocket scheme for IPv6
literals, whose host form CSP cannot encode. Public CSP derives the equivalent decision
only from `PUBLIC_URL`; server-side public Origin enforcement remains exact.
Because a plain-HTTP LAN IP is not a secure browser context, the web client cannot rely
on `crypto.randomUUID()`. Its shared UUIDv4 generator uses `crypto.getRandomValues()` as
the secure-context-independent primitive for realtime request IDs, Room-create
idempotency keys, and browser-local editor identities.

The stable `serverId` lives in singleton installation metadata and is not derived from
network or display values. Identity reset is an offline operator operation that refuses
while live Rooms/replay credentials remain unless explicit runtime invalidation is
requested.

---

# 78. Security Boundaries

Recognized boundaries:

```text id="1q9ny7"
Public internet
Local LAN
Authenticated DataSpace
Active Room
```

Local LAN is trusted less than localhost.

---

# 79. Public HTTPS

Enforced public deployment requires:

- HTTPS;
- WSS;
- secure account cookies;
- proxy configuration.

An administrator may explicitly select the public development policy to test over HTTP;
the runtime announces that unsafe state in its structured startup log.

---

# 80. WebSocket Authentication

Connection flow:

1. open socket;
2. accept only handshake;
3. receive `client.hello`;
4. validate credentials;
5. bind Principal/Room identity;
6. commit participant activation and centralized Host selection;
7. return the authoritative role in `server.hello`;
8. send any role-change event, then a fresh snapshot/presence, or close.

Credentials must not be leaked through reusable query URLs.

---

# 81. Input Validation

Every external input must be validated:

- HTTP;
- WebSocket;
- config;
- catalog import;
- translation import;
- data import.

---

# 82. Rate Limiting

Enforced public deployment rate-limits:

- login;
- registration;
- reset;
- Room-code guessing;
- device pairing;
- imports;
- abusive realtime commands.

The explicit public development security policy disables these abuse controls so an
administrator can run high-volume/manual test workflows on a trusted network.

---

# 83. Logging Privacy

Logs must not contain:

- passwords;
- auth tokens;
- participant tokens;
- reset tokens;
- private boundaries;
- individual Never-Have-I-Ever answers, including named-reveal result values.

Localized Card text should normally not be logged at informational level because Card IDs are sufficient for diagnostics.

---

# 84. Observability

Endpoints:

```text id="x2q9hc"
/healthz
/readyz
/api/v1/server-info
```

`server-info` may include:

- server version;
- deployment mode;
- protocol versions;
- enabled locales;
- source locale;
- catalog version.

---

# 85. Testing Strategy

Testing layers:

- domain unit tests;
- simulation tests;
- persistence contract tests;
- migration tests;
- catalog tests;
- localization tests;
- protocol tests, including Never-Have-I-Ever privacy projections;
- WebSocket integration tests;
- Playwright E2E;
- native client fixture tests.

---

# 86. Localization Tests

Required runtime invariants include:

- the same producer Card UUID resolves across every locale;
- applying another locale never creates a second logical Card;
- a missing/soft-disabled localization excludes the Card by default;
- changing UI locale does not alter history;
- changing Card locale does not reset history;
- taxonomy logic uses stable codes rather than localized labels;
- a retired/soft-disabled Card remains resolvable from history;
- a newer FULL snapshot can update wording without changing the producer Card UUID.

Producer-side draft/review/staleness workflow is outside the game runtime and is tested
by the catalog producer rather than by runtime persistence.

---

# 87. Catalog Reconciliation Tests

Runtime reconciliation tests include:

```text
existing producer Card UUID with updated metadata/text
→ same UUID updated
```

```text
stored producer Card UUID absent from newer FULL snapshot
→ soft-disabled / retired
```

```text
new producer Card UUID in newer FULL snapshot
→ new logical Card
```

```text
previously soft-disabled producer Card UUID reappears
→ same existing UUID reactivated
```

The game never derives identity from source IDs or text similarity.

---

# 88. Translation Coverage Tests

Catalog build should be able to assert required thresholds.

Example:

```text id="zomx7x"
de-DE:
100% active Card coverage required

en-GB:
release threshold configured separately
```

A locale may remain enabled for development with partial coverage but public release rules may define minimum coverage.

---

# 89. Simulation Tests

Large deterministic simulations verify:

- no forbidden DareTypes;
- correct Question Category filtering;
- locale eligibility;
- history;
- repeat rules;
- GameProfile behavior;
- Random-mode balancing;
- meta-card scheduling;
- both Never-Have-I-Ever reveal modes;
- no pre-reveal leakage of individual vote values;
- correct per-player `PENDING` / `VOTED` progress.

---

# 90. Persistence Contract Tests

Same repository behavior runs against:

- SQLite;
- MariaDB.

Localization repositories are included in this parity testing.

---

# 91. Migration Tests

CI tests:

```text id="u9szhc"
empty DB
→ all schema migrations
→ catalog load
```

and important upgrade paths from previous release versions.

Both database engines are covered.

---

# 92. Protocol Compatibility

Native clients may update more slowly than the server.

The server should support:

- current protocol major;
- previous compatible major where practical.

Localization additions must not require a protocol major change unless wire format changes.

Adding a new locale is normally data-only.

---

# 93. Dependency Management

Dependencies should remain focused.

The server should avoid large dependency trees for functionality available in:

- Node standard library;
- existing infrastructure.

Lockfiles are mandatory.

---

# 94. Build Outputs

CI should produce:

- one coupled server-web build;
- platform-specific portable and public server-web archives;
- protocol schemas;
- catalog bundle;
- translation/language bundles where configured;
- SBOM.

---

# 95. Release Versioning

At minimum, track independently:

```text id="rbx83w"
server_web_application_version
database_schema_version
catalog_version
protocol_version
```

`server_web_application_version` applies to both the server and browser client. Kodi,
Android TV, and any other native clients have independent application versions and
release bundles. Native client versions must never replace or alias the server-web
version; compatibility is negotiated through `protocol_version`.

Locale packs may additionally expose:

```text id="1lov4g"
locale_pack_version
```

---

# 96. Upgrade Sequence

Typical local upgrade:

1. backup user database;
2. apply schema migrations;
3. reconcile/apply catalog update;
4. apply localization updates;
5. validate catalog;
6. start application.

Failure stops startup with actionable diagnostics.

---

# 97. No Full Event Sourcing

The system uses relational state plus versioned Session snapshots.

Full event sourcing is intentionally excluded.

---

# 98. No Microservices

All server modules live in one application process initially.

This supports:

- portability;
- local deployment;
- atomic state changes.

---

# 99. No Client-Side Card Database Requirement

Clients do not require the complete Card catalog.

The server resolves:

- eligibility;
- localization;
- Card text.

This keeps native clients lightweight and avoids catalog-version divergence.

---

# 100. No Runtime CDN Requirement

All required assets are packaged or served by the local/public host.

This is mandatory for offline operation.

---

# 101. Existing Node Blueprint Reuse

Retain/refactor:

- Express bootstrap;
- Node/TypeScript foundation;
- configuration hierarchy;
- TypeORM migrations;
- account sessions;
- password/OIDC infrastructure;
- mail;
- centralized errors;
- health checks;
- Vitest;
- Playwright.

Do not retain as architectural constraints:

- Pug;
- Bootstrap/jQuery page architecture;
- Surveyor-specific entity inheritance;
- generic `Profile` ownership terminology;
- controller-owned business logic;
- MariaDB-only assumptions.

---

# 102. Naming Rules

Reserved meanings:

```text id="is0xwp"
DataSpace
= persistent ownership boundary

GameProfile
= gameplay preset

Card
= language-independent logical content

CardLocalization
= localized Card rendering

Locale
= supported content language/locale
```

These meanings must remain consistent across:

- database;
- TypeScript;
- APIs;
- documentation.

---

# 103. Application Service Rule

Transport controllers remain thin.

They:

1. validate transport payload;
2. establish Principal;
3. invoke application service/command;
4. serialize result.

Business logic belongs in:

- application;
- game-core;
- catalog/localization domain services.

---

# 104. Architecture Acceptance Criteria

The architecture is being followed when:

- one server codebase supports local and public deployment;
- portable play requires no internet installation;
- Cards have stable language-independent IDs;
- adding a locale does not add logical Cards;
- editing Card text does not reset history;
- source removal retires rather than deletes Cards;
- localized text lives outside the logical Card record;
- QuestionCategory/DareType labels use localization tables;
- game logic never branches on translated labels;
- card selection requires locale-compatible published localization;
- Group history is independent from Card language;
- same-lineage catalog releases preserve Group history, while a catalog-lineage replacement
  advances each existing Group's history-reset epoch without deleting appearances;
- producer-approved localization presence/absence is reconciled without changing Card identity;
- FULL catalog snapshots preserve producer-owned stable UUIDs while soft-disabling removed runtime content;
- locales can be added through catalog releases without schema redesign;
- web/Kodi/TV clients all use the same protocol;
- server and web always share one server-web release version and artifact;
- Kodi, Android TV, and other native clients use independent release units and versions;
- database behavior is tested on SQLite and MariaDB;
- catalog and schema versions are independently tracked;
- no runtime CDN is required for local play;
- `neverHaveIEverRevealMode` is authoritative Session configuration and defaults to `ANONYMOUS_AGGREGATE`;
- reveal mode is immutable during an active Session;
- all clients receive per-player `PENDING`/`VOTED` progress during Never-Have-I-Ever collection;
- no client receives another player's answer value before the result state;
- `NAMED_ANSWERS` exposes per-player answers only after all required votes are present;
- individual Never-Have-I-Ever answers are not copied into long-term history, analytics, or logs.

---

# 105. Final Architectural Model

```text id="2d9ykz"
                        CLIENTS
          Web / Kodi / Android-family TV
                          │
                    HTTP / WebSocket
                          │
                  Transport Layer
                          │
                 Application Layer
                          │
        ┌─────────────────┼──────────────────┐
        │                 │                  │
    Game Domain       Catalog Domain     Localization
        │                 │                  │
        └─────────────────┼──────────────────┘
                          │
                 Repository Contracts
                          │
                       TypeORM
                    /            \
                 SQLite         MariaDB
                  local          public
```

Content identity is modeled separately from language:

```text id="bsr6xs"
                  LOGICAL CARD
                      │
            Stable Card UUID
                      │
        ┌─────────────┼─────────────┐
        │             │             │
      de-DE         en-GB         fr-FR
 localization   localization   localization
```

History always references:

```text id="0d0g0b"
Card UUID
```

never localized wording.

The resulting architecture allows the game to evolve:

- Cards;
- languages;
- wording;
- source imports;
- clients;
- deployments

without invalidating the durable concepts that must remain stable over the lifetime of the product.

## Scoped Card-policy compilation

`game-core/policies` owns directive types, predicate matching, and deterministic
resolution. Application services load sparse DataSpace/Group scopes and
compile a pending Session. TypeORM adapters store validated directive/predicate JSON in
portable relational owner-scoped rows; core behavior does not depend on database JSON
queries. HTTP adapters validate management and setup inputs with Zod.

The read-only pending-game eligibility preview loads the same localized Cards, compiles
the same hierarchy, and runs the same core eligibility function at both starting and
maximum intensity. It includes shared Group history and authoritative proposed roster
size but intentionally has no private-boundary input. This keeps the count useful without
turning private participant choices into shared setup data.

Lobby clients use the same preview through their Room participant credential. The
application resolves the saved Room settings, connected represented-player count,
DataSpace/Group owner, and shared history server-side; it does not trust a Group UUID or
roster count supplied by a guest and does not mutate WebSocket presence.

The compiled GameSession runtime is version 5. It contains immutable catalog provenance,
maximum policy revisions, and compact positional effective values for every Card. The
engine builds an O(1) Card-ID map in memory rather than repeating JSON property and
provenance names per Card. Draw-time selection applies that map before the existing
eligibility/history/weight pipeline; it does not reevaluate Conditional Rules. Roster
count remains dynamic and is compared with each compiled atomic range at the next draw.

Persistence freezes two potentially catalog-sized inputs independently: the compiled
policy and the Group history visible when the Session starts. They are compressed,
content-addressed, and written as bounded immutable chunks; the active Session row keeps
only foreign-key digests. The Group-history payload is an exact bitset indexed by the
compiled snapshot, so even a 50,000-Card catalog needs only 6,250 raw bit bytes per
Session. Separate digests let common compiled policies deduplicate even when Groups have
different histories. A restart rehydrates the exact inputs rather than
recompiling against possibly changed catalog or policy rows. Compilation reads the
DataSpace scope and, when selected, that one Group scope only; rules from unrelated
Groups never enter the Session payload. Normalized appearance rows provide mutable
current-Session history and only the newest or changed appearance is written per commit.

Persistent scope rows use a server-derived owner key plus DataSpace and optional Group
foreign keys. DataSpace/Group deletion cascades policy rows, while Card deletion remains
restricted and producer Cards continue to be soft-retired. Every Group request proves
membership in the selected DataSpace. Local no-auth mode resolves the one local
DataSpace; public mode resolves the authenticated session's selected DataSpace.

### Management-query and browser boundary

The Card-management browser never loads the catalog as one client-side collection.
`GET /api/v1/card-policy/cards` and the pending-Session equivalent accept validated
facets, a bounded limit of at most 50, and an opaque stable-UUID cursor. The web client
uses 24-Card pages, retains only the pages visited during the current search, resets its
cursor stack when filters change, and opens one detail editor at a time. Rule preview is
also server-side: it counts the complete result and returns only a bounded sample for
human verification.

Rules and account-owned Group/DataSpace summaries are smaller ownership resources and
may arrive as complete API snapshots, but their presentation remains search-filtered
and paged so the DOM is bounded. The current web limits are ten rules, eight DataSpaces
or policy-scope Groups, twelve setup Groups, and sixteen account-management Groups per
rendered page. This distinction is intentional: catalog scale is bounded at transport
and rendering, while ownership-list scale is bounded at rendering without creating a
second partial account model.

The client holds only draft form state and optimistic revisions. It does not resolve
policy, trust its own match count for bulk writes, or infer producer metadata from Card
text. Creating a rule produces a disabled draft; changing its predicate invalidates the
optional informational preview but does not block saving. The application service
remains authoritative for validation, preview, bulk reconfirmation, imports, precedence,
and transactional persistence in both deployment modes.
