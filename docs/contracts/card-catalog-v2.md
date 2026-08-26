# Card Catalog Delivery Contract v2

## 1. Purpose

This document defines the complete delivery contract between the third-party Card management system and the game application for `game-card-catalog/v2`.

The third-party system is the authoritative content-management system for:

- permanent Card identity;
- language-independent gameplay metadata;
- Card lifecycle;
- Card localizations;
- the set of Card-content locales available at runtime;
- localized Card-taxonomy labels;
- baseline social-sensitivity classification;
- baseline minimum/maximum participant-count applicability.

The game application is **not** a Card authoring, enrichment, translation, review, or publishing system. It does not know the producer's source database shape and it does not perform source-system-specific transformation.

The producer delivers a release-ready, fully normalized catalog. The game validates that artifact, stores it, reconciles it transactionally, and uses it as the producer baseline for gameplay and account/session Card policies.

UI localization is a separate application concern. A Card locale delivered by this catalog MUST NOT be required to exist in the application's UI localization bundles.

Player-facing profiles and account/session Card policies are **game-owned configuration**, not producer-owned fields. The producer supplies reusable Card metadata; the game composes social sensitivity, taxonomy, and operational flags into editable profile defaults such as `PROFILE_CHILD_FRIENDLY` without requiring a per-Card/per-audience matrix.

---

## 2. Deliverable and wire version

For every catalog release, the producer delivers exactly one UTF-8 JSON document:

```text
card-catalog.json
```

The document conforms to exactly:

```text
game-card-catalog/v2
```

The game team provides the machine-readable JSON Schema:

```text
card-catalog-v2.schema.json
```

The producer MUST validate its output before delivery. The receiver performs the same structural validation plus cross-record and cross-release semantic validation.

The delivered bytes are immutable. The receiver calculates SHA-256 over the exact artifact and records that digest with the applied catalog release.

### 2.1 Contract version versus catalog version

`contract` identifies the immutable wire schema and normative semantics. For this contract it MUST be:

```json
"contract": "game-card-catalog/v2"
```

`catalogVersion` is a producer-defined content-release label. It does not change contract semantics.

Examples:

```text
contract:       game-card-catalog/v2
catalogVersion: 2026.09.01-1
sequence:       14
```

A later Card-text, metadata, localization, taxonomy-label, taxonomy-default, sensitivity, or player-count change is ordinary catalog **content** evolution. It requires a new immutable release but does not require another wire version.

Any future change that changes accepted object shape, required/optional field semantics, enum membership, inheritance rules, validation rules, or a field's meaning requires a new major contract identifier such as:

```text
game-card-catalog/v3
```

There is no independently negotiated minor wire-contract version.

### 2.2 Relationship to v1

`game-card-catalog/v1` remains immutable. v2 does not mutate v1 in place.

For the same `catalogId`, release `sequence` continues monotonically across the v1-to-v2 cutover. The first accepted v2 snapshot MUST have a sequence greater than the last accepted v1 snapshot in that catalog lineage.

An application release that depends on v2 social-sensitivity or participant-count metadata MUST require a v2 artifact before readiness. It MUST NOT load v1 and silently synthesize those producer classifications as if the v2 contract had been delivered.

### 2.3 Encoding and serialization

- UTF-8 JSON.
- RFC 8259 compatible.
- No comments.
- No duplicate object keys.
- No unknown properties.
- No non-finite numbers.
- Producers SHOULD sort Cards by `id`, locales by `id`, taxonomy entries by `id`, and localization arrays by `locale` for stable diffs. Ordering has no semantic meaning unless explicitly stated otherwise.

---

## 3. Top-level shape

