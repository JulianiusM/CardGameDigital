# Multiplayer Party Card Game — Game Design Document

**Document status:** Canonical design reference / single source of truth  
**Version:** 1.1  
**Working title:** TBD  
**Primary language:** German  
**Game type:** Multiplayer social, party and conversation card game  
**Target platforms:** Responsive web application / PWA for televisions, computers, tablets and smartphones  
**Primary content source:** Existing German-language card database with approximately 2,000 cards

---

# 1. Purpose of This Document

This Game Design Document defines the authoritative product design for the game.

It covers:

- product vision;
- terminology;
- content taxonomy;
- game modes;
- card selection;
- profiles;
- groups and persistence;
- multiplayer interaction;
- privacy and player boundaries;
- UI and UX;
- visual and audio direction;
- accessibility;
- database semantics;
- technical architecture;
- content administration;
- edge cases;
- release priorities.

The document is intended to remain the **single source of truth** for future design and implementation.

Where implementation details have not yet been fixed, the document identifies them as open design decisions rather than presenting competing rules.

---

# 2. Product Vision

The product is a modern digital multiplayer social card game built around an existing collection of approximately 2,000 German-language cards originating from games such as:

- Wahrheit oder Pflicht;
- Ich hab noch nie;
- conversation games;
- friendship games;
- relationship games;
- drinking and party games;
- intimate couples games.

The game should transform the existing card database into a cohesive multiplayer experience rather than simply displaying random database entries.

The product should work for very different social contexts, including:

- colleagues;
- casual friends;
- close friends;
- established friend groups;
- dates;
- couples;
- adult couples seeking more intimate content.

The same underlying game engine should support all of these contexts through profiles, filtering, player boundaries and different game modes.

---

# 3. Core Design Principles

## 3.1 The social interaction is the game

The card exists to create interaction between players.

The software should facilitate that interaction rather than becoming the focus itself.

Players should spend more time:

- talking;
- laughing;
- answering;
- reacting;
- performing dares;
- interacting with one another

than navigating the interface.

---

## 3.2 Cards remain visually central

During gameplay the card should dominate the screen.

Supporting UI should normally be limited to:

- active player;
- card type;
- relevant content classification;
- one or two actions;
- discreet settings access.

Complex toolbars and permanent navigation should be avoided.

---

## 3.3 One engine supports all game modes

The game must not be implemented as four unrelated products.

All modes share:

- rooms;
- sessions;
- players;
- groups;
- profiles;
- content filters;
- card history;
- repeat rules;
- multiplayer synchronization;
- visual presentation.

A game mode modifies how eligible cards are selected and how players interact with them.

---

## 3.4 Questions and dares use different primary classifications

This is a foundational content rule.

For **questions**:

> `Category` describes what the question is about and is the primary content classification.

For **dares**:

> `DareType` describes what the player actually has to do and is the primary content classification.

A dare's existing `Category` value has a different purpose:

> It describes the type of group or conversational comfort level for which the dare is likely to fit.

In the normalized application model this concept is called **Dare Affinity Category**.

Question categories and DareTypes therefore must not be treated as equivalent filters.

---

## 3.5 Setup must remain fast

A normal group should be able to start playing with only a few decisions:

1. game mode;
2. device mode;
3. game profile;
4. group/players;
5. start.

Advanced configuration must remain available without becoming mandatory.

---

## 3.6 Repetition is deliberate

The engine must never accidentally repeat cards because it failed to track state.

The system explicitly distinguishes:

- normal cards;
- cards allowed to return in later sessions;
- cards allowed to repeat within the same session.

---

## 3.7 Content boundaries are multidimensional

A single "spiciness" slider is not sufficient.

For example, a player may be comfortable with:

- kissing;

but not:

- nudity;

or may be comfortable with:

- intimate physical contact;

but not:

- contacting uninvolved third parties.

DareTypes therefore remain individually selectable.

A secondary intensity system may influence pacing **within** an allowed type but never replaces DareType filtering.

---

## 3.8 Privacy should be built into multiplayer interaction

When individual devices are available, private preferences should not automatically become public.

Examples include:

- private content boundaries;
- private Wahrheit/Pflicht choices;
- private vetoes;
- anonymous voting.

The game should quietly respect a boundary rather than announce who established it.

---

## 3.9 The system should degrade gracefully

Loss of a phone, network interruption or exhausted card pool should not destroy a session.

The game should always provide a clear continuation path.

---

# 4. Existing Source Data

The existing source database contains approximately 2,000 cards.

Current table:

## Cards

| Column | Current type | Purpose |
|---|---|---|
| ID | AutoNumber | Unique card identifier |
| CardText | Long Text | German card text |
| Type | Short Text | Main card type |
| Origin | Short Text | Original source/game |
| OriginCategory | Short Text | Category in original source |
| YesNoAnswerPossible | Yes/No | Whether yes/no answering is possible |
| Category | Short Text | Current project category |
| DareType | Short Text | Dare classification |

The source may remain in Access or be imported from Access into another format.

The production game database should use a normalized structure described later in this document.

---

# 5. Canonical Card Types

The game currently recognizes three main card types.

## 5.1 Fragen

Normal questions.

Primary classification:

**Question Category**

---

## 5.2 Pflicht

Actions or dares.

Primary classification:

**DareType**

Secondary classification:

**Dare Affinity Category**

---

## 5.3 Gespräch

Meta/conversation-flow cards.

These are not treated as ordinary random questions.

They are inserted through a pacing system, especially in **Let's Talk**.

Only approximately 3–5 such cards currently exist.

---

# 6. Canonical Question Categories

The following categories are authoritative for the current content set.

## Alltag

Default/general everyday content.

Examples include ordinary life, habits, preferences and common situations that do not fit a more specific category.

Internal code recommendation:

`CAT_EVERYDAY`

---

## Kindheit

Childhood, upbringing and memories from early life.

Internal code:

`CAT_CHILDHOOD`

---

## Persönlichkeit

Personality, values, character, self-perception, opinions and personal traits.

Internal code:

`CAT_PERSONALITY`

---

## Szenario

Hypothetical situations.

Examples:

- "Was würdest du tun, wenn …?"
- "Wen würdest du mitnehmen …?"
- imagined choices;
- fictional situations.

Internal code:

`CAT_SCENARIO`

---

## Trunkenheit

Alcohol intoxication, excessive drinking and recreational/non-medical drug-related subject matter.

Normal medication is excluded from this category.

This category describes **subject matter**. It does not by itself indicate that a player must consume alcohol or another substance.

Internal code:

`CAT_INTOXICATION`

---

## Freundschaft

Friendship, friendship dynamics and relationships between friends.

Internal code:

`CAT_FRIENDSHIP`

---

## Beziehung

Love, dating, romantic relationships and partnerships.

Internal code:

`CAT_RELATIONSHIP`

---

## Körper

The physical body and appearance.

Examples:

- tattoos;
- weight;
- appearance;
- body features;
- physical self-image.

Internal code:

`CAT_BODY`

---

## Sexualität

Questions about sexuality as a personal characteristic or identity-related subject.

Examples include:

- sexual orientation;
- gender-related sexuality topics;
- how a person describes their sexuality.

Internal code:

`CAT_SEXUALITY`

---

## Sex-Offenheit

Questions about openness surrounding sexual subjects and attraction.

Examples:

- whether somebody talks with friends about sexual subjects;
- whether somebody currently has a crush on someone in the room;
- comfort discussing sexual matters.

Internal code:

`CAT_SEX_OPENNESS`

---

## Sex-Spannung

Questions involving sexual attraction, preferences and tension.

Examples:

- turn-ons;
- preferences;
- things a player finds sexually appealing.

Internal code:

`CAT_SEX_TENSION`

---

## Sex-Erfahrung

Questions concerning sexual experiences, encounters, stories and personal history.

Internal code:

`CAT_SEX_EXPERIENCE`

---

# 7. Question Categories Are Not an Intensity Scale

The categories:

- Sexualität;
- Sex-Offenheit;
- Sex-Spannung;
- Sex-Erfahrung

describe **different subjects**, not four guaranteed levels of severity.

For example, one player may consider a question about orientation more personal than a light question about turn-ons.

Therefore:

> Category and intensity are separate dimensions.

Profiles may enable or disable individual categories independently.

---

# 8. Canonical DareTypes

DareType is the authoritative classification for `Pflicht` cards.

The following DareTypes are canonical.

---

## Blödsinn

Silly, playful or ridiculous actions.

Examples may include:

- acting;
- making noises;
- doing deliberately absurd things.

Internal code:

`DARE_SILLY`

---

## Unbeteiligte Dritte

Actions involving somebody who is not participating in the current game.

Examples:

- calling someone from the player's contacts;
- sending a message;
- involving an outside person in some other way.

Internal code:

`DARE_THIRD_PARTY`

This type represents a separate boundary from sexual or physical intensity and must always remain individually configurable.

---

## Kuss

Non-intimate or relatively mild kissing.

Examples:

- hand;
- forehead;
- cheek;
- objects where appropriate.

Internal code:

`DARE_KISS`

---

## Kuss-Spicy

More intimate kissing.

Examples:

- mouth;
- neck;
- similarly intimate locations.

Internal code:

`DARE_KISS_SPICY`

---

## Berührung

Simple physical contact.

Examples:

- holding;
- embracing;
- normal touch.

Internal code:

`DARE_TOUCH`

---

## Berührung-Spicy

More intense touch that remains below the `Berührung-Sexy` classification.

Examples:

- touching underneath clothing on comparatively non-sexual areas such as the back;
- contact with more intimate areas such as the buttocks.

Internal code:

`DARE_TOUCH_SPICY`

---

## Berührung-Sexy

Explicitly intimate touch.

Examples:

- between the legs;
- fingers in another person's mouth;
- pinning another person;
- similarly intimate physical interaction.

Internal code:

`DARE_TOUCH_SEXY`

---

## Kleidung

Actions involving clothing.

Examples:

- exchanging clothing;
- removing individual pieces of clothing;
- other clothing-focused dares.

Internal code:

`DARE_CLOTHING`

A `Kleidung` dare does not automatically imply nudity.

---

## Nacktheit

Non-sexual nudity.

Examples:

- flashing;
- naked dancing;
- stripping down;
- comparing bodies.

Internal code:

`DARE_NUDITY`

Nudity is treated separately from `Sex`.

---

## Sexuelle Spannung

Actions intended to deliberately create sexual tension or arousal without crossing into `Borderline Sex` or `Sex`.

Examples:

- attempting to turn someone on;
- breathing against somebody's skin.

Internal code:

`DARE_SEXUAL_TENSION`

---

## Borderline Sex

Actions approaching actual sexual activity without being classified as `Sex`.

Examples:

- clothed grinding;
- private intimate "shows";
- similar acts near the boundary of sexual activity.

Internal code:

`DARE_BORDERLINE_SEX`

---

## Sex

Explicit sexual acts.

Internal code:

`DARE_SEX`

This category may include direct sexual stimulation or sexual acts and is intended only for appropriately configured adult profiles.

---

## Sonstiges

Default DareType for dares that do not fit another type.

Internal code:

`DARE_OTHER`

---

# 9. DareType Is Not a Single Escalation Ladder

Some DareTypes form natural progressions:

```text
Berührung
→ Berührung-Spicy
→ Berührung-Sexy
```

and:

```text
Kuss
→ Kuss-Spicy
```

and approximately:

```text
Sexuelle Spannung
→ Borderline Sex
→ Sex
```

However, the complete DareType system is **not** a single severity hierarchy.

For example:

- `Unbeteiligte Dritte` concerns external social boundaries;
- `Nacktheit` concerns exposure;
- `Kleidung` concerns clothing;
- `Blödsinn` may involve embarrassment without physical intimacy.

The user must therefore be able to allow or exclude DareTypes directly.

---

# 10. Dare Affinity Category

The existing `Category` value on a dare is retained, but its meaning is explicitly different from the Category of a question.

For a dare:

> Category indicates the kind of group that would probably also be comfortable answering questions from that category.

Example:

```text
Type = Pflicht
DareType = Kuss-Spicy
Category = Sex-Spannung
```

means:

- the actual action is classified as `Kuss-Spicy`;
- the dare is considered socially compatible with groups comfortable with `Sex-Spannung` subject matter.

In the normalized production database this field should be called:

**DareAffinityCategory**

It is secondary metadata.

---

# 11. How Dare Affinity May Be Used

Dare Affinity Category may be used for:

- profile tuning;
- editorial review;
- optional selection weighting;
- recommendation logic;
- analyzing content consistency.

It is **not** the main dare eligibility filter.

The default hard filter for a dare is its DareType.

Player-facing Question Category toggles must not automatically disable dares sharing the same affinity category.

Example:

Disabling `Sex-Erfahrung` questions does **not** automatically disable:

- Berührung-Sexy;
- Kuss-Spicy;
- Sexuelle Spannung;
- other allowed DareTypes.

---

# 12. Secondary Intensity Property

A generic intensity property remains useful, but has a secondary role.

Recommended scale:

| Intensity | Meaning |
|---|---|
| 1 | mild |
| 2 | personal / somewhat challenging |
| 3 | intimate / strong |
| 4 | very intimate / spicy |
| 5 | explicit / extreme within the allowed profile |

For questions:

> Intensity describes how personally or emotionally demanding a particular question is.

For dares:

> Intensity describes how intense a particular dare is **within its DareType**.

For example, two `Kleidung` dares may have very different intensities.

DareType always remains the primary boundary.

---

# 13. Operational Card Flags

Some card properties represent game mechanics rather than subject matter.

These should not be hidden inside Category or DareType.

