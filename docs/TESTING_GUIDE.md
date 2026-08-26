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
npx vitest run tests/unit/card-catalog-contract.spec.ts tests/integration/card-catalog-persistence.spec.ts
npx vitest run tests/unit/card-policy.spec.ts tests/simulation/card-policy-scale.spec.ts
npx vitest run tests/integration/room-http.spec.ts tests/integration/sqlite-migrations.spec.ts
npm run e2e:couch
npm run e2e
npm run test:mariadb:reset
npm run test:mariadb:public
npm run test:ci
```

The Card-policy scale simulation compiles 10,000 and 50,000 Cards against 200 ordered
rules, then measures O(1) compiled snapshot lookup. The Room HTTP/SQLite suites cover
ownership, cursor search, provenance, optimistic conflicts, atomic portable import, and
confirmed-count bulk writes. `test:mariadb:public` runs the same persistent policy seam
inside the authenticated public workflow against a guarded disposable MariaDB schema.

Card-management browser coverage must also verify the presentation boundary: no more
than the configured page size is rendered for large DataSpace, Group, rule, or Card
collections; changing filters resets paging; selected detail and provenance remain
legible; inline destructive confirmations replace native dialogs; and `scrollWidth`
does not exceed the viewport at desktop and narrow-phone widths. Run the same navigation
in local none-auth and authenticated public configurations. Translation audits compare
all referenced Card-management and DataSpace-browser keys in both locale catalogs and
must reject raw contract field names in visible output.

The browser regression also verifies the standalone outer Card, the compact embedded
Account hierarchy, non-wrapping scope actions, wrapping selected-scope copy, standard
profile selection and editable Child-friendly defaults, least-restrictive range
defaults, restoration of an in-editor custom value, explicit DataSpace-versus-Group
scope levels, full Card UUID display, equal-width pagination actions, and no master-pane
scrollbar when wide-view Conditions expand. It also verifies successful rule deletion
through a string-encoded revision query. The Room HTTP integration test covers both rule
and exact-Card DELETE revision parsing.

`npm run test:ci` writes coverage and JUnit output under `artifacts/`. Playwright requires
installed browser binaries and a prepared database; use the corresponding `e2e:*:init`
script when running a standalone server.

`test:mariadb:public` uses `TEST_DB_*` process variables or the ignored
`tests/.env.test.local` profile. It refuses names without `test`/`e2e` and clears every
object in that exact disposable schema before migrations. The public Playwright account
scenario requires `E2E_DEPLOYMENT_MODE=public`; explicit E2E mode permits only a
loopback HTTP origin so CI can exercise public auth/CSRF semantics without relaxing the
production HTTPS validator.

For interactive administrator testing outside the E2E harness,
`PUBLIC_RUNTIME_SECURITY=development` intentionally relaxes the public infrastructure
and runtime gates and emits a startup warning. This is distinct from E2E mode: it is an
operator-selected unsafe profile and must be confined to a trusted development network.

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
changes must demonstrate producer UUID stability, localization soft-disable, immutable
release ordering, and no hard deletion.
Account changes must demonstrate ownership scoping and avoid revealing account
existence through reset responses.

## Test hygiene

- Use temporary directories/databases and delete them in teardown.
- Never depend on test order or a developer's `.env`.
- Do not use live SMTP, OIDC, or production databases.
- Do not claim an E2E pass when browser installation or external infrastructure blocked
  execution; report the limitation explicitly.
- Keep tests readable enough to serve as executable contract examples.
