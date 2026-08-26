# ADR-002: Bundled global Card catalog

## Status

Accepted; supersedes the Access/source-mapping importer design.

## Decision

The game consumes one producer-approved immutable FULL snapshot using
`game-card-catalog/v2`. The exact `catalog/card-catalog.json` bytes are validated at
build and startup, hashed by the receiver, and transactionally reconciled before the
application becomes ready. Runtime never contacts the producer.

The v2 wire envelope is closed and exact: `catalogId` is `core`, `snapshotKind` is
`FULL`, Question Categories and DareTypes live below `taxonomy`, the conversation Card
type is `CONVERSATION_META`, and operational flags use only the producer-defined v2
registry. Internal code does not accept flattened aliases or v1 spellings as v2.

The producer supplies permanent Card UUIDs, release ordering, lifecycle, gameplay
metadata, the Card-content locale registry, approved Card localizations, and localized
taxonomy copy. The game has no source mapping, raw staging, alias normalization, or
translation editorial workflow.

v2 adds fixed catalog-wide Card defaults, mandatory taxonomy social-sensitivity
defaults, and sparse taxonomy/Card player-count and sensitivity overrides. The
receiver resolves Card → primary taxonomy → catalog defaults during reconciliation and
persists `socialSensitivity`, `minimumPlayerCount`, and `maximumPlayerCount` on every
logical Card. Runtime rejects v1 rather than synthesizing editorial values, while the
published v1 schema and documentation remain immutable for historical integrations and
sequence ordering continues across the v1-to-v2 cutover.

`Card` remains language-independent. `CardLocalization(card_id, locale)` stores exact
playable text plus active/soft-disabled state. Catalog locales and taxonomy copy are
database runtime data and are deliberately independent of UI i18n resources.

## Reconciliation

For each catalog ID, sequence and SHA-256 enforce immutable ordering. Equal releases
are skipped, conflicting bytes fail, greater releases apply, and older bundles do not
downgrade newer databases. MariaDB/MySQL hold an advisory lock across decision and
transaction.

The explicitly named `development-fixture-*` bundle is a disposable local bootstrap,
not a producer release. The first non-fixture `core` release transactionally removes
that fixture release record and becomes the start of the production lineage even when
its producer sequence is lower. Once a production release is installed, a development
fixture can never replace it. Normal immutable sequence rules remain unchanged within
the producer lineage.

FULL apply upserts incoming locales, taxonomies, Cards, localizations and exact flag
sets. Missing Cards/locales/localizations are soft-disabled. No Card, localization, or
historical appearance is deleted. Failed application rolls back as one unit.

## Runtime consequence

Sessions validate `cardLocale` against active database catalog locales. Selection joins
active logical Cards to active exact-locale localizations. Explicit fallback is the
only way to use catalog default text when exact text is absent. Taxonomy API copy comes
from database rows for the Card locale, never from UI translation bundles.