```json
{
  "contract": "game-card-catalog/v2",
  "catalogId": "core",
  "catalogVersion": "2026.09.01-1",
  "sequence": 14,
  "generatedAt": "2026-09-01T12:00:00Z",
  "snapshotKind": "FULL",
  "cardDefaults": {
    "socialSensitivity": "GENERAL",
    "minimumPlayerCount": 2,
    "maximumPlayerCount": null
  },
  "defaultLocale": "de-DE",
  "locales": [],
  "taxonomy": {
    "questionCategories": [],
    "dareTypes": []
  },
  "cards": []
}
```

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `contract` | string | yes | Exactly `game-card-catalog/v2`. |
| `catalogId` | string | yes | Exactly `core` in v2. |
| `catalogVersion` | string | yes | Immutable human-readable content release label, max. 80 characters. |
| `sequence` | positive integer | yes | Strictly increasing release order for `catalogId`; machine ordering authority across contract-major cutovers. |
| `generatedAt` | RFC 3339 timestamp | yes | Time at which the producer finalized the immutable artifact. |
| `snapshotKind` | enum | yes | Exactly `FULL` in v2. |
| `cardDefaults` | object | yes | Fixed v2 producer metadata defaults. |
| `defaultLocale` | BCP 47 tag | yes | Default Card-content locale for new installation/session configuration; unrelated to UI locale. |
| `locales` | array | yes | Runtime Card-content locale registry. |
| `taxonomy` | object | yes | Localized Card-domain taxonomy plus sparse producer defaults. |
| `cards` | array | yes | Complete logical Card snapshot including all release-approved localizations. |

### 3.1 Release immutability

The producer MUST NOT publish different content under an already published `(catalogId, sequence)` or `(catalogId, catalogVersion)`.

A change of any Card, locale, Card localization, taxonomy localization, taxonomy default, or Card-level v2 metadata requires a new sequence and catalog version.

Sequence numbers may have gaps but MUST increase.

---

## 4. Fixed v2 Card defaults

The top-level object is required and MUST be exactly:

```json
{
  "socialSensitivity": "GENERAL",
  "minimumPlayerCount": 2,
  "maximumPlayerCount": null
}
```

These values are architectural v2 defaults, not producer-tunable release settings.

| Field | Fixed value | Meaning |
|---|---|---|
| `socialSensitivity` | `GENERAL` | Baseline when no primary taxonomy/default or Card override supplies a sensitivity. |
| `minimumPlayerCount` | `2` | The game has no one-player Session. |
| `maximumPlayerCount` | `null` | No Card-specific upper bound. |

The receiver MUST reject a v2 artifact with different top-level values. Requiring them in the artifact keeps the default behavior explicit and independently verifiable without hiding it in application code.

---

## 5. Card-content locales

`locales` is authoritative runtime data for Card language selection.

Example:

```json
[
  { "id": "de-DE", "nativeName": "Deutsch (Deutschland)", "active": true },
  { "id": "en-GB", "nativeName": "English (United Kingdom)", "active": true },
  { "id": "fr-FR", "nativeName": "Français (France)", "active": true }
]
```

### Locale fields

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | BCP 47 language tag | yes | Stable Card-content locale ID. |
| `nativeName` | non-empty string | yes | Player-facing locale name written for practical recognition. |
| `active` | boolean | yes | Whether the locale is selectable for new Card sessions. |

Rules:

1. Locale IDs MUST be unique in the artifact.
2. `defaultLocale` MUST reference exactly one locale with `active: true`.
3. A Card or taxonomy localization MUST reference a locale present in `locales`.
4. An active locale may be partially translated. Missing Card localizations reduce that locale's eligible Card pool; they do not trigger implicit fallback.
5. A locale can be delivered even when the app has no UI resources for that language.
6. The game MUST NOT validate Card locales against UI localization support.
7. Removing a locale from a later FULL snapshot or setting it inactive makes it unavailable for new sessions but does not destructively delete historical Card-localization data.

### UI locale independence

These are valid combinations:

```text
UI locale:   en-GB
Card locale: de-DE
```

```text
UI locale:   de-DE
Card locale: fr-FR
```

```text
UI locale:   en-GB
Card locale: ja-JP
```

The last combination remains valid even when `ja-JP` is not an application UI locale.

---

## 6. Permanent Card identity

Every Card is assigned a permanent canonical lowercase UUID by the producer.

The UUID is the canonical Card identity for:

- persistence;
- session appearances;
- history;
- account/DataSpace and Group Card policies;
- exact-Card overrides;
- analytics;
- future reporting references;
- APIs;
- future catalog releases;
- every localization of the Card.

The producer MUST preserve the UUID across text changes, localization changes, metadata changes, lifecycle changes, contract-major upgrades, and later reactivation.

