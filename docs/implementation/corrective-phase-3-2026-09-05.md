# Corrective Phase 3 — authoritative snapshots and commits

The [2026-09-06 correction](corrective-phase-3-rework-2026-09-06.md) implements the
follow-up design. This document records the earlier implementation/analysis.

Scope: F07, F08, F12 and F20 from the
[implementation review](implementation-review-2026-09-05.md). The corrections are implemented and verified below.
The resource constraints raised in F06/F09/F11/F14/F15 also govern these corrections.

The subsequent [conceptual and implementation analysis](corrective-phase-3-analysis-2026-09-05.md)
identifies a catalog-lifetime mismatch, remaining storage/resource limits and additional
reproduced concurrency gaps. The passing checks recorded here cover their tested cases;
they do not establish worst-case scalability or complete lifecycle correctness.

## Corrective work plan

1. **F12 — compare Couch proposals with their actual base revision.** Make the expected
   revision explicit in the persistence port, commit runtime and appearances together,
   and check persisted revisions before reusing an owned Session from the cache.
2. **F20 — commit Room lifecycle and gameplay together.** Perform terminal participant,
   Host, roster, frozen-voter and private-boundary changes in the Room transaction.
   Remove follow-up Session writes from lifecycle application operations; test rollback
   and restart/retry after injected write failures in SQLite and MariaDB.
3. **F07 — freeze the actual catalog inputs.** Preserve membership, classification,
   operational flags and localized text independently of later catalog releases. Share
   immutable catalog storage across Sessions and policy variants, keep only references
   in hot database rows, and never add the catalog to HTTP/WebSocket snapshots. Define
   explicit migration/recovery behavior for previously started games.
4. **F08 — make policy writes and provenance authoritative.** Add monotonic scope
   revisions, conditional row writes, expected scope revisions for aggregate mutations,
   and coherent hierarchy reads. Update HTTP adapters, browser and Kodi callers,
   generated contracts and documentation together.

## Resource guardrails and verification

- Check size/count budgets before constructing or writing oversized immutable data.
- Keep immutable database chunks below the existing 24 KiB compressed-byte budget;
  deduplicate payloads and avoid repeated writes on ordinary Session commands.
- Bound shared immutable caches by bytes and avoid copying catalog-sized values into
  each proposal, lifecycle transaction or viewer projection.
- Measure stored runtime bytes, payload/chunk counts, cache size and catalog reads with
  representative and worst-case fixtures. Use bounded synthetic data and disposable
  test databases; do not generate bulk artifacts or copy the catalog into test logs.
- Verify same-base conflicts, transaction rollback and recovery on both database modes.
- Run focused tests while iterating, then formatting, build, full tests, native checks,
  relevant browser audits and `git diff --check` for final delivery.

## Implemented corrections

- **F07:** Runtime v6 stores a digest for the complete frozen localized catalog. Card
  membership, type/taxonomy, operational flags, locale, text and compiled values survive
  catalog/policy changes and restart. Unknown IDs cannot bypass a compiled policy. Catalog
  and provenance reads share a transaction; DataSpace/Group policy reads share another
  coherent snapshot. Missing/corrupt payloads fail recovery without live recompilation.
- **F08:** Policy scopes have independent monotonic clocks, including empty scopes.
  Conditional updates/deletes enforce caller revisions. Every mutation advances its
  scope clock; replacement and delete/recreate cannot reuse an old row revision. Reorder,
  import and bulk writes require the reviewed scope revision. Scope initialization takes
  the write lock immediately; aborted public-database writes return a conflict.
- **F12:** Couch persistence compares each proposal with its supplied base revision and
  commits runtime/appearances together. Owned caches check the stored revision before
  reuse. Failed commits cannot publish proposed state.
- **F20:** A Room transaction now includes lifecycle/Host decisions, Session departures,
  current voters, private-boundary cleanup and replay-result cleanup. Commands recheck
  their actor under the Room lock. Lifecycle operations need only the hot runtime row.
  Recovery tests cover failure after writes and loss of the result after database commit.

## Compatibility

`1787360000000-AddCardPolicyScopeRevisions` backfills clocks without resetting row
revisions. `1787361000000-FreezeSessionCatalogs` upgrades runtime to v6 and **ends
pre-v6 games**, retaining historical appearances and policy/history payloads. Those games
never stored enough information to reconstruct their original catalog. Start new games
after upgrading; downgrade requires a matching database backup/server version.

