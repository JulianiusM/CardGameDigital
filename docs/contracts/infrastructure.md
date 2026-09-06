# Infrastructure integration contracts

## Database

Operational numbers below describe the default deployment policy. Retention, caches,
admission, work concurrency, rate windows and realtime scheduling/backpressure are
configurable through [operational settings](operational-settings.md). Protocol and
storage-format boundaries remain fixed. Settings are validated at startup and apply
after restart.

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

### Authoritative Session and policy commits

Couch persistence takes an explicit expected base revision (`null` only for creation).
Runtime and CardAppearances commit together through a conditional update. Owned caches
check a small persisted revision before reuse. Room membership/closure transactions
change only hot runtime fields and do not hydrate catalog payloads or appearance history.
Authoritative Room/Couch/policy transactions and catalog reconciliation serialize on
the shared SQLite connection, including direct repository reads and independent transaction callbacks;
public writes use row locks/CAS and coherent reads use repeatable-read transactions.
Policy scopes retain an independent monotonic clock, including empty scopes.

Session runtime **v7** records the catalog fingerprint and captured sparse DataSpace,
Group and Session policy inputs. It stores no catalog membership, metadata array,
translation snapshot, compiled per-Card policy or Group-history bitset. A changed catalog
ends incompatible active games atomically at startup. Same-fingerprint recovery remains
available; this is not a save-and-quit feature. Saved Group history never blocks catalog
updates and keeps its stable Card UUIDs.

Each draw scans every localized candidate in 256-Card metadata pages. Indexed lookups
supply that Card's last Session appearance and membership in the Group history window
captured at start. The engine reevaluates current progression, roster, boundaries,
cooldown and captured policy, then runs a weighted reservoir for each relevant Card type.
Cooldown expiry only makes a Card eligible again; it provides no priority. Only the
selected Card's chosen rendering is fetched. Fallback availability uses one `EXISTS`
query per page across the ordered locale set, without joining or loading translations.

Sparse policy inputs alone use content-addressed Brotli chunks (24 KiB binary / 32 KiB
Base64), with digest lookup before compression and validated size/count metadata on
recovery. Ended games detach them; bounded cleanup runs at end, account/DataSpace
deletion, catalog replacement and periodically. Identical live decoded inputs share weak
references. Runtime retains the most recent two appearances plus a total shown counter;
persistent draws query normalized history without loading the archive. Unsaved Rooms
retain one last-seen row per played Card and erase those rows when the game ends.
Saved sessions retain their required appearance archive.

Large hot runtime and Room-settings JSON uses `brotli-json/v1` storage envelopes above
64 KiB. Envelopes are at most 512 KiB, decode to at most 4 MiB, and validate their byte
length and SHA-256 digest. Small records remain plain JSON; HTTP and WebSocket objects
are unaffected. Four concurrent codecs bound compression/decompression work. These
records contain no catalog membership, compiled catalog policy or translations.

The forward, resumable `1787362000000-UseLiveSessionCatalog` migration ends pre-v7
runtimes, drops obsolete payload references and deletes unreferenced archives. It adds
history lookup indexes and widens producer weights to `DOUBLE`. Historical Card IDs and
saved appearances remain. Downgrades require a matching backup and server release.

There is no gameplay Card-count/catalog-JSON admission ceiling. Startup file validation
streams records and uses an anonymous temporary UUID-only uniqueness index, deleted on
close, with a 2 MiB SQLite page cache. Each record and the complete header are limited to
16 MiB. Each rendering is limited to 4,000 Unicode characters and 8,192 UTF-8 bytes.
MariaDB/MySQL catalog writes enable strict mode and require `max_allowed_packet >= 1 MiB`;
ordinary metadata/rendering batches stay below 256/128 KiB estimated statement content.
A release that exceeds these deployment content limits fails before installation.

