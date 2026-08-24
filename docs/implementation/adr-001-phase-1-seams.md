# ADR-001: Phase 1 seams without a monorepo relocation

## Status

Accepted for the incremental migration.

## Decision

The first `game-core`, `application`, `protocol`, `persistence`, and
`configuration` boundaries live under `src/packages`. They establish import
direction and independently testable contracts without moving the retained
Express server. A later mechanical workspace relocation can move these modules
after their consumers and build tooling are stable.

Configuration is validated before database initialization. The runtime and
migration CLI use the same TypeORM option factory. SQLite uses `better-sqlite3`,
enables WAL and foreign keys, and is server-only. MariaDB/MySQL uses the same
entities and migrations; game-domain behavior must never inspect the driver.

Ownership `Profile` is migrated to `DataSpace` in TypeScript, relations, session
state, routes, views, and the database table. `GameProfile` remains unused and
reserved for gameplay presets. The account-session class becomes
`AccountSession`, but its table remains `session` to preserve stored sessions.

## Consequences

- The root server stays recognizable as the Blueprint composition root.
- Old `profiles` data is renamed rather than dropped.
- Orphan Surveyor abstract types may retain historical filenames until Phase 10;
  they are not used as the new Room authorization or game persistence model.
- The full migration chain passes on MariaDB 10.11 and SQLite; CI repeats both
  production-database and browser contract checks for each release candidate.
