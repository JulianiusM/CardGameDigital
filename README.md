# Multiplayer Party Card Game

A server-authoritative party card game for one shared screen, personal devices, or
personal devices plus a public Party Screen. The same game engine powers every play
topology, while accounts and persistence remain optional for quick rounds.

## Product capabilities

- **Couch mode:** all players, cards, and controls on one device.
- **Personal mode:** participants play from their own devices; a device may control
  multiple local players.
- **Party Screen:** personal controls plus a read-only shared display.
- **Realtime Rooms:** one host, explicit host transfer, reconnect grace period, and
  automatic fallback host selection.
- **Private boundaries:** participant restrictions affect eligibility without being
  disclosed to the room.
- **Optional accounts:** anonymous ephemeral rounds or account-owned DataSpaces,
  groups, preferences, sessions, and exports.
- **Localized catalog:** stable card UUIDs, locale-specific renderings, translation
  lifecycle, source reconciliation, and soft retirement.

The detailed product definition is in the
[Game Design Document](./Multiplayer%20Party%20Card%20Game%20%E2%80%94%20Game%20Design%20Document%281%29.md).
Architecture decisions are grounded in the
[Technical Architecture Document](./Multiplayer%20Party%20Card%20Game%20%E2%80%94%20Technical%20Architecture%20Document.md).

## Technology

- Node.js 24 and TypeScript
- Express 5 HTTP API and `ws` WebSocket transport
- Svelte 5 and Vite browser client
- TypeORM with SQLite for local deployments and MariaDB/MySQL for public deployments
- Vitest for unit, integration, simulation, and architecture tests
- Playwright for browser workflows

## Quick start

### Requirements

- Node.js 24.x
- npm 10 or newer
- A C/C++ build toolchain only when a prebuilt native package is unavailable

### Local single-machine/LAN deployment

```bash
npm ci
npm run build
npm run run
```

Open <http://localhost:3000/play/>. Defaults use SQLite at
`./data/card-game.sqlite`, bind to `127.0.0.1`, and disable accounts. To make a local
instance reachable on the LAN, configure `HTTP_BIND=0.0.0.0`; do not expose that
account-free configuration to the public internet.

For development with server reloads:

```bash
npm ci
npm run server:dev
```

The browser bundle must be rebuilt after frontend changes with `npm run build:web`.

## Configuration

Settings are read from environment variables and optionally from the CSV file named
by `SETTINGS_FILE`. CSV rows use `KEY,value` syntax. Environment variables override
the file.

Common settings:

| Variable                                                  | Default                   | Purpose                                                            |
| --------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| `DEPLOYMENT_MODE`                                         | `local`                   | `local` uses SQLite; `public` requires MariaDB/MySQL and accounts. |
| `AUTH_MODE`                                               | `none`                    | `none` or `account`; public mode requires `account`.               |
| `HTTP_BIND` / `HTTP_PORT`                                 | `127.0.0.1` / `3000`      | Listen address and port.                                           |
| `PUBLIC_URL`                                              | `http://localhost:3000`   | Canonical origin for links and origin checks.                      |
| `DB_TYPE`                                                 | `sqlite`                  | `sqlite`, `mariadb`, or `mysql`.                                   |
| `DB_FILE`                                                 | `./data/card-game.sqlite` | SQLite database path.                                              |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | varies                    | Public database connection.                                        |
| `SESSION_SECRET`                                          | generated locally         | Set a stable secret of at least 16 characters in deployments.      |
| `CARD_MISSING_TRANSLATION`                                | `EXCLUDE`                 | `EXCLUDE` or explicit cross-language `FALLBACK`.                   |
| `CARD_FALLBACK_LOCALE`                                    | `de-DE`                   | Card locale used only when fallback is enabled.                    |
| `SMTP_*`                                                  | empty                     | Account activation, reset, and deletion mail transport.            |
| `OIDC_*`                                                  | disabled                  | Optional OpenID Connect provider settings.                         |
| `TRUST_PROXY`                                             | `false`                   | Express proxy trust; configure to match the actual reverse proxy.  |

All settings and validation rules are defined in
[`src/modules/settings.ts`](./src/modules/settings.ts).

## Database and cards

Migrations run automatically during server startup. To run them explicitly:

```bash
npm run typeorm:migrate
```

Import a JSON export from a stable source namespace:

```bash
npm run card:import -- \
  raw-cards.json catalog/cards-2026.08.json 2026.08 legacy-access-v1 de-DE
```

This produces a validated interchange catalog. Applying that catalog is an
application-layer operation: source identity is reconciled to a permanent random UUID,
source-language text is upserted as a rendering, outdated adaptations become stale,
and missing source rows are retired rather than deleted. See the
[card importer contract](./docs/contracts/card-catalog-import.md).

## Testing and quality checks

```bash
npm test                 # unit, integration, simulation, and architecture tests
npm run test:unit
npm run test:integration
npm run build
npm run format:check
npm run e2e              # requires Playwright browsers
```

Release layouts can be built and verified with:

```bash
npm run package:portable
npm run package:public
npm run package:smoke -- artifacts/<package-directory>
```

## Repository map

```text
apps/web/                    Svelte browser application and browser localization
src/packages/game-core/      Framework-independent game domain
src/packages/application/    Use cases and repository ports
src/packages/persistence/    TypeORM adapters
src/packages/protocol/       Versioned realtime wire schemas
src/packages/localization/   Server message keys and locale catalogs
src/modules/                 Express, database, email, OIDC, WebSocket adapters
src/routes/api/              HTTP API adapters
docs/contracts/              External interface contracts
docs/user-guide/             In-app player help by locale
tests/                       Unit, integration, simulation, E2E, architecture tests
```

## Interface documentation

- [External contract index](./docs/contracts/README.md)
- [HTTP API v1](./docs/contracts/http-api.md)
- [WebSocket protocol v1](./docs/contracts/websocket-v1.md)
- [Card catalog importer](./docs/contracts/card-catalog-import.md)
- [Infrastructure integrations](./docs/contracts/infrastructure.md)

## Contributing

Read [`AGENTS.md`](./AGENTS.md), the
[code-style rules](./docs/implementation/code-style.md), and the applicable ADR before
changing an architectural boundary. Keep domain rules independent from Express,
TypeORM, WebSocket, and Svelte. Update contracts and tests in the same commit whenever
an external interface changes.

## License

Licensed under the Apache License 2.0. See [`LICENSE.md`](./LICENSE.md).
