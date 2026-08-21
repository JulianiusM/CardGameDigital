# Testing Guide

Surveyor uses a pragmatic two-runner strategy:

- **Vitest** for isolated utility/frontend tests and database-backed controller integration workflows.
- **Playwright** for a small E2E suite that verifies critical workflows against the built application.

The goal is useful regression signal with low maintenance overhead. Prefer tests that describe expected input/output transformations or user-visible outcomes. Avoid tests that assert private implementation details, fragile DOM structure, broad snapshots, or test-only helpers.

## Test Structure

```
tests/
├── unit/                  # Isolated production utilities and transformations only
├── integration/           # Controller workflows against the disposable MariaDB test schema
├── frontend/              # Fast Vitest frontend helper/component tests
│   └── helpers/           # Client-side helper behavior
├── e2e/                   # Focused Playwright critical-flow tests
├── factories/             # Reusable production-shaped test data builders
├── fixtures/              # Shared fixture assets and seed data
└── support/               # Runner setup and shared test utilities
```

All test files use the `*.spec.ts` suffix.

## What to Test

Choose the cheapest stable test that catches the regression:

| Risk | Preferred test |
| --- | --- |
| Isolated date, permission, invoice, or request transformation is wrong | Vitest unit test |
| A controller workflow no longer validates, orchestrates, or persists the expected entity graph | Vitest controller + MariaDB integration test |
| Frontend helper/component behavior changes | Vitest frontend test |
| Main user workflow is unusable | Playwright E2E test |

Do not add every layer for every feature. Add one high-value test at the layer that best protects the use case.

## Anti-Brittleness Rules

1. Test production behavior, not implementation details or convenience wrappers that mostly delegate to third-party code. Unit tests are limited to code that is naturally isolated, primarily utilities.
2. Prefer realistic factories in `tests/factories/` over hard-coded inline objects, and reuse common entity factories such as `createEntityBase()` before adding specialized factories.
3. Put reusable smoke-test workflow/assertion keywords in `tests/keywords/` only when they clarify intent and remove real repetition.
4. Keep E2E broad and shallow; do not cover every validation branch in E2E.
5. Prefer API/database setup over UI setup for E2E prerequisites.
6. Use accessibility selectors or stable `data-testid` anchors for E2E; avoid Bootstrap class and DOM-depth selectors.
7. Avoid broad snapshots. Assert the behavior or contract that matters.
8. Keep helpers small. A helper should reduce brittle repetition, not hide the purpose of the test.
9. Do not create one spec file per assertion. Group related examples by stable production behavior or use case, then use parameterized cases inside that spec.
10. Add a short comment to each grouped smoke assertion explaining the user-facing regression it protects.
11. Keep test imports order-independent: production modules must be safe to import before test setup, so browser globals need guards such as `typeof window !== 'undefined'`.
12. Do not mock TypeORM repositories or core services. Integration tests enter through production controllers and initialize the production DataSource against `TEST_DB_NAME`, which must contain `test`. Service reads may verify the resulting state, but tests must not make database CRUD the behavior under test.

## Running Tests

```bash
npm test                    # Fast Vitest suite
npm run test:ci             # Fast Vitest suite with JUnit and LCOV coverage reports for CI/SonarQube
npm run test:quick          # Database-free utility + frontend checks
npm run test:unit           # Isolated production utilities only
npm run test:frontend       # Frontend Vitest tests
npm run test:integration    # Database-backed controller workflow suite
npm run e2e                 # Playwright E2E tests
npm run test:all            # Vitest + build + Playwright E2E
```

`npm test`, `npm run test:integration`, and `npm run test:ci` run the database-index generator through their npm lifecycle hooks before Vitest starts. This keeps the ignored `src/modules/database/__index__.ts` build artifact out of Git while ensuring clean CI checkouts can load the production DataSource.

## Example Patterns

### Factory-backed Vitest test

```typescript
import {describe, expect, it} from 'vitest';
import {buildDateTotals} from '../../src/modules/lib/util';
import {createDateTotalsCase} from '../factories/dateTotalsFactory';

const cases = [createDateTotalsCase()];

describe('date totals transformation', () => {
    it.each(cases)('$description', (testCase) => {
        expect(buildDateTotals(
            testCase.eventStart,
            testCase.eventEnd,
            testCase.registrations,
        )).toEqual(testCase.expectedTotals);
    });
});
```

### Focused Playwright E2E test

```typescript
import {test, expect} from '@playwright/test';
import {createHealthCase} from '../factories/healthFactory';

const cases = [createHealthCase()];

test.describe('application health', () => {
    for (const testCase of cases) {
        test(testCase.description, async ({request}) => {
            const response = await request.get(testCase.endpoint);
            expect(response.status()).toBe(testCase.expectedStatus);
            expect(await response.text()).toBe(testCase.expectedBody);
        });
    }
});
```

## Current Example Coverage

The scaffold includes useful production-code examples for:

- Isolated utilities: date totals, dashboard entity flattening, permission masks, API guards, and query-limit coercion.
- MariaDB integration canaries: local authentication, events, surveys and responses, activity plans and assignments, packing lists and assignments, drivers lists/items, and persisted permissions.
- Frontend canaries: authentication validation, permission guards, event registration payloads, invoice pool settings, activity slot payloads, recommendation matching, packing items, driver items, and survey combinations.
- E2E: public availability and critical core workflow creation checks.

For future tests, keep the same canary model: protect the most important Surveyor workflows first, keep setup factory-backed, and avoid detailed edge-case matrices unless a real regression justifies them.

## Architecture Review Checklist

- **Single-developer maintainability**: `npm run test:quick` remains database-free for daily edits; `npm test` adds one grouped MariaDB suite that initializes the schema once. Production-shaped factories keep entity changes centralized.
- **Resistance to small implementation changes**: integration checks call public service functions and assert persisted user-visible state. They do not mock repositories, inspect private methods, count class members, or depend on internal call sequences.
- **Core regression value**: current canaries cover real authentication transactions, permissions, events, survey voting, activity schedules/assignments, packing assignments, drivers coordination, frontend transformations, and focused E2E workflows.
- **Database fidelity**: TypeORM integration tests use the same entities, subscribers, relations, transactions, and MariaDB driver as production. The setup refuses to reset a database whose name does not contain `test`.
- **Passing tests expectation**: CI runs the fast Vitest suite with JUnit output, builds the app, installs/caches Playwright browsers, runs focused Playwright E2E with JUnit output, uploads all test reports, and passes the package version plus JUnit and LCOV coverage report paths to SonarQube.
- **Low-overhead goal**: add future coverage as broad smoke cases first; only add detailed edge-case tests when a real bug proves the broad canary is insufficient.