A materially different gameplay concept receives a new UUID. An old UUID MUST never be reused for another Card.

The game does not generate or reconcile source-system identities.

---

## 7. Social-sensitivity classification

v2 adds one reusable, ordered producer classification:

```text
GENERAL
< PERSONAL
< CLOSE_PERSONAL
< DEEP_PERSONAL
< INTIMATE
< EXPLICIT
```

The wire values are strings. The order above is normative; consumers MUST NOT compare them lexically.

### `GENERAL`

Ordinary social content that does not require meaningful private disclosure or a sensitive action.

### `PERSONAL`

Light personal preference, history, opinion, or self-description. It may reveal something about the player but normally does not require vulnerability or intimate disclosure.

### `CLOSE_PERSONAL`

The first child-friendly close-personal step below actual `INTIMATE` content. It may cover meaningful feelings, friendship dynamics, harmless embarrassing memories, hopes, fears, or similar material without becoming adult/sexual or inherently unsuitable for family play.

### `DEEP_PERSONAL`

The second child-friendly close-personal step below actual `INTIMATE` content. It covers emotionally vulnerable, heartfelt, or deeply personal material that may still be appropriate for children/families when the Card's taxonomy and operational flags are also appropriate.

### `INTIMATE`

Actually intimate/private adult, romantic, sexual, or comparably sensitive disclosure/action that should not be assumed suitable for children, strangers, or colleagues.

### `EXPLICIT`

Explicit sexual/adult or extreme private content/action.

### Orthogonality

`socialSensitivity` is independent from:

- QuestionCategory;
- DareType;
- Dare Affinity;
- operational flags;
- relative Card intensity.

The producer MUST NOT assume that intensity is a substitute for social suitability. The game may combine all of these dimensions when implementing profiles and Card policies.

---

## 8. Participant-count applicability

Every effective Card has a minimum and optional maximum number of represented players for which the Card makes semantic sense.

The effective model is:

```text
minimumPlayerCount: integer >= 2
maximumPlayerCount: null | integer >= 2
```

`maximumPlayerCount = null` means unbounded.

The resolved pair MUST satisfy:

```text
maximumPlayerCount == null
OR maximumPlayerCount >= minimumPlayerCount
```

There is intentionally no finite contract-level upper cap. Deployment/session capacities can evolve independently. A Card whose minimum exceeds the current Session size is simply ineligible.

Participant count is a hard applicability condition. `alwaysEligible`, repeatability, cooldown, weight, or pool exhaustion MUST NOT bypass it.

---

## 9. Localized Card taxonomy and sparse defaults

QuestionCategory and DareType IDs remain stable, language-neutral values used by game logic.

Each taxonomy item now also carries the producer's default social sensitivity. This is the key scalability mechanism for a stable catalog with thousands of Cards: classify the relatively small taxonomy once, then add Card-level values only for exceptions.

### QuestionCategory shape

```json
{
  "id": "CAT_FRIENDSHIP",
  "defaultSocialSensitivity": "CLOSE_PERSONAL",
  "defaultMinimumPlayerCount": 2,
  "defaultMaximumPlayerCount": null,
  "localizations": [
    { "locale": "de-DE", "label": "Freundschaft", "description": null },
    { "locale": "en-GB", "label": "Friendship", "description": null }
  ]
}
```

### DareType shape

```json
{
  "id": "DARE_KISS",
  "defaultSocialSensitivity": "INTIMATE",
  "localizations": [
    { "locale": "de-DE", "label": "Kuss", "description": null },
    { "locale": "en-GB", "label": "Kiss", "description": null }
  ]
}
```

Taxonomy v2 fields:

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `id` | stable enum | yes | Existing language-independent taxonomy ID. |
| `defaultSocialSensitivity` | `SocialSensitivity` | yes | Default for Cards whose primary taxonomy is this item. |
| `defaultMinimumPlayerCount` | integer >= 2 | no | Overrides top-level minimum for Cards inheriting from this taxonomy. |
| `defaultMaximumPlayerCount` | null or integer >= 2 | no | If present, overrides top-level maximum. `null` explicitly means unbounded. |
| `localizations` | array | yes | Existing localized label/description entries. |

