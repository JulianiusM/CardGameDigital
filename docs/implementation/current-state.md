# Current product architecture

## Runtime boundaries

| Boundary                   | Responsibility                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                 | The single Svelte presentation for home, Couch, Room, account, DataSpace and help flows. It talks only to versioned HTTP/WebSocket APIs. |
| `src/packages/game-core`   | Framework-independent rules, eligibility, selection, history and Session state transitions.                                              |
| `src/packages/application` | Use cases for Couch sessions, Rooms, accounts, and help. Express and TypeORM details do not cross into the game domain.                  |
| `src/packages/protocol`    | Versioned, validated realtime messages shared by transport and clients.                                                                  |
| `src/packages/persistence` | TypeORM implementations of application repository ports.                                                                                 |
| `src/routes/api`           | Thin Express adapters that validate input, call application services and serialize JSON responses.                                       |
| `src/modules`              | Process composition: settings, database, sessions, OIDC, email and WebSocket transport.                                                  |

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
systems. Portable server archives
must be built on every supported operating system because their Node dependencies have
platform-specific native bindings. Kodi and Android-family native clients are deferred
from the current release scope; the responsive web client covers Couch, Personal, and
Party Screen device modes. The canonical production Card catalog is still required
before the complete Core Release can be labelled verified.
