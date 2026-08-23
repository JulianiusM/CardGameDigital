# Multiplayer Party Card Game — Game Design Document

**Document status:** Canonical design reference / single source of truth  
**Version:** 1.3
**Working title:** TBD  
**Primary source language:** German (`de-DE`)  
**Game type:** Multiplayer social, party and conversation card game  
**Target platforms:** Responsive web application, smartphones, computers, Kodi, Android TV / Google TV / Fire TV, televisions and projectors  
**Primary content source:** Existing card database with approximately 2,000 German-language cards

---

# 1. Purpose

This document defines the authoritative product and gameplay design.

It covers:

- product vision;
- gameplay principles;
- card taxonomy;
- localization;
- game modes;
- multiplayer behavior;
- profiles;
- player boundaries;
- card history and repetition;
- visual and audio direction;
- UX;
- content lifecycle;
- release scope.

The companion Technical Architecture Document defines how these requirements are implemented technically.

---

# 2. Product Vision

The product is a modern digital multiplayer social card game built around a large curated card collection originating from:

- Wahrheit oder Pflicht;
- Ich hab noch nie;
- conversation games;
- friendship games;
- relationship games;
- drinking and party games;
- intimate couples games.

The game should transform the existing card database into a cohesive multiplayer experience rather than simply presenting random records.

The same game engine should work for:

- colleagues;
- casual friends;
- close friends;
- recurring friend groups;
- dates;
- couples;
- consenting adults seeking intimate content.

The game should be:

- quick to start;
- visually playful;
- easy to understand;
- usable without internet;
- usable without mandatory accounts;
- respectful of individual boundaries;
- resistant to unwanted repetition;
- extensible to additional languages without breaking history or content identity.

---

# 3. Core Design Principles

## 3.1 Social interaction is the game

The software exists to trigger interaction between people.

Players should spend more time:

- talking;
- laughing;
- reacting;
- answering;
- performing dares;
- discussing

than interacting with menus.

---

## 3.2 Cards are visually central

During active play, the primary screen should normally contain:

- active player where applicable;
- card classification;
- card text;
- one or two relevant actions;
- discreet settings access.

Complex permanent navigation should be avoided.

---

## 3.3 One engine supports all modes

All modes share:

- Rooms;
- Sessions;
- Players;
- Groups;
- GameProfiles;
- content filtering;
- localization;
- card history;
- repetition rules;
- multiplayer synchronization.

A Game Mode changes selection and interaction rules, not the underlying infrastructure.

---

## 3.4 Questions and dares have different primary classifications

For **questions**:

> Question Category describes what the question is about.

For **dares**:

> DareType describes what the player actually has to do.

A dare's secondary category is called:

> **Dare Affinity Category**

It describes the kind of conversational comfort level for which the dare is likely to fit.

Question Categories and DareTypes are intentionally independent.

---

## 3.5 A card is language-independent

A Card represents one logical gameplay concept.

Its identity is independent from:

- German wording;
- English wording;
- punctuation;
- grammar;
- localization.

A translation is a localized rendering of the same Card.

This is fundamental because:

- history;
- repetition;
- analytics;
- profiles;
- favorites;
- custom configuration

must continue to refer to the same Card regardless of language.

---

## 3.6 Stable identity is more important than wording

Changing:

> "Was ist dein größter Wunsch?"

to:

> "Was ist momentan dein größter Wunsch?"

must not create a new logical Card.

A new Card is created only when the gameplay meaning changes sufficiently that it should be treated as separate content.

---

## 3.7 Removing content does not erase history

Cards are normally retired rather than deleted.

Retiring a Card prevents new selection while preserving:

- Group history;
- Session records;
- statistics;
- localization records;
- references from custom content.

---

## 3.8 Repetition must always be intentional

The engine distinguishes:

- ordinary cards;
- cards allowed to return in later Sessions;
- cards allowed to repeat within one Session.

No repetition may occur merely because state was lost.

---

## 3.9 Content boundaries are multidimensional

A single "spiciness" slider is insufficient.

A player may accept:

- kissing;

but reject:

- nudity;

or accept:

- intimate physical contact;

but reject:

- involving uninvolved third parties.

DareTypes therefore remain individually configurable.

Intensity is only a secondary pacing dimension.

---

## 3.10 Privacy is part of the gameplay design

Where private devices exist, the game should avoid exposing:

- private boundaries;
- private veto identity;
- private Wahrheit/Pflicht choices before confirmation;
- individual Ich-hab-noch-nie answers where anonymous mode is selected.

The system should quietly respect boundaries.

---

# 4. Canonical Card Model

A logical Card contains gameplay metadata but no language-specific identity.

Conceptually:

```text id="c1o1zw"
Card
----
Stable Card ID
Card Type
Question Category
DareType
Dare Affinity Category
Yes/No compatibility
Intensity
Repeat behavior
Operational flags
Active/retired state
Source metadata
```

Player-facing text belongs to localized Card content.

