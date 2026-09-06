# Corrective Phase 3 follow-up — live catalog, complete draws, bounded data

This implements the recommendations in the [Phase 3 analysis](corrective-phase-3-analysis-2026-09-05.md)
and the clarified requirement that expired cooldowns confer no selection preference.
It supersedes Phase 3's durable frozen-catalog design while retaining its optimistic
commits, policy revisions, consent and lifecycle corrections.

## Result

The normalized catalog is the only stored source of Card metadata and translations.
Sessions store its fingerprint, their settings and sparse policy inputs, and the history
needed for play. They do not copy catalog membership, translations, compiled per-Card
policy, or a Group-history snapshot. A different catalog ends incompatible active games
atomically during installation. Same-catalog recovery remains possible; there is no
save-and-quit feature and Group history does not prevent catalog updates.

Every draw consumes the complete current candidate stream. SQL uses 256-Card keyset
pages, localization `EXISTS` checks and separate flag queries. It reads no rendering text
for candidates. All configured fallback locales participate in one availability check
per page, so a long fallback chain does not multiply page queries. Only the chosen
Card's highest-priority available rendering is fetched for the response.

The shared domain engine resolves captured policy and reevaluates current progression,
roster, boundaries and history for each candidate. It retains one weighted candidate per
relevant type using an exponential race in log space. Within the chosen type, selection
uses ordinary Card weights; previous appearance, page order and cooldown expiry add no
priority. Type ratios, streak limits and mode-specific type requirements remain the
existing engine rules. A scan failure produces no partial draw or appearance commit.

This is deliberately not a preselected deck, finite candidate window or refill queue.
Cards becoming eligible later can enter every subsequent draw, including a Card beyond
the first 100,000 candidates. Counts consume the same eligibility logic, cache by pool
revision and share in-flight work; voting alone does not invalidate eligibility.

## Storage and lifecycle

- Runtime v7 keeps a total shown counter and the most recent two appearance records.
  Persisted draws obtain last-seen sequences from indexed appearance rows. Recovery
  does not materialize the complete appearance archive.
- Group history uses stable Card IDs and a captured time/reset window. Indexed `EXISTS`
  checks cover both Room and Couch appearances and exclude the current Session.
- Unsaved Couch games retain an in-memory last-seen map for Cards actually drawn.
  Unsaved Rooms retain one last-seen database row per drawn Card, even across repeated
  draws, and erase those rows at game end. Saved games keep their required appearance
  archives. These are gameplay records, not catalog snapshots.
- Runtime and Room-settings records up to 64 KiB remain ordinary JSON. Larger records
  use a versioned asynchronous Brotli encoding capped at 512 KiB stored / 4 MiB decoded,
  with digest validation and at most four concurrent codecs. This covers the supported
  maximum roster/settings on the existing 1 MiB MariaDB packet configuration without
  changing transport objects. This encoding contains no catalog or translations.
- Only sparse policy inputs use immutable payload storage. Hash lookup precedes
  compression; identical inputs share storage. Compression is asynchronous and chunks
  are at most 24 KiB binary / 32 KiB Base64. Decodes validate lengths, counts and digest,
  share live decoded inputs, and have a concurrency limit.
- End, account/DataSpace deletion and catalog replacement detach obsolete policy
  references. Cleanup removes at most 16 unreferenced payloads per batch, with periodic
  cleanup covering remaining orphans. Required saved appearance history is preserved.
- SQLite coordinates the entire shared connection, including independent direct
  repository reads and transaction callbacks. Room creation rechecks connected roster,
  names, settings, boundaries and catalog under the Room lock before its first commit.

The forward `UseLiveSessionCatalog1787362000000` migration ends pre-v7 games, removes
obsolete digest columns and payloads, adds history indexes and changes producer weights
to `DOUBLE`. It is resumable across implicitly committed DDL. The earlier unpublished
Phase 3 migrations also tolerate completed columns/runtime rows when resumed. A downgrade
requires the matching backup and server version.

## Resource behavior and limits

| Resource                           | Behavior                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Catalog storage                    | Normalized Cards and localizations, independent of Session count                                                        |
| Draw buffers                       | One 256-Card metadata page plus one selected candidate per type                                                         |
| Draw work                          | Linear catalog scan; worst-case policy work additionally depends on rule count                                          |
| Policy setup                       | Only the selected DataSpace/Group and Session; exact directives indexed, rules sorted once                              |
| Policy precedence                  | Shadowed properties/rules avoid unnecessary resolution and object copies                                                |
| Startup validation                 | Streaming passes, bounded records/header and a temporary UUID-only uniqueness index                                     |
| Rendering writes                   | Batches limited by both row count and estimated bytes                                                                   |
| Concurrent expensive work          | Two starts, four scans, two uncached policy decodes, one policy import                                                  |
| Session caches                     | 128 entries / 128 MiB conservative estimate per Room/Couch service; 24-hour idle expiry                                 |
| Ordinary HTTP / WebSocket messages | 4 MiB, shared with generated Kodi definitions                                                                           |
| Authenticated policy import        | 64 MiB; existing 250-rule / 50,000-Exact-Card schema                                                                    |
| WebSocket queues                   | 32 messages / 8 MiB input per socket, 32 MiB queued input total; 8 MiB send buffer per socket, 32 MiB outstanding sends |