A process admits at most two simultaneous Session starts, four metadata scans, two
uncached policy decodes, and one authenticated policy import. Work exceeding those
budgets fails with `SESSION_CAPACITY_EXCEEDED` (HTTP 429), without a large proposal queue.
Each Room/Couch service caches at most 128 Sessions and 128 MiB of conservatively estimated
policy/history/roster data. Recoverable games can be evicted; live unsaved games reserve
their entries. A minute maintenance pass expires idle entries after 24 hours, even
without another request. Ended unsaved Couch summaries expire after at most 15 minutes,
or earlier under cache pressure,
without extending that window on reads. Cache limits are not an
exact heap measurement or a total process-memory guarantee.

Ordinary JSON and WebSocket messages allow 4 MiB; authenticated policy import allows
64 MiB for the existing 50,000-Exact-Card scope. WebSocket input queues allow 32 messages
and 8 MiB per socket, within 32 MiB total queued input. Sends allow 8 MiB per socket and
32 MiB outstanding in the process; excess/slow consumers close with code 1013. Shared
voting progress is coalesced over 50 ms, while the submitting voter receives an immediate
response. Full Room snapshots still incur roster/recipient-dependent traffic: this is not
a delta protocol. Persistent history and operator backups still require retention and
sufficient disk space. Database I/O and rule evaluation grow with catalog size even
though draw buffers and per-game catalog storage do not.

### Game retention and resource admission

The `1787363000000-BoundGameRetention` migration adds an indexed Couch
`last_active_at` timestamp and a database admission lock. A successful Couch command
updates activity; reading a snapshot does not keep abandoned saved runtime active.
After 24 hours without a command, maintenance ends saved Couch runtime through the
shared engine, increments its revision, clears private state and detaches policy input.
Owned Session/Group appearances remain durable. Existing rows use their original
start time when migrating, rather than receiving a new lease.

After 15 minutes, closed unowned Rooms and their dependent records are purged. Detached
ended Session records in a reused unowned Room have the same retention. Existing Room
expiry/Host lifecycle decisions run first; maintenance never purges a live Room or an
owned Room's history. Replay tombstones retain their independent policy. Each minute
pass processes at most 16 records per category and 16 orphan payloads, with no overlap.
Startup runs a pass before listening and shutdown waits for active maintenance.

Admission is transactional across repository instances: at most 256 retained unowned
Rooms plus open owned Rooms, 128 active saved Couch games, and 32 retained temporary
Sessions per Room. Ended temporary records still consume capacity until purged.
Existing records above those limits remain readable/endable. Cache, codec, scan and
queue limits apply independently; durable history and backups still need disk planning.
The migration is resumable; downgrade requires restoring a matching backup.

Ordinary game HTTP requests reserve one of eight process-wide slots before body
parsing. Couch end requests can use two extra slots. Async adapters retain the slot
until their work settles even if the client disconnects; rejected requests receive
`429 SESSION_CAPACITY_EXCEEDED` with `Retry-After: 1`. Authenticated imports retain
their separate parser and single import slot.

Policy searches/previews/bulk operations share two additional work slots. Work and
import slots are released when the operation settles, including after disconnected
requests. Couch queues hold 16 commands per game / 256 per service; Room queues hold
1,024 per Room / 2,048 per service, within transport byte limits. Terminal operations
have two extra per-game slots and 16 extra service slots in Couch. Room terminal and
lifecycle operations reserve 1,024 extra per Room / 2,048 per service, covering the
maximum 2,000 simultaneous WebSocket connections. Limiters store at most 10,000
live identities. Aggregate `games.work_rejected`, `games.retention` and
`games.retention_failed` events omit identities and private inputs.

### Private boundary retention and backups

First-time enrollment during active play commits the private boundary row and the
expanded Session roster/runtime in the same Room-locked, revision-checked transaction.
Draws cannot observe an enrolled player without their accepted restrictions. Frozen
choices for existing Session players remain immutable.

Private boundaries may be stored for active Session recovery and for an explicitly
continuing, unexpired Room lobby. An ended Session retains no boundary values. Removing
a participant removes their boundary row and the runtime copies for every player their
device represents. Room closure/expiry and installation identity invalidation erase all
Room boundary values. Active reconnect and restart within grace preserve restrictions.
Account/DataSpace deletion cascades through the owned Rooms, participants, Sessions,
and boundary rows. Non-sensitive CardAppearance and Group history otherwise remain.

