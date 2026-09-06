# External interface contracts

These documents describe the boundaries that clients, content pipelines, and deployment
infrastructure may rely on. Source schemas remain authoritative; the documents explain
semantics, lifecycle, security, and failure behavior that types alone cannot express.

| Contract                               | Implementation authority                                        | Document                                        |
| -------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------- |
| HTTP API v1                            | `apps/server/src/routes/api.ts`, `apps/server/src/routes/api/*` | [HTTP API](http-api.md)                         |
| WebSocket protocol v4                  | `packages/protocol`, `apps/server/src/modules/websocket.ts`     | [WebSocket v4](websocket-v4.md)                 |
| WebSocket protocol v3 (retired)        | Historical enrollment and interim capacity contract             | [WebSocket v3](websocket-v3.md)                 |
| WebSocket protocol v2 (retired)        | Historical contract                                             | [WebSocket v2](websocket-v2.md)                 |
| WebSocket protocol v1 (retired)        | Historical contract                                             | [WebSocket v1](websocket-v1.md)                 |
| Bundled Card catalog v2                | `card-catalog-contract`, catalog reconciler                     | [Card catalog v2](card-catalog-v2.md)           |
| Bundled Card catalog v1 (historical)   | Immutable producer contract                                     | [Card catalog v1](card-catalog-v1.md)           |
| Database, SMTP, OIDC, proxy and health | `apps/server/src/modules/*`                                     | [Infrastructure](infrastructure.md)             |
| Release bundles                        | `tooling/release/package.ts`, release workflow                  | [Release bundles](release-bundles.md)           |
| Operational settings                   | `apps/server/src/modules/settings.ts`, `operationalSettings.ts` | [Operational settings](operational-settings.md) |

## Compatibility policy

- `/api/v1` and WebSocket `protocol: 4` are versioned interfaces. Protocol v1 was retired
  when Room settings ownership changed; v2 was retired for mandatory late-join enrollment.
  Version 3 was retired to guarantee the shared native receive capacity.
- Additive response fields are allowed. Consumers must ignore unknown response fields.
- Removing/renaming a field, changing its meaning, or adding a required WebSocket field
  requires a new contract version.
- Error `code` is machine-readable. Localized `message` is for people and must not drive
  client logic.
- HTTP clients should send `Accept-Language`; initial web setup may match it, but Card
  language and ordered Card fallback remain explicit game settings.
- Credentials and participant tokens are bearer secrets and must never appear in URLs,
  QR codes, logs, analytics, or public snapshots.