---

# 5. Card Types

The canonical Card Types are:

- `Fragen`
- `Pflicht`
- `Gespräch`

Internal identifiers must be language-neutral.

Recommended examples:

```text id="7zinz5"
QUESTION
DARE
CONVERSATION_META
```

---

# 6. Questions

Questions use:

> **Question Category**

as their primary content classification.

---

# 7. Dares

Dares use:

> **DareType**

as their primary content classification.

A Dare Affinity Category may additionally describe the kind of group for which the dare is appropriate.

Dare Affinity is secondary metadata and is not the main player-facing dare filter.

---

# 8. Gespräch Cards

`Gespräch` cards are conversation-flow or meta cards.

They are not placed in the ordinary random question pool.

They are scheduled deliberately, especially in **Let's Talk**.

---

# 9. Canonical Question Categories

The current Question Categories are:

## Alltag

General/default everyday content.

Internal code:

`CAT_EVERYDAY`

---

## Kindheit

Childhood, upbringing and early memories.

Internal code:

`CAT_CHILDHOOD`

---

## Persönlichkeit

Personality, values, traits, self-image and opinions.

Internal code:

`CAT_PERSONALITY`

---

## Szenario

Hypothetical or imagined situations.

Internal code:

`CAT_SCENARIO`

---

## Trunkenheit

Alcohol intoxication, excessive drinking and recreational/non-medical drug-related subject matter.

It describes a topic, not an instruction to consume substances.

Internal code:

`CAT_INTOXICATION`

---

## Freundschaft

Friendship and friendship dynamics.

Internal code:

`CAT_FRIENDSHIP`

---

## Beziehung

Love, dating, romance and partnerships.

Internal code:

`CAT_RELATIONSHIP`

---

## Körper

The body and appearance.

Examples include:

- tattoos;
- weight;
- appearance;
- body features;
- physical self-image.

Internal code:

`CAT_BODY`

---

## Sexualität

Sexuality as a personal or identity-related subject.

Internal code:

`CAT_SEXUALITY`

---

## Sex-Offenheit

Openness around sexual topics, attraction and discussion.

Internal code:

`CAT_SEX_OPENNESS`

---

## Sex-Spannung

Sexual preferences, attraction, turn-ons and tension.

Internal code:

`CAT_SEX_TENSION`

---

## Sex-Erfahrung

Sexual experiences, encounters, stories and history.

Internal code:

`CAT_SEX_EXPERIENCE`

---

# 10. Categories Are Not Severity Levels

Question Categories describe subject matter.

They are not guaranteed intensity levels.

For example, one person may find an orientation-related question more personal than a light question about attraction.

Therefore:

> Category and Intensity remain separate dimensions.

---

# 11. Canonical DareTypes

## Blödsinn

Silly and playful actions.

Internal code:

`DARE_SILLY`

---

## Unbeteiligte Dritte

Actions involving people outside the current game.

Internal code:

`DARE_THIRD_PARTY`

This remains separately configurable because it represents an external social boundary.

---

## Kuss

Milder kissing.

Internal code:

`DARE_KISS`

---

## Kuss-Spicy

More intimate kissing.

Internal code:

`DARE_KISS_SPICY`

---

## Berührung

Simple physical contact.

Internal code:

`DARE_TOUCH`

---

## Berührung-Spicy

More intense contact while below the `Berührung-Sexy` classification.

Internal code:

`DARE_TOUCH_SPICY`

---

## Berührung-Sexy

Explicitly intimate physical contact.

Internal code:

`DARE_TOUCH_SEXY`

---

## Kleidung

Clothing-focused actions.

Internal code:

`DARE_CLOTHING`

Clothing actions do not automatically imply nudity.

---

## Nacktheit

Non-sexual nudity.

Internal code:

`DARE_NUDITY`

---

## Sexuelle Spannung

Actions intended to deliberately create sexual tension or arousal.

Internal code:

`DARE_SEXUAL_TENSION`

---

## Borderline Sex

Acts approaching actual sexual activity.

Internal code:

`DARE_BORDERLINE_SEX`

---

## Sex

Explicit sexual acts.

Internal code:

`DARE_SEX`

---

## Sonstiges

Default DareType for dares that do not fit another classification.

Internal code:

`DARE_OTHER`

---

# 12. DareTypes Are Not One Linear Scale

Some types naturally progress:

```text id="96f551"
Berührung
→ Berührung-Spicy
→ Berührung-Sexy
```

and:

```text id="hdh6d2"
Kuss
→ Kuss-Spicy
```

but the taxonomy as a whole is multidimensional.

For example:

- `Unbeteiligte Dritte` concerns outside people;
- `Nacktheit` concerns exposure;
- `Kleidung` concerns clothing;
- `Blödsinn` may be embarrassing but non-intimate.

DareTypes therefore remain individually configurable.

---

# 13. Dare Affinity Category

For a Dare, Category is normalized as:

> **Dare Affinity Category**

Example:

```text id="medkny"
Type = Pflicht
DareType = Kuss-Spicy
DareAffinityCategory = Sex-Spannung
```

means:

- the actual action is `Kuss-Spicy`;
- the dare is considered suitable for groups comfortable with `Sex-Spannung`-level conversation.

Dare Affinity may influence:

- editorial review;
- GameProfile tuning;
- optional weighting.

It does not replace DareType filtering.

---

# 14. Intensity

Cards may have an Intensity value.

Recommended scale:

| Intensity | Meaning                                   |
| --------- | ----------------------------------------- |
| 1         | mild                                      |
| 2         | personal / somewhat challenging           |
| 3         | intimate / strong                         |
| 4         | very intimate / spicy                     |
| 5         | explicit / extreme within allowed content |

For questions, intensity describes personal or emotional intensity.

For dares, intensity describes intensity **within the selected DareType**.

A disabled DareType can never become eligible through intensity escalation.

---

# 15. Operational Flags

Some behaviors are orthogonal to taxonomy.

Examples include:

- requires target player;
- involves uninvolved third party;
- requires physical contact;
- removes clothing;
- requires nudity;
- involves alcohol;
- involves recreational/non-medical substances.

These properties should be represented explicitly.

The game must not infer such behavior solely from Card text or Category.

---

# 16. Localization Model

Localization is part of the content model rather than a later presentation feature.

Every logical Card may have multiple localized versions.

Example:

```text id="m9vpcl"
Card UUID 8fc2...

de-DE
"Was würdest du ...?"

en-GB
"What would you ...?"

fr-FR
"Que ferais-tu ...?"
```

All versions refer to the same Card.

---

# 17. Source Language

The initial canonical source language is:

```text id="w1ijvh"
de-DE
```

The first production catalog may contain only German.

The data model and ingest process must already support additional locales without schema redesign.

---

# 18. Session Content Language

Every Session has one selected:

> **Card Language**

This determines which localized Card text is eligible and displayed.

Examples:

```text id="g41r5w"
de-DE
en-GB
```

All players in a normal Session receive the same Card language so that everyone is discussing the same wording.

A future feature may allow per-client translated display, but this is not part of the canonical first implementation.

---

# 19. Client UI Language

Client UI language is separate from Card Language.

A phone may conceptually use:

```text id="31z91b"
UI language: en-GB
Card language: de-DE
```

UI elements such as:

- Weiter;
- Überspringen;
- Einstellungen

are localized by each client application.

Card text and game-taxonomy labels are localized through the content catalog.

---

# 20. Localized Taxonomy

Player-facing labels for:

- Question Categories;
- DareTypes;
- built-in GameProfiles;
- other catalog-defined classifications

must be localized independently from their internal IDs.

Example:

```text id="7f6qjz"
DARE_TOUCH_SPICY

de-DE:
Berührung-Spicy

en-GB:
Spicy Touch
```

Game logic always uses:

`DARE_TOUCH_SPICY`

and never depends on translated labels.

---

# 21. Localized Card Content Is an Adaptation

A localization does not have to be word-for-word literal.

It should preserve:

- intended gameplay meaning;
- tone;
- social intensity;
- target behavior.

Cultural or grammatical adaptation is allowed.

If a localization changes the underlying gameplay meaning enough to become materially different content, it should become a separate Card with its own Card ID.

---

# 22. Translation Lifecycle

Localized Card content has an editorial lifecycle, but that lifecycle belongs to the
external content producer rather than the game runtime.

Recommended producer-side states include:

```text
DRAFT
REVIEW
PUBLISHED
STALE
```

Only release-approved content is published to the game catalog. The runtime does not
need to store draft, review, or stale editorial state.

---

# 23. Source Revisions and Translation Review

The content producer must track enough source revision information to determine whether
a change to the canonical source wording requires translations to be reviewed.

Example:

```text
Card source revision: 8
English localization reviewed against revision: 7
```

The producer should treat that localization as stale until it has been reviewed or
explicitly approved as unaffected.

Source revision metadata is an authoring concern and does not have to be shipped to the
game runtime.

---

# 24. Source Text Changes

When canonical German wording changes, the producer must decide whether the change:

- preserves the same logical Card;
- requires localized versions to be reviewed;
- or changes gameplay meaning enough to require a new Card ID.

For wording changes that preserve gameplay meaning:

1. the same Card ID remains;
2. the source localization is updated;
3. affected translations are reviewed by the producer;
4. the next catalog release contains only approved localized text.

Minor non-semantic corrections may be approved without translation changes.

---

# 25. Adding a Language

Adding a new Card language requires the producer to:

- register the locale in the catalog;
- provide localized taxonomy labels;
- provide release-approved Card localizations;
- publish a new catalog release.

No new logical Cards are created merely because a new language is introduced.

---

# 26. Removing a Language

Removing or disabling a locale:

- does not remove Cards;
- does not alter Group history;
- does not change Card IDs;
- does not affect other languages.

When a locale or localization disappears from a newer FULL catalog release, the game
runtime soft-disables the corresponding runtime content rather than deleting historical
references.

---

# 27. Card Language Eligibility

A Card is normally eligible in a Session only if the current runtime catalog contains
an active, release-approved localization in the selected Card Language.

If a localization is unavailable, the Card is excluded.

This can reduce the available pool for partially translated languages.

Pool-count warnings should therefore use the selected Card Language.

---

# 28. Translation Fallback

For ordinary client UI strings, locale fallback is allowed.

Example:

```text
de-AT
→ de
→ configured default
```

For Card content, silent fallback is disabled by default.

A deployment or Session may explicitly enable:

> Missing translations → use configured fallback Card language

but the default is:

> Missing translations → exclude Card.

This avoids unexpected mixed-language games.

---

# 29. Card History Across Languages

History always refers to the logical Card ID.

If a Group has already seen Card X in German, that Card is still considered seen if the
Group later plays in English.

Changing language does not reset content history.

This behavior is intentional.

---

# 30. Card Lifecycle

Canonical Card states include at least:

```text
ACTIVE
RETIRED
```

A retired Card:

- is not selected for new games;
- remains in history;
- retains historical localization references where required;
- retains its stable Card identity.

Hard deletion is reserved for exceptional administrative repair where no historical
references exist.

---

# 31. Meaning-Changing Revisions

If an edit changes a Card so substantially that it should count as new gameplay content:

1. retire the old Card;
2. create a new Card ID;
3. optionally link the two in the producer's editorial system.

This preserves historical accuracy.

---

# 32. Content Producer and Source Data

The existing Access database remains a source/content-authoring system, but the game
runtime does not ingest Access directly.

An external producer/editorial pipeline owns:

- source integration;
- source-record mapping;
- stable Card UUID assignment;
- normalization;
- translation review;
- catalog release assembly.

The game consumes one normalized, versioned FULL `game-card-catalog/v1` snapshot.

---

# 33. Stable Source Mapping

The producer must maintain a stable mapping between its source records and canonical
Card IDs.

Conceptually:

```text
source namespace
+
source record identity
→
canonical Card UUID
```

The game runtime does not need to store the producer's source IDs.

The canonical Card UUID is never derived from Card text.

---

# 34. Producer Ingest and Runtime Reconciliation

The producer-side ingest pipeline should:

1. read and preserve source records;
2. resolve existing source-to-Card identity;
3. reuse the existing Card UUID where the logical Card is unchanged;
4. create a new Card UUID only for genuinely new logical content;
5. normalize gameplay metadata;
6. update and review localized content;
7. retire missing/removed logical Cards without reusing their UUIDs;
8. publish a validated FULL catalog snapshot.

The game runtime then:

1. validates the immutable catalog artifact;
2. applies only a newer approved catalog sequence;
3. upserts and activates Cards/localizations present in the FULL snapshot;
4. soft-disables runtime Cards/localizations absent from the newer snapshot;
5. preserves history and stable Card references.

---

# 35. Source Identity Changes

If the external authoring source changes IDs or structure, the producer is responsible
for remapping those records to the existing canonical Card UUIDs.

Text similarity may assist editorial tooling but must never automatically redefine
logical Card identity in the game.

---

# 36. Game Modes

The four canonical Game Modes are:

1. Classic Wahrheit oder Pflicht
2. Random Wahrheit oder Pflicht
3. Ich hab noch nie
4. Let's Talk

---

# 37. Classic Wahrheit oder Pflicht

The active player chooses:

- Wahrheit;
- Pflicht

before a Card is selected.

Selection occurs only after the choice.

---

# 38. Random Wahrheit oder Pflicht

The engine chooses whether the active player receives:

- Frage;
- Pflicht.

Selection follows a target ratio rather than unrestricted independent randomness.

The system should avoid excessively long same-type streaks.

---

# 39. Ich hab noch nie

Eligible Cards:

```text
Card Type = QUESTION
YesNoAnswerPossible = true
```

plus all normal:

- language;
- Question Category;
- GameProfile;
- boundary;
- history;
- repeat

rules.

Every active player in the current voting set answers once.

## Answer Reveal Mode

`Ich hab noch nie` remains one Game Mode. Answer visibility is a Session setting rather
than a separate mode because card eligibility, voting, pacing, and progression are
otherwise identical.

Canonical setting:

```text
neverHaveIEverRevealMode
```

with two values:

```text
ANONYMOUS_AGGREGATE
NAMED_ANSWERS
```

Default:

```text
ANONYMOUS_AGGREGATE
```

The reveal mode is selected before the Session starts and is locked for the duration of
that active Session. It must not be changed after players have started voting, because
participants must know whether their answer will later be public.

The selected reveal mode must be visible on the voting screen before any answer is
submitted.

### Anonymous aggregate

During collection, answer values remain private.

After all required votes have been submitted, the result shows only aggregate totals,
for example:

> Ja: 3
> Nein: 4

No association between a player and their answer is revealed.

### Named answers

During collection, answer values remain private exactly as in anonymous mode.

After all required votes have been submitted, the reveal shows every player's name and
answer. The aggregate totals may remain visible as a summary.

Example:

```text
Anna     Ja
Ben      Nein
Lea      Ja
Chris    Nein
```

Named answers are public Session state after the reveal. They are still ephemeral game
data and are not persisted as long-term player-history or analytics records by default.

## Voting Progress

While votes are being collected, every game presentation must show who has and has not
yet voted.

For every player in the current voting set, show:

```text
PENDING
VOTED
```

with the player's display name.

Example:

```text
Anna      ✓ Abgestimmt
Ben       • Wartet
Lea       ✓ Abgestimmt
Chris     • Wartet
```

Voting progress is public in both reveal modes.

On a Party Screen, the Card, reveal-mode indicator, result totals, and current voting
state remain on the public stage without requiring manual scrolling. When the full
voter roster or named-answer columns cannot fit, only the variable roster rows are
automatically paged. Pages advance and wrap continuously while the Card and the column
or progress headings remain fixed.

The progress display must never expose whether a submitted vote was `YES` or `NO` before
the result reveal.

The voting set is determined for the current Card when answer collection begins. A
player joining during active play participates from the next applicable Card according
to the normal Session-roster rules.

## Completion

The result reveal occurs only after every required player in the current voting set has
submitted an answer.

A reconnecting player who has not yet voted remains pending and may submit after
reconnection.

The game does not automatically rewrite arbitrary questions into "Ich habe noch nie..."
statements.

---

# 40. Let's Talk

Only questions and Gespräch/meta cards are used.

Gespräch Cards are scheduled deliberately rather than mixed into the ordinary question pool.

Possible triggers include:

- completed round;
- configured question count;
- elapsed time;
- conversation phase.

---

# 41. Device Modes

Three canonical device configurations exist.

---

## Couch Mode

One shared device controls and displays the game.

No phones are required.

---

## Personal Mode

Every participant uses an individual device.

No central display is required.

---

## Party Screen Mode

A TV/projector is the shared stage.

Phones act as:

- private controllers;
- voting devices;
- settings interfaces;
- boundary interfaces.

This is the flagship multiplayer experience.

The Party Screen is a passive public stage. It shows the Room identity, connection/player
state, current Card, active player where applicable, public voting progress, and public
results. It never shows private controls, private boundaries, participant credentials,
or actions that submit gameplay decisions. Its active-play presentation fits within the
viewport without document scrolling; overflowing public rosters use automatic,
wrapping pagination.

---

# 42. Rooms

A Room is the temporary networking container for connected clients.

Rooms have:

- short join code;
- optional QR code;
- host;
- connected clients;
- current Session where applicable.

Accounts are not required for ordinary Room participants.

---

# 43. Players and Groups

## Player

A participant in the current Session.

## Group

A persistent real-world playing group used for long-term Card history.

Examples:

- WG Freitag
- Büro-Team
- Anna & Ben

The host deliberately selects which Group history applies.

---

# 44. Persistent Group History

A Card shown to Group A is normally excluded from later Sessions for Group A.

The same Card remains available to Group B.

History is language-independent because it references the logical Card ID.

---

# 45. Session History

Ordinary Cards do not repeat within the same Session.

A Card is recorded as shown when committed for display, not only when completed.

---

# 46. AlwaysEligible

Card property:

`AlwaysEligible`

If enabled:

- Group-history exclusion is ignored;
- Session-history exclusion still applies unless the Card is also repeatable.

---

# 47. RepeatableInSession

Card property:

`RepeatableInSession`

If enabled:

- the Card may return during the same Session;
- repeat cooldown still applies.

---

# 48. Repeat Matrix

| AlwaysEligible | RepeatableInSession | Behavior                                                   |
| -------------- | ------------------- | ---------------------------------------------------------- |
| No             | No                  | Ordinary Card                                              |
| Yes            | No                  | May return in later Sessions, once per current Session     |
| No             | Yes                 | Subject to Group history, may recur within current Session |
| Yes            | Yes                 | Evergreen Card that may also recur within the Session      |

---

# 49. Repeat Cooldown

Recommended default:

> at least 10 other displayed Cards.

A Card-specific cooldown may override this.

---

# 50. Question Eligibility

Question selection applies:

1. Card Type;
2. Game Mode rules;
3. Yes/No requirement where applicable;
4. selected Card Language;
5. published localization availability;
6. Question Category;
7. GameProfile;
8. player boundaries;
9. intensity/phase;
10. active state;
11. Session history;
12. Group history;
13. repeat rules;
14. weighting;
15. random selection.

---

# 51. Dare Eligibility

Dare selection applies:

1. Card Type;
2. selected Card Language;
3. published localization availability;
4. DareType;
5. GameProfile;
6. player DareType boundaries;
7. operational flags;
8. optional Dare Affinity logic;
9. intensity/phase;
10. active state;
11. Session history;
12. Group history;
13. repeat rules;
14. weighting;
15. random selection.

Question Category is not the primary Dare filter.

---

# 52. Pool Exhaustion

The engine never silently relaxes filters.

When no eligible Cards remain:

> Keine neuen Karten mehr.

Possible actions:

- broaden Question Categories;
- enable additional DareTypes;
- allow previously seen Cards;
- change GameProfile;
- change Card Language where appropriate;
- end the game.

For partially translated languages, the UI should be able to show:

> X Cards are available in this language with the current settings.

---

# 53. GameProfiles

A GameProfile configures:

## Questions

- enabled Question Categories;
- optional Intensity maximum;
- weighting.

## Dares

- enabled DareTypes;
- optional Intensity maximum;
- operational restrictions;
- optional Dare Affinity weighting.

## Game behavior

Potentially:

- question/dare ratio;
- escalation;
- meta-card frequency.

Built-in GameProfiles have localized display names and descriptions.

Custom GameProfiles use the name entered by the user and are not automatically translated.

---

# 54. Built-In Profiles

Canonical profile concepts include:

- Kollegen;
- Freunde;
- Beste Freunde;
- Paare;
- Paare – Spicy;
- Custom.

The current release uses conservative, data-driven operational defaults. Every
built-in profile blocks third-party, alcohol, and recreational-drug requirements.
Colleagues additionally blocks contact, private-space, clothing-removal, and
nudity requirements. Friends and Best Friends progressively permit consensual
contact-related rules. Couples presets permit the private/contact rules that fit
their declared content range. Custom starts neutral with every additional rule
blocked until the Host explicitly enables it. These values remain catalog data
and should be reviewed alongside each production Card release.

---

# 55. Player Boundaries

Phone-enabled modes should support private boundaries.

Question boundaries operate on:

- Question Categories.

Dare boundaries operate primarily on:

- DareTypes;
- selected operational flags.

---

# 56. Dare Boundary Resolution

Until Card metadata allows reliable target-specific consent calculation:

> A DareType disabled by any active participant is unavailable for the Session.

Future target-aware logic may narrow this rule where safely possible.

---

# 57. Boundary Privacy

The shared display must not identify which player disabled sensitive content.

The corresponding Cards simply never become eligible.

---

# 58. Skip and Veto

A player can always:

> Überspringen.

Skipping has no default penalty.

Phone-enabled modes may additionally support anonymous private veto.

A vetoed revealed Card still counts as seen.

---

# 59. Player Rotation

Turn-based modes use:

1. random starting player;
2. stable order;
3. cycle through active players;
4. complete a round after every player has taken a turn.

---

# 60. Session Duration

Default:

> open-ended.

Optional targets:

- time;
- number of Cards.

Reaching a target offers continuation rather than forced termination.

---

# 61. Main Menu

Recommended hierarchy:

- Neues Spiel
- Gruppe fortsetzen
- Profile
- Einstellungen

Secondary management areas may later include:

- Kartenverwaltung
- Sprachverwaltung
- Statistiken

---

# 62. New Game Setup

The main entry presents three explicit paths:

- **Host Game**;
- **Join Game**;
- **Display Only**.

The canonical Host wizard sequence is:

1. Group — No Group, Select Group, or New Group;
2. Game Mode;
3. GameProfile, including Custom;
4. Customize Experience;
5. Screen Selection.

Customize Experience contains the complete canonical settings editor, including Card
Language and all mode-specific settings. For `Ich hab noch nie`, this is where the Host
selects **Anonym** or **Antworten offen**. It is not repeated as a separate wizard page.
Anonymous aggregate is the default.

After Screen Selection, Couch starts local player setup and the other screen choices
create a Room. Join Game asks for participant name and Room code; Display Only asks for
the Room code and joins as a read-only Party Screen. A safe deep join URL may prefill
the code, but never contains participant credentials.

---

# 63. Advanced Question Settings

Heading:

> Über welche Themen wollt ihr sprechen?

Display localized Question Category names.

---

# 64. Advanced Dare Settings

Heading:

> Welche Arten von Pflichten sind okay?

Display localized DareType names.

DareTypes may be grouped visually for readability without changing the taxonomy.

---

# 65. In-Game Settings

The in-game modal may contain:

## Audio

- music;
- sound effects.

## Display

- animations;
- reduced motion;
- larger text.

## Content

- Question Categories;
- DareTypes;
- escalation;
- Card Language where changing it mid-Session is intentionally allowed.

Changing Card Language applies only to future Cards and does not reset history.

For an active `Ich hab noch nie` Session, the Answer Reveal Mode is displayed as a
read-only Session property. It cannot be changed until a new Session is started.

## Players

- player management;
- QR code.

## Session

- pause;
- end.

---

# 66. Visual Identity

The game should be:

- modern;
- playful;
- colorful;
- polished;
- readable;
- mature enough for harmless and adult content.

---

# 67. Visual Hierarchy for Questions

```text id="icgvbt"
Card Type
    ↓
primary identity

Question Category
    ↓
secondary visual atmosphere
```

---

# 68. Visual Hierarchy for Dares

```text id="zk5n0l"
Card Type
    ↓
primary identity

DareType
    ↓
secondary visual atmosphere
```

Dare Affinity normally has no player-facing visual effect.

---

# 69. Gespräch Visual Treatment

Gespräch/meta Cards should feel like intentional pauses.

Possible characteristics:

- softer movement;
- additional whitespace;
- slower reveal;
- distinct frame.

---

# 70. Audio

Audio is optional.

Use:

- subtle ambient loops;
- restrained sound effects.

All required local-play audio must be bundled with the game.

---

# 71. Accessibility

The game should support:

- large touch targets;
- keyboard input where relevant;
- TV remote control;
- readable contrast;
- scalable text;
- reduced motion;
- non-color-only status;
- clear focus states.

Localization must support languages with longer strings without breaking layout.

UI components must not assume German text length.

---

# 72. Localization UX

Language selection should show native names where practical.

Example:

```text id="q7v88y"
Deutsch
English
Français
```

The interface should clearly distinguish:

- interface language;
- Card language

where both are configurable.

---

# 73. Missing Translation UX

If a selected Card Language has incomplete coverage, setup may show:

> 1,437 Cards available in English.

The system should not imply that unavailable translations are errors during gameplay.

They simply reduce the eligible content pool.

---

# 74. Content Administration

Card administration belongs to the external Card management system, not the game.
That system owns permanent UUID assignment, gameplay metadata, lifecycle, localization
review, localized taxonomy copy, and release assembly. The game only consumes a
release-ready immutable catalog snapshot.

---

# 75. Translation Administration

The external Card management system should let its editors:

- filter untranslated Cards;
- filter stale translations;
- compare source revision with translation;
- publish reviewed translations;
- retire a locale or Card localization;
- report coverage.

Example coverage:

```text id="9m0ne7"
de-DE: 100%
en-GB: 72%
fr-FR: 18%
```

---

# 76. Data Normalization

Production logic must use stable internal codes/IDs.

It must not rely on free-form labels such as:

- `Berührung`
- `berührung`
- `Berührung `

or translated strings.

---

# 77. Duplicate Detection

Because content comes from multiple source games, duplicate detection should eventually identify:

- exact duplicates;
- small wording variants;
- semantically similar Cards.

Potential duplicates are reviewed manually.

Localization similarity must not automatically merge logical Card identity.

---

# 78. Accounts

Accounts are optional for joining games.

Public accounts may provide:

- persistent Groups;
- cross-device history;
- custom GameProfiles;
- custom Cards;
- language preferences;
- cloud synchronization.

Guests can still join Rooms without registration.

---

# 79. Privacy

Persistent storage should avoid unnecessary sensitive data.

Individual `Ich hab noch nie` answers are ephemeral in both reveal modes. In
`NAMED_ANSWERS`, they become public Session state only after the reveal; they are not
stored as long-term player-history or analytics records by default.

Before voting, the UI must clearly indicate whether the current Session uses anonymous
aggregate or named-answer reveal.

Private boundaries should not be retained longer than necessary.

Localization does not change this policy.

---

# 80. Adult Content

Profiles enabling explicit DareTypes are intended only for consenting adults.

Public distribution must implement suitable:

- content gating;
- age handling;
- platform-policy compliance;
- regional legal review.

---

# 81. Social Safety

Core rules:

- skipping is always possible;
- no default punishment for refusal;
- private boundaries remain private;
- escalation cannot enable disabled content;
- explicit content requires deliberate eligibility;
- third-party involvement remains separately configurable.

---

# 82. Content Release Lifecycle

A catalog release may:

- add Cards;
- retire Cards;
- update Card metadata;
- update wording;
- add translations;
- retire translations;
- update localized taxonomy labels.

It must not:

- reassign existing logical Card identity because wording changed;
- erase Group history;
- silently merge distinct Cards.

---

# 83. Initial Release Scope

The first complete product should support:

## Game Modes

- Classic Wahrheit oder Pflicht
- Random Wahrheit oder Pflicht
- Ich hab noch nie
- Let's Talk

## Device Modes

- Couch
- Personal
- Party Screen

## Ich hab noch nie

- `ANONYMOUS_AGGREGATE` reveal mode;
- `NAMED_ANSWERS` reveal mode;
- visible per-player `PENDING` / `VOTED` progress during answer collection;
- no answer values exposed before reveal.

## Content

- stable logical Card IDs;
- Question Categories;
- DareTypes;
- Dare Affinity;
- Yes/No compatibility;
- repeat settings;
- producer-owned stable Card UUIDs;
- German `de-DE` localization.