Omission of a taxonomy player-count property means inherit from `cardDefaults`. Explicit `null` for `defaultMaximumPlayerCount` means unbounded and therefore differs from omission when an upstream value is finite in a future contract lineage.

For every Card localization delivered for locale `L`, the catalog MUST also contain locale-`L` taxonomy localizations for every player-visible QuestionCategory/DareType ID referenced by that Card.

Taxonomy labels MUST NOT come from UI i18n bundles.

---

## 10. Card record shape

Example:

```json
{
  "id": "5cb8e827-93dd-42e3-b8f6-6927a896c529",
  "lifecycle": "ACTIVE",
  "cardType": "QUESTION",
  "questionCategoryId": "CAT_FRIENDSHIP",
  "dareTypeId": null,
  "dareAffinityCategoryId": null,
  "yesNoAnswerPossible": false,
  "intensity": 4,
  "alwaysEligible": false,
  "repeatableInSession": false,
  "repeatCooldown": 0,
  "weight": 1,
  "socialSensitivity": "DEEP_PERSONAL",
  "minimumPlayerCount": 3,
  "operationalFlags": [],
  "localizations": [
    {
      "locale": "de-DE",
      "text": "Welche Eigenschaft an euren Freundschaften bedeutet dir besonders viel?"
    }
  ]
}
```

### Card fields

| Field | Type | Required | Contract |
|---|---|---:|---|
| `id` | canonical UUID | yes | Permanent producer-owned logical Card identity. |
| `lifecycle` | `ACTIVE` \| `RETIRED` | yes | Whether the logical Card may enter new gameplay. |
| `cardType` | enum | yes | `QUESTION`, `DARE`, or `CONVERSATION_META`. |
| `questionCategoryId` | enum or null | yes | Question category where applicable. |
| `dareTypeId` | enum or null | yes | Dare type where applicable. |
| `dareAffinityCategoryId` | enum or null | yes | Optional Question-category affinity for a Dare. |
| `yesNoAnswerPossible` | boolean | yes | Existing domain metadata. |
| `intensity` | integer 1..5 | yes | Relative domain intensity. |
| `alwaysEligible` | boolean | yes | Existing Group-history eligibility behavior. |
| `repeatableInSession` | boolean | yes | Whether the Card may repeat in one Session. |
| `repeatCooldown` | integer >= 0 | yes | Repeat cooldown; MUST be `0` when non-repeatable. |
| `weight` | number > 0 | yes | Relative selection weight. |
| `socialSensitivity` | `SocialSensitivity` | no | Card-specific exception to its primary taxonomy/default. |
| `minimumPlayerCount` | integer >= 2 | no | Card-specific minimum exception. |
| `maximumPlayerCount` | null or integer >= 2 | no | Card-specific maximum exception. Explicit `null` means unbounded. |
| `operationalFlags` | unique enum array | yes | Orthogonal behavior/safety flags. |
| `localizations` | array | yes | All currently release-approved Card texts. Unique by locale. |

The new fields are deliberately sparse. The producer SHOULD omit Card-level values when the inherited taxonomy/default value is correct.

There is intentionally no source-language `text`, source revision, translation workflow state, per-audience suitability matrix, or source database ID in the game contract.

---

## 11. Effective producer-value inheritance

The receiver MUST resolve the producer baseline deterministically before gameplay-policy overlays.

### 11.1 Primary taxonomy

For inheritance purposes:

- `QUESTION` uses its referenced QuestionCategory;
- `DARE` uses its referenced DareType;
- `CONVERSATION_META` uses its QuestionCategory only when one is present; otherwise it goes directly to `cardDefaults`.

Dare Affinity is not a primary inheritance taxonomy.

### 11.2 Social sensitivity

For a Card with a primary taxonomy:

```text
Card.socialSensitivity
?? primaryTaxonomy.defaultSocialSensitivity
```

For a Card without a primary taxonomy:

```text
Card.socialSensitivity
?? cardDefaults.socialSensitivity
```

Because QuestionCategory and DareType sensitivity defaults are required, ordinary Questions and Dares always resolve without Card-level classification.

### 11.3 Minimum player count

With a primary taxonomy:

```text
Card.minimumPlayerCount
?? primaryTaxonomy.defaultMinimumPlayerCount
?? cardDefaults.minimumPlayerCount
```

Without a primary taxonomy:

```text
Card.minimumPlayerCount
?? cardDefaults.minimumPlayerCount
```

### 11.4 Maximum player count

Maximum inheritance uses **property presence**, because JSON `null` is meaningful.

With a primary taxonomy:

```text
if Card contains maximumPlayerCount:
    use Card.maximumPlayerCount
else if primary taxonomy contains defaultMaximumPlayerCount:
    use primary taxonomy defaultMaximumPlayerCount
else:
    use cardDefaults.maximumPlayerCount
```

Without a primary taxonomy, use the Card property when present; otherwise use the top-level default.

### 11.5 Final validation

After inheritance every Card MUST resolve:

```text
socialSensitivity in the v2 enum
minimumPlayerCount >= 2
maximumPlayerCount == null OR maximumPlayerCount >= minimumPlayerCount
```

The producer and receiver MUST reject an artifact in which any Card fails this resolution.

---

## 12. Card localization shape

```json
{
  "locale": "en-GB",
  "text": "What is your greatest wish?"
}
```

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `locale` | BCP 47 tag | yes | Must exist in top-level `locales`. |
| `text` | non-empty string | yes | Final player-facing rendering for this Card and locale. |

Presence in `card.localizations` means that the localization is approved for gameplay in this catalog release. Draft/review/stale workflow states remain producer-internal.

An active locale does not require every active Card to be localized. Missing exact-locale text excludes the Card by default unless an explicit game fallback policy selects another delivered locale.

Removal from a later FULL snapshot soft-disables the stored `(cardId, locale)` row; reintroduction reactivates the same identity.

---

## 13. Canonical Card types

```text
QUESTION
DARE
CONVERSATION_META
```

### `QUESTION`

- `questionCategoryId` MUST be non-null.
- `dareTypeId` MUST be null.
- `dareAffinityCategoryId` MUST be null.
- producer defaults inherit from the referenced QuestionCategory.

### `DARE`

- `questionCategoryId` MUST be null.
- `dareTypeId` MUST be non-null.
- `dareAffinityCategoryId` MAY be null or a valid QuestionCategory ID.
- producer defaults inherit from the referenced DareType, not Dare Affinity.

### `CONVERSATION_META`

- `dareTypeId` MUST be null.
- `dareAffinityCategoryId` MUST be null.
- `questionCategoryId` MAY be null or valid when the domain intentionally classifies the Card.
- when a QuestionCategory is present, it is the primary inheritance taxonomy; otherwise top-level defaults apply.

---

## 14. QuestionCategory IDs

v2 retains the existing language-independent IDs:

```text
CAT_EVERYDAY
CAT_CHILDHOOD
CAT_PERSONALITY
CAT_SCENARIO
CAT_INTOXICATION
CAT_FRIENDSHIP
CAT_RELATIONSHIP
CAT_BODY
CAT_SEXUALITY
CAT_SEX_OPENNESS
CAT_SEX_TENSION
CAT_SEX_EXPERIENCE
```

Changing normal localized copy or producer defaults is content evolution. Adding/removing an enum ID changes the closed v2 schema and therefore requires a later contract major plus corresponding game-domain support.

---

## 15. DareType IDs

v2 retains:

```text
DARE_SILLY
DARE_THIRD_PARTY
DARE_KISS
DARE_KISS_SPICY
DARE_TOUCH
DARE_TOUCH_SPICY
DARE_TOUCH_SEXY
DARE_CLOTHING
DARE_NUDITY
DARE_SEXUAL_TENSION
DARE_BORDERLINE_SEX
DARE_SEX
DARE_OTHER
```

---

## 16. Operational flag IDs

v2 retains:

```text
REQUIRES_TARGET_PLAYER
INVOLVES_THIRD_PARTY
REQUIRES_PHYSICAL_CONTACT
REMOVES_CLOTHING
REQUIRES_NUDITY
INVOLVES_ALCOHOL
INVOLVES_RECREATIONAL_SUBSTANCES
```

The game MUST NOT infer these behaviors from text, taxonomy, social sensitivity, or intensity.