Startup accepts no unbounded individual value: each Card record and the complete header
must fit 16 MiB; each rendering fits 4,000 Unicode characters and 8,192 UTF-8 bytes.
Producer integer fields fit signed SQL integers, and positive finite weights use
`DOUBLE`. MariaDB/MySQL catalog installation enables strict writes and requires a packet
allowance of at least 1 MiB. Existing installed text is also checked when a release is
retained. Invalid content fails installation instead of installing a catalog that later
fails a Session-specific catalog-size guard.

These are explicit deployment bounds, not a promise that infinite data fits finite
hardware. More languages require their actual normalized translation storage; more
Cards increase scan time. Large sparse policy scopes and long unsaved Couch histories
still require memory. Saved appearances, historical logical Cards, backups and database
transaction logs require disk space. Active unsaved games are protected from ordinary
cache eviction, and capacity pressure rejects additional work instead of queuing large
allocations. Ending a game requires no catalog scan.

Room broadcasts build common state once, preserving viewer-specific controls and voting
privacy. They yield to I/O, serialize per Room and suppress older snapshots after a
newer one was sent. Shared voting progress coalesces over 50 ms while the voter receives
an immediate response. Slow/overloaded sockets close with 1013. Full snapshots still
carry roster-dependent data to each recipient: the remaining delta/broadcast and durable
history-retention work from later corrective phases is not claimed complete here.

## Compatibility and verification

HTTP field shapes remain v1 and WebSocket field shapes remain v3. Updated server/web/Kodi
builds share the expanded message allowance; older native v3 builds may retain the former
64 KiB limit. Card text/record limits tighten deployment acceptance and are documented
in the catalog contract. Pre-v7 active games end during migration; Group history survives.

Regression coverage includes a lazy 100,001-candidate draw, equal-weight expired-cooldown
sampling, progression changes, extreme weights, thousands of repeats, page/fallback
query counts without rendering loads, strict streaming parsing, catalog changes,
policy recovery/cleanup, SQLite ownership, the initial roster race, maximum setting
payload arithmetic and bounded WebSocket queues. Large catalogs and disk-fill tests
were not generated. Persistent catalog fixtures added for pagination contain 257 Cards;
the 100,001-candidate test generates metadata lazily in memory.

Executed checks:

| Exact command                                                                                                                                                                                   | Result                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `npm run build`                                                                                                                                                                                 | Passed; server build, Svelte checks, web build and generated artifacts current |
| `npm run typecheck:test`                                                                                                                                                                        | Passed                                                                         |
| `npm run format:check`                                                                                                                                                                          | Passed, including Kodi static checks                                           |
| `npx vitest run tests/unit/stored-json.spec.ts tests/integration/boundary-persistence.spec.ts tests/integration/public-mode-mariadb.spec.ts --bail 1`                                           | 112 passed on SQLite and MariaDB                                               |
| `npx vitest run tests/integration/websocket-rooms.spec.ts --bail 1`                                                                                                                             | 25 passed, including delayed broadcast ordering                                |
| `npm test`                                                                                                                                                                                      | 522 passed; 1 opt-in test skipped and passed separately below                  |
| `npm run kodi:check`                                                                                                                                                                            | Static checks and 276 native tests passed                                      |
| `npm run e2e:couch`                                                                                                                                                                             | 46 Chromium tests passed                                                       |
| `npm run e2e:visual -- --grep "visually audits menu, complete setup\|visually audits Personal play\|visually audits the configured 1000-player ceiling\|visually audits the English interface"` | 4 visual audits passed                                                         |
| `node node_modules/vitest/vitest.mjs run tests/integration/card-catalog-mariadb.spec.ts --hookTimeout 600000 --testTimeout 600000`                                                              | 1 passed with `CARD_CATALOG_MARIADB_TEST=1`                                    |
| `git diff --check`                                                                                                                                                                              | Passed                                                                         |

The visual run covered desktop, 320-pixel phones, short displays and TV, including the
1,000-player roster; selected phone/game/settings and TV captures were also inspected.
The public database was MariaDB 10.4.32 with `max_allowed_packet = 1048576`; no global
server settings were changed. Tests cover large hot-record round trips and concurrent
adoption of identical sparse policy inputs on that database. The opt-in startup-lock
command ran through a temporary helper that supplied `E2E_DB_*` from the configured
disposable test profile and reset/removed that schema before/after the test. It verified
that two independent connections serialize installation and record the release once.

MySQL was not executed in this environment. It uses the same public-adapter SQL path,
but that is not a substitute for a MySQL deployment test. No disk-fill, sustained public
load or target low-power hardware benchmark was run. The limits above describe bounded
work/data paths, not a throughput or unlimited-storage guarantee.