## Localization Foundation

- language-independent Card model;
- locale-aware taxonomy;
- Card localization records;
- producer-side source/translation revision tracking;
- missing-translation eligibility rules.

Shipping an additional translated Card catalog is optional for the first release, but no schema redesign may be required to add one.

---

# 84. Later Localization Features

Potential later features:

- additional Card languages;
- downloadable language packs;
- translator workflow;
- community translation review;
- per-client translated Card display;
- machine-assisted draft translations;
- locale-specific content variants.

Machine-generated text must not become `PUBLISHED` automatically without the chosen editorial policy.

---

# 85. Canonical Content Model

```text id="d3e8z8"
                     LOGICAL CARD
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
      QUESTION           DARE             META
        │                 │                 │
 QuestionCategory      DareType       Meta Scheduler
                          │
                   DareAffinity
```

Shared Card metadata includes:

```text id="2bkoq0"
Stable Card ID
Intensity
History rules
Repeat rules
Operational flags
Producer-owned stable identity
Lifecycle state
```

Localized content exists separately:

```text id="h1b4rc"
Logical Card
   │
   ├── de-DE localization
   ├── en-GB localization
   └── ...
```

---

# 86. Canonical Selection Model

Questions:

```text id="mdm14n"
Game Mode
+
Card Language
+
Published localization
+
Question Categories
+
GameProfile
+
Player boundaries
+
Intensity / phase
+
Session history
+
Group history
+
Repeat rules
=
Eligible Questions
```

Dares:

```text id="htsaeg"
Game Mode
+
Card Language
+
Published localization
+
DareTypes
+
GameProfile
+
Player boundaries
+
Operational flags
+
optional Dare Affinity
+
Intensity / phase
+
Session history
+
Group history
+
Repeat rules
=
Eligible Dares
```

---

# 87. Foundational Product Decisions

The following are canonical:

1. A Card is language-independent.
2. Card history refers to logical Card ID, not localized text.
3. Card IDs never derive from wording.
4. Questions are primarily classified by Question Category.
5. Dares are primarily classified by DareType.
6. Dare Affinity is secondary metadata.
7. Category and Intensity are separate concepts.
8. DareTypes are not replaced by one severity slider.
9. Missing Card translations are excluded by default rather than silently falling back.
10. UI language and Card language are separate concepts.
11. Built-in taxonomy labels are localized independently from internal identifiers.
12. Source changes preserve Card identity unless gameplay meaning changes materially.
13. Source revision changes may invalidate translations.
14. Cards are retired rather than deleted when removed from active content.
15. Group history survives language changes.
16. AlwaysEligible and RepeatableInSession remain independent.
17. Gespräch Cards use pacing logic rather than ordinary random selection.
18. `Ich hab noch nie` uses one Game Mode with a pre-Session Answer Reveal Mode setting.
19. During `Ich hab noch nie` voting, player completion status is public but answer values remain private until reveal.
20. `NAMED_ANSWERS` reveals each player's answer only after all required votes are submitted.
21. The `Ich hab noch nie` reveal mode cannot change during an active Session.
22. Phones are supporting controllers in Party Screen Mode.
23. The server remains authoritative.
24. Accounts are not required for ordinary party participants.

---

# 88. Acceptance Criteria

The design is correctly implemented when:

- changing Card wording does not reset history;
- adding another language does not duplicate Cards;
- removing a translation does not delete a Card;
- retiring a Card preserves old Session/history references;
- switching a Group from German to English does not make previously seen logical Cards "new";
- unpublished/missing translations cannot appear accidentally;
- localized labels never determine game logic;
- all four Game Modes use the same logical Card identities;
- Question Category and DareType filtering behave independently;
- Session and Group deduplication remain correct;
- AlwaysEligible and RepeatableInSession remain independent;
- untranslated content reduces the pool predictably;
- the UI communicates language coverage clearly where relevant;
- producer catalog releases preserve stable Card UUIDs while runtime FULL reconciliation soft-disables removed content;
- `Ich hab noch nie` defaults to anonymous aggregate reveal;
- named-answer reveal exposes every player's answer only after all required votes are submitted;
- while voting, every player is visibly marked `PENDING` or `VOTED`;
- vote progress never reveals `YES`/`NO` values before the reveal;
- the reveal mode is visible before voting and cannot change during an active Session;
- individual answers are not stored as long-term history or analytics by default;
- explicit content boundaries remain respected in every language.

---

# 89. Final Product Summary

The game is one multilingual-capable social-card platform built around stable logical content.

The core principle is:

> **A Card is the game concept. A translation is one way of presenting that concept.**

This allows the product to evolve its content and languages without breaking:

- history;
- repetition;
- Groups;
- GameProfiles;
- analytics;
- future synchronization.

The player-facing experience remains simple:

**join, choose how and in which language you want to play, receive a Card, interact with one another, and continue for as long as the group is having fun.**