The normalized model should support optional operational flags.

Possible examples:

- `REQUIRES_TARGET_PLAYER`
- `INVOLVES_THIRD_PARTY`
- `REQUIRES_PHYSICAL_CONTACT`
- `REQUIRES_PRIVATE_SPACE`
- `REMOVES_CLOTHING`
- `REQUIRES_NUDITY`
- `INVOLVES_ALCOHOL`
- `INVOLVES_RECREATIONAL_DRUGS`

Not every card needs every flag.

Flags should be introduced where they serve concrete game logic.

---

# 14. Substance-Related Content

`Trunkenheit` is a question/content topic.

If a dare actively requires:

- consuming alcohol;
- consuming a recreational/non-medical substance;
- interacting with such substances

this must be represented by a dedicated operational flag.

The game must never infer required consumption merely from:

`Category = Trunkenheit`

Profiles can then independently control:

- discussion of intoxication/drug experiences;
- actual substance-related actions.

---

# 15. Source and Production Data Strategy

The original Access data should be preserved.

Recommended architecture:

```text
Access / original export
        ↓
     raw_cards
        ↓
validation + normalization
        ↓
normalized game tables
        ↓
     game engine
```

The raw layer exists so that:

- no original metadata is lost;
- imports remain reproducible;
- migration bugs can be corrected;
- original category assignments remain auditable.

The game should operate on normalized tables rather than directly depending on free-form source strings.

---

# 16. Canonical Normalized Card Semantics

A normalized card should conceptually support:

```text
Card
----
ID
CardText
CardType
Origin
OriginCategory
YesNoAnswerPossible

QuestionCategoryID
DareTypeID
DareAffinityCategoryID

Intensity
AlwaysEligible
RepeatableInSession
RepeatCooldown
Weight
Active
```

Operational flags may use either:

- explicit columns;
- a separate card-flags relation.

---

## For Fragen

```text
QuestionCategoryID = required
DareTypeID = NULL
DareAffinityCategoryID = NULL
```

---

## For Pflicht

```text
QuestionCategoryID = NULL
DareTypeID = required
DareAffinityCategoryID = optional/recommended
```

`Sonstiges` is the intentional default if no more specific DareType applies.

---

## For Gespräch

Meta cards may optionally have a Question Category for editorial purposes.

Their primary gameplay eligibility is controlled by the meta-card scheduler rather than the ordinary question pool.

---

# 17. Stable Internal Identifiers

Game logic should not rely directly on German display strings.

For example:

```text
DARE_TOUCH_SPICY
```

is the stable identifier.

`Berührung-Spicy`

is the German display label.

This enables:

- safe renaming;
- localization;
- cleaner code;
- less fragile migrations.

The same rule applies to:

- card types;
- Question Categories;
- DareTypes;
- profile identifiers;
- game modes.

---

# 18. Game Terminology

## Room

Temporary networking container.

Example:

`XK7P2Q`

Devices join the Room.

---

## Session

A single playthrough from game start until game end.

A Session stores:

- game mode;
- selected profile;
- effective settings;
- active players;
- current state;
- cards shown;
- round state;
- optional responses;
- start/end timestamps.

---

## Player

A participant in the current Room/Session.

Players may be guests.

---

## Group

A persistent collection representing a recurring real-world playing group.

Examples:

- WG Freitag
- Büro-Team
- Anna & Ben

Card history is attached to the Group.

Group membership does not have to be inferred automatically from the exact current roster.

The user explicitly chooses which Group history to use.

---

## Profile

A reusable preset describing which content is suitable for a particular social context.

---

# 19. Supported Play Configurations

Three configurations are core product requirements.

---

# 20. Couch Mode

## Purpose

The entire game runs on one shared display.

Examples:

- TV;
- laptop;
- tablet;
- projector-connected computer.

No individual player device is required.

## Interaction

All controls are operated on the shared device.

## Characteristics

- fastest setup;
- no QR joining required;
- no private phone interactions;
- ideal for casual local play.

All game features must have a shared-screen fallback where possible.

---

# 21. Personal Mode

## Purpose

Every participant uses their own device.

There is no required central display.

All clients remain synchronized.

## Characteristics

- suitable for playing around a table;
- allows private choices;
- allows private boundaries;
- supports simultaneous answers;
- technically suitable for future remote play.

The active player's phone may show different controls from other players.

---

# 22. Party Screen Mode

## Purpose

A TV/projector acts as the central stage while participant phones operate as controllers.

This is the flagship multiplayer presentation.

## Shared display

The main screen shows:

- lobby;
- QR code;
- active player;
- cards;
- animations;
- aggregate answers;
- round transitions;
- session status.

## Phones

Phones handle:

- private choices;
- voting;
- private settings;
- boundary selection;
- veto actions;
- active-player controls.

Phones should not become the main place players spend their attention.

---

# 23. Joining a Room

Networked rooms support:

- QR code;
- short room code.

No account is required to join.

A guest chooses a display name.

The browser receives a temporary reconnection token allowing the same device to reclaim the Player identity after a short disconnect.

---

# 24. Host

Every Room has a host.

Host capabilities include:

- starting the game;
- pausing;
- managing players;
- changing session settings;
- displaying the QR code;
- ending the session.

Host migration may occur automatically if the original host disconnects permanently.

---

# 25. Game Modes

Four game modes are core requirements:

1. Classic Wahrheit oder Pflicht
2. Random Wahrheit oder Pflicht
3. Ich hab noch nie
4. Let's Talk

---

# 26. Classic Wahrheit oder Pflicht

## Core rule

The active player decides between:

- Wahrheit
- Pflicht

**before** a card is selected.

The server must not select both options in advance.

---

## Turn flow

1. Determine active player.
2. Ask Wahrheit oder Pflicht.
3. Player chooses.
4. Engine builds eligible pool for chosen type.
5. Engine selects card.
6. Card is recorded as shown.
7. Card is displayed.
8. Player answers/performs, skips or requests replacement where permitted.
9. Turn resolves.
10. Next player becomes active.

---

## Party Screen behavior

TV:

> ANNA IST DRAN  
> Wahrheit oder Pflicht?

Anna's phone:

- WAHRHEIT
- PFLICHT

After selection, the result may be revealed on the TV before the card animation.

---

# 27. Random Wahrheit oder Pflicht

## Core rule

The active player cannot choose whether the turn contains a question or dare.

The engine decides.

---

## Type balancing

Selection uses a target ratio rather than independent random coin flips.

Example default:

- Fragen: 60%
- Pflicht: 40%

Profiles may override this.

The balancing algorithm should:

- move the observed ratio toward the target;
- avoid excessively long streaks;
- respect card-pool availability.

Recommended default:

- avoid more than three identical card types consecutively;
- prefer no more than two where possible.

---

# 28. Ich hab noch nie

## Eligible content

Default:

```text
Type = Fragen
AND YesNoAnswerPossible = True
```

