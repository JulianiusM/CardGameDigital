# ADR-002: Bundled global Card catalog

## Status

Accepted; supersedes the Access/source-mapping importer design.

## Decision

The game consumes one producer-approved immutable FULL snapshot using
`game-card-catalog/v1`. The exact `catalog/card-catalog.json` bytes are validated at
build and startup, hashed by the receiver, and transactionally reconciled before the
application becomes ready. Runtime never contacts the producer.

The producer supplies permanent Card UUIDs, release ordering, lifecycle, gameplay
metadata, the Card-content locale registry, approved Card localizations, and localized
taxonomy copy. The game has no source mapping, raw staging, alias normalization, or
translation editorial workflow.

`Card` remains language-independent. `CardLocalization(card_id, locale)` stores exact
playable text plus active/soft-disabled state. Catalog locales and taxonomy copy are
database runtime data and are deliberately independent of UI i18n resources.

## Reconciliation

For each catalog ID, sequence and SHA-256 enforce immutable ordering. Equal releases
are skipped, conflicting bytes fail, greater releases apply, and older bundles do not
downgrade newer databases. MariaDB/MySQL hold an advisory lock across decision and
transaction.

FULL apply upserts incoming locales, taxonomies, Cards, localizations and exact flag
sets. Missing Cards/locales/localizations are soft-disabled. No Card, localization, or
historical appearance is deleted. Failed application rolls back as one unit.

## Runtime consequence

Sessions validate `cardLocale` against active database catalog locales. Selection joins
active logical Cards to active exact-locale localizations. Explicit fallback is the
only way to use catalog default text when exact text is absent. Taxonomy API copy comes
from database rows for the Card locale, never from UI translation bundles.
