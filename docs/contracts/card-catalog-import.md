# Card catalog importer contract

## Purpose and identity rule

The importer translates an external content export into a validated reconciliation
catalog. A logical Card UUID is permanent and language-independent. The importer must
never derive that UUID from card text or a content hash.

External identity is the tuple:

```text
source namespace + source ID
```

For the original Access source use `legacy-access-v1` plus the stable row ID. Changing
wording, punctuation, category metadata, or locale does not change this tuple.

## CLI

```bash
npm run card:import -- \
  <raw-json> <catalog-json> <catalog-version> [source-namespace] [source-locale]
```

Defaults are `legacy-access-v1` and `de-DE`. Input is a JSON array. The command always
writes the catalog, reports accepted/error/warning counts, and exits with status `2`
when validation errors exist.

## Raw row contract

```json
{
    "ID": "1427",
    "CardText": "Was ist dein größter Wunsch?",
    "Type": "Fragen",
    "Origin": "Access",
    "OriginCategory": null,
    "YesNoAnswerPossible": false,
    "Category": "Alltag",
    "DareType": null,
    "Intensity": 2,
    "AlwaysEligible": false,
    "RepeatableInSession": false,
    "RepeatCooldown": 0,
    "Weight": 1,
    "Active": true,
    "OperationalFlags": [],
    "SourceRevision": 7
}
```

The schema is strict. `ID`, `CardText`, `Type`, and `Origin` are required. Type and
localized legacy taxonomy aliases are normalized to stable codes. Unknown values are
errors; missing dare affinity and ineffective cooldown are warnings. Malformed rows
remain in `rawCards`/`rejectedRawCards` for auditability.

## Catalog interchange

The generated schema version is `2` and includes catalog/source metadata, SHA-256
source digest, raw rows, normalized logical metadata, source-language rendering,
issues, and rejected rows. It intentionally contains source IDs rather than canonical
card UUIDs.

A source rendering contains:

- BCP 47 `locale`;
- adaptable player-facing `text`;
- positive `revision`;
- SHA-256 `contentHash` for change detection;
- initial status `PUBLISHED`.

## Application semantics

`applyCardCatalog` parses the entire untrusted catalog before opening a transaction.
Unless `allowErrors` is explicitly set, any error rejects the application.
Within one transaction it:

1. records locale/catalog/raw import metadata;
2. resolves `(source_namespace, source_id)` to an existing Card UUID or creates one
   random UUID and permanent source mapping;
3. upserts language-independent gameplay metadata and flags;
4. upserts the source-language rendering;
5. advances its revision on a changed hash;
6. marks older non-source renderings `STALE` without deleting them;
7. sets Cards missing from the complete source export to `active=false`.

A malformed row still present in `rawCards` is not considered absent. Re-importing a
retired source ID reactivates the same Card UUID. Source mappings, translations,
`CardAppearance` history, and old sessions are never hard-deleted by catalog ingest.

## Translation publishing

Game selection includes only `active` Cards with a `PUBLISHED` rendering in the
session's exact card locale. `DRAFT`, `REVIEWED`, and `STALE` renderings are editorial
resources, not playable content. Missing translations are excluded by default.
Cross-language rendering requires deployment configuration:

```text
CARD_MISSING_TRANSLATION=FALLBACK
CARD_FALLBACK_LOCALE=de-DE
```

Adaptations may change grammar and cultural framing while preserving gameplay meaning.
A substantial meaning change is a new logical Card and therefore a new source ID/UUID.
