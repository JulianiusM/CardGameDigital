# Corrective Phase 4 — wire capacity and policy transfer

This implements F09 and F11 from the [implementation review](implementation-review-2026-09-05.md),
after evaluating the newer [Phase 3 analysis](corrective-phase-3-analysis-2026-09-05.md)
and [rework](corrective-phase-3-rework-2026-09-06.md).

## Design precedence

The rework already established 4 MiB ordinary messages, a separately admitted 64 MiB
policy-import endpoint, bounded WebSocket queues and bounded Card text. Those decisions
are retained. Sessions continue using runtime v7, live normalized catalog metadata,
complete candidate scans, sparse captured policy and stable-ID history. This phase adds
no frozen catalogs, per-game catalog copies, compiled catalogs, delivery pages or larger
transport limits. Rule previews remain optional.

One compatibility decision changes for a concrete reason: keeping v3 could not identify
clients capable of receiving the larger messages. Early native v3 clients accepted only
64 KiB, and even the reworked decoder still rejected more than 500 participants and
presence entries. A live server-to-Python capacity regression reproduced the latter.
Protocol **v4** therefore guarantees the shared receive allowance and supported Room
ceilings. Native release **0.4.0**, server and browser select v4 together. Versions 1–3
are retired; no legacy fallback or silent state truncation is introduced.

## Implemented behavior

- Shared/generated definitions cover 4,194,304 bytes per complete WebSocket message,
  1,000 participants, 1,000 represented players and 128-character request IDs. The
  default Room ceilings remain 100. Configuration and boundary taxonomy lists contain
  unique declared enum members, preventing repeated inputs from defeating the budget.
- Native snapshot and presence validation use the shared participant ceiling. Fragmented
  messages count aggregate UTF-8 bytes; an oversized continuation is rejected before
  its body is read. Diagnostic size messages use the actual shared limit.
- The import parser retains its ownership check and separate 64 MiB allowance, including
  case-insensitive routes and optional trailing slashes accepted by Express. Ordinary
  requests retain the rework's 4 MiB allowance.
- Export and import share the portable v2 schema. Unsupported packages, missing Card
  references, malformed JSON and excessive body bytes have actionable German/English
  errors. Both parser locations return the same `PAYLOAD_TOO_LARGE`/`VALIDATION_ERROR`
  contract; size errors include the permitted byte count, without returning input.
- Browser imports check file size before reading and validate the package before
  replacement confirmation. Import and Session draft failures remain readable in an inline, focused
  Golden Mischief panel. Cancel preserves policy; changing scope clears pending import
  state. Session drafts are checked before persistence, and adding rules stops at 250.
- Existing counts remain 250 rules, 1,000 Session exact overrides and 50,000 portable
  exact overrides. Long Unicode names, maximum predicates, mixed directives, envelope
  overhead and JSON escaping participate in the capacity checks.

HTTP remains v1, portable policy remains v2, catalog remains v2 and runtime remains v7.
No database migration is added. The [HTTP](../contracts/http-api.md),
[WebSocket v4](../contracts/websocket-v4.md), release and architecture documentation
record the compatibility impact; v3 remains historical documentation.

## Evidence and limits

The tests exercise maximum Session settings over a real WebSocket command and a native
HTTP Couch create/recovery round trip. A live Python WebSocket client receives real
server projections with 1,000 participants and 1,000 players, maximum Card text, 250
rules and 1,000 overrides. Outgoing messages are fragmented at byte boundaries, including
inside Unicode text. The client requests a fresh snapshot and verifies identical state,
both during private vote collection and after all 1,000 named answers are revealed.
Native tests also cover maximum presence, exact-limit decoding, one byte over the limit,
and outgoing/fragment admission.

A 50,000-override document traverses the actual Express export and import routes, with
the repository boundary substituted to isolate transport capacity. A separate 1,500-Card
round trip exercises the actual SQLite repository and optimistic import revisions.
The test database is in memory; no 50,000-Card catalog or disk-fill fixture is generated.
These checks establish document/adapter capacity, not sustained fan-out throughput or
low-power hardware performance. The Phase 3 operational and deployment limitations remain.

Browser audits cover English and German at 1280- and 320-pixel widths, import errors,
long filenames, Session rule/override limits, keyboard focus, cancel/retry, overflow,
touch targets and navigation. Rejected Session additions preserve the stored draft and
permit subsequent edits to existing rules.
Screenshot inspection found clipped toast guidance and led to the inline error panel.

## Verification

| Exact command                                                                                                                                                                           | Result                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `npm run generate`                                                                                                                                                                      | Passed; shared native artifacts and database index current            |
| `npm run build`                                                                                                                                                                         | Passed; server build, Svelte checks (zero errors/warnings), web build |
| `npm run typecheck:test`                                                                                                                                                                | Passed                                                                |
| `npm run format:check`                                                                                                                                                                  | Passed, including Kodi static checks                                  |
| `npx vitest run tests/integration/policy-transport.spec.ts tests/integration/websocket-rooms.spec.ts tests/unit/runtime-capacity.spec.ts tests/unit/card-policy-draft.spec.ts --bail 1` | 37 passed                                                             |
| `npm test`                                                                                                                                                                              | 532 passed; 1 opt-in test skipped                                     |
| `npm run kodi:check`                                                                                                                                                                    | 280 native tests and static checks passed                             |
| `npm run e2e:couch -- --grep "Card policy\|Card management" --workers=1`                                                                                                                | 6 Chromium tests passed                                               |
| `git diff --check`                                                                                                                                                                      | Passed                                                                |

The opt-in MariaDB catalog-installation test was not enabled for this run; catalog
installation is unchanged by this phase. No sustained load or target-device benchmark
was run. The native capacity probes use CPython and the actual native transports against
local integration servers. Their standard input explicitly uses UTF-8 on Windows so
console encodings cannot alter the Unicode fixtures. The replacement-order regression
awaits each client's fresh snapshot before checking event order, respecting the Phase 3
broadcast scheduling.
