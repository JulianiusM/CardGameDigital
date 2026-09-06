# Corrective Phase 6 — retention and operational budgets

This implements F06, F14 and F15 from the [implementation review](implementation-review-2026-09-05.md),
after evaluating the [Phase 3 analysis](corrective-phase-3-analysis-2026-09-05.md),
[Phase 3 rework](corrective-phase-3-rework-2026-09-06.md),
[Phase 4](corrective-phase-4-2026-09-06.md) and
[Phase 5](corrective-phase-5-2026-09-06.md) decisions.
Runtime v7, complete metadata scans, captured sparse policy,
ordinary cooldown weighting, same-catalog recovery and stable-ID Group history remain.
There is no catalog archive, finite draw window, save-and-quit or protocol downgrade.
WebSocket v4 and its 4 MiB native receive contract remain compatible.

## Configuration follow-up

All operational limits and timeouts described below are **defaults**, configurable
through environment variables or the existing CSV settings file. See the complete
[operational settings reference](../contracts/operational-settings.md) for names,
units, defaults and validation rules. The initial hard-coded operational caps have
been replaced with validated settings and resource-policy injection. Protocol and
storage-format byte boundaries retain their existing contracts.

Configuration applies on restart. Existing Room expiry timestamps, Couch activity
timestamps, terminal timestamps, optimistic revisions and shared-policy references
remain authoritative. Lower game-count capacity prevents new admission without deleting owned
history or invalidating an already admitted game. Queue reservations are validated
against configured participant/connection capacity so disconnect cleanup can finish.

## Retention and admission

- Room and Couch caches still allow 128 entries / 128 MiB estimated data each. A minute
  maintenance task now removes idle entries even if no more requests arrive. Active
  unsaved Couch games expire after 24 idle hours or server restart. Their ended summaries
  remain cached for up to 15 minutes, subject to capacity eviction; reads do not extend that window.
- Saved Couch games end after 24 hours without a committed command. The persisted
  `last_active_at` timestamp survives restart. Expiry increments the authoritative
  revision, erases active private state and detaches sparse inputs. Saved Session and
  Group appearances remain available as owned history.
- The existing Room lifecycle still closes expired/abandoned Rooms transactionally.
  After 15 minutes, maintenance purges closed unowned Rooms and their dependent rows.
  Detached ended Sessions in a reused unowned Room have the same retention. Live Room
  snapshots, owned history and replay tombstones are preserved.
- Each maintenance pass processes at most 16 records per category and collects at most
  16 unreferenced immutable payloads. Ticks do not overlap. Startup runs the same work
  before listening; timestamp cutoffs are never restarted by migration or recovery.
- A database admission lock limits retained temporary Rooms plus open owned Rooms to
  256, active saved Couch games to 128, and temporary Session records per Room to 32.
  Closed temporary records occupy their slots until cleanup. This also bounds rapid
  create/end cycles between sweeps. Existing installations above a limit can continue
  and end games; additional creation waits for capacity. Idempotent create replay still
  resolves before admitting a new record.

Saved appearances, historical logical Cards, policy scopes and operator backups are
intentional durable data. They are not automatically deleted to meet a transient-game
quota. Owners delete their DataSpace/history through existing account flows; operators
must provision disk and apply a finite backup policy. Logical deletion does not reclaim
SQLite free pages, WAL or external backups immediately.

The resumable `1787363000000-BoundGameRetention` migration adds the admission row,
Couch activity timestamp and retention indexes. Existing Couch timestamps start from
their original start time, so abandoned games receive no new lease. Downgrade requires
the matching backup; deleted temporary records cannot be reconstructed.

## Expensive work and delivery

The existing two starts / four scans / two policy decodes / one import limits remain.
Policy preview, search and bulk operations share two work slots, leaving scan capacity
for gameplay. Slots remain occupied until work settles, even after client disconnect.
Imports likewise retain their slot through the actual transaction.

Ordinary game HTTP requests share eight process-wide slots reserved before JSON body
parsing, with two additional slots for Couch end requests. Async adapters retain these
reservations after client disconnect until the work settles. This prevents repeated
aborted requests from bypassing the in-flight budget. Rejection uses the existing
localized `SESSION_CAPACITY_EXCEEDED` error and `Retry-After: 1`. Import keeps its
separate authenticated parser and single work slot.

Public enforced deployments additionally apply these fixed windows:

| Work                        | Limit                                                                             |
| --------------------------- | --------------------------------------------------------------------------------- |
| Couch/Room creation         | 60 per account or anonymous address per 15 minutes; 120 process-wide              |
| Card-policy requests        | 60 per account or anonymous address per minute; 600 per address; 240 process-wide |
| Existing Couch requests     | 120 per game per minute; end remains available                                    |
| Room creation address guard | 120 per 15 minutes                                                                |
| Room joins on one address   | 2,000 per 15 minutes, allowing the supported shared-LAN roster                    |

Rate rejection is localized `429 RATE_LIMITED` with `Retry-After`. Work/capacity
rejection remains `SESSION_CAPACITY_EXCEEDED`. Limiter identity tables are capped at
10,000 entries without evicting live limits; pruning is amortized. Public development
continues to disable abuse-rate controls. Resource bounds apply in every deployment.
Logs contain operation/reason/count/duration aggregates, never keys or private inputs.

Couch command queues allow 16 pending operations per game / 256 per service. Room
queues allow 1,024 per Room / 2,048 per service, within the existing transport byte
caps. Couch reserves two extra terminal slots per game / 16 per service. Room lifecycle
and terminal work reserve 1,024 extra slots per Room / 2,048 per service, sufficient to
record disconnects for the supported maximum of 2,000 simultaneous process connections.
At most 32 WebSocket authentications run concurrently. Clients have five seconds to
submit hello; admitted authentication has 30 seconds. Overload closes with retryable 1013. A socket lost during authentication cannot leave a false connected participant.

Broadcasts encode public roster/settings/voting bytes once and each viewer's controls
separately, using two text fragments that form one complete v4 JSON message. Presence
uses one encoding and skips unchanged deliveries. Fan-out yields after 16 recipients
or 4 MiB of queued bytes. New gameplay interrupts obsolete ambient presence/snapshot
fan-out; explicitly request-correlated snapshots still finish. Validated small
authenticated heartbeat pings bypass queued game work, retaining public rate checks.
Ordinary
reconnections receive their own snapshot immediately and coalesce shared refreshes;
role-change ordering remains explicit. Reconnect lifecycle commits save only changed
participants and reconcile Session membership when a terminal transition requires it.
All these changes preserve the existing complete v4 envelopes and privacy projection.

## Verification

`npm run benchmark:operations` uses an in-memory SQLite database, the actual repositories,
engine and WebSocket adapter, plus loopback clients. It exercises the bundled 1,940-Card
catalog and 50,000 normalized Cards, 100,000 persisted appearances, cold reconstruction,
deterministic draws, 100/1,000 connected devices, reconnect waves and repeated draws/votes.
It reports query counts, command-to-all-recipient latency, received bytes and managed
heap growth. No production database or disk-fill fixture is created.

Acceptance budgets for this workstation probe are five seconds per command-to-all-client
delivery at 100 peers, and 30 seconds at 1,000 peers,
120 seconds for reconnect waves of 20 devices, less than 256 MiB heap growth,
at most `4 × ceil(C / 256) + 50` cold-read queries and
`8 × ceil(C / 256) + 200` draw queries. Voting must remain below 150 queries with no
catalog scan, regardless of catalog/history size. Full-snapshot bandwidth still grows
with roster and peer count. These are executable regression budgets, not a promise of
equivalent latency on low-power hardware or over a public network. A 1,000-peer update
with 40-character CJK names transfers roughly 650 MiB across all recipients. The initial
20-second experimental ceiling at maximum capacity was too tight for this full-snapshot
traffic; the measured capacity-specific budgets preserve v4 and tighten the default-room
budget instead of claiming the same latency at both sizes.

The complete four-scenario benchmark passed on Node v24.13.0 / Windows, an Intel
Core i7-5930K at 3.50 GHz and 64 GiB RAM. Each row includes five draws and five votes,
with 100,000 persisted appearance records:

|  Cards | Peers | Cold restore | Reconnect wave | Slowest draw | Slowest vote | Peak heap growth |
| -----: | ----: | -----------: | -------------: | -----------: | -----------: | ---------------: |
|  1,940 |   100 |        42 ms |         1.11 s |       237 ms |       203 ms |           18 MiB |
|  1,940 | 1,000 |        51 ms |        57.53 s |      11.78 s |      13.14 s |          104 MiB |
| 50,000 |   100 |       754 ms |         0.90 s |       1.71 s |       202 ms |           29 MiB |
| 50,000 | 1,000 |       789 ms |        55.62 s |      24.54 s |      11.61 s |           72 MiB |

