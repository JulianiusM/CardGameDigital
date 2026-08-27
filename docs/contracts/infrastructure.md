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

## Room access discovery

The server listens on the dual-stack wildcard `HTTP_BIND=::` by default, with IPv6-only
mode disabled so both IPv6 and IPv4 interfaces accept HTTP and WebSocket connections.
Detected IPv6 origins use the required bracketed URL form. In local mode, omitting
`PUBLIC_URL` makes each browser use its current origin for the Room QR payload; an
explicit `PUBLIC_URL` is the administrator override. The discovery response also lists
HTTP origins for eligible physical network interfaces covered by a wildcard bind.
Virtual adapters and link-local IPv6 addresses are omitted from the browser list, and
each interface contributes at most one IPv6 origin, preferring global over unique-local.
These origins contain no Room or participant credentials.

Local deployments additionally publish one DNS-SD service per running installation as
`_partycard._tcp.local`. Public deployments do not advertise unless the administrator
explicitly enables `MDNS_DISCOVERY_ENABLED`, which emits a startup warning. The release
TXT profile is static, ordered, and intentionally small:

```text
txtvers=1
api=1
ws=2
tls=0|1
path=/api/v1
cap=rooms[,display-bootstrap]
```

The multicast records never include the stable installation ID, Room codes, accounts,
participants, credentials, endpoint tokens, Card text, or live game state. mDNS is a
convenience locator, not authentication: peers on the link can observe or impersonate
it. A discovering client fetches `/api/v1/server-info`, validates the advertised
capabilities and relative endpoints, and treats `serverId` only as a deduplication key.

The advertiser starts only after the HTTP listener, database/catalog readiness, and
persisted Room connection recovery are live. It
withdraws after sustained loss of readiness, reconciles network changes, retries
responder failure with bounded exponential backoff and jitter, and sends goodbye records
before HTTP/WebSocket shutdown. Only listener-reachable, approved addresses are
published. Loopback, multicast, unspecified, and virtual/container interfaces are
excluded by default; IPv4 is private/link-local unless explicitly allowed. Interface
allow/deny lists are exact, with deny taking precedence. The DNS responder retains
normal probing, conflict renaming, known-answer suppression, link-local validation, and
interface-specific answers.

Local response CSP authorizes the WebSocket origin derived from the validated request
protocol and Host, so a page opened through any bound address can connect back to that
same server. Domain and IPv4 hosts use an exact WebSocket origin. Because CSP host-source
syntax cannot represent IPv6 literals, an IPv6 page uses only the matching `ws:` or
`wss:` scheme source; the browser client still connects to its own `location.host`.
Public response CSP uses the WebSocket form of `PUBLIC_URL`, with the same IPv6-literal
scheme fallback, while server-side public Origin enforcement remains exact.

A browser page opened over plain HTTP at a LAN IP is not a secure context and may not
expose `crypto.randomUUID()`. Browser-generated WebSocket request IDs, display-bootstrap
idempotency keys, and local editor IDs therefore use `crypto.getRandomValues()`, set the
RFC 4122 UUIDv4 version/variant bits, and never fall back to `Math.random()`.

Every public runtime, including the explicit development policy, requires an explicit
`PUBLIC_URL`. Public Room QR payloads and displayed availability URLs use only that
configured origin and never the current browser origin or detected server interfaces.

`ROOM_MAX_PARTICIPANTS` and `ROOM_MAX_PLAYERS` configure the per-Room active-device
and represented-player ceilings. Both default to 100 and accept 2 through 1000. The
values are advertised for display, but joins and device-player changes are enforced in
server-side repository/application transactions.

`ROOM_RECONNECT_GRACE_SECONDS` configures how long a temporarily disconnected device
can reclaim the same participant. It defaults to 180 seconds and accepts 120 through 3600. The browser retry window spans ordinary one-to-two-minute interruptions; only the
server's persisted participant status determines whether the credential is still valid.

`ROOM_DISPLAY_BOOTSTRAP_ENABLED` and `MDNS_DISCOVERY_ENABLED` default on in local mode
and off in public mode. Display-bootstrap creation also requires stable replay
protection. `ROOM_CREATE_SECRET` may supply at least 32 bytes explicitly; otherwise a
stable non-generated `SESSION_SECRET` is purpose-separated, or local mode creates
`ROOM_CREATE_SECRET_FILE` once with restrictive permissions. Retained replay rows make
silent key replacement unsafe. Each retained row carries non-secret identifiers for
both the HMAC lookup key and replay-encryption key. Startup compares every replayable
row and every ordinary tombstone with the active purpose keys, disabling new
display-bootstrap creation on mismatch instead of silently stranding a known key.
`ROOM_INITIAL_ACTIVATION_SECONDS` and
`UNACTIVATED_PARTICIPANT_TTL_SECONDS` default to 300; the replay tombstone default is
`ROOM_CREATE_IDEMPOTENCY_TOMBSTONE_SECONDS=86400`.

Discovery configuration is `SERVER_DISPLAY_NAME`, `MDNS_INSTANCE_NAME`,
`MDNS_HOST_LABEL`, `MDNS_INTERFACE_ALLOWLIST`, `MDNS_INTERFACE_DENYLIST`,
`MDNS_ALLOW_PUBLIC_IPV4`, `MDNS_ADVERTISED_PORT`, and `MDNS_ADVERTISED_TLS`.
`MDNS_SERVICE_TYPE=_partycard._tcp` is a release constant (overridable only in the E2E
test runtime). `WEB_SOCKET_PATH` and `ROOM_JOIN_PATH_TEMPLATE` are same-origin relative,
credential-free endpoints. The TLS flag must match the configured HTTP front door.

The database stores exactly one installation UUID in `installation_metadata`; it is
stable across normal restarts, upgrades, address changes, and display-name changes.
Identity reset is an offline operator action:

```bash
npm run installation:reset
npm run installation:reset -- --invalidate-runtime
```

The first form refuses while any Room or replayable create result remains. The explicit
invalidation form closes live Rooms, revokes participant credentials, erases encrypted
replay bodies into bounded tombstones, and then rotates the ID. Stop the serving process
before running either command; never copy an installation identity or replay secret into
a second simultaneously advertising replica.

The in-process monitoring adapters expose low-cardinality discovery and Room lifecycle
metrics without opening a new public HTTP endpoint. Discovery supplies advertiser state,
advertisement/restart counters, and interface/address gauges. Room lifecycle supplies
`room_create_total`, `room_create_idempotency_total`,
`room_host_state_transition_total`, `room_initial_host_assignment_total`,
`room_hostless_duration_seconds`, `unactivated_participant_expiry_total`, and
`room_reconciliation_total`. Their labels are closed protocol/lifecycle enums; IDs,
codes, names, addresses, keys, and credentials are never metric labels.

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
