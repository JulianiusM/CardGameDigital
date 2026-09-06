# Corrective Phase 1 — privacy and identity

Implements work package 1 (F01, F05, F10) from the
[2026-09-05 implementation review](./implementation-review-2026-09-05.md).
The review remains the historical baseline; this record describes the corrective work.

## Work plan and implementation

| Finding | Corrective scope                                                                                                                                                                                                     | Acceptance evidence                                                                                                                                                                                    |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F01     | Derive retained answer totals from the shared reveal projection. Zero all totals until reveal and after advance/end.                                                                                                 | Full serialized Couch responses and Host/Player/Display envelopes checked through sequential YES/NO submissions in both reveal modes.                                                                  |
| F05     | Scrub ended and departed-player runtime boundaries, delete terminal participant rows in the lifecycle transaction, preserve active recovery/continuing lobbies, migrate existing records, document backup retention. | Shared SQLite/MariaDB lifecycle regressions inspect actual boundary rows and runtime JSON; history and active recovery remain intact.                                                                  |
| F10     | Resolve validated email/verification pairs with provenance; conditionally link only unlinked accounts.                                                                                                               | Callback tests with controlled provider responses and real account persistence cover equal/changed emails, omitted/false/true verification, unavailable UserInfo, and conflicting existing identities. |

Boundary erasure is part of terminal Room persistence even if a subsequent roster
commit is interrupted. Expired devices also remove every represented player from the
Session. The broader lifecycle transaction redesign remains F20's separate work package.

HTTP v1 and WebSocket v2 shapes are unchanged. Masking totals restores their documented
privacy semantics and is compatible with existing web/Kodi decoders. Runtime v5 and
entities remain unchanged; the generated migration index includes the new data cleanup.
Existing backups require operator retention and restricted access; database row cleanup
does not physically sanitize media or rewrite backups.

## Validation

The final `npm test` run passed: 63 files, 408 tests; 1 file/test skipped, 605.33 seconds.
This includes the shared SQLite/MariaDB lifecycle tests and cleanup beyond the migration's
100-row page size. The first full run exposed an old assertion expecting the leaked
total and a test fixture assuming the Host received the first turn. Both were corrected;
the fixture now uses the authoritative active player.

| Exact command                                                                                                                                                                                                                 | Result                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `npm run generate`                                                                                                                                                                                                            | Passed; migration index regenerated, web/Kodi definitions current.              |
| `npx vitest run tests/integration/couch-api.spec.ts tests/integration/websocket-rooms.spec.ts tests/unit/game-session.spec.ts tests/integration/boundary-persistence.spec.ts tests/unit/oidc-callback.spec.ts --reporter=dot` | Passed: 5 files, 46 tests during initial iteration.                             |
| `npx vitest run tests/integration/boundary-persistence.spec.ts tests/integration/oidc-user-persistence.spec.ts --reporter=verbose`                                                                                            | Initially 22 passed, 1 migration test failed; TypeORM column mapping corrected. |
| `npx vitest run tests/integration/boundary-persistence.spec.ts --reporter=verbose`                                                                                                                                            | Passed after correction: 12 tests.                                              |
| `npm run build`                                                                                                                                                                                                               | Passed; Svelte reported 0 errors and 0 warnings.                                |
| `npm run typecheck:test`                                                                                                                                                                                                      | Passed.                                                                         |
| `npm run format:check`                                                                                                                                                                                                        | Passed, including Kodi static checks.                                           |
| `git diff --check`                                                                                                                                                                                                            | Passed.                                                                         |
| `npm run e2e:couch -- --grep "Never Have I Ever" --reporter=line`                                                                                                                                                             | Passed: 4 tests, 45.4 seconds.                                                  |
| `npm run e2e:visual -- --grep "maximum-name Party Screen roster\|anonymous Never Have I Ever results" --reporter=line`                                                                                                        | Passed: 2 scenarios, 2.1 minutes.                                               |

The visual audit covered private ballots/progress and named/anonymous results, including
320×568 phones, 800×600 and 1280×600 desktop displays, 844×390 landscape, and TV.
Generated captures were inspected for hierarchy, spacing, sectionalization, contrast,
touch targets, and overflow. Existing gameplay/settings navigation remained intact; no
new control, focus, or destructive-action flow was introduced. Captures remain under
ignored `.tmp/visual-audit/`. This focused audit does not close F17's full visual gate.

Live-provider OIDC and physical Kodi device testing are outside this corrective run.