---

## 17. FULL snapshot semantics

v2 supports only:

```text
snapshotKind = FULL
```

The artifact defines the producer's complete current game catalog, locale registry, approved Card localizations, localized taxonomy content, taxonomy defaults, and Card-specific metadata exceptions.

Reconciliation behavior:

- incoming Card → create/update by producer UUID;
- existing Card absent from snapshot → soft-retire Card;
- incoming `RETIRED` Card → persist but exclude from new gameplay;
- retired Card reintroduced as `ACTIVE` → reactivate same UUID;
- incoming Card localization → upsert and activate;
- previously stored Card localization absent from incoming Card → deactivate, do not delete;
- incoming locale → upsert metadata/activity state;
- previously stored locale absent from incoming locale registry → deactivate, do not delete;
- incoming taxonomy defaults → replace the current producer defaults for that taxonomy;
- incoming Card v2 overrides → replace the current producer override fields, including clearing an old override when the property is omitted in the new FULL snapshot;
- resolved producer values are recalculated for all affected Cards within the same transaction.

No catalog application hard-deletes Card history, Card identities, Card appearances, account policies, or previously persisted localization rows.

A release within the same `catalogId` preserves Group-history eligibility. When the active
catalog lineage changes to another `catalogId`, the receiver advances existing Groups to a new
history epoch without deleting their earlier Card appearances.

---

## 18. Validation rules

JSON Schema performs structural validation. Producer and receiver MUST additionally run semantic validation.

### 18.1 Document-level

- unique Card IDs;
- unique locale IDs;
- unique taxonomy IDs within their type;
- `defaultLocale` references an active locale;
- every localization locale references `locales`;
- every Card's localization locales are unique;
- every taxonomy entry's localization locales are unique;
- `sequence >= 1`;
- artifact contains at least one locale and one Card;
- top-level `cardDefaults` exactly matches the fixed v2 values;
- every QuestionCategory and DareType has `defaultSocialSensitivity`.

### 18.2 Card-level

- UUID uses canonical lowercase representation;
- text contains no leading/trailing whitespace;
- existing required gameplay fields are explicit;
- `repeatCooldown == 0` when `repeatableInSession == false`;
- Card-type taxonomy constraints are satisfied;
- every active Card has a localization for `defaultLocale`;
- referenced player-visible taxonomy has a same-locale label for each delivered Card localization;
- every sensitivity value is a defined enum member;
- every supplied minimum player count is an integer >= 2;
- every supplied non-null maximum player count is an integer >= 2;
- every Card resolves a valid sensitivity;
- every Card resolves a valid player-count range;
- effective finite maximum is not below effective minimum.

Semantic validation errors MUST identify the Card UUID or taxonomy ID so producer editors can correct source data efficiently.

### 18.3 Cross-release

For the same Card UUID, the producer MUST NOT silently turn the Card into a materially different gameplay concept.

For releases of the same `catalogId`:

- incoming sequence lower than installed sequence → do not apply;
- same sequence + same SHA-256 → already applied/no-op;
- same sequence + different SHA-256 → invalid immutable-release reuse;
- higher sequence → eligible to apply subject to supported contract/application compatibility.

The sequence does not reset when moving from v1 to v2.

---

## 19. Scalable producer workflow

v2 is intentionally designed for a stable catalog containing thousands or tens of thousands of Cards.

A migration or normal release MUST NOT require setting an audience-specific value on every Card.

Expected v2 adoption workflow:

1. emit the fixed top-level `cardDefaults`;
2. choose one `defaultSocialSensitivity` for each stable QuestionCategory;
3. choose one `defaultSocialSensitivity` for each stable DareType;
4. optionally add taxonomy player-count defaults where an entire taxonomy genuinely shares them;
5. add Card-level sensitivity only for exceptions;
6. add Card-level minimum/maximum counts only when a Card differs from the inherited defaults;
7. run automated distribution/outlier validation.

Adding or revising a game-owned profile normally requires **zero** catalog changes when it can be expressed using existing sensitivity, taxonomy, operational flags, and other stable metadata.

The producer SHOULD report at release time:

- effective Card count per sensitivity level;
- number/percentage inheriting taxonomy sensitivity;
- number/percentage with Card sensitivity overrides;
- Cards with effective minimum > 2;
- Cards with finite effective maximum;
- invalid or suspicious range outliers;
- taxonomy defaults responsible for unusually large distributions.

These diagnostics are tooling requirements, not additional wire fields.

---

## 20. Profile and policy ownership

The catalog MUST NOT contain fields such as:

```text
suitableForChildren
audiences
profileIds
```

Those would create an expensive Card × audience/preset matrix and make every new game
profile a producer-wide migration.

The game owns profiles and scoped Card policies, which combine:

- effective `socialSensitivity`;
- QuestionCategory;
- DareType;
- operational flags;
- existing hard safety/adult gates.

This keeps audience presets editable and application-owned without weakening the producer's responsibility to classify the reusable social-sensitivity dimension accurately. Child-friendly behavior is therefore a normal built-in game profile, not a producer field or a separate policy mechanism.

---

## 21. Fields deliberately not accepted

The v2 artifact does not accept:

- source database row IDs/namespaces;
- raw source payloads;
- normalization warnings/rejected rows;
- a single top-level source-language Card `text`;
- source/translation revision workflow fields;
- draft/review/stale publication states;
- producer-supplied translation content hashes;
- Card UUID generation instructions;
- UI locale support metadata;
- UI translation keys/copy;
- per-account, per-DataSpace, per-Group, or per-Session Card policy;
- exact-Card user exclusions;
- producer-supplied game-profile membership;
- per-audience Card suitability matrices;
- Card-report/moderation workflow fields.

Those concerns belong to producer-internal authoring, game-owned policy, future reporting, or receiver implementation.

---

## 22. UI localization versus Card-content localization

### UI localization

Application-owned compiled/static resources for buttons, menus, dialogs, settings, errors, account flows, profile labels/descriptions, and ordinary application help/copy.

### Card-content localization

Database runtime content delivered by this catalog for Card text, Card language choices, QuestionCategory labels/descriptions, and DareType labels/descriptions.

A Card-content locale can exist and be playable even if the application UI does not support that language.

---

## 23. Producer acceptance checklist

A producer is v2-compliant when it can:

- assign and retain permanent canonical Card UUIDs;
- emit exactly `game-card-catalog/v2`;
- keep sequence monotonic across the v1-to-v2 cutover;
- emit the fixed `cardDefaults` object;
- supply all existing gameplay metadata using stable contract codes;
- classify every QuestionCategory and DareType with a default social sensitivity;
- use sparse Card sensitivity overrides only for exceptions;
- use sparse participant-count metadata with a default minimum of 2 and optional maximum;
- guarantee a valid effective sensitivity and player-count range for every Card;
- maintain the authoritative runtime Card locale registry;
- deliver a default active Card locale;
- deliver all currently approved Card localizations per Card;
- deliver localized taxonomy labels required by those Card localizations;
- issue immutable FULL catalog snapshots with increasing sequence;
- use canonical BCP 47 locale tags;
- never depend on the game to infer social sensitivity from Card text/intensity;
- never depend on game UI language support for Card locale support;
- pass the machine-readable schema and semantic validator without errors.

---

## 24. Contract ownership and evolution

The machine-readable v2 JSON Schema, semantic rules in this document, and shared game contract package together form the normative external contract.

`game-card-catalog/v2` is fixed once approved and published.

The following are ordinary content evolution under v2 and require a new catalog release, not v3:

- add/retire/reactivate a Card;
- change Card text or localization coverage;
- add/deactivate a Card-content locale;
- change a taxonomy label/description;
- change an existing taxonomy's sensitivity/player-count default;
- change a Card-level sensitivity/player-count exception;
- change ordinary existing Card metadata such as intensity, repeatability, cooldown, or weight.

The following are contract evolution and require a later major identifier:

- new/removed/renamed JSON fields;
- changed required/optional/null semantics;
- new/removed enum members;
- changed inheritance order;
- changed meaning/order of a sensitivity level;
- changed FULL snapshot semantics;
- accepting previously unknown properties.

A future delta/patch format must be introduced explicitly and MUST NOT overload or weaken v2 `FULL` semantics.
