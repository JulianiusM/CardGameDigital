# Bundled Card catalog contract

The only external Card-content boundary is the immutable FULL snapshot at
`catalog/card-catalog.json`. Its wire identifier is `game-card-catalog/v1`; the
producer-facing JSON Schema is
`src/packages/card-catalog-contract/card-catalog-v1.schema.json` and the runtime
schema and semantic validator live beside it.

The producer owns stable Card UUIDs, lifecycle, gameplay metadata, the Card-content
locale registry, release-approved Card localizations, localized QuestionCategory and
DareType copy, and release ordering. The game does not ingest Access rows, create Card
IDs, map source identities, or persist draft/review/stale translation workflow.

## Envelope

```json
{
    "contract": "game-card-catalog/v1",
    "catalogId": "global",
    "sequence": 42,
    "catalogVersion": "2026.08.2",
    "generatedAt": "2026-08-22T12:00:00.000Z",
    "defaultLocale": "de-DE",
    "locales": [],
    "questionCategories": [],
    "dareTypes": [],
    "cards": []
}
```

Objects reject unknown fields. Locale IDs are canonical BCP 47 tags. Cards contain a
producer UUID, `ACTIVE`/`RETIRED` lifecycle, canonical game-core metadata and flags,
and an array of `{locale,text}` release-approved localizations. Taxonomy items contain
stable game-core IDs and `{locale,label,description}` localizations.

Semantic validation enforces unique IDs/locales, one active default locale, default
text for every active Card, same-locale labels for referenced taxonomies, enum and
Card-type constraints, unique flags/localizations, resolved locale references, and
final text without leading/trailing whitespace.

Validate without rewriting the artifact:

```bash
npm run card:catalog:validate -- catalog/card-catalog.json
```

## Release and startup

`npm run build` validates the source bytes and copies those bytes to
`dist/catalog/card-catalog.json`. Release packaging includes that exact file. Startup
strict-parses and validates it again, computes SHA-256 over the delivered bytes,
acquires the database catalog lock, and applies it before readiness.

For a given `catalogId`, equal sequence/equal digest is a no-op; equal sequence with a
different digest fails; a greater sequence applies; an older bundled sequence never
downgrades a newer database. MariaDB/MySQL use `GET_LOCK` across the decision and
transaction. A persistent SQLite database receives a one-time pre-upgrade backup
before migrations.

FULL reconciliation is transactional. Incoming rows are upserted; flag sets are
replaced exactly. Missing Cards, locales, and per-Card localizations are soft-disabled,
never deleted. Card/session history and producer UUIDs remain intact.

## Runtime language boundary

Card-content locales come exclusively from catalog-populated database rows, separately
from UI localization bundles. `GET /api/v1/catalog/locales` lists active Card locales
and coverage. `GET /api/v1/catalog/taxonomies?locale=L` returns database taxonomy copy
for active Card locale `L`. Session `cardLocale` is checked against the database.
Exact-locale active localizations are selected; missing content is excluded unless the
explicit deployment/session fallback policy is enabled.
