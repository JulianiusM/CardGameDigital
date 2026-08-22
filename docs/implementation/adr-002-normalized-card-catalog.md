# ADR-002: Stable cards and localized catalog resources

## Status

Accepted and production-facing.

## Decision

A `Card` is a language-independent game object with a permanent UUID. Player-facing
wording is a `CardTranslation`, keyed by card and BCP 47 locale. `CardSource` maps a
stable external identity (`source_namespace`, `source_id`) to the UUID. Neither the
wording nor a content hash participates in identity assignment.

```text
source export -> raw rows -> validation -> source reconciliation
              -> canonical Card -> source-language CardTranslation
              -> versioned catalog
```

Run the current Access ingest with:

```bash
npm run card:import -- raw-cards.json catalog/cards-2026.08.json 2026.08 legacy-access-v1 de-DE
```

The normalized interchange contains source identities and localized renderings but
no generated card UUID. During transactional application, an existing source mapping
wins; otherwise the persistence layer assigns a random UUID once and records it.
Rewording therefore updates the rendering without resetting history.

`QuestionCategory` and `DareType` are stable business codes. Their labels and
descriptions live in separate locale-keyed translation tables. The source-language
labels retained by the importer are input aliases only and never drive game logic.

## Reconciliation and lifecycle

The source rendering records a revision and content hash. When it changes, its
revision advances and older non-source renderings are marked `STALE`; they remain
available for editorial comparison but are not playable. A row absent from a later
source catalog is soft-retired by setting `Card.active = false`. Source mappings,
translations, appearances, session history, and statistics remain intact. Restoring
the source row reactivates the same UUID.

Gameplay always asks the repository for a locale and a missing-translation policy.
The production default is `EXCLUDE`: only active cards with a `PUBLISHED` rendering
in the requested locale enter the eligible pool. Cross-language fallback is possible
only through an explicit `FALLBACK` policy and fallback locale.

## Consequences

- Adding or removing a language cannot create or delete a logical card.
- Wording edits do not invalidate `CardAppearance.card_id` or group history.
- Missing, draft, reviewed, and stale renderings are excluded from new sessions.
- Unknown types, classifications, and flags remain explicit ingest errors.
- Catalog application reconciles and retires; it never replaces or hard-deletes the
  canonical catalog.
