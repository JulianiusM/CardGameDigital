# Phase 3 conceptual and implementation analysis

The [2026-09-06 correction](corrective-phase-3-rework-2026-09-06.md) implements the
follow-up design. This document records the earlier implementation/analysis.

This reviews the [Phase 3 implementation](corrective-phase-3-2026-09-05.md) against the
subsequent product clarification: no save-and-quit feature, catalog updates occur during
server deployment/startup, and saved Group history must never pin an old catalog.
It records findings and a proposed correction; application code is not changed by this
analysis.

**Verdict:** retain the revision and transactional corrections, but revise the catalog
lifetime/storage design. The implementation improves several normal command paths, yet
it does not establish bounded total storage, scalable admission, or correctness under
every supported concurrent operation. Its cross-release catalog recovery exceeds the
stated product requirement. The earlier passing-test report was too broad as an assurance
of worst-case behavior.

## 1. Session lifetime and catalog lifetime

The production catalog is reconciled at startup, before readiness:
[dataSource.ts](../../apps/server/src/modules/database/dataSource.ts#L65) and
[ADR-002](adr-002-normalized-card-catalog.md). There is no ordinary runtime catalog-editing
endpoint. DataSpace/Group policies, by contrast, can change while games are running.

The original F07 acceptance condition explicitly asked for an existing Session to retain
its inputs across a catalog change and restart. Phase 3 implemented that stronger
condition. It should have challenged whether that condition fit the intended product
before adding durable copies of all localized catalog inputs.

These are different lifetimes:

| Data                                            | Required lifetime                                           | Consequence                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Active game state, votes and private boundaries | Current game and allowed reconnect/recovery window          | Needs authoritative consistency and terminal cleanup.                            |
| Selected catalog inputs                         | While that game is allowed to continue against that release | Does not automatically require an archive across catalog upgrades.               |
| Selected policy                                 | Current game, despite later management edits                | Keep a captured policy or compiled representation for that game.                 |
| Group history                                   | Across games and ordinary catalog updates                   | Store stable Card IDs and history semantics, independently of catalog snapshots. |
| Current catalog                                 | Installed producer release                                  | New games must use the installed release.                                        |

No save-and-quit does not, by itself, prohibit automatic recovery from a short server
crash. Existing [ADR-003](adr-003-shared-session-engine.md) and
[ADR-009](adr-009-play-topologies-and-ephemeral-rooms.md) explicitly describe restart
recovery. That can be preserved **only when the catalog fingerprint still matches**,
without promising recovery across a release change. Browser refresh, Kodi reconnect and
a brief network interruption also need not end a game while its authoritative server
remains available.

Recommended lifecycle:

1. Load and validate the installed catalog before accepting games. Treat it as immutable
   during that server/catalog generation, optionally sharing cached locale views.
2. Record the catalog fingerprint with active runtime. Capture changing policy inputs
   separately; keep the unknown-Card-ID guard in compiled policy evaluation.
3. On a restart with the same fingerprint, permit only the explicitly supported automatic
   recovery window. If all server restarts are intended to terminate play, end active
   games instead; neither interpretation requires save-and-quit.
4. On a changed fingerprint, finish/invalidate old active runtime, release its temporary
   inputs and start new games against the new catalog. Preserve Group history and stable
   Card identity.

With that lifecycle, using the current catalog through a stable application interface is
reasonable. A shared immutable in-memory view can avoid repeated database reads. There
is no need to copy the complete localized catalog into Session payload tables.

Unrestricted reads from a mutable catalog would still be wrong if an administrator or
another server could rewrite it underneath a game. A deployment with multiple writers
must coordinate catalog application, drain old owners, or retain a catalog generation in
memory while its games finish. That is an explicit deployment concern; durable snapshots
for every historical Session should not be the default solution.

## 2. Performance: improvements and costs

The useful improvements are real:

- Warm game commands no longer load the full live catalog on every draw/projection.
- Room/Couch caches check a small authoritative revision before full hydration.
- Remaining-pool counts are reused for the same runtime revision.
- Eligibility builds history lookup and merged boundaries once per pool, replacing
  repeated per-Card history scans.
- Room departure/closure updates use hot runtime fields without loading the catalog or
  complete appearance history.
- Policy scope clocks and conditional writes prevent the tested lost updates.

However, a new game still queries all active Cards with a usable localization, constructs
and freezes the catalog, hashes it, compiles policy, and encodes/compresses immutable
payloads. Sharing happens late:
[TypeOrmCardRepository.snapshot](../../packages/persistence/TypeOrmCardRepository.ts#L27)
queries and builds the view before interning it;
[externalizeSessionImmutableState](../../packages/persistence/sessionImmutablePayloadStore.ts#L186)
encodes it before the database existence check in `persistEncodedPayload`.
Identical data avoids repeated inserts, but still incurs substantial repeated work.

Bounded probes against the actual source adapters used 600 Cards, 722,401 serialized
catalog bytes, Node 24.13.0 and in-memory SQLite 3.53.2:

| Operation                                                                          | Observed result                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| First catalog snapshot                                                             | 14 SQL statements; 43.83 ms                                        |
| Identical repeated snapshot                                                        | Same frozen array returned, but still 14 SQL statements; 40.05 ms  |
| Requested locale plus 100 fallback locales, usable text only in the final fallback | 314 SQL statements; 234.54 ms                                      |
| First catalog + compiled-policy persistence                                        | Two synchronous Brotli calls; 58.43 ms                             |
| Identical second persistence                                                       | Zero added chunks, but two more synchronous Brotli calls; 57.33 ms |
| Compilation with empty Session policy                                              | 3.21 ms                                                            |
| Compilation with 1,000 Session exact overrides                                     | 90.15 ms                                                           |

SQL counts include transaction statements. The fallback probe registers 101 active
locales but provides Card renderings only in English. These are diagnostic measurements
from one bounded run, not deployment throughput or tail-latency benchmarks. They exclude
HTTP handling, production storage/network latency and multi-viewer fan-out.

The compiler also retains expensive pre-existing behavior:
[resolveCardPolicy](../../packages/game-core/policies/cardPolicy.ts#L269) reconstructs the
Session exact-policy map and Session availability rules for each Card;
`applyScope` copies and sorts rules for each Card/scope. Consequently compilation includes
work proportional to `Cards × SessionExactOverrides`, plus repeated rule evaluation and
sorting. Discarding the final provenance object does not eliminate the allocations used
to produce it.

JSON encoding, hashing and synchronous Brotli run on the server's main JavaScript thread.
They can delay unrelated Rooms while a game starts. Two simultaneous starts limit how
many preparations are admitted, but do not make their synchronous work asynchronous or
place a time budget on one preparation. This is consistent with
[Node's guidance on blocking operations](https://nodejs.org/learn/asynchronous-work/dont-block-the-event-loop).

For a small installation, the added start-up work may be an acceptable delay, and warm
gameplay should benefit. The bundled catalog currently has 1,940 Cards, with 132,043 bytes
of German text in total and a maximum German rendering of 262 bytes; it is far below the
new catalog budgets. There is nevertheless no measured before/after end-to-end latency
comparison establishing the exact tradeoff on low-power hardware.

For a large deployment, repeated catalog construction/compression, synchronous policy
compilation and database round trips become material. The changes improve warm steady
state but are not sufficient evidence that many simultaneous games will scale well.

## 3. Memory limits and admission do not describe total process memory

[SessionCache](../../packages/application/sessionCache.ts#L5) charges each Session for
three times its catalog's serialized size, even when every Session shares the same frozen
catalog object. It also charges compiled entries, history and a fixed overhead.

This errs toward early rejection/eviction but does not measure real retained memory. The
600-Card probe admitted only **57** active ephemeral Sessions sharing the same 722,401-byte
catalog before returning `SESSION_CAPACITY_EXCEEDED`. It charged 132,864,606 bytes. That
number is accounting weight, not observed heap use. A catalog close to 32 MiB alone is
charged about 96 MiB per Session, making two such games exceed one service's 128 MiB budget
despite catalog sharing.

The consequences differ by persistence mode:

- Active ephemeral Couch games cannot be evicted, so additional games are refused. They
  have no new inactivity expiry; abandoned games can hold capacity until they end or the
  process restarts. A growing active game's subsequent command can also exceed admission
  weight rather than benefiting from a resource reservation made at creation.
- Recoverable Sessions are evicted. At higher active-game counts, ordinary requests can
  repeatedly load appearances, decompress compiled policy/Group history and rebuild
  runtime. A large catalog therefore creates a cache-thrashing risk.
- The shared catalog cache, Room cache and Couch cache have separate limits. They are not
  one server-wide memory budget. Active references can keep catalogs alive after they
  leave the shared LRU.
- Hydration, encoding strings/Buffers, query results, compiled effective-card arrays,
  per-viewer projections and queued work are outside the retained-cache accounting.

The global start limiter is a fixed **two in-flight starts per process**. It is not an
active-game quota, a sustained request-rate limit, or fairness between owners. It does
not cover previews, cold reloads, ongoing history work or deployment-wide concurrency.
Increasing process count multiplies its aggregate allowance.

History still grows with game length. `GameSession.toRuntimeState()` copies every
appearance and expands Group-history IDs; `restore()` rebuilds those collections.
[Couch recovery](../../packages/persistence/TypeOrmCouchSessionRepository.ts#L38) and
[Room recovery](../../packages/persistence/TypeOrmRealtimeRoomRepository.ts#L541) load the
whole appearance list. These costs are not bounded by the number of current Cards, because
repeatable Cards can generate arbitrarily many appearances.

WebSocket refresh also still requests a snapshot once for the Room and once per peer.
Revision/count caching helps, but participant/settings/boundary queries, viewer projection
and serialization remain repeated. A fan-out and cold-cache benchmark is still needed.

## 4. Database growth remains unbounded

**Yes, the database can continue filling up.** No finite retention or storage quota was
added for finished Session rows, appearances, catalog payloads, compiled payloads or
frozen Group-history payloads.

The changes add a third immutable payload kind. Best-case deduplication stores one
localized catalog shared across Sessions and policy variants. It does not create a
copy for every identical game. Nevertheless:

- One changed Card text changes the digest of the **whole catalog array**. In the probe,
  a one-Card edit resulted in two retained catalog payloads totalling 1,444,810 raw bytes
  and 541,319 compressed bytes. Chunks are storage framing, not independently deduplicated
  content blocks.
- Catalog releases and differing locale/fallback results create further catalog views.
- A policy revision change with identical effective values still creates another whole
  compiled payload, because revision provenance is included in that payload's digest.
  The probe confirmed one extra compiled payload for this case.
- Frozen Group-history payloads reference the compiled digest. Different histories or
  compiled digests can produce further payloads.
- Finished Sessions retain their payload references. Deleting only orphan payloads would
  not reclaim data still referenced by these historical runtime rows.
- Deleting an owning account/DataSpace does not itself run immutable-payload garbage
  collection. Chunk rows cascade when their parent payload is deleted, but there is no
  general operation that finds and deletes unreferenced payload parents.

An approximate storage model is:

`current normalized catalog + Σ distinct catalog views + Σ compiled snapshots + Σ history snapshots + Session/Room/appearance rows`

Payload bytes are Base64 text, adding roughly one third to compressed data before database
row/index overhead. The 32 MiB uncompressed ceiling is not a 32 MiB database ceiling. The
loader's allowed compressed maximum of 32 MiB + 64 KiB corresponds to up to 1,368 chunks
and about 42.75 MiB of Base64, before metadata and indexes. This is a format upper bound,
not a measured compression ratio for real Cards.

Those limits apply to individual payloads; there is no limit on the lifetime number of
distinct payloads. Backups and database logs add operational storage beyond these rows.
Thus the Phase 3 implementation did not meet a broad interpretation of “no excessive
data even in worst cases.” It bounded some individual allocations/writes while leaving
cumulative retention open.

Group history itself does **not** block catalog reconciliation. The importer updates
wording/metadata under stable UUIDs, soft-disables removed content and adds new IDs.
History can exclude a previously seen Card ID in a later game; that is the intended
deduplication rule, not a catalog-version lock. New Card IDs remain candidates. Ordinary
wording/translation updates retain identity. A catalog-lineage replacement uses the
existing history-epoch rule. None of these behaviors requires preserving every old
catalog rendering in Session payloads.

## 5. Reproduced correctness and database gaps

### A. SQLite transaction coordination is incomplete

The new [transaction helper](../../packages/persistence/transaction.ts#L8) serializes
operations using that helper. Several other paths still call `DataSource.transaction()`
directly, including
[UserService](../../apps/server/src/modules/database/services/UserService.ts#L481),
Group deletion and installation reset. Direct repository operations can also share the
connection while an asynchronous transaction is active.

A two-row in-memory probe reproduced:

1. A helper-managed transaction writes row A and waits.
2. A direct read sees A before commit.
3. A separate direct transaction writes B and reports success.
4. A is rolled back; **B disappears too**.

The second transaction became a nested savepoint on the shared connection. This is not
evidence that SQLite transactions are inherently weak; it is incomplete application
ownership of that connection. SQLite explicitly documents
[no isolation between operations on one connection](https://sqlite.org/isolation.html).
All relevant operations must participate in one transaction/connection ownership model,
including reads that need coherent isolation. The current helper is a partial fix.

### B. Starting a Session can retain a departed player

Reproduced with the actual Room service/repository on **SQLite and MariaDB**:

1. The Host starts a game using the connected Host/Guest roster.
2. An independent repository commits the Guest's departure before initial runtime commits.
3. The Host is still authorized, so `commitRuntime` succeeds.
4. The Guest's participant row says `LEFT`, but the newly stored Session still includes it.

[The start service](../../packages/application/roomService.ts#L711) reads players before
catalog work. [The initial commit](../../packages/persistence/TypeOrmRealtimeRoomRepository.ts#L674)
checks current Session absence and the actor's authority, but does not revalidate the
entire proposed starting roster. Departure has no existing Session to reconcile at that
point. This can strand a turn or an answer requirement on a departed player.

The ordinary single-service per-Room queue prevents this interleaving between commands
that all use that queue. The probe deliberately uses an independent lifecycle writer,
which matters to the claimed repository/multiple-writer guarantees. Initial creation
needs roster/consent validation under the Room lock, or an expected Room setup revision
covering those inputs. Existing-runtime CAS and the tested atomic departure/closure work
should remain.

### C. Valid Card text is not bounded consistently across databases

The catalog contract has no `maxLength` for Card text, and the
[localization entity](../../packages/persistence/entities/card/CardLocalizationEntity.ts#L9)
uses `TEXT`. A **65,536-byte** ASCII rendering passed the actual catalog validator and
was stored in full by SQLite.

On the configured MariaDB 10.4.32 server, the insert reported success but stored only
**65,535 bytes** in its non-strict SQL mode. With `STRICT_ALL_TABLES`, the same value
failed with `ER_DATA_TOO_LONG`. This tests the actual database column behavior; it does
not claim a full production importer run for that fixture. The behavior agrees with
the [MariaDB TEXT limits](https://mariadb.com/docs/server/reference/data-types/string-data-types/text).

This mismatch predates Phase 3, but Phase 3 does not solve it. Freezing a database view can
preserve already-truncated text under provenance naming the original artifact. Catalog
acceptance, storage and outgoing Card-text limits need one explicit supported byte budget
and strict write behavior.

The new 256-Card read page is also bounded by **row count**, not text bytes. It materializes
selected localizations before `FrozenCatalogBudget.add()` checks them. With unbounded
SQLite text, a page can exceed the intended memory budget before the guard runs. Artifact
loading itself still reads/parses the complete file before these Session guards apply.

### D. Public database migrations are not one rollback boundary

Both new migrations mix schema alteration and data changes. Startup requests TypeORM
`transaction: "all"`, but MariaDB/MySQL DDL causes implicit commits. A small MariaDB probe
inserted a row, executed `ALTER TABLE`, then threw and rolled back: the row remained.
See the primary [MariaDB](https://mariadb.com/docs/server/reference/sql-statements/transactions/sql-statements-that-cause-an-implicit-commit)
and [MySQL](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html) documentation.

This establishes a platform limitation, not a reproduction of every partial migration
failure. It means a failure partway through `FreezeSessionCatalogs` can leave schema/data
progress behind. Its unconditional column additions and v5-only row expectation do not
form a resumable migration protocol. Processing 25 rows at a time limits a result batch,
not transaction duration, total rewrite cost or bytes per row. Successful migration tests
are insufficient evidence for interruption/disk-full recovery.

### E. Transport and broader operational limits remain unresolved

F09/F11's supported native snapshot and policy body sizes were not fixed by this phase.
Keeping the frozen catalog off the wire is good, but a large current Card, roster, voting
projection or Session policy can still exceed client/adapter limits. F06/F14/F15 retention,
history, preview and fan-out work also remains. Those pre-existing issues must not be
described as newly introduced by Phase 3, nor as solved by its cache/chunk guards.

The new probes ran on SQLite 3.53.2 and MariaDB 10.4.32. MySQL was reviewed in source and
official documentation, not executed. No result here certifies every database version,
SQL mode, packet configuration, crash schedule or resource-exhaustion condition.

## 6. Future catalog extensions

### More Cards

The new 50,000-Card and 32 MiB limits are intersecting hard admission limits. They are
not part of the producer schema's Card-count/text bounds, and the startup importer does
not preflight every runtime locale view against them. A release can therefore install
successfully while making new games fail at Session creation.

The reader includes all active Cards with a selected rendering before mode/profile
eligibility is applied. Even a small intended playable subset can be rejected because
the broader localized catalog is too large.

At 50,000 Cards, the JSON ceiling allows about **671 bytes per Card including metadata**.
For the probe's Card shape, metadata plus separator uses 421 bytes, leaving about
**250 text bytes per Card on average**. Illustrative capacities with the same metadata:

| Text per Card                             | Approximate Card count before the 32 MiB guard |
| ----------------------------------------- | ---------------------------------------------: |
| 4,000 ASCII bytes                         |                                          7,589 |
| 4,000 CJK characters / 12,000 UTF-8 bytes |                                          2,701 |

These are arithmetic illustrations; no oversized catalog was generated. Different
metadata and JSON escaping change the exact result. Raising the constants alone would
increase CPU, memory and storage exposure.

### More languages

Each Session catalog contains one selected rendering per Card, so adding languages does
not automatically multiply that Session's payload. The normalized catalog does grow by
its additional renderings. Once games use different languages/fallback results, complete
localized snapshots can multiply retained storage, including repeated language-independent
Card metadata.

Completing translations can also increase a language's selected membership past the
runtime cap without adding any new logical Cards. Long fallback chains add queries:
with 50,000 selected Cards, 256-Card pages and usable text only at the end of the maximum
101-locale search order, the reader's structure permits roughly **20,193 SQL statements**
per snapshot in SQLite, versus 593 for an exact locale. This is derived from the query
structure, not a 50,000-Card load test.

The frozen Session payload contains only its chosen text. A future feature that changes
Card language during an active game would need a same-generation locale view and explicit
membership rules; the saved single-language blob cannot supply another rendering.

### More metadata or new catalog contracts

Larger Card representations consume the JSON budget even if text length stays constant.
New gameplay fields need mapper, frozen payload/runtime and compatibility decisions.
Archived per-Session catalogs increase this migration burden. A current-generation catalog
provider lets a new server use its new schema while terminating incompatible active games,
without maintaining an unnecessary archive decoder.

## 7. Recommended correction before treating Phase 3 as complete

1. **Resolve catalog lifetime first.** Adopt startup-generation catalog stability and
   invalidate active games on a catalog change. Retain same-fingerprint crash recovery
   only if wanted. Update F07 acceptance criteria and the relevant ADR/contracts.
2. **Keep F08/F12 and the atomic lifecycle work.** Fix shared SQLite connection ownership
   and the initial Room roster race; add the newly reproduced cases to regression tests.
3. **Remove the unnecessary durable full-catalog snapshot path.** Share current catalog
   locale views in memory. Preserve policy consistency and stable-ID history independently.
   Revise the unpublished migration accordingly; installations that have applied it need
   an explicit forward migration rather than an edited migration history.
4. **Give transient runtime a terminal cleanup rule.** Retain required appearances/Group
   history, detach unnecessary ended-runtime payload references, and garbage-collect
   unreferenced payloads. Orphan cleanup alone is insufficient while ended rows retain them.
5. **Define supported content/transport bytes together.** Preflight releases, bound each
   rendering and decoded page before allocation, enforce strict database writes, and
   coordinate Phase 4's native and HTTP limits.
6. **Measure shared resources accurately and bound expensive work.** Charge shared catalog
   memory once, reserve room for active games to progress/end, expire abandoned ephemeral
   games, precompute policy indexes/sorted rules, and use measured CPU/admission budgets.
   Benchmark warm/cold gameplay, long history, fallback chains and fan-out on intended
   low-power and public-deployment hardware.

This is a proposal from the review, not an implemented redesign. It preserves the actual
consistency fixes while removing a storage obligation that the clarified product does not
need. The current design should not be extended merely by increasing its numeric limits.

## 8. Evidence and scope of verification

The earlier 501-test suite, native checks and browser audits remain evidence for their
covered cases. They were not rerun during this analysis and are not worst-case capacity
measurements. This review ran additional bounded probes directly against the source:

- `node .tmp/phase-3-analysis-probes.cjs > .tmp/phase-3-analysis-probes.json`
  — completed; in-memory SQLite only, 600 synthetic Cards and small concurrency fixtures.
- `node .tmp/phase-3-analysis-mariadb.cjs > .tmp/phase-3-analysis-mariadb.json`
  — completed; configured disposable schema created only when absent and removed afterward.
  An initial attempt to create a separately named schema was denied by database privileges;
  the successful run used the authorized test schema without replacing existing data.
- `node .tmp/phase-3-catalog-shape.cjs > .tmp/phase-3-catalog-shape.json`
  — completed; aggregate inspection of the existing catalog and arithmetic capacity estimates.

The scripts print aggregates, not Card text, credentials or participant tokens. No
oversized catalog, disk-fill test, sustained traffic load, persistent SQLite database or
production schema change was generated. Probe scripts/JSON remain ignored local artifacts;
this report records the findings and measurements so they remain reviewable.