Question Category, profile, boundary and history rules continue to apply.

---

## Interaction

Every active player answers.

Typical conceptual choices:

- Trifft zu
- Trifft nicht zu

Exact wording may adapt to the card text.

---

## No automatic rewriting

The engine must not automatically rewrite arbitrary yes/no questions into:

> Ich habe noch nie …

If dedicated Never-Have-I-Ever wording is needed in the future, it should use:

- curated card variants;
- a dedicated text field;
- dedicated cards.

---

## Result visibility

Supported settings:

### Anonymous aggregate

Example:

> 3 von 7

Default recommended behavior.

### Reveal after everyone votes

Individual answers appear after voting closes.

### Visible answers

Answers may be visible immediately if deliberately selected.

---

## Turn structure

This mode normally has no active-player rotation.

Each card is a group event.

---

# 29. Let's Talk

## Core rule

No dares are used.

Normal content comes from `Fragen`.

`Gespräch` cards are inserted as conversation-flow events.

---

## Meta-card scheduling

`Gespräch` cards are not mixed into the ordinary random pool.

Possible scheduler triggers include:

- after a completed round;
- after a configured number of questions;
- after an elapsed time threshold;
- at conversation-phase boundaries.

Profiles may define the pacing.

The scheduler must respect card history and repeat properties.

---

## Meta-card exhaustion

If all eligible meta cards have been used:

- normal question flow continues;
- meta cards do not automatically repeat unless their repeat settings permit it.

---

# 30. Player Rotation

Turn-based modes use:

1. random starting player;
2. stable player order;
3. cycle through active players;
4. complete a round after everyone has received one turn.

The host may alter the roster during the session.

---

# 31. Rounds

A round completes when every active player has taken one turn in a turn-based mode.

Rounds provide pacing and presentation structure.

Possible transition:

> RUNDE 3  
> 18 Karten gespielt

Rounds do not determine when the game must end.

---

# 32. Session Duration

Default:

**Open-ended**

Optional targets:

## Time

- 20 minutes
- 45 minutes
- 60 minutes
- custom

## Card count

- 20
- 40
- custom

Reaching a target produces an optional end/continue prompt rather than forcing termination.

---

# 33. Groups and Persistent History

Card history must be scoped to a selected Group.

Example:

Group A has seen Card 523.

Group B has not.

Card 523 is therefore normally:

- excluded for Group A;
- eligible for Group B.

---

## Group identity

The system does not automatically decide that two sets of players are the same group.

The host deliberately chooses:

- an existing Group;
- a new Group;
- play without persistent history.

If a guest joins an existing Group's session, the selected Group history still applies for that session.

---

# 34. Session History

Every Session tracks cards shown during that Session.

Ordinary cards must not appear twice within a Session.

A card is entered into session history as soon as it is committed for display.

This protects against duplicates caused by:

- refresh;
- reconnect;
- skip;
- navigation errors.

---

# 35. Group History

A card counts as seen by a Group once it has been revealed as a playable card during that group's Session.

Completion is not required.

Therefore:

- answered card → seen;
- completed dare → seen;
- skipped after reveal → seen.

This prevents previously rejected or skipped cards from unexpectedly returning at the next game night.

---

# 36. AlwaysEligible

Card property:

`AlwaysEligible`

Purpose:

Allow a card to remain eligible in later sessions even if the Group has seen it before.

Behavior:

- ignores Group-history exclusion;
- does not ignore current Session history unless the card is also repeatable.

---

# 37. RepeatableInSession

Card property:

`RepeatableInSession`

Purpose:

Allow a card to return during the same Session.

A repeatable card must still respect a cooldown.

---

# 38. Repeat Behavior Matrix

| AlwaysEligible | RepeatableInSession | Behavior |
|---|---|---|
| No | No | Normal card |
| Yes | No | May return in later Sessions, once per current Session |
| No | Yes | Subject to Group history, but may recur in Session after becoming eligible |
| Yes | Yes | Evergreen card that may also recur during a Session |

---

# 39. Repeat Cooldown

Default recommended repeat cooldown:

**10 other displayed cards**

A card-specific `RepeatCooldown` may override the global default.

Repeatable cards must never be immediately shuffled back into the top of the pool.

---

# 40. Question Eligibility Pipeline

For a Question:

1. Required Card Type is `Fragen`.
2. Game-mode conditions are applied.
3. `YesNoAnswerPossible` is applied where required.
4. Enabled Question Categories are applied.
5. Profile restrictions are applied.
6. Relevant player question boundaries are applied.
7. Game-phase/intensity rules are applied.
8. inactive cards are removed.
9. current Session history is applied.
10. Group history is applied.
11. AlwaysEligible rules are applied.
12. repeat cooldown is applied.
13. editorial weight is calculated.
14. one eligible card is selected.
15. card is committed to Session history.
16. card is displayed.

---

# 41. Dare Eligibility Pipeline

For a Dare:

1. Required Card Type is `Pflicht`.
2. Enabled DareTypes are applied.
3. Profile DareType restrictions are applied.
4. relevant player DareType boundaries are applied.
5. operational card flags are checked.
6. optional Dare Affinity rules/weighting are applied.
7. game-phase/intensity rules are applied.
8. inactive cards are removed.
9. current Session history is applied.
10. Group history is applied.
11. AlwaysEligible rules are applied.
12. repeat cooldown is applied.
13. editorial weight is calculated.
14. one eligible card is selected.
15. card is committed to Session history.
16. card is displayed.

Question Category is not used as the primary Dare filter.

---

# 42. Weighted Selection

Optional card field:

`Weight`

Default:

`1.0`

Weight may be used for editorial tuning.

Examples:

- unusually strong evergreen card: slightly above 1.0;
- highly situational card: below 1.0.

Weighting occurs **after** eligibility filtering.

Weight must never bypass a boundary or disabled content type.

---

# 43. Pool Exhaustion

The engine must never silently relax filters.

If the pool is exhausted, display a clear message.

Example:

> Keine neuen Karten mehr  
> Ihr habt alle Karten mit diesen Einstellungen bereits gesehen.

Possible actions:

- Themen erweitern;
- weitere Pflicht-Arten erlauben;
- bereits gesehene Karten erlauben;
- Profil ändern;
- Spiel beenden.

Where useful, warn before exhaustion:

> Noch 12 neue Karten mit diesen Einstellungen.

---

# 44. Profiles

Profiles are configuration presets, not game modes.

A Profile defines separate configuration for:

## Questions

- allowed Question Categories;
- optional maximum intensity;
- optional question weighting.

## Dares

- allowed DareTypes;
- optional maximum intensity;
- operational restrictions;
- optional Dare Affinity weighting.

## Game behavior

Potentially:

- Random-mode question/dare ratio;
- escalation setting;
- meta-card frequency;
- visual ambience.

---

# 45. Question and Dare Configuration Are Independent

Example:

A player may disable:

