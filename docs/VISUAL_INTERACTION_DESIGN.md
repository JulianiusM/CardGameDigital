# Multiplayer Party Card Game — Visual & Interaction Design Document

> **Canonical look & feel / single source of truth**

Warm, playful, card-first, and adaptive. A golden-orange visual universe that changes character with the game without becoming visually fragmented.

|                     |                                                                                 |
| ------------------- | ------------------------------------------------------------------------------- |
| **Document status** | Canonical visual and interaction design reference                               |
| **Version**         | 1.1                                                                             |
| **Date**            | 22 August 2026                                                                  |
| **Scope**           | Look, feel, visual hierarchy, iconography, motion, and interaction presentation |

_Companion references: Game Design Document v1.3 for gameplay/product behavior; Technical Architecture Document v1.2 for implementation constraints. This document is authoritative within its visual-design scope._

# 1. Authority and scope

**This document defines how the game should look and feel.** Where
another document or an older screen conflicts with this document on
visual appearance, motion, iconography, color, or presentation
hierarchy, this document takes precedence within that scope.

- It is intentionally non-technical. It does not prescribe code,
  components, frameworks, stylesheets, data structures, rendering
  techniques, or platform architecture.

- Gameplay rules, card eligibility, taxonomy semantics, privacy
  behavior, networking, persistence, and deployment remain outside this
  document.

- The visual system must work as one coherent identity across menus,
  setup, active play, settings, summaries, phones, computers, and shared
  displays.

- Intentional deviations should be reflected here before they become
  part of the canonical design.

# 2. Design essence

**Golden Mischief** is the defining visual direction: sunny and social
at the light end, mischievous and hot at the intense end, but always
recognizably part of the same warm world.

**Card first.** The game exists to trigger conversation and action.
Menus and chrome should recede; the current card, player, and immediate
choice should dominate.

**Warm, not corporate.** The dominant universe is golden yellow, orange,
peach, coral, raspberry, and berry. Cool blue/purple “product dashboard”
styling is not part of the identity.

**Playful, not childish.** Use lively movement, friendly rounded forms,
and expressive symbols without relying on emoji, novelty fonts, or
cartoon clutter.

**Mature without becoming explicit.** Adult and intimate states may
become hotter, darker, and more suggestive, but visual motifs remain
abstract or affectionate rather than graphic.

**Few decisions at once.** Setup and primary flows use a wizard rhythm:
one clear question per page, a small number of large options, and
restrained secondary controls.

**Quiet settings access.** Settings remain available through a subtle,
persistent icon in the upper-right corner and open into a tabbed modal
rather than permanent navigation.

# 3. Core palette

The palette is a continuous warm spectrum rather than a set of unrelated
category colors. Ivory and dark brown provide stable reading surfaces;
the animated atmosphere lives behind them.

| **Name**          | **Swatch** | **Hex** | **Role**                       |
| ----------------- | ---------- | ------- | ------------------------------ |
| **Warm Paper**    |            | #FFF8E8 | Primary card and modal surface |
| **Soft Cream**    |            | #FFF1C7 | Selected/raised warm surface   |
| **Espresso Ink**  |            | #3B2416 | Primary text and icon ink      |
| **Muted Cocoa**   |            | #76533D | Secondary text                 |
| **Sunflower**     |            | #FFD166 | Light/playful accent           |
| **Golden Orange** |            | #FFB238 | Core warm accent               |
| **Tangerine**     |            | #FF8A1F | Energetic/action accent        |
| **Apricot**       |            | #FFA85C | Bridge between gold and coral  |
| **Coral**         |            | #FF6F61 | Intimate/flirt bridge          |
| **Raspberry**     |            | #E84769 | Spicy/intimate accent          |
| **Berry**         |            | #9D315B | Deepest standard hot state     |

**Color rule:** avoid introducing cool blue, teal, or corporate violet
as category identities. Neutral accessibility states may use grayscale,
but the expressive game identity remains warm.

# 4. Typography

**Primary typeface.** Inter. Its rounded, neutral geometry is retained
from the existing design.