Cold reads used 42 / 794 queries at 1,940 / 50,000 Cards, respectively, independent
of peer count. Draw windows used 107–113 / 1,611–1,619 queries; voting windows used
37–43 with no catalog reads. An ordinary 1,000-peer command window received about
652 MiB of JSON; the first 50,000-Card draw window received 1.26 GiB when reconnect
refresh traffic overlapped. The reported slowest draw includes that overlap. Memory
is sampled managed heap growth relative to the already loaded fixture, not total
process RSS or OS/socket memory. Physical Kodi/phone hardware and public-network
latency remain deployment validation work.

Initial Phase 6 checks, before the configuration follow-up:

- `npm run build`: passed; Svelte reported no errors or warnings.
- `npm run typecheck:test`: passed.
- `npm run format:check`: passed, including Kodi static checks.
- `git diff --check`: passed.
- `npm test`: 555 passed; one opt-in catalog/MariaDB test skipped (72 files passed,
  one skipped). SQLite and public-mode MariaDB retention tests ran successfully.
- `npx vitest run tests/unit/game-work-limits.spec.ts --bail 1`: five passed,
  including admission before parsing, localized quotas, reserved end capacity and
  retention of an aborted request's slot until its work settles.
- `npm run benchmark:operations`: all four scenarios passed, as measured above.
- `npm run kodi:check`: generated artifacts/static checks passed; 280 Python tests passed.
- `npm run e2e:couch -- couch-recovery.spec.ts party-screen.spec.ts --workers=1`:
  all 23 browser tests passed, including overload recovery and existing shared-display,
  voting, reconnect, Host-transfer and Room-reuse behavior.

The earlier broader command
`npm run e2e:couch -- couch-mode.spec.ts couch-recovery.spec.ts party-screen.spec.ts --workers=1`
passed 56 tests and failed one existing animated-backdrop geometry assertion (60.116 px
against a less-than-60 px assertion). Its unchanged isolated retry,
`npm run e2e:couch -- couch-mode.spec.ts --grep "Golden Mischief uses warm" --workers=1`,
passed. No visual assertion or motion styling was weakened. The affected recovery flow
was also visually inspected at 1,280 px desktop and 320 px phone widths for layout,
contrast, focus, touch targets, overflow and preservation of the active-game reference.

Retention regressions exercise 800 cache create/end cycles, database create/expire
cycles with fresh maintenance workers, competing admissions for the final Room slot,
reused-Room cleanup, saved Group history and reference-safe shared policy collection.
Transport tests preserve complete v4 privacy projections and native receive capacity,
and verify that authenticated heartbeat replies remain responsive during blocked work.

## Configuration follow-up checks

- `npx vitest run tests/unit/configuration.spec.ts tests/unit/game-work-limits.spec.ts tests/unit/session-budgets.spec.ts tests/unit/couch-session-service.spec.ts --bail 1`:
  55 passed. Every operational setting loads from CSV and can be overridden by the
  environment; invalid numbers, timer overflow and incompatible cleanup/queue budgets
  are rejected. Non-default rates, retry windows, work slots and cache lifetimes are
  exercised through their consumers.
- `npx vitest run tests/integration/boundary-persistence.spec.ts tests/integration/public-mode-mariadb.spec.ts tests/integration/websocket-rooms.spec.ts tests/unit/stored-json.spec.ts --bail 1`:
  152 passed, covering configured admission/inactivity in SQLite and MariaDB,
  shared scan/codec concurrency, and WebSocket connection/message admission.
- `npm run e2e:couch -- couch-recovery.spec.ts --workers=1`: seven passed.
- `npm run build`, `npm run typecheck:test`, `npm run format:check` and
  `git diff --check`: passed.
- `npm test`: 574 passed and one opt-in catalog/MariaDB test skipped (72 files
  passed, one skipped). Both configured SQLite and public-mode MariaDB cases ran.

The full-suite run also covers localized rejection of a configured policy-byte budget
without partial writes.
The four benchmark measurements and 280-test Kodi run above predate this follow-up;
those separate commands were not repeated for the settings change. Defaults, complete
v4 messages, and native receive capacity remain covered by the regression suites.