`Sex-Erfahrung`

while still allowing:

`Kuss-Spicy`

or:

`Berührung-Sexy`.

Likewise, enabling `Beziehung` questions does not automatically enable `Kuss`.

This separation must be visible in both data model and UI.

---

# 46. Suggested Built-In Profiles

Exact default selections must be validated against the real card content before release.

The following define intended social direction rather than irreversible data assignments.

---

## Kollegen

Purpose:

Low-risk social play for colleagues or acquaintances.

Question focus:

- Alltag;
- Kindheit;
- Persönlichkeit;
- Szenario;
- selected Freundschaft content.

Dare focus:

- Blödsinn;
- Sonstiges;
- other explicitly reviewed low-risk actions.

`Unbeteiligte Dritte` should normally be off unless intentionally enabled.

Intimate DareTypes are disabled.

---

## Freunde

Purpose:

General friend groups.

Question set may expand into:

- Freundschaft;
- Beziehung;
- Körper;
- selected Sex-Offenheit depending on final curation.

Dare set may include:

- Berührung;
- Kuss;
- Kleidung;
- playful non-intimate actions.

---

## Beste Freunde

Purpose:

Groups comfortable with more personal subject matter.

May enable broader:

- Beziehung;
- Körper;
- Sex-Offenheit;
- selected Sex-Spannung.

DareTypes may include stronger contact depending on final curation.

---

## Paare

Purpose:

Romantic partners.

May enable:

- Beziehung;
- Körper;
- Sexualität;
- Sex-Offenheit;
- Sex-Spannung;
- selected Sex-Erfahrung.

May include:

- Berührung;
- Berührung-Spicy;
- Kuss;
- Kuss-Spicy;
- Kleidung;
- Nacktheit;
- Sexuelle Spannung.

Actual defaults must be tested editorially.

---

## Paare – Spicy

Purpose:

Consenting adults deliberately requesting explicit content.

May enable the complete adult content set, including:

- Berührung-Sexy;
- Borderline Sex;
- Sex

subject to individual boundaries and product age/content restrictions.

---

## Custom

Users configure all relevant options manually.

---

# 47. Custom Profiles

Users should be able to duplicate a built-in Profile.

Example:

> Freunde  
> Als eigenes Profil speichern  
> "WG Freitag"

Custom Profiles may be:

- renamed;
- edited;
- duplicated;
- deleted.

Built-in Profiles remain immutable.

---

# 48. DareType Settings UI

DareTypes should remain individually configurable, but may be organized into visual groups to improve readability.

These UI groups are not additional data classifications.

Suggested arrangement:

## Party

- Blödsinn
- Sonstiges

## Andere Personen

- Unbeteiligte Dritte

## Nähe

- Berührung
- Kuss

## Intensivere Nähe

- Berührung-Spicy
- Kuss-Spicy
- Kleidung

## Intimität

- Berührung-Sexy
- Nacktheit
- Sexuelle Spannung

## Sexuelle Handlungen

- Borderline Sex
- Sex

Individual switches remain available within every group.

---

# 49. Game Phases and Escalation

Optional setting:

> Spiel langsam steigern

When enabled, the engine gradually raises the permitted `Intensity` value up to the Profile maximum.

Example concept:

### Phase 1 — Warm-up

Milder eligible cards.

### Phase 2 — Personal

Moderate intensity.

### Phase 3 — Deep / Wild

Full Profile intensity.

Escalation does **not** automatically enable DareTypes that the Profile or players disabled.

Example:

If `Nacktheit` is disabled, escalation can never introduce nudity.

---

# 50. Player Boundaries

Phone-enabled modes should support private content boundaries.

Boundaries have separate controls for:

- Question Categories;
- DareTypes;
- selected operational flags where relevant.

---

# 51. Question Boundary Resolution

For a turn-based question:

> The active player's private Question Category restrictions apply.

For group-answer modes such as Ich hab noch nie:

> The effective question pool is restricted by the combined boundaries of all participating players.

For conversation cards intended for everybody:

> Use the group-wide effective question boundaries.

---

# 52. Dare Boundary Resolution

A safe default is:

> A DareType disabled by any currently participating player is unavailable for the Session.

This is particularly suitable while cards do not contain enough structured metadata to know exactly which players will be physically involved.

A future advanced system may use:

- acting player;
- target player;
- operational flags

to calculate more granular eligibility.

Until then, the group-wide intersection is the authoritative behavior.

---

# 53. Boundary Privacy

The shared screen must not reveal who disabled a sensitive category or DareType.

Avoid:

> Lea hat Nacktheit deaktiviert.

Instead, the corresponding content simply never appears.

---

# 54. Skip

A skip must always be available.

Default:

> Überspringen

Skipping carries no penalty by default.

A revealed skipped card still counts as seen.

---

# 55. Private Veto

Phone-enabled modes may provide:

> Andere Karte

A veto:

- replaces the current card;
- does not identify the vetoing player;
- marks the revealed card as seen;
- prevents immediate reselection.

The TV simply transitions to another card.

---

# 56. Main Menu

Recommended hierarchy:

**PLAY**

- Neues Spiel
- Gruppe fortsetzen
- Profile
- Einstellungen

Secondary management screens may later include:

- Kartenverwaltung;
- Statistiken.

---

# 57. New Game Flow

## Step 1 — Game Mode

- Wahrheit oder Pflicht
- Zufällige Wahl
- Ich hab noch nie
- Let's Talk

---

## Step 2 — Device Mode

- Nur dieser Bildschirm
- Alle mit eigenem Gerät
- TV + Smartphones

---

## Step 3 — Profile

- Kollegen
- Freunde
- Beste Freunde
- Paare
- Paare – Spicy
- Eigenes Profil

---

## Step 4 — Group

- existing Group;
- create new Group;
- play without persistent history.

---

## Step 5 — Players / Room

Couch Mode:

- enter players directly.

Network modes:

- create Room;
- display QR code;
- players join.

---

## Step 6 — Start

Primary action:

> SPIEL STARTEN

Advanced customization remains available before starting.

---

# 58. Advanced Content Setup

Custom settings should use language reflecting the actual taxonomy.

## Fragen

Heading:

> Über welche Themen wollt ihr sprechen?

Show Question Categories.

---

## Pflichten

Heading:

> Welche Arten von Pflichten sind okay?

Show DareTypes.

The UI must not imply that Question Categories and DareTypes are interchangeable.

---

# 59. Lobby

The multiplayer lobby displays:

- Room code;
- QR code;
- connected players;
- host;
- ready state if used;
- start action.

Example:

> GAME NIGHT  
> Raum XK7P2Q  
> 4 Spieler verbunden

---

# 60. Gameplay Screen

Primary hierarchy:

1. active player, where applicable;
2. Card Type;
3. Question Category or DareType;
4. Card text;
5. minimal actions.

For a Question:

> FRAGE · PERSÖNLICHKEIT

For a Dare:

> PFLICHT · KUSS-SPICY

Dare Affinity Category is normally not shown to players.

---

# 61. In-Game Settings Modal

The settings modal must not navigate away from the Session.

Suggested structure:

## Audio

- Musik
- Soundeffekte

## Darstellung

- Animationen
- reduzierte Bewegung
- größere Schrift

## Fragen

- Themen

## Pflichten

- Pflicht-Arten

## Spieler

- Spieler verwalten
- QR-Code anzeigen

## Session

- pausieren
- beenden

Content changes affect the next card.

---

# 62. Main Settings

Global preferences include:

## Darstellung

- Hell
- Dunkel
- Automatisch
- reduzierte Bewegung
- Schriftgröße

## Audio

- Musiklautstärke
- Soundeffekte

## Spiel

- Standardprofil
- default device mode

## Daten

- gespeicherte Gruppen
- Gruppenverlauf
- lokale Daten
- optional cloud/account synchronization

---

# 63. Visual Identity

The visual style should be:

- modern;
- playful;
- colorful;
- polished;
- readable;
- social rather than game-show-like;
- mature enough to support both harmless and adult content.

The same visual system is used throughout the product.

---

# 64. Visual Hierarchy for Questions

For `Fragen`:

```text
Card Type
    ↓
primary card identity

Question Category
    ↓
secondary accent / atmosphere
```

Examples:

- Alltag → general/light visual treatment;
- Persönlichkeit → flowing/reflective treatment;
- Szenario → imaginative/dynamic treatment;
- Beziehung → relational/paired motifs;
- Körper → organic forms;
- sexual topic categories → progressively more intimate atmosphere without using Category as a literal severity meter.

---

# 65. Visual Hierarchy for Dares

For `Pflicht`:

```text
Card Type
    ↓
primary card identity

DareType
    ↓
secondary accent / atmosphere
```

Dare Affinity Category normally does not affect player-facing visuals.

Examples:

- Blödsinn → chaotic/playful motion;
- Berührung → warm physical closeness;
- Kuss → affectionate treatment;
- Kuss-Spicy → stronger intimate accent;
- Nacktheit → minimal/intimate visual treatment;
- Sexuelle Spannung → restrained tension;
- explicit adult types → mature treatment without graphic imagery.

---

# 66. Visual Hierarchy for Gespräch

`Gespräch` cards receive a distinct reflective presentation.

Possible characteristics:

- softer motion;
- greater whitespace;
- slower transition;
- unique card frame.

They should feel like deliberate pauses in the normal flow.

---

# 67. Card Presentation

Cards should visually resemble physical cards without copying traditional playing-card conventions too literally.

Possible treatments:

- rounded corners;
- subtle depth;
- shadow;
- slight perspective;
- card-deal entrance;
- gentle tilt;
- flip/reveal.

Player-facing cards may show:

- type;
- Question Category or DareType;
- card text.

Internal IDs should not normally be displayed.

---

# 68. Animation

Potential animations:

- deal;
- flip;
- discard;
- next-player transition;
- subtle particles;
- player joining;
- round transitions;
- vote completion;
- background motion.

Animation must remain short enough that it never delays conversation.

---

# 69. Reduced Motion

Setting:

> Animationen reduzieren

When enabled:

- disable parallax;
- remove large moving transitions;
- reduce particles;
- use fades where possible.

No gameplay information may depend exclusively on animation.

---

# 70. Audio

Audio is optional.

Two systems:

- ambient music;
- sound effects.

---

## Ambient music

Suggested moods:

- lobby;
- conversation;
- energetic dare;
- intimate/spicy;
- round/end transition.

Use subtle loops and smooth crossfades.

---

## Sound effects

Potential events:

- join;
- card deal;
- reveal;
- confirmation;
- turn change;
- vote completion;
- round transition.

Audio should reinforce interaction rather than dominate it.

---

# 71. Accessibility

The interface should support:

- responsive layouts;
- large touch targets;
- keyboard input where appropriate;
- sufficient contrast;
- scalable text;
- reduced motion;
- visible focus states;
- clear labels;
- status indicators not based on color alone.

A formal accessibility target should be selected during implementation and verified through testing.

---

# 72. Responsive Design

Supported displays include:

- portrait phones;
- landscape phones;
- tablets;
- laptops;
- desktops;
- televisions;
- projectors.

TV layouts prioritize:

- large text;
- large cards;
- minimal controls.

Phone layouts prioritize:

- thumb-friendly controls;
- low scrolling;
- clear active/inactive states.

---

# 73. Server-Authoritative Game State

The server owns:

- current Session;
- current card;
- active player;
- player order;
- card-selection state;
- voting state;
- history;
- timers;
- Room membership.

Clients submit actions and render authoritative state.

Clients do not independently choose random cards.

---

# 74. Example State Machine — Classic Mode

Possible states:

```text
WAITING_FOR_PLAYER
CHOOSING_CARD_TYPE
SELECTING_CARD
SHOWING_CARD
WAITING_FOR_RESOLUTION
TRANSITION
NEXT_PLAYER
```

---

# 75. Example State Machine — Ich hab noch nie

```text
SELECTING_CARD
SHOWING_CARD
COLLECTING_ANSWERS
SHOWING_RESULTS
NEXT_CARD
```

The exact implementation names may differ while preserving equivalent behavior.

---

# 76. Technical Architecture

Recommended architecture:

```text
                 Game Server
                      │
          ┌───────────┼───────────┐
          │           │           │
      TV Client   Phone Client Phone Client
```

Recommended transport:

- HTTPS for ordinary API operations;
- WebSockets or equivalent for live Session synchronization.

---

# 77. Platform Strategy

A responsive browser application / PWA is the recommended client strategy because it naturally supports:

- TV-connected computers;
- tablets;
- phones;
- QR joining;
- shared URLs;
- no mandatory store installation.

The architecture should remain implementation-framework agnostic.

---

# 78. Database Strategy

Recommended production database:

- MariaDB;
- MySQL;
- or a comparable server relational database.

SQLite is suitable for:

- development;
- testing;
- local installations;
- very low-concurrency environments.

Access is treated as an import/source system rather than the multiplayer runtime database.

---

# 79. Core Database Entities

Recommended conceptual entities:

```text
Cards
QuestionCategories
DareTypes
CardFlags

Profiles
ProfileQuestionCategories
ProfileDareTypes
ProfileRules

Groups
GroupPlayers

Rooms
Sessions
Players
SessionPlayers

CardAppearances
Votes
PlayerBoundaries
```

Not every table must exist in the first development milestone, but the logical model should remain compatible with these concepts.

---

# 80. CardAppearances

Recommended fields:

```text
ID
SessionID
GroupID
CardID
PlayerID
ShownAt
RoundNumber
Skipped
Completed
Vetoed
```

This supports:

- Session deduplication;
- Group history;
- analytics;
- repeat logic.

---

# 81. Source Metadata

