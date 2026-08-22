# Testing guide

The repository uses Vitest for unit, integration, simulation, and architecture tests,
and Playwright for browser workflows.

## Test suites

```text
tests/unit/          Pure domain, tooling, localization, and utility behavior
tests/integration/   Disposable SQLite/API/WebSocket/persistence workflows
tests/simulation/    Long deterministic game-mode behavior
tests/architecture/  Enforced dependency, localization, card, and documentation rules
tests/e2e/           Browser-visible Couch and Party Screen workflows
tests/support/       Shared deterministic fixtures and environment setup
```

All Vitest files end in `.spec.ts` and are included by `vitest.config.mts`.

## Commands

```bash
npm test
npm run test:unit
npm run test:integration
npm run test:quick
npx vitest run tests/unit/card-import.spec.ts
npm run e2e:couch
npm run e2e
npm run test:ci
```

`npm run test:ci` writes coverage and JUnit output under `artifacts/`. Playwright requires
installed browser binaries and a prepared database; use the corresponding `e2e:*:init`
script when running a standalone server.

## Choosing a test

| Risk                                                     | Preferred coverage                          |
| -------------------------------------------------------- | ------------------------------------------- |
| Eligibility, history, selection, state transition        | Unit test with deterministic random source. |
| Mode balance over many turns                             | Simulation test.                            |
| Migration, reconciliation, transactions, authorization   | Integration test with disposable database.  |
| HTTP error/status/body or account cookie behavior        | Supertest integration test.                 |
| Handshake, revisions, role transfer, private projections | WebSocket integration test.                 |
| Layering or “must never return” rule                     | Architecture test.                          |
| Navigation, layout, browser audio/control behavior       | Playwright E2E.                             |

Prefer observable outcomes over private-method assertions. Do not mock the domain rule
being tested. Use production schemas/adapters in integration tests and deterministic
fixtures in unit tests.

## Required regression cases

When applicable, cover success plus invalid input, unauthorized access, stale revision,
empty localized pool, transaction failure, reconnect, and cross-Room isolation. Card
changes must demonstrate stable UUID, translation status, and no hard deletion.
Account changes must demonstrate ownership scoping and avoid revealing account
existence through reset responses.

## Test hygiene

- Use temporary directories/databases and delete them in teardown.
- Never depend on test order or a developer's `.env`.
- Do not use live SMTP, OIDC, or production databases.
- Do not claim an E2E pass when browser installation or external infrastructure blocked
  execution; report the limitation explicitly.
- Keep tests readable enough to serve as executable contract examples.