The browser reads `{scope,scopeRevision,scopeDefault,rules}` from `/card-policy/scope`.
Import sends `{policy,expectedScopeRevision}` and accepts an empty 204 response. Reorder
and bulk requests also carry `expectedScopeRevision`; stale changes return 409. Portable
policy files remain v2. **WebSocket remains v3**. Kodi does not call these persistent
management endpoints, and its Session/setup wire contracts remain unchanged.

## Data and memory budgets

| Resource                              | Limit / behavior                                                    |
| ------------------------------------- | ------------------------------------------------------------------- |
| Frozen localized catalog              | 50,000 Cards; 32 MiB serialized UTF-8 JSON                          |
| Catalog reads                         | 256 Cards per page; one selected rendering per Card; separate flags |
| Immutable database chunks             | 24 KiB compressed bytes / 32 KiB Base64                             |
| Shared catalog cache                  | 64 MiB of serialized data and 128 entries                           |
| Session cache per service             | 128 entries / 128 MiB conservative estimated weight                 |
| Concurrent Session starts per process | 2; excess work rejected before loading/compiling                    |
| Ordinary draws and viewer snapshots   | Frozen inputs; no live catalog reads or immutable writes            |

Each immutable loader validates sizes and chunk counts before collecting/decompressing.
Catalogs are shared across Room/Couch Sessions and policy variants. Proposals share
immutable inputs and compiled lookup maps. Remaining-pool counts are cached per revision,
and selection builds a history lookup and merged boundaries once per pool instead of
allocating per-Card appearance lists. Recoverable Sessions can be evicted; active ephemeral
games are preserved and further admission is rejected when the cache is full. Capacity
errors are localized. Compilation discards per-Card textual provenance after resolution.
WebSocket capacity refusals are expected errors, so repeated refusals do not generate
unhandled-error logs.

A bounded **600-Card** fixture with UTF-8 text and deterministic entropy measured:

| Measurement                                     | Bytes / count |
| ----------------------------------------------- | ------------: |
| Uncompressed catalog                            | 722,401 bytes |
| Compressed catalog                              | 270,614 bytes |
| Catalog chunks                                  |            12 |
| Largest compressed chunk                        |  24,576 bytes |
| Shared catalog payloads for two policy variants |             1 |
| Initial hot runtime                             |   1,511 bytes |
| Hot runtime showing a Card                      |   2,743 bytes |
| Additional immutable chunks for a draw          |             0 |

The probe used an in-memory SQLite database. Byte-limit tests reuse one row incrementally;
count/admission/cache tests use small references or declared weights. No oversized catalog
artifact or bulk test database was generated. The management audit uses the supported
250-rule limit, while keeping the existing Group paging stress case.

These backstops cover the new snapshot work. Phase 4 still owns maximum HTTP/WebSocket
payloads and large policy transport; Phase 6 still owns durable-history retention, orphan
cleanup, per-owner quotas, preview workload and broader operational/fanout budgets. No
transport limit was increased.

## Verification

- `npm run generate` — database index and native artifacts regenerated; 28 entities and
  32 migrations are indexed.
- `npm run format:check` — passed, including native static checks.
- `npm run build` — passed; Svelte reported zero errors and warnings.
- `npm run typecheck:test` — passed.
- `npm test` — **501 passed, 1 skipped**, across 64 passing files and one skipped file.
  This includes the Phase 3 SQLite and MariaDB conflict, snapshot and lifecycle tests.
- `npx vitest run tests/integration/websocket-rooms.spec.ts` — **23 passed** after the
  final expected-capacity-error logging adjustment; the build was repeated and passed.
- `npm run kodi:check` — generated artifacts, static checks and all **276** native tests
  passed. WebSocket v3 remains aligned across server, browser and native client.
- `npm run e2e:couch -- --grep "Card management" --workers=1` — **2 passed**.
- `npm run e2e:visual -- --grep "visually audits Help and Card management"` — **1 passed**,
  covering desktop and 320-pixel phone widths, focus, forced colors, overflow and
  maximum-length content. Desktop and phone captures were inspected; captures remain
  local generated artifacts.
- `git diff --check` — passed.

The skipped test is the separate opt-in MariaDB catalog advisory-lock scenario, which
requires `CARD_CATALOG_MARIADB_TEST=1` and its dedicated disposable schema. It does not
include the Phase 3 MariaDB suite, which ran successfully.

The storage measurements used the bounded repository fixture in
`tests/support/frozenCatalogFixture.ts` and the actual immutable-payload adapter:
`npx ts-node --project tsconfig.server.json .tmp/phase-3-resource-probe.ts > .tmp/phase-3-resource-metrics.json`
— passed, using an in-memory SQLite database. The probe and its compact output remain
local generated artifacts.