Preserve:

- Origin;
- OriginCategory.

These remain useful for:

- editorial review;
- tracing imported games;
- identifying duplicate sets;
- measuring skip rates by source;
- bulk editing.

They are not normal player-facing filters.

---

# 82. Content Administration

A future internal editor should support:

- text search;
- Card Type;
- Question Category;
- DareType;
- Dare Affinity Category;
- Origin;
- OriginCategory;
- YesNoAnswerPossible;
- Intensity;
- AlwaysEligible;
- RepeatableInSession;
- operational flags;
- Active.

Bulk editing is important because of the size of the content set.

---

# 83. Content Validation

Automated checks should distinguish errors from warnings.

## Errors

Examples:

- blank CardText;
- unknown Card Type;
- invalid normalized foreign key;
- Pflicht without a DareType after normalization.

## Warnings

Examples:

- Fragen with a DareType;
- Pflicht without Dare Affinity Category;
- Gespräch using unexpected metadata;
- YesNoAnswerPossible on a Pflicht;
- possible duplicate text;
- unexpected operational flag combination.

Warnings may be deliberately overridden by editors.

---

# 84. Data Normalization

Production logic should not rely on free-form variants such as:

- `Berührung`
- `berührung`
- `Berührung `
- alternate spellings.

Source strings are mapped to canonical records/IDs during import.

---

# 85. Duplicate Detection

Because cards originate from multiple games, duplicate content is likely.

The administration workflow should eventually identify:

- exact duplicates;
- punctuation variants;
- small wording variants;
- semantically similar cards.

Potential duplicates should be flagged for human review rather than automatically deleted.

---

# 86. Disconnect Handling

If a phone disconnects:

- the Session remains active;
- the player can reconnect using their token;
- current state is restored.

Host actions may include:

- wait;
- remove player;
- temporarily control that player's turn from the shared screen.

A disconnected client cannot own authoritative state.

---

# 87. End of Session

Players may end a game at any time.

Possible summary:

> GUTE NACHT ✨  
> 58 Karten  
> 4 Runden  
> 1:12 Stunden  
> 642 ungesehene Karten mit diesem Profil

Actions:

- Noch eine Runde
- Einstellungen ändern
- Neues Spiel
- Beenden

Statistics should remain secondary to the social experience.

---

# 88. Accounts

Accounts are not required to join or play.

Guest play is a core requirement.

Persistent Groups may initially be associated with:

- host browser/device identity;
- a signed persistent token;
- optional account ownership.

Accounts may later provide:

- cross-device synchronization;
- cloud Groups;
- custom Profiles;
- custom cards;
- saved preferences.

Registration must not be required for a guest joining a party.

---

# 89. Statistics and Privacy

Possible non-sensitive statistics:

- Sessions played;
- cards seen;
- remaining unseen cards;
- rounds;
- play time;
- most-used categories.

Sensitive individual answers should not be permanently stored by default.

Ich-hab-noch-nie responses should be ephemeral unless a future feature has a clear privacy-conscious reason to persist them.

---

# 90. Explicit Adult Content

Profiles enabling:

- Borderline Sex;
- Sex;
- other explicitly sexual activity

are intended for consenting adults.

Public release must implement appropriate:

- age/content gating;
- platform-policy compliance;
- regional legal review.

Explicit content must never appear accidentally in lower-intensity profiles.

---

# 91. Social Safety Principles

The game facilitates voluntary social interaction.

Core rules:

- skip is always available;
- no default punishment for skipping;
- boundaries are respected;
- private exclusions are not announced;
- disabled DareTypes cannot be reintroduced by escalation;
- explicit content requires deliberate eligibility.

The software should never frame refusal as failure.

---

# 92. Uninvolved Third Parties

`Unbeteiligte Dritte` is treated as its own explicit DareType because it concerns people who have not joined the game.

It must be individually configurable.

Profiles may keep it disabled by default.

No generic "spiciness" control may automatically enable it.

---

# 93. Performance Expectations

Gameplay interactions should feel immediate.

Targets include:

- near-instant synchronization;
- card selection without visible query delay;
- smooth card transitions;
- no full-page reload between turns;
- reliable recovery after brief network interruption.

The engine may cache eligible pools, but authoritative history checks remain server-side.

---

# 94. Localization

Initial UI and card content are German.

Architecture should support future localization.

Requirements:

- UI strings separated from code;
- stable internal identifiers;
- card language metadata if multilingual content is introduced;
- no business logic based on translated labels.

---

# 95. Core Release Scope

The first complete public product should support all fundamental requirements.

## Game Modes

- Classic Wahrheit oder Pflicht
- Random Wahrheit oder Pflicht
- Ich hab noch nie
- Let's Talk

## Device Modes

- Couch Mode
- Personal Mode
- Party Screen Mode

## Content

- Question Categories
- DareTypes
- Dare Affinity
- YesNoAnswerPossible
- Profiles
- operational flags required by existing content

## Persistence

- Rooms
- Sessions
- Groups
- Session history
- Group history
- AlwaysEligible
- RepeatableInSession
- cooldowns

## UX

- main menu
- setup flow
- lobby
- gameplay
- settings modal
- global settings
- end screen

## Multiplayer

- QR join
- room code
- WebSocket/live synchronization
- reconnect

## Presentation

- responsive card UI
- animated backgrounds
- ambient music
- sound effects
- reduced motion

---

# 96. Post-Core Enhancements

Features that may follow the core release:

- advanced custom Profile editor;
- per-player private boundaries if not included in first release;
- advanced target-aware Dare filtering;
- richer game phases;
- card favorites;
- custom player cards;
- account synchronization;
- remote-focused play;
- group statistics;
- advanced content-management tooling;
- profile sharing.

---

# 97. Recommended Development Order

## Phase 1 — Content normalization

- import source Cards;
- create canonical Question Categories;
- create canonical DareTypes;
- split question Category from Dare Affinity semantics;
- preserve Origin metadata;
- validate content;
- add history/repeat fields.

## Phase 2 — Core game engine

- Session state;
- Groups;
- history;
- question eligibility;
- dare eligibility;
- repeat logic;
- round logic.

## Phase 3 — Couch Mode

- complete all four modes on one device;
- validate game flow independently of networking.

## Phase 4 — Multiplayer rooms

- Room creation;
- QR join;
- Player synchronization;
- reconnect;
- host control.

## Phase 5 — Party Screen and Personal Mode

- phone controllers;
- synchronized personal displays;
- private choices;
- simultaneous voting.

## Phase 6 — Profile and boundary system

- built-in Profiles;
- custom settings;
- private boundaries;
- operational flags.

## Phase 7 — Visual/audio polish

- final card styles;
- type/category/DareType theming;
- animation;
- ambient music;
- accessibility polish.

## Phase 8 — Content/admin tooling

- bulk editing;
- validation;
- duplicate detection;
- analytics.

---

