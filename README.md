# Multiplayer Party Card Game

A server-authoritative party card game for one shared screen, personal devices, or
personal devices plus a public Party Screen. The same game engine powers every play
topology, while accounts and persistence remain optional for quick rounds.

## Product capabilities

- **Couch mode:** all players, cards, and controls on one device.
- **Personal mode:** participants play from their own devices; a device may control
  multiple local players.
- **Party Screen:** the setup screen opens a read-only Room; the first connected player
  phone becomes Host and receives the controls.
- **Native Kodi client:** a Kodi 21/Omega TV add-on supports Couch Play, complete Room
  setup, TV-first hosting, read-only display joining, recovery, and remote-only input.
- **LAN discovery:** local installations advertise a privacy-minimal DNS-SD service for
  compatible native discovery clients.
- **Realtime Rooms:** one host, explicit host transfer, reconnect grace period, and
  automatic fallback host selection.
- **Private boundaries:** participant restrictions affect eligibility without being
  disclosed to the room.
- **Optional accounts:** anonymous ephemeral rounds or account-owned DataSpaces,
  groups, preferences, sessions, and exports.
- **Scoped Card management:** inherited defaults, structured metadata rules, exact Card
  exceptions, and per-game overrides for a DataSpace, Group, or the next game. Search
  and preview remain bounded with a production-scale catalog.
- **Transparent setup:** the main menu names the active DataSpace, social sensitivity is
  an explicit game setting, and server-calculated eligible Card counts appear before
  play without disclosing private boundaries.
- **Bundled global catalog:** producer-owned Card UUIDs, database Card locales,
  release-approved localizations, immutable releases, and non-destructive FULL apply.

The detailed product definition is in the
[Game Design Document](./docs/GAME_DESIGN.md).
Architecture decisions are grounded in the
[Technical Architecture Document](./docs/TECHNICAL_ARCHITECTURE.md).
The look and feel is defined by
[Visual & Interaction Design Document](./docs/VISUAL_INTERACTION_DESIGN.md).

## Technology

- Node.js 24 and TypeScript
- Express 5 HTTP API and `ws` WebSocket transport
- Svelte 5 and Vite browser client
- Python 3 and WindowXML native Kodi client
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
`./data/card-game.sqlite`, bind to all IPv4 and IPv6 interfaces, and disable accounts.
The Room screen lists eligible physical LAN interfaces. It omits virtual and link-local
IPv6 routes and keeps at most one useful IPv6 URL per interface. Party Screens fit as
many URLs as possible on each carousel page. Do not expose that account-free
configuration to the public internet.

Choosing **TV + phones** in the setup wizard opens that browser directly as the Party
Screen. It shows the Room code and waits without creating a hidden Host. Join from a
phone; the first successfully connected player becomes Host. The main-menu **Display
only** action remains the way to attach another read-only screen to an existing code.

For development with server reloads:

```bash
npm ci
npm run server:dev
```

The browser bundle must be rebuilt after frontend changes with `npm run build:web`.

In public mode, opening the game does not require an account: Quick Round remains
available for Couch, Personal-device, and Party Screen play and writes no account-owned
history. Signing in unlocks the same setup flow plus DataSpaces, saved groups/defaults,
durable sessions, history, export, and multi-device login management.

Card management is available from the main menu in a local none-auth installation and
from the signed-in Account screen in a public installation. Leaving every decision at
**Inherit** preserves the catalog and profile defaults, so a normal quick game requires
no policy configuration.

## Configuration

Settings are read from environment variables and optionally from the CSV file named
by `SETTINGS_FILE`. CSV rows use `KEY,value` syntax. Environment variables override
the file.

Common settings:

| Variable                                                                  | Default                   | Purpose                                                                           |
| ------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| `DEPLOYMENT_MODE`                                                         | `local`                   | `local` or `public` product/runtime behavior.                                     |
| `PUBLIC_RUNTIME_SECURITY`                                                 | `enforced`                | `enforced`, or explicit unsafe `development` override for administrator testing.  |
| `AUTH_MODE`                                                               | `none`                    | `none` or `account`; enforced public mode requires `account`.                     |
| `HTTP_BIND` / `HTTP_PORT`                                                 | `::` / `3000`             | Dual-stack all-interface listen address and port.                                 |
| `ROOM_MAX_PARTICIPANTS` / `ROOM_MAX_PLAYERS`                              | `100` / `100`             | Active device and represented-player limits per Room (2–1000).                    |
| `ROOM_RECONNECT_GRACE_SECONDS`                                            | `180`                     | Time a disconnected device can reclaim its place (minimum 120 seconds).           |
| `ROOM_DISPLAY_BOOTSTRAP_ENABLED`                                          | local: `true`             | Permit TV-first Room creation; defaults off in public mode.                       |
| `ROOM_INITIAL_ACTIVATION_SECONDS` / `UNACTIVATED_PARTICIPANT_TTL_SECONDS` | `300` / `300`             | Pending Room and never-connected participant lifetimes.                           |
| `ROOM_CREATE_SECRET` / `ROOM_CREATE_SECRET_FILE`                          | local key file            | Stable secret source for encrypted idempotent create replay.                      |
| `SERVER_DISPLAY_NAME`                                                     | `Party Game`              | Human-readable server name; no machine/user name is inferred.                     |
| `MDNS_DISCOVERY_ENABLED`                                                  | local: `true`             | Advertise `_partycard._tcp` on eligible LAN interfaces; defaults off publicly.    |
| `MDNS_INTERFACE_ALLOWLIST` / `MDNS_INTERFACE_DENYLIST`                    | empty                     | Exact comma-separated interface policy; deny wins.                                |
| `MDNS_ADVERTISED_PORT` / `MDNS_ADVERTISED_TLS`                            | HTTP port / `false`       | Reachable front-door port and its actual TLS requirement.                         |
| `PUBLIC_URL`                                                              | browser origin locally    | Optional local QR/link override; required canonical public origin.                |
| `DB_TYPE`                                                                 | `sqlite`                  | `sqlite`, `mariadb`, or `mysql`.                                                  |
| `DB_FILE`                                                                 | `./data/card-game.sqlite` | SQLite database path.                                                             |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`                 | varies                    | Public database connection.                                                       |
| `SESSION_SECRET`                                                          | generated locally         | Enforced public mode requires an explicit stable value of at least 32 characters. |
| `CARD_MISSING_TRANSLATION`                                                | `EXCLUDE`                 | `EXCLUDE` or explicit cross-language `FALLBACK`.                                  |
| `CARD_FALLBACK_LOCALE`                                                    | `de-DE`                   | Card locale used only when fallback is enabled.                                   |
| `SMTP_*`                                                                  | empty                     | Account activation, reset, and deletion mail transport.                           |
| `OIDC_*`                                                                  | disabled                  | Optional OpenID Connect provider settings.                                        |
| `TRUST_PROXY`                                                             | `false`                   | Enforced public mode requires the reverse proxy's positive hop count.             |
| `LOG_LEVEL`                                                               | `info`                    | Structured server log threshold, or `silent`.                                     |
| `LOG_ERROR_DETAILS`                                                       | `standard`                | `diagnostic` adds cause stacks and database/driver codes.                         |
| `IMPRINT_URL` / `PRIVACY_POLICY_URL`                                      | empty                     | Public HTTP(S) legal links shown in the SPA menu and settings.                    |

All settings and validation rules are defined in
[`apps/server/src/modules/settings.ts`](./apps/server/src/modules/settings.ts).

When `PUBLIC_URL` is omitted in local mode, each browser puts its own current origin in
the Room QR code. Setting it explicitly overrides that payload. Public mode always
requires and uses `PUBLIC_URL`; it never derives Room links from the browser address.

Local DNS-SD discovery publishes only protocol/capability hints and reachable interface
addresses. It does not publish `serverId`, Room data, credentials, names, or Card text,
and it provides convenience rather than trust. Public mDNS requires an explicit opt-in
and logs a warning. Full interface, TLS, and endpoint rules are in the
[infrastructure contract](./docs/contracts/infrastructure.md).

The installation UUID normally never changes. For an intentional offline reset, first
stop the game server and run `npm run installation:reset`. The command refuses if live
Rooms or credential-bearing replay results remain. Use
`npm run installation:reset -- --invalidate-runtime` only when deliberately revoking
them all.

For administrator-controlled development of public behavior, set
`PUBLIC_RUNTIME_SECURITY=development`. This intentionally permits HTTP, SQLite,
`AUTH_MODE=none`, the development Card fixture, generated session secrets, incomplete
SMTP, and no trusted proxy; it also disables public origin checks, HSTS, and public
HTTP/WebSocket abuse rate limits. `AUTH_MODE=account` can still be selected to exercise the complete
account and persistence UI (use a local SMTP catcher for email flows). The server emits
a warning event at every startup in this mode. Do not expose it to an untrusted network
or use it as a production configuration. Complete OIDC configuration and canonical
callback validation still apply when OIDC is enabled.

## Database and cards

Migrations run automatically during server startup. To run them explicitly:

```bash
npm run typeorm:migrate
```

Validate the producer-approved release artifact without rewriting it:

```bash
npm run card:catalog:validate -- catalog/card-catalog.json
```

Builds package the exact validated bytes. Startup validates them again and applies a
newer immutable FULL snapshot transactionally before readiness. Producer UUIDs are
stored unchanged; missing Cards, locales, and localizations are soft-disabled. See the
[bundled Card catalog contract](./docs/contracts/card-catalog-v2.md).

The checked-in four-Card catalog is a development fixture. Enforced public startup and
public release packaging deliberately refuse it; replace it with the producer-approved
production artifact before deployment.

## Testing and quality checks

```bash
npm test                 # unit, integration, simulation, and architecture tests
npm run test:unit
npm run test:integration
npm run test:mariadb:public # clean MariaDB public/auth/persistence integration flow
npm run build
npm run format:check
npm run e2e              # requires Playwright browsers
npm run e2e:visual       # strict multi-viewport visual and geometry audit
npm run kodi:check       # generated drift, static/XML/privacy checks, Python tests
npm run kodi:package     # reproducible install ZIP, checksum, SBOM, provenance
```

MariaDB test credentials can live in the ignored `tests/.env.test.local` and `.env.e2e`
profiles. `npm run test:mariadb:reset` clears only database names containing `test` or
`e2e`; the configured database user must be able to create and drop objects in those
schemas. The public MariaDB suite clears its exact disposable schema before use.
Set `E2E_DB_USE_TEST_PROFILE=1` in `.env.e2e` when one permission-scoped local MariaDB
account/schema should serve both integration and Playwright runs. Playwright copies the
ignored `TEST_DB_*` values into its server process without printing or duplicating secrets.

Release layouts can be built and verified with:

```bash
npm run package:server-web:portable
npm run package:server-web:public
npm run package:server-web:smoke -- artifacts/<package-directory>
```

Server and browser code form one `server-web` release unit with one version. Both
portable and public archives embed Node and all production packages for their exact
OS/architecture; an operator does not install Node or npm. Public operation still needs
the configured database, TLS/proxy, secrets, authentication, and mail services. Manual
release CI produces Linux, Windows, and macOS archives for x64 and arm64.

The implemented Kodi client is an independent `kodi-client` release unit with its own
version, `kodi-client-v{version}` tag, deterministic add-on ZIP, checksum, SBOM, and
provenance. It is never added to the server-web archive. See the
[Kodi client guide](./docs/KODI_CLIENT.md) and
[release bundle contract](./docs/contracts/release-bundles.md). Android-family clients
remain separate future release units.

## Repository map

```text
apps/server/                    Express/WebSocket application and migrations
apps/web/                       Svelte browser application and browser localization
apps/kodi/                      Native Kodi add-on, generated artifacts, and tests
packages/game-core/             Framework-independent game domain
packages/application/           Use cases and repository ports
packages/persistence/           TypeORM entities, adapters, and domain mapping
packages/card-catalog-contract/  Card catalog schemas and semantic validation
packages/protocol/              Versioned wire schemas, DTOs, and client decoders
packages/localization/          Server catalogs, shared client terms, and Kodi source manifest
packages/design-tokens/         Shared Golden Mischief and Card presentation decisions
tooling/                        Database, design, Kodi, release, and test generators
docs/contracts/                 External interface contracts
docs/user-guide/                In-app player help by locale
tests/                          Unit, integration, simulation, E2E, architecture tests
```

## Interface documentation

- [External contract index](./docs/contracts/README.md)
- [HTTP API v1](./docs/contracts/http-api.md)
- [WebSocket protocol v2](./docs/contracts/websocket-v2.md)
- [Retired WebSocket protocol v1](./docs/contracts/websocket-v1.md)
- [Bundled Card catalog](./docs/contracts/card-catalog-v2.md)
- [Historical immutable Card catalog v1](./docs/contracts/card-catalog-v1.md)
- [Infrastructure integrations](./docs/contracts/infrastructure.md)
- [Release bundles](./docs/contracts/release-bundles.md)
- [Native Kodi client](./docs/KODI_CLIENT.md)

## Contributing

Read [`AGENTS.md`](./AGENTS.md), the
[code-style rules](./docs/implementation/code-style.md), and the applicable ADR before
changing an architectural boundary. Keep domain rules independent from Express,
TypeORM, WebSocket, and Svelte. Update contracts and tests in the same commit whenever
an external interface changes.

## License

Licensed under the Apache License 2.0. See [`LICENSE.md`](./LICENSE.md).
