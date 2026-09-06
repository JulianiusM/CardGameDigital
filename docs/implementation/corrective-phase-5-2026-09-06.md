# Corrective Phase 5 — recovery and actionable errors

This implements F13 and F16 from the [implementation review](implementation-review-2026-09-05.md),
after evaluating the [Phase 3 analysis](corrective-phase-3-analysis-2026-09-05.md),
[Phase 3 rework](corrective-phase-3-rework-2026-09-06.md) and
[Phase 4 implementation](corrective-phase-4-2026-09-06.md).

## Design precedence

Recovery reads the currently available authoritative game. Runtime v7, the live
normalized catalog, complete candidate scans, sparse captured policy and stable-ID
history remain unchanged. Same-catalog recovery follows the existing lifecycle;
incompatible catalog installation can still end active games. There is no save-and-quit,
catalog archive or mutation replay. Rule previews remain optional. Phase 4's WebSocket
v4/native 0.4.0 and transport limits remain unchanged.

The older review mentioned missing-rule errors as well as conflicts. Phase 3 explicitly
made removed mutation rows conflicts to protect the scope clock. This implementation
retains **409 POLICY_REVISION_CONFLICT** for removed rules, with a specific localized
message, rather than reverting that newer decision to 404.

## Implemented behavior

- Couch keeps its browser Session reference through network failures, timeouts,
  server errors, unrelated 404s, malformed snapshots and authorization failures.
  Only `404 SESSION_NOT_FOUND` clears it automatically; existing deliberate reset
  actions still clear it. The setup guard lets a surviving game reference reach
  recovery even if setup state is absent.
- A lost or failed command response, including a stale revision, causes an uncached
  authoritative GET. Controls stay suspended until a valid matching snapshot arrives.
  Neither automatic nor explicit recovery retries a command or creates a game.
- Reads and existing-Session commands have a 10-second browser deadline. A recovery
  cycle permits three reads with 2- and 4-second delays. Manual retry or an online
  event starts another cycle; authorization failures wait for deliberate retry.
  Component disposal cancels recovery reads, timers and the online listener.
- Shared browser errors retain HTTP status, stable code and server message. A shared
  Couch snapshot decoder rejects incomplete success responses before their revision
  reaches gameplay. It reuses the public game/voting schemas, preserving privacy.
- Policy conflicts, changed bulk-match counts, removed rules, invalid ordering and missing Cards/Groups use
  exported localization keys. Foreign and nonexistent Group IDs return identical
  localized 404 responses. Failed rule mutations leave the scope clock unchanged.
- Focused inline policy errors offer an explicit reload, scope selection, or Account
  with retry. Conflicting edits remain available until reload replaces them. Scope
  changes hide the old editor until loading succeeds, preventing writes under the
  wrong displayed scope. Initial loading failures can be retried.
- Account recovery links open separately. Policy recovery never changes an active
  game's captured policy. English/German help and the HTTP contract describe the
  behavior. HTTP codes/statuses and wire fields remain compatible.

## Verification

| Command                                                                                                   | Result                                            |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `npm run build`                                                                                           | Passed; Svelte reported zero errors and warnings. |
| `npm run format:check`                                                                                    | Passed, including Kodi static checks.             |
| `npm run typecheck:test`                                                                                  | Passed.                                           |
| `npx vitest run tests/integration/policy-errors.spec.ts tests/unit/http-client-contract.spec.ts --bail 1` | 9 passed.                                         |
| `npx vitest run tests/integration/policy-errors.spec.ts --bail 1`                                         | 4 passed, including bulk-conflict rollback.       |
| `npm test`                                                                                                | 538 passed; 1 opt-in test skipped.                |
| `npm run e2e:couch -- couch-mode.spec.ts couch-recovery.spec.ts --workers=1`                              | 41 Chromium tests passed.                         |
| `git diff --check`                                                                                        | Passed.                                           |

Early runs identified invalid ownership fixtures and two existing browser assertions
that sampled an opacity/size transition before it settled. The fixtures now use a
real signed-in public account and valid DataSpace relations. The visual assertions
wait for their original required values rather than weakening the expected result.
Cold server-module transformation also exceeded the initial focused setup budget;
the new suite allows 240 seconds for initialization and keeps normal operation
timeouts. The final browser run passes the existing flows as well as the new cases.

The skipped test is the opt-in MariaDB Card catalog advisory-lock scenario
(`CARD_CATALOG_MARIADB_TEST=1`); it was not enabled for this run.

The browser regressions use the actual Express server and disposable SQLite database.
A route fetch commits a draw before deliberately losing its response; recovery must
restore that exact revision, issue no repeated command or creation, and leave exactly
one persisted appearance. Further cases cover a temporary reload failure, automatic
reconnection, stale-command resynchronization, incomplete 200 bodies, unrelated 404s,
authorization failure, definitive not-found, policy conflicts and removed rules/Groups.
Policy recovery is also checked while another tab retains an unchanged Couch game.

The recovery, conflict and removed-resource flows are audited at 1280-pixel desktop
and 320-pixel phone widths in English and German. Checks cover overflow inside the
error panel as well as viewport overflow, target sizes, overlaps, focus transfer,
explicit replacement of drafts, separate Account navigation and game continuity.
Screenshots and measurement reports are local artifacts under `.tmp/visual-audit`.
