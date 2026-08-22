# Current product architecture

## Runtime boundaries

| Boundary                   | Responsibility                                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                 | The single Svelte presentation for home, Couch, Room, account, DataSpace and help flows. It talks only to versioned HTTP/WebSocket APIs. |
| `src/packages/game-core`   | Framework-independent rules, eligibility, selection, history and Session state transitions.                                              |
| `src/packages/application` | Use cases for Couch sessions, Rooms, accounts, help and catalog imports. Express and TypeORM details do not cross into the game domain.  |
| `src/packages/protocol`    | Versioned, validated realtime messages shared by transport and clients.                                                                  |
| `src/packages/persistence` | TypeORM implementations of application repository ports.                                                                                 |
| `src/routes/api`           | Thin Express adapters that validate input, call application services and serialize JSON responses.                                       |
| `src/modules`              | Process composition: settings, database, sessions, OIDC, email and WebSocket transport.                                                  |

## Account model

A persistent account is a `User`. A `DataSpace` owns saved groups, preferences and
persistent games for exactly one user. Anonymous quick play uses an ephemeral Room
and never creates a database identity. The old persistent Guest account, Pug views,
page controllers and template renderer have been removed.

Local password login and OIDC converge on the same AccountSession contract. Passwords
use Argon2id and one-time links are stored as hashes. Account and DataSpace management
are exposed through `/api/v1/account` and rendered by `/play/account`.

## Help and communication

Help Markdown is hidden behind `helpService` and `/api/v1/help`; the Svelte help page
is the sole presentation. Email transport accepts localized account messages from
`packages/localization`. Survey, guest-recovery and ownership-migration mail variants
are not part of this product.

## Deliberate external release gates

MariaDB, SMTP, an actual OIDC provider, HTTPS proxy behavior, browser screenshots and
cross-platform native packages still require their respective CI or staging systems.
The canonical production card database is also still required before the complete
Core Release can be labelled verified.
