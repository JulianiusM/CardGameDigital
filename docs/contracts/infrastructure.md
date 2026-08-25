# Infrastructure integration contracts

## Database

- **Local deployment:** SQLite via `better-sqlite3`; `DB_TYPE=sqlite` and `DB_FILE`.
  Startup enables foreign keys and WAL. A local database must contain exactly one
  DataSpace.
- **Enforced public deployment:** MariaDB/MySQL; configure `DB_HOST`, `DB_PORT`,
  `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. Enforced public mode rejects SQLite.
- **Public development runtime:** the explicit `PUBLIC_RUNTIME_SECURITY=development`
  override also permits SQLite for administrator testing. Its DataSpaces follow public
  account ownership and do not use the local singleton-DataSpace invariant.
- TypeORM migrations run transactionally at startup. The database user needs schema
  migration privileges during startup.
- Store database files and backups outside release directories. Never share one SQLite
  file between multiple server processes.
- Local SQLite creates a version-named safe backup before each new schema/catalog target.
  Enforced public startup refuses the bundled development Card fixture.

Readiness is `GET /readyz`, which performs `SELECT 1`. Liveness is `GET /healthz`.
Orchestrators should remove an instance from service when readiness fails and restart
only when liveness fails.

## Reverse proxy and TLS

Enforced public traffic must terminate TLS and forward HTTP plus WebSocket upgrade
requests for `/ws`. Set `PUBLIC_URL` to the browser-visible, credential-free HTTPS origin and
`TRUST_PROXY` to the positive hop count matching the proxy topology. Boolean `true` is
rejected in enforced public mode because it would trust the left-most forwarded address
from any caller. Session cookies use `Secure` whenever `PUBLIC_URL` is HTTPS. The proxy
must preserve `Origin`, `Referer`, `Host`, `X-Forwarded-Proto`, and the WebSocket upgrade
headers.

With `PUBLIC_RUNTIME_SECURITY=enforced` (the default), public startup fails unless
`PUBLIC_URL` is HTTPS, `TRUST_PROXY` is explicit, MariaDB/MySQL and SMTP credentials are
complete, account authentication is enabled, and `SESSION_SECRET` is an explicit stable
value of at least 32 characters. Enabled OIDC additionally requires HTTPS
issuer/callback URLs and the exact canonical callback path documented below.

`PUBLIC_RUNTIME_SECURITY=development` is an explicit administrator override for testing
public product behavior without production infrastructure. It permits HTTP, SQLite,
account-free operation, generated session secrets, incomplete SMTP, no trusted proxy,
and the development Card fixture. At runtime it disables HTTP and WebSocket Origin
enforcement, HSTS, and public HTTP/WebSocket abuse rate limits. It does not bypass password,
session-ownership, DataSpace-ownership, Room-authority, input-validation, or OIDC
callback-validation logic. A warning event is emitted at startup. This mode is not safe
for an untrusted network and must never be used as a production hardening profile.

The narrower automated-test exception remains the explicit `NODE_ENV=e2e` runtime,
where enforced public semantics may use an HTTP `localhost`, `127.0.0.1`, or
loopback-IPv6 origin. It preserves public Origin enforcement while disabling the Secure
attribute only because the loopback URL is HTTP. Every non-loopback enforced public
origin continues to require HTTPS and Secure cookies.

Responses set a same-origin Content Security Policy, clickjacking/MIME/referrer and
browser-capability protections. Enforced public responses additionally set HSTS. API
responses use `Cache-Control: no-store`, including Room join responses that contain a
participant credential.

Do not publish a local `AUTH_MODE=none` instance to the internet.

`ROOM_MAX_PARTICIPANTS` and `ROOM_MAX_PLAYERS` configure the per-Room active-device
and represented-player ceilings. Both default to 100 and accept 2 through 1000. The
values are advertised for display, but joins and device-player changes are enforced in
server-side repository/application transactions.

`ROOM_RECONNECT_GRACE_SECONDS` configures how long a temporarily disconnected device
can reclaim the same participant. It defaults to 180 seconds and accepts 120 through 3600. The browser retry window spans ordinary one-to-two-minute interruptions; only the
server's persisted participant status determines whether the credential is still valid.

## SMTP

Nodemailer uses `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_EMAIL`,
and `SMTP_SECURE`. The server sends plain-text localized activation, password-reset,
and deletion notifications. Delivery success means the SMTP server accepted the
message; bounce processing is outside the current contract.

Activation/reset links use `PUBLIC_URL`, expire after one hour, and contain one-time
bearer tokens. Logs and monitoring must redact message bodies and URLs containing
these tokens.

## Logging

The server writes newline-delimited JSON events at `LOG_LEVEL`. HTTP events contain a
server-generated request ID, method, query-free path, status, duration, and aborted
state; the same request ID is returned as `X-Request-ID`. Request bodies, URL query
strings, credentials, private boundaries, Card text, and individual answers are never
included. Unexpected failures log the actual exception class, message, and complete call
stack. Zod failures additionally log schema path, issue code, and validator message.
`LOG_ERROR_DETAILS=diagnostic` also logs chained cause stacks and available error/driver
`code`, `errno`, `sqlState`, and `sqlMessage` fields. Arbitrary Error properties, SQL
parameters, rejected request values, and request bodies are not serialized. Concrete
configured credentials and session/OIDC/SMTP/database secrets, bearer/session tokens,
email addresses echoed by database errors, and duplicate-key values remain specifically
redacted; ordinary diagnostic text is not replaced with a generic message.

## OpenID Connect

OIDC is optional and requires account authentication. Configure issuer discovery,
client ID/secret, redirect URL, and display name through `OIDC_*`. The provider must
allow the exact configured callback URL:

```text
<PUBLIC_URL>/api/v1/account/oidc/callback
```

The integration uses Authorization Code flow. State/verifier data lives in the account
session. The application trusts provider claims only after callback validation; proxy
rewrites must not alter callback URL semantics.

## Localization and content policy

Ordinary server messages resolve `Accept-Language` to a supported base language and
then the configured application default. Card content follows the independent BCP 47
card locale saved in the session. `CARD_MISSING_TRANSLATION=EXCLUDE` is the safe
default. `FALLBACK` must be a deliberate deployment choice and uses
`CARD_FALLBACK_LOCALE`. An individual game can instead explicitly enable its own ordered
fallback list; every requested locale is checked against the active catalog on the
server.

## Public legal destinations

`IMPRINT_URL` and `PRIVACY_POLICY_URL` are optional public HTTP(S) destinations. When
configured, the account status/configuration API exposes them and the SPA renders both
as themed links on the main menu and in Settings. They contain no credentials, are
validated at startup, and open separately so active setup or gameplay remains intact.

## Release bundles

- `portable` includes a Node runtime, production dependencies, local settings template,
  and start scripts. It is intended for one machine or LAN server.
- `public` includes the built app and production dependencies but requires external
  database, TLS/proxy, stable secrets, authentication, and email configuration.
- Both editions include `LICENSE.md`, a CycloneDX JSON SBOM, and protocol-v2 JSON
  schemas with a versioned manifest.
- `scripts/smokeRelease.ts` validates required layout only; it does not prove external
  database, SMTP, OIDC, DNS, certificates, or firewall correctness.
