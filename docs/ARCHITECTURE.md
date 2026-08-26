# Architecture overview

This is a modular monolith with a server-authoritative game engine. The browser is a
presentation and input adapter: it never decides card eligibility, turn order, votes,
roles, or persistence commits.

## Runtime shape

```text
Svelte clients
  ├─ HTTP /api/v1 ───────────────┐
  └─ WebSocket /ws (protocol 2) ─┤
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

A producer-owned Card UUID identifies language-independent gameplay metadata.
`CardLocalization` stores only release-approved BCP 47 localized runtime text and active
state. Catalog locales and localized taxonomy labels are database content and do not
come from UI i18n resources.

The exact bundled `game-card-catalog/v2` FULL snapshot is validated and hashed at build
and startup, then reconciled transactionally before readiness. Missing Cards, locales,
or localizations are soft-disabled. Gameplay requests an active database locale and
excludes missing localizations unless deployment explicitly enables fallback.

`game-core` owns an independent, hard-coded numeric intensity offset for every Question
Category and DareType. It combines that offset with each Card's relative 1–5 position;
fractional values fine-tune how much related ranges overlap without changing the catalog
contract. The shared Session engine applies configurable start/end intensity and round-
or Card-based pacing with a fine-grained score increment; adapters only persist or
project that decision.

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
HTTP API v1, WebSocket protocol v2, bundled catalog, and infrastructure integrations.
The TAD and implementation ADRs explain the decisions behind these contracts.
