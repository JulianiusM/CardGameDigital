# External interface contracts

These documents describe the boundaries that clients, content pipelines, and deployment
infrastructure may rely on. Source schemas remain authoritative; the documents explain
semantics, lifecycle, security, and failure behavior that types alone cannot express.

| Contract                               | Implementation authority                            | Document                              |
| -------------------------------------- | --------------------------------------------------- | ------------------------------------- |
| HTTP API v1                            | `src/routes/api.ts`, `src/routes/api/*`             | [HTTP API](http-api.md)               |
| WebSocket protocol v2                  | `src/packages/protocol`, `src/modules/websocket.ts` | [WebSocket v2](websocket-v2.md)       |
| WebSocket protocol v1 (retired)        | Historical contract                                 | [WebSocket v1](websocket-v1.md)       |
| Bundled Card catalog                   | `card-catalog-contract`, catalog reconciler         | [Card catalog v1](card-catalog-v1.md) |
| Database, SMTP, OIDC, proxy and health | `src/modules/*`                                     | [Infrastructure](infrastructure.md)   |

## Compatibility policy

- `/api/v1` and WebSocket `protocol: 2` are versioned interfaces. Protocol v1 is no
  longer negotiated because Room settings ownership changed incompatibly.
- Additive response fields are allowed. Consumers must ignore unknown response fields.
- Removing/renaming a field, changing its meaning, or adding a required WebSocket field
  requires a new contract version.
- Error `code` is machine-readable. Localized `message` is for people and must not drive
  client logic.
- HTTP clients should send `Accept-Language`; card language is a separate game setting.
- Credentials and participant tokens are bearer secrets and must never appear in URLs,
  QR codes, logs, analytics, or public snapshots.