# 98. Canonical Gameplay Example — Classic Party Screen

1. Host chooses **Neues Spiel**.
2. Host selects **Wahrheit oder Pflicht**.
3. Host selects **TV + Smartphones**.
4. Host chooses **Freunde**.
5. Host selects Group **WG Freitag**.
6. Room is created.
7. QR code appears.
8. Players join.
9. Private boundaries are collected if enabled.
10. Server calculates effective allowed content.
11. Host starts.
12. Server selects Anna as first player.
13. Anna chooses Wahrheit or Pflicht on her phone.
14. If Wahrheit:
    - Question Category rules are applied.
15. If Pflicht:
    - DareType rules are applied.
16. Group and Session history are applied.
17. Eligible card is selected.
18. Card is committed to history.
19. Card is displayed on TV.
20. Anna answers/performs or skips.
21. Ben becomes active.
22. After all players take a turn, a round transition occurs.
23. Play continues until the group chooses to stop.

---

# 99. Canonical Gameplay Example — Ich hab noch nie

1. Engine selects `Fragen`.
2. `YesNoAnswerPossible = True` is required.
3. Question Category/Profile/boundary rules are applied.
4. History rules are applied.
5. Card is selected.
6. Everyone receives answer controls.
7. Session enters voting state.
8. Answers are collected.
9. Aggregate result is shown according to visibility settings.
10. Next card is selected.

---

# 100. Canonical Gameplay Example — Let's Talk

1. Engine selects an eligible normal Question.
2. Conversation continues through ordinary cards.
3. Meta-card scheduler reaches its next trigger.
4. An eligible `Gespräch` card is selected.
5. Meta card receives distinct presentation.
6. Group follows the conversation instruction.
7. Normal question flow resumes.
8. Meta-card history prevents unintended repetition.

---

# 101. Canonical Selection Model

The overall content model is:

```text
QUESTIONS

Game Mode
+
Question Categories
+
Profile
+
Player Question Boundaries
+
Intensity / Phase
+
Session History
+
Group History
+
Repeat Rules
=
Eligible Questions
```

For dares:

```text
DARES

Game Mode
+
DareTypes
+
Profile
+
Player Dare Boundaries
+
Operational Flags
+
optional Dare Affinity logic
+
Intensity / Phase
+
Session History
+
Group History
+
Repeat Rules
=
Eligible Dares
```

---

# 102. Canonical Content Hierarchy

The fundamental semantic model is:

```text
                         CARD
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
      FRAGE             PFLICHT          GESPRÄCH
        │                 │                 │
 Question Category      DareType        Meta Scheduler
   primary              primary
                          │
                   Dare Affinity
                     secondary
```

All card types may additionally use:

- Intensity;
- history rules;
- repeat rules;
- Weight;
- Origin;
- operational flags;
- Active state.

---

# 103. Key Decisions That Must Remain Consistent

The following are foundational product rules.

1. **Question Category is the primary classification for questions.**
2. **DareType is the primary classification for dares.**
3. **A dare's Category is normalized as Dare Affinity Category and is secondary metadata.**
4. **Question Category toggles do not automatically enable or disable DareTypes.**
5. **DareTypes remain individually selectable and are not replaced by a single spice/intensity scale.**
6. **Intensity is secondary pacing metadata.**
7. **Operational behaviors such as third-party involvement or substance use must not be inferred solely from thematic Category.**
8. **Session history and Group history are independent.**
9. **AlwaysEligible and RepeatableInSession are independent.**
10. **Gespräch cards use a scheduler instead of the ordinary random question pool.**
11. **Phones are controllers/supporting interfaces in Party Screen Mode; the shared screen remains the social focal point.**
12. **The server is authoritative for multiplayer game state.**
13. **Profiles configure questions and dares independently.**
14. **Skipping is always possible.**
15. **Private boundaries are never publicly attributed to a specific player.**
16. **Explicit content cannot appear unless both Profile/session settings and effective player boundaries allow it.**
17. **The original imported data is preserved while production gameplay uses normalized semantics.**

---

# 104. Remaining Open Design Decisions

The following decisions require prototyping, editorial review or user testing.

They do not change the canonical architecture above.

1. Final product name.
2. Final German name for Random Wahrheit oder Pflicht.
3. Exact default content of each built-in Profile.
4. Exact Random-mode question/dare ratios per Profile.
5. Exact default repeat cooldown.
6. Exact meta-card scheduling frequency.
7. Final intensity assignment rules.
8. Whether Dare Affinity affects selection weight by default or only in Profiles explicitly configured to use it.
9. Exact substance-related operational flags required after auditing the existing dares.
10. Exact implementation of target-aware individual Dare boundaries once cards contain sufficient participant metadata.
11. Final age-gating flow for adult profiles.
12. Final default answer-visibility setting for Ich hab noch nie.
13. Final account/cloud synchronization model.
14. Whether custom player-created cards are included in the first post-core release.

---

# 105. Acceptance Criteria

The design is correctly implemented when all of the following are true:

- all four game modes use the same underlying content engine;
- all three device configurations work;
- guests can join without accounts;
- a returning Group normally receives unseen cards;
- another Group still has access to those cards;
- ordinary cards do not duplicate during a Session;
- AlwaysEligible cards may return in future Sessions;
- RepeatableInSession cards may return only according to cooldown rules;
- Question Category filtering affects questions as intended;
- DareType filtering is the primary filter for dares;
- disabling a Question Category does not accidentally disable unrelated allowed dares;
- Dare Affinity remains secondary metadata;
- disabled DareTypes can never be reintroduced by intensity escalation;
- `Unbeteiligte Dritte` can be independently disabled;
- substance-action cards can be controlled independently from questions about Trunkenheit once such action flags exist;
- Let's Talk reliably inserts Gespräch cards through pacing logic;
- Ich hab noch nie uses only suitable yes/no content and does not automatically rewrite card text;
- private boundaries are not publicly attributed;
- a player can always skip;
- network disconnects do not destroy Sessions;
- pool exhaustion is shown explicitly rather than silently recycling content;
- TV and phone clients remain synchronized;
- the active gameplay UI remains focused on the current card.

---

# 106. Final Product Summary

The product is one flexible social-card platform built around a curated German content library.

Questions and dares deliberately use different taxonomic models:

> **Questions are selected primarily by what players are willing to talk about.**

> **Dares are selected primarily by what kinds of actions players are willing to perform.**

Profiles combine those dimensions into social presets, while private boundaries can narrow them further.

Persistent Groups preserve variety over repeated game nights.

Session history eliminates accidental duplication.

Explicit repeat rules allow intentionally evergreen content.

The three device modes allow the same game to work:

- on one shared screen;
- entirely on participant devices;
- or with a shared TV supported by individual phone controllers.

The software should remain visually playful and technically sophisticated while presenting a very simple experience to players:

**join, choose how you want to play, receive a card, interact with one another, and continue for as long as the group is having fun.**