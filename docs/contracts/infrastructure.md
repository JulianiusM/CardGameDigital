# Infrastructure integration contracts

## Database

- **Local deployment:** SQLite via `better-sqlite3`; `DB_TYPE=sqlite` and `DB_FILE`.
  Startup enables foreign keys and WAL. A local database must contain exactly one
  DataSpace.
- **Public deployment:** MariaDB/MySQL; configure `DB_HOST`, `DB_PORT`, `DB_NAME`,
  `DB_USER`, and `DB_PASSWORD`. Public mode rejects SQLite configuration.
- TypeORM migrations run transactionally at startup. The database user needs schema
  migration privileges during startup.
- Store database files and backups outside release directories. Never share one SQLite
  file between multiple server processes.

Readiness is `GET /readyz`, which performs `SELECT 1`. Liveness is `GET /healthz`.
Orchestrators should remove an instance from service when readiness fails and restart
only when liveness fails.

## Reverse proxy and TLS

Public traffic must terminate TLS and forward HTTP plus WebSocket upgrade requests for
`/ws`. Set `PUBLIC_URL` to the browser-visible HTTPS origin and `TRUST_PROXY` to the
minimum value matching the proxy topology. Secure session cookies are enabled in public
mode. The proxy must preserve `Origin`, `Referer`, `Host`, `X-Forwarded-Proto`, and the
WebSocket upgrade headers.

Do not publish a local `AUTH_MODE=none` instance to the internet.

## SMTP

Nodemailer uses `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_EMAIL`,
and `SMTP_SECURE`. The server sends plain-text localized activation, password-reset,
and deletion notifications. Delivery success means the SMTP server accepted the
message; bounce processing is outside the current contract.

Activation/reset links use `PUBLIC_URL`, expire after one hour, and contain one-time
bearer tokens. Logs and monitoring must redact message bodies and URLs containing
these tokens.

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
`CARD_FALLBACK_LOCALE`.

## Release bundles

- `portable` includes a Node runtime, production dependencies, local settings template,
  and start scripts. It is intended for one machine or LAN server.
- `public` includes the built app and production dependencies but requires external
  database, TLS/proxy, stable secrets, authentication, and email configuration.
- `scripts/smokeRelease.ts` validates required layout only; it does not prove external
  database, SMTP, OIDC, DNS, certificates, or firewall correctness.