**Headlines.** Very bold (approximately 800), compact line height around
0.95-1.0, large enough to feel like a game rather than an app form.

**Card text.** Bold/semibold, centered, approximately 1.12-1.18 line
height. It is normally the largest text on the active-play screen.

**Labels.** Small, uppercase when used as an eyebrow/classification
label, with generous letter spacing (approximately 0.18-0.28 em).

**Body/supporting text.** Regular to medium weight, short lines, high
contrast. Long explanatory paragraphs should be rare in primary flows.

# 5. Surfaces and visual hierarchy

**Cards.** Warm ivory (#FFF8E8) at approximately 96% opacity, with
espresso text. Corners are strongly rounded (about 28 px in the web
reference scale). Cards should feel like soft printed game pieces, not
glass panels.

**Card edge and shadow.** Use a very subtle warm-brown edge (roughly
10-14% opacity) and a broad, soft shadow. A small amount of
atmosphere-colored glow may be present, but never enough to compete with
the text.

**Decorative card mark.** A single family-relevant watermark or symbol
may sit near an edge at 6-10% opacity. It must remain secondary to the
card text.

**Permanent navigation.** Avoid it during active play. The primary
screen should normally show the active player where relevant, card
classification, card text, one or two immediate actions, and discreet
settings access.

**Whitespace.** Use generous spacing. Gespräch/meta cards intentionally
receive more whitespace and calmer visual pacing than ordinary questions
or dares.

**Never Have I Ever voting status.** While answers are being collected, the Card remains
the primary surface and a compact voting-status roster sits directly below it on phones
or beside/below it on larger displays. Every voter is shown by name with exactly one
public state: **Pending** or **Voted**. For large rosters, use a two-column/grid treatment
on active devices and a vertically scrollable list on small personal devices rather
than hiding individual names. A passive Party Screen must never depend on manual
scrolling: it automatically pages and wraps the variable roster rows while the Card,
reveal-mode indicator, section heading, and result totals remain fixed.

The status treatment must remain neutral. A submitted vote uses a check mark plus text;
a pending vote uses a muted dot/clock plus text. Do not use `YES`/`NO`, binary answer
colors, or any visual hint of the submitted value before reveal.

**Reveal-mode indicator.** The selected Never-Have-I-Ever answer mode is visible before
and during voting as a small but explicit text treatment such as **Anonymous result** or
**Answers revealed**. It may not rely on color alone.

**Anonymous result.** After voting completes, show aggregate `YES`/`NO` totals as the
primary result. Do not show names beside either answer.

**Named-answer result.** After voting completes, show each player's name and answer in
the Session player order. An aggregate summary may remain above the list. Use neutral,
equally weighted answer chips; avoid moralizing green/red success/failure styling.

# 6. Buttons, choices, and wizard behavior

| **Shape**           | Large pill or generously rounded tile; primary actions should feel tactile and obvious.                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Primary color**   | Sunflower/golden surface (#FFD166) with espresso text (#3B2416); on very yellow scenes, use a warm-cream lift and a stronger orange/brown edge so the control stays distinct. |
| **Secondary color** | Warm ivory/cream surface at roughly 70-85% opacity with espresso text and a subtle warm edge.                                                                                 |
| **Hover**           | Over about 160 ms, rise 3 px, rotate approximately -0.35°, and deepen the soft shadow.                                                                                        |
| **Press**           | Drop about 1 px and compress to roughly 98% scale.                                                                                                                            |
| **Primary glimmer** | A slow, restrained highlight travels across the primary button on a 4-second cycle. It must read as polish, not sparkle noise.                                                |
| **Disabled**        | Approximately 55% visual opacity, with no hover/press animation.                                                                                                              |

**Wizard rule:** each page asks one clear setup question and normally
offers 2-4 large choices. Secondary or advanced settings stay out of the
main decision path. A progress indicator is present but visually
subordinate.

**Wizard page transition:** about 360 ms, fading in while sliding
approximately 24 px from the direction of forward progress. Back
navigation is a quiet text action rather than another large tile.

# 7. Settings modal

**Persistent trigger.** A small circular settings control remains subtly
visible in the upper-right corner. Reference size: 46-48 px. The fill is
warm ivory at about 72% opacity, with a thin warm-brown ring around 18%
opacity and an espresso/orange icon around 88% opacity. On hover/focus
it becomes fully present rather than moving dramatically.

**Modal surface.** Warm Paper (#FFF8E8) at about 98% opacity, rounded
approximately 28 px, with dark text. Avoid dark corporate glass styling.

**Backdrop.** Espresso-brown scrim at about 42% opacity. It should quiet
the game without turning the screen black.

**Tabs.** Settings remain split into horizontal tabs. The available tabs
may vary with context, but the pattern stays stable. The active tab uses
a golden capsule (#FFD166) with espresso text; inactive tabs are
transparent/cream with muted cocoa text.

**Modal motion.** Backdrop fades in over roughly 180 ms. The modal
arrives over roughly 260 ms from about 20 px lower and 97% scale. Tabs
themselves do not use the playful button rotation.

# 8. Adaptive ambient background

The background is a living visual atmosphere, not a rotating corporate
gradient. It combines a slowly animated warm gradient with multiple
diagonal rows of simple monochrome symbols.

**Gradient.** Two dominant family colors plus a soft warm highlight. The
gradient moves slowly in a direction different from the symbol drift; a
full breathing cycle should take about 20-28 seconds.

**Icon rows.** Use approximately 6 rows in the normal state, extending
beyond the viewport and tilted around 12-18°. Symbols are large and
sparse rather than confetti-sized.

**Drift.** Rows travel continuously from lower-left toward upper-right.
Adjacent rows vary slightly in speed so they do not read as a rigid
conveyor belt.

**Symbol color.** Symbols have no fixed color. On bright scenes they are
a darker relative of the active gradient; on the darkest hot scenes they
may become a lighter warm relative. They should look printed into the
atmosphere.

**Icon style.** Bespoke monochrome line/shape icons with rounded ends,
mild organic asymmetry, and low detail. No emoji, platform-native
pictographs, photographic imagery, or graphic sexual imagery.

**Density.** Normal scenes use enough symbols to make the identity
visible without becoming wallpaper noise. Density increases gently with
intensity.

# 9. Question visual families

| **Family**           | **Members**                   | **Intensity-3 gradient** | **Pattern tone** | **Motifs**                                                                       |
| -------------------- | ----------------------------- | ------------------------ | ---------------- | -------------------------------------------------------------------------------- |
| **Curiosity**        | EVERYDAY, CHILDHOOD, SCENARIO | #FFE49A → #FFB347        | #B86516          | ?, lightbulbs, thought bubbles, clouds, stars, dice                              |
| **Inner Self**       | PERSONALITY, BODY             | #FFC18A → #E97D5D        | #884434          | mirrors, fingerprints, eyes, silhouettes, contour lines, sparkles                |
| **Connection**       | FRIENDSHIP, RELATIONSHIP      | #FFAD75 → #FF7485        | #9C4050          | linked circles, paired speech bubbles, hands, paired stars, small hearts         |
| **Unfiltered**       | INTOXICATION                  | #FFC44D → #FF7A1A        | #9B470F          | wobbles, bubbles, spirals, warped stars, tilted abstract shapes                  |
| **Intimate Talk**    | SEXUALITY, SEX_OPENNESS       | #FF9A78 → #E85D82        | #8B3550          | open hearts, lips, speech bubbles, keyholes, soft sparkles                       |
| **Desire & Stories** | SEX_TENSION, SEX_EXPERIENCE   | #FF775F → #D84670        | #792A48          | sparks, kiss marks, magnetic curves, hearts, trailing lines, memory-frame shapes |

_INTOXICATION uses warped/chaotic abstract motifs rather than bottles or
drink branding. BODY remains an inward/self-image family and is not
automatically sexualized._

# 10. Dare visual families

| **Family**       | **Members**                             | **Intensity-3 gradient** | **Pattern tone** | **Motifs**                                                                    |
| ---------------- | --------------------------------------- | ------------------------ | ---------------- | ----------------------------------------------------------------------------- |
| **Mischief**     | SILLY                                   | #FFD45F → #FF8A1F        | #9E4B0D          | zigzags, bursts, stars, goofy blobs, exclamation marks                        |
| **Social Chaos** | THIRD_PARTY                             | #FFB13D → #F0602A        | #853718          | outward arrows, satellite dots, message bubbles, ringing circles, people-dots |
| **Affection**    | KISS, TOUCH                             | #FFB58E → #F67C74        | #91483F          | hearts, hands, paired shapes, kiss marks, soft ripples                        |
| **Flirt**        | KISS_SPICY, TOUCH_SPICY, SEXUAL_TENSION | #FF906D → #E94775        | #812B49          | lips, sparks, magnetic curves, hearts, electric squiggles                     |
| **Reveal**       | CLOTHING, NUDITY                        | #EE8A4F → #9F4A64        | #613245          | fabric folds, hangers, curtains, silhouettes, reveal/sunrise shapes           |
| **Heat**         | TOUCH_SEXY, BORDERLINE_SEX, SEX         | #E85065 → #942C59        | #FFD0B5\*        | flames, intertwined curves, pulses, crescents, dense sparks                   |
| **Generic Dare** | OTHER                                   | #FFC05A → #FF8A1F        | #91400E          | arrows, bursts, exclamation marks, motion lines                               |

_\*Heat is the exception where the pattern tone may switch to a lighter
warm tint at higher intensities because the background itself becomes
dark. OTHER intentionally remains generic and must not invent semantic
meaning._

# 11. Intensity gradient

The intensity used for presentation is the derived global Card intensity. It modifies a
family; it never replaces the family. A Childhood question stays golden/amber and a SEX
dare stays berry/raspberry regardless of their position in the global progression.

| **Intensity**       | **Color**                                | **Icon opacity** | **Density** | **Row drift** | **Character**                                                  |
| ------------------- | ---------------------------------------- | ---------------- | ----------- | ------------- | -------------------------------------------------------------- |
| **1 — Mild**        | ≈30% softer/lighter than the family base | 8%               | 5 rows      | 52-58 s       | Very airy; low contrast; calm motion                           |
| **2 — Personal**    | ≈15% softer/lighter                      | 10%              | 5-6 rows    | 45-50 s       | Still soft, with clearer family identity                       |
| **3 — Strong**      | Canonical family gradient                | 13%              | 6 rows      | 37-42 s       | Reference/default atmosphere                                   |
| **4 — Very strong** | ≈10% deeper/hotter than base             | 17%              | 6-7 rows    | 31-35 s       | Richer color, denser symbols, more presence                    |
| **5 — Extreme**     | ≈20% deeper/hotter than base             | 21%              | 7-8 rows    | 27-31 s       | Deepest allowed family expression; energetic but never frantic |

**Intensity must never:** change a question into a sexual-looking family
solely because it is intense; reclassify a dare; introduce new semantic
icons; or turn motion into rapid/flickering animation.

# 12. State transitions and motion

**Atmosphere change.** When a new card changes family, the old symbol
rows continue drifting while fading and softening; the new rows emerge
through them. Icon-family crossfade: about 800 ms. Gradient transition:
about 1.0-1.2 s.

**Card reveal.** About 320 ms: fade in, rise roughly 22 px, and settle
from about 97% scale. The transition should feel decisive, not
theatrical.

**Same-family next card.** Do not restart the whole background. The
atmosphere continues naturally; only intensity adjustments should gently
retune it.

**Gespräch/meta cards.** Use approximately 1.35× slower ambient motion,
more whitespace, and a slower card reveal around 430-480 ms. They should
feel like intentional pauses.

**Never Have I Ever voting.** Submitting a vote should produce only a local/private
confirmation plus the public status change from Pending to Voted. The public status
transition should be quick and restrained (approximately 160-220 ms). It must not reveal
or imply the answer value.

**Never Have I Ever result reveal.** When the final required vote arrives, transition
from the voting roster to the result over approximately 280-360 ms. Anonymous mode
reveals aggregate totals. Named-answer mode reveals the player-answer rows together as
one deliberate result state rather than animating answers one by one, which could
suggest an order or ranking that does not exist.

**Celebration/end.** Confetti/star motifs may appear, but remain within
the warm palette and do not become a full-screen particle storm.

# 13. Iconography

- Background symbols and interface icons belong to one visual language:
  simple, rounded, monochrome, low-detail, and slightly organic.

- Background motifs should use approximately 4-6 distinct symbols per
  visual family, arranged into at least two repeating row sequences so
  repetition is not obvious.

- UI icons must remain legible at small sizes and may be visually
  simpler than background motifs.

- Hearts, lips, sparks, fabric, silhouettes, and intertwined abstract
  curves are acceptable for intimate content. Explicit sexual anatomy or
  graphic act depictions are not part of the visual identity.

- Emoji are not canonical icons because their appearance varies by
  platform and weakens visual consistency.

# 14. Reduced motion and visual comfort

**Reduced motion.** Stop continuous row drift, glimmer, rotation, and
scale-based flourishes. Keep the family colors and icons static. State
changes use a simple 180-220 ms opacity crossfade.

**Contrast.** Primary text on cards and modals uses espresso on warm
ivory. Atmosphere colors must never sit directly behind long-form or
essential text without a solid/near-solid reading surface.

**Focus.** Keyboard/focus indication must be clearly visible,
approximately 3 px in the reference scale, using a deep
burnt-orange/espresso outline with enough contrast against the current
surface.

**Large displays.** Cards and primary actions scale up; decorative
density should not increase merely because more pixels are available.
Shared displays should feel spacious rather than busier.

**Passive Party Screens.** Treat the viewport as a bounded public stage. Room identity,
live status, the current Card, and public progress/result headings stay visible. If a
roster exceeds the available region, advance through measured pages automatically and
wrap to the first page. Do not introduce document scrolling or participation controls.

**Small displays.** Option grids collapse before individual choices
become cramped. The settings tabs may scroll horizontally; essential
labels remain readable.

# 15. Canonical do / do not

| **DO**                                                                        | **DON’T**                                                                     |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Keep the entire game in one warm chromatic universe.                          | Assign every category an unrelated rainbow color.                             |
| Let category/DareType define the motif family and let intensity tune it.      | Treat intensity as a second category or a universal “red = extreme” scale.    |
| Use slow diagonal icon rows and a separately moving gradient.                 | Use a rotating conic background or obvious corporate ambient halo.            |
| Keep cards warm, bright, tactile, and text-first.                             | Return to dark glassmorphism as the dominant card surface.                    |
| Use a few large choices and hide complexity behind the wizard/settings model. | Fill the screen with persistent navigation, toolbars, or dense configuration. |
| Make intimate states suggestive, abstract, and mature.                        | Use graphic sexual imagery or platform emoji as the visual identity.          |
| Preserve graceful crossfades between atmospheres.                             | Hard-switch colors/icons when a new card appears.                             |

# 16. Acceptance summary

A screen or visual change conforms to this design when all of the
following are true:

- It reads as warm, playful, and mature rather than corporate.

- The card and immediate social action remain visually central.

- Setup decisions remain wizard-like and intentionally sparse.

- Settings are discreetly available from the upper-right and remain
  tabbed inside a modal.

- The ambient background uses diagonal family-specific icon rows and a
  slow warm gradient, not a rotating background.

- Category/DareType determines the visual family; intensity only tunes
  that family.

- New-card atmosphere changes are graceful crossfades rather than hard
  switches.

- Primary typography and tactile button motion preserve the established
  character.

- Never-Have-I-Ever voting visibly distinguishes Pending from Voted for every current
  voter without exposing answer values before the reveal.

- Anonymous and named-answer results are visually distinct by explicit labels and
  content structure, not by color alone.

- Reduced-motion presentation remains complete and visually coherent.

**End of canonical visual-design scope.**
