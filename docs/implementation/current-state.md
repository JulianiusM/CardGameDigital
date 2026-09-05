# Current product architecture

## Runtime boundaries

| Boundary                      | Responsibility                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web`                    | The single Svelte presentation for home, Couch, Room, account, DataSpace and help flows. It talks only to versioned HTTP/WebSocket APIs.   |
| `packages/game-core`          | Framework-independent rules, eligibility, selection, history and Session state transitions.                                                |
| `packages/application`        | Framework-independent use cases and repository ports for Couch sessions and Rooms.                                                         |
| `packages/protocol`           | Versioned, validated wire messages, inferred DTOs, and forward-compatible client decoders.                                                 |
| `packages/persistence`        | TypeORM entities, application-port implementations, and domain mapping.                                                                    |
| `packages/design-tokens`      | Golden Mischief colors, base atmospheres, and exhaustive Card-family classification shared by visual clients.                              |
| `packages/localization`       | Server message catalogs, stable shared browser/native terms, and the generated Kodi locale/settings source.                                |
| `apps/server/src/application` | Server-specific account and Help orchestration that depends on HTTP, mail, OIDC, filesystem, or database adapters.                         |
| `apps/server/src/routes/api`  | Thin Express adapters that validate input, call application services and serialize JSON responses.                                         |
| `apps/server/src/modules`     | Process composition: settings, database, sessions, OIDC, email and WebSocket transport.                                                    |
| `apps/kodi`                   | Native Kodi TV presentation, discovery, transport, recovery, profile storage, generated contracts/localization, and independent packaging. |

## Account model

A persistent account is a `User`. A `DataSpace` owns saved groups, preferences and
persistent Couch/Room games for exactly one user. Anonymous quick play uses explicit
`EPHEMERAL` persistence in every screen topology and never creates a database identity
or durable Couch/history row. Realtime Rooms retain only the transient authoritative
rows needed for live coordination/reconnect and have no DataSpace or account history.
The old persistent Guest account, Pug views, page controllers and template renderer
have been removed.

Local password login and OIDC converge on the same minimal AccountSession identity.
Passwords use Argon2id, one-time links are stored as hashes, and password reset revokes
all login sessions. Account, activation recovery, login-session, export, and DataSpace
management are exposed through `/api/v1/account` and integrated into `/play/account`.
The server maintains the invariant that every authenticated account owns and selects a
DataSpace, including self-repair for accounts or sessions created by older builds.
The tabbed Account screen explains that boundary and supports ownership-checked
DataSpace deletion while retaining at least one space.
Each DataSpace owns isolated no-Group Custom-profile and Card-language snapshots, while
every Group owns its separate snapshots with the same complete shape. Language preferences
belong to the User across DataSpaces and are written only after a manual choice. The
browser keeps a local copy for startup/offline use; explicit system mode follows current
browser languages. Interface/Card choices and an ordered fallback list stay distinct,
and each game separately decides whether Card fallback is enabled.
Grouped setup changes do not overwrite the User/device Card-language defaults used by
quick rounds.
Public runtime hardening defaults to `enforced`. Administrators can explicitly select
the warning-emitting `development` policy to exercise the same public SPA, accounts, and
persistence on trusted development infrastructure without the production TLS, proxy,
SMTP, MariaDB, catalog, Origin, HSTS, or HTTP/WebSocket rate-limit startup/runtime gates.

Room reconnect grace remains authoritative and defaults to 180 seconds. Once no
Host/Player remains, a connected Party Screen keeps the Room joinable but cannot become
Host; a newly connected Player takes over. The Room closes when neither a reconnecting
player device nor a connected display remains.
The **TV + phones** setup path now opens that Party Screen directly through
`DISPLAY_WAITING_FOR_HOST`; the Room contains no synthetic creator Host and the first
authenticated player phone is promoted atomically. Room bootstrap/lifecycle metadata,
an encrypted idempotent create replay, and a one-Host database guard persist across
restart. Local installations also own a stable server UUID and advertise a privacy-small
`_partycard._tcp` DNS-SD profile on eligible interfaces after readiness. Both capabilities
default off for public deployments unless explicitly enabled.

## Help and communication

Help Markdown is hidden behind `helpService` and `/api/v1/help`; the Svelte help page
is the sole presentation. `docs/user-guide/topics.json` is the single validated registry
for locale-independent topic slugs and explicit spaced ordering, so Help tab order never
depends on filenames. Email transport accepts localized account messages from
`packages/localization`. Survey, guest-recovery and ownership-migration mail variants
are not part of this product.

## Deliberate external release gates

MariaDB 10.11 migration, public account/persistence integration, catalog-lock, and
public-mode browser checks pass and are wired into CI. Real SMTP, an actual OIDC
provider, and deployed HTTPS proxy behavior still require their respective staging
systems. Portable server archives must be built on every supported operating system
because their Node dependencies have platform-specific native bindings. The Kodi
client is implemented as an independent thin-client release with generated
protocol/design artifacts, Couch and Room display flows, display-bootstrap hosting,
discovery, recovery, localization, automated CPython checks, and reproducible
packaging. Clean Kodi install/launch and the version/platform/skin/remote/network matrix
remain external release QA gates. Native account linking is capability-gated and the
current server explicitly advertises it as disabled. Android-family native clients
remain deferred. The canonical production Card catalog is still required before the
complete Core Release can be labelled verified.

## Card management

The runtime now requires the canonical strict `game-card-catalog/v2` envelope: fixed
`catalogId=core`, required `snapshotKind=FULL`, nested `taxonomy`, canonical lowercase
UUIDs, `CONVERSATION_META`, and the closed operational-flag vocabulary. The shipped
JSON Schema and delivery contract match the provider handoff exactly; historical v1
artifacts remain published unchanged. Runtime persists resolved social sensitivity and
player-count metadata. DataSpace/Group Card policy is sparse,
optimistically revisioned, ownership-scoped, portably exportable/importable, and
available through the Golden Mischief SPA in both local no-auth and authenticated public
deployments. Faceted Card search is cursor-paged; confirmed bulk results materialize
stable UUID exceptions. Room and Couch setup accept additive Session policy, and active
Sessions carry an immutable version-4 compiled policy snapshot.

Maximum social sensitivity is now an explicit profile/game-setting eligibility gate,
persisted for DataSpace quick-game defaults by migration `1787352000000`. The
Child-friendly built-in profile provides ordinary,
fully editable category, DareType, flag, intensity, and sensitivity defaults. A
read-only server preview reports mode-specific eligible totals at starting and maximum
intensity using compiled policy, localization, shared Group history, and proposed player
count without exposing private boundaries.

The Golden Mischief management workspace is complete in both deployment modes. It uses
searchable eight-item scope/DataSpace/Group pages, ten-item rule pages, and server-backed
24-Card pages; only the selected rule or Card is expanded. New rules start disabled and
require a current bounded server preview. Responsive provenance cards replace wide
tables, all controls and confirmation states are styled, and German/English catalogs
cover every visible state. Standalone management uses the established page Card and its
Account tab uses the compact tab-explainer hierarchy. Account-contained and narrower
workspaces stack master/detail panes; scope actions remain uniform and scope labels wrap
without loss. The picker visibly separates the DataSpace baseline from Group overrides;
selected Cards show full UUIDs, pager actions are equal width, and wide Conditions use
document flow without a master-pane scrollbar. Ordered custom values use one themed
scale with remembered drafts and least-restrictive initial values. The page is audited
without horizontal overflow at desktop and narrow-phone widths.
New policy controls use the shared tactile hover/press motion and reduced-motion rules.
The main menu names the active DataSpace, while setup, editor, Couch setup, and lobby
surfaces reuse one localized eligible-Card panel.
Empty policies still inherit every producer/profile default, so quick setup remains
unchanged.