The data-only `1787359000000-ScrubExpiredPrivateBoundaries` migration scrubs existing
ended/detached runtimes, departed/expired participant values, and closed/expired Rooms
in bounded pages. It preserves active recoverable restrictions, leaves runtime version
5 and the database schema unchanged, and cannot reconstruct erased values on rollback.
Terminal Room transactions commit presence, Host roles, Session roster, frozen voters,
private-boundary erasure and replay-result erasure together. There is no follow-up roster
commit. Commands also recheck their actor under the Room lock; stale proposals cannot
restore departed players or private restrictions.

Database erasure is logical deletion, not physical media sanitization. Existing SQLite
backup files, WAL/free pages, database snapshots, and MariaDB binary/backup logs may
still contain earlier values. The application does not rewrite or purge operator backups.
Operators must restrict backup access and set a finite retention period appropriate to
their deployment; delete expired copies and their encryption keys under that policy.
The automatic pre-migration SQLite backup also contains the old data until it expires.
Restore only into a stopped installation and apply current migrations and Room recovery
before serving clients. Restoring an older backup must not restart the retention clock
for expired Room or participant records.

## Reverse proxy and TLS

Enforced public traffic must terminate TLS and forward HTTP plus WebSocket upgrade
requests for `/ws`. Set `PUBLIC_URL` to the browser-visible, credential-free HTTPS origin and
`TRUST_PROXY` to the positive hop count matching the proxy topology. Boolean `true` is
rejected in enforced public mode because it would trust the left-most forwarded address
from any caller. Session cookies use `Secure` whenever `PUBLIC_URL` is HTTPS. The proxy
must preserve `Origin`, `Referer`, `Host`, `X-Forwarded-Proto`, and the WebSocket upgrade
headers.

The Kodi client requires TLS 1.2 or newer for HTTPS and WSS and verifies server
certificates and hostnames. TLS front doors that only support TLS 1.0 or 1.1 are
incompatible; local HTTP/WS discovery and connections retain their address policy.

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
ws=4
tls=0|1
path=/api/v1
cap=rooms[,display-bootstrap]
```

The `ws` hint uses the shared current WebSocket protocol version. Native discovery
accepts that same version from its generated definitions, matching HTTP server
information and the subsequent WebSocket handshake. TXT format version 1 is unchanged.

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

ID-token and UserInfo identity claims are separately schema-validated and must name the
same subject. UserInfo may replace the email, but its `email_verified` flag applies only
to that email. An omitted flag may inherit the ID-token value only when both sources
contain the exact same email string. A changed address with omitted/false verification
never auto-links an account. A UserInfo flag without an email does not change the
ID-token email's verification. If UserInfo is unavailable, the validated ID-token pair
is used.

The issuer/subject identity takes precedence over email. Verified-email auto-linking
atomically claims only an account with no existing OIDC issuer or subject. An account
already linked to another identity is left intact; the new identity receives its own
account with a stable synthetic address. Existing identity logins retain their local
account even if provider email claims change. No HTTP fields or callback URLs change;
providers that returned inconsistent email/verification claims will no longer link those
unverified addresses. Provider tokens remain transient.

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

- `server-web` is the indivisible application release unit. Its `portable` and `public`
  editions include the same-version server and complete Vite client, a platform Node
  runtime, production dependencies, a non-secret settings template, and start scripts.
- `portable` is intended for one machine or LAN server and includes a writable SQLite
  data directory. `public` requires deployment services including MariaDB, TLS/proxy,
  stable secrets, authentication, and email, but does not require installed Node/npm or
  separately installed application packages.
- Both editions include `LICENSE.md`, a CycloneDX JSON SBOM, protocol-v4 JSON schemas,
  and a `party-game-release/v1` manifest that gives server and web the same version.
- Kodi and Android-family applications are separate native-client release units. They
  are never added to a server-web archive and have independent versions and tags.
- `tooling/release/smoke.ts` validates required layout only; it does not prove external
  database, SMTP, OIDC, DNS, certificates, or firewall correctness.

Artifact names, supported platforms, manifest fields, tag namespaces, and compatibility
impact are defined in the [release bundle contract](./release-bundles.md).
