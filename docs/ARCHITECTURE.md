# Architecture overview

This is a modular monolith with a server-authoritative game engine. The browser is a
presentation and input adapter: it never decides card eligibility, turn order, votes,
roles, or persistence commits.

## Runtime shape

```text
Svelte clients
  ├─ HTTP /api/v1 ───────────────┐
  └─ WebSocket /ws (protocol 1) ─┤
                                  ▼
Express / WebSocket adapters
                                  ▼
Application services and ports
  ├─ CouchSessionService
  ├─ RoomService
  ├─ account/help/catalog services
  └─ repository interfaces
                                  ▼
Game core                    Persistence adapters
  Card eligibility           TypeORM repositories
  GameSession state          SQLite or MariaDB/MySQL
  profiles/history
```

## Source boundaries

| Directory                   | Responsibility                                                                | Must not contain                      |
| --------------------------- | ----------------------------------------------------------------------------- | ------------------------------------- |
| `src/packages/game-core`    | Pure cards, eligibility, history, profiles, selection, session state machine. | Express, TypeORM, WebSocket, Svelte.  |
| `src/packages/application`  | Use cases, authorization decisions, application ports.                        | HTTP parsing, database query details. |
| `src/packages/persistence`  | TypeORM implementations and domain mapping.                                   | Browser behavior, transport policy.   |
| `src/packages/protocol`     | Strict versioned WebSocket schemas.                                           | Service execution or persistence.     |
| `src/packages/localization` | Stable keys, server catalogs, fallback.                                       | Domain identity or transport logic.   |
| `src/modules`, `src/routes` | Infrastructure and HTTP/WebSocket adapters.                                   | Duplicate game rules.                 |
| `apps/web`                  | Svelte screens, transport clients, adaptive presentation.                     | Authoritative game state.             |

Architecture tests in `tests/architecture` enforce important dependency and content
boundaries.

## Game state and concurrency

`GameSession` is the only turn-state machine. Couch and Room services feed it localized
eligible cards. Realtime commands are serialized per Room and use optimistic revisions.
The persistence adapter commits runtime state and card appearances transactionally;
clients receive a new viewer-specific snapshot only after commit.

A Room has one host. Explicit transfer updates persisted roles. Unexpected host loss
uses a reconnect grace timer and promotes an eligible player device, never a display.
Multiple Rooms remain isolated by Room ID, credential, command queue, and broadcasts.

## Card content model

A Card UUID identifies language-independent gameplay metadata. `CardSource` maps an
external namespace/ID to that UUID. `CardTranslation` stores BCP 47 localized text,
status, revision, source revision, and hash. Taxonomy codes are stable and have separate
translation tables.

Catalog application reconciles rather than replaces: edits retain UUIDs, source edits
stale older adaptations, and absent source rows set `active=false`. Gameplay requests an
exact locale and excludes missing/unpublished translations unless deployment explicitly
enables a fallback.

## Persistence and ownership

- SQLite is the single-process local deployment store and uses WAL plus foreign keys.
- MariaDB/MySQL is required for public deployment.
- DataSpace is the account ownership boundary for groups, preferences, and persisted
  Rooms/history.
- Ephemeral Rooms and Couch sessions do not require an account.
- Account sessions are distinct from game sessions and use HTTP-only cookies.

## Privacy and security

Participant credentials, account tokens, passwords, and private boundaries are never
broadcast. Participant credentials are hashed at rest and treated as bearer secrets.
Passwords use Argon2id. Activation/reset tokens are one-time hashed values. Public
state-changing HTTP and WebSocket connections enforce the configured origin. Role and
available actions come from authenticated server state, not client claims.

## Interfaces

External semantics are versioned and documented under [`docs/contracts`](contracts/):
HTTP API v1, WebSocket protocol v1, catalog import, and infrastructure integrations.
The TAD and implementation ADRs explain the decisions behind these contracts.