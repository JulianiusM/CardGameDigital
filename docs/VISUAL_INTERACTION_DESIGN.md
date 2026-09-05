# Multiplayer Party Card Game — Visual & Interaction Design Document

> **Canonical look & feel / single source of truth**

Warm, playful, card-first, and adaptive. A golden-orange visual universe that changes character with the game without becoming visually fragmented.

|                     |                                                                                 |
| ------------------- | ------------------------------------------------------------------------------- |
| **Document status** | Canonical visual and interaction design reference                               |
| **Version**         | 1.3                                                                             |
| **Date**            | 25 August 2026                                                                  |
| **Scope**           | Look, feel, visual hierarchy, iconography, motion, and interaction presentation |

_Companion references: Game Design Document v1.4 for gameplay/product behavior; Technical Architecture Document v1.2 for implementation constraints. This document is authoritative within its visual-design scope._

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
| **Result Honey**  |            | #D5A03B | Post-reveal `YES` comparison   |
| **Result Clay**   |            | #A96B5A | Post-reveal `NO` comparison    |

**Color rule:** avoid introducing cool blue, teal, or corporate violet
as category identities. Neutral accessibility states may use grayscale,
but the expressive game identity remains warm.

**Utility feedback.** Information, confirmation, warning, and error
states must be identified by text and iconography rather than color
alone. Informational and confirmation treatments use cream, gold, or
burnt orange. Error and destructive treatments may use Berry. Green,
teal, and blue are not default utility-state colors for this identity.

**Result-color rule.** Result Honey and Result Clay are neutral
post-reveal comparison accents, not success/failure states. They must
never be reused as generic confirmation, warning, error, or player-status
colors.

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

**Answer-associated color.** Answer colors appear only after the final required vote has
been received. They are most prominent in anonymous aggregate results and may be used
sparingly in named-result column headings. They are never used on vote controls,
Pending/Voted progress, individual player names, or pre-reveal states.

**Anonymous result.** After voting completes, show aggregate `YES`/`NO` totals as the
primary result. The existing two-segment percentage-bar principle is canonical and may
continue. Use these equally weighted warm comparison gradients:

- `YES`: Result Honey, **#E4BA61 → #A66812**;
- `NO`: Result Clay, **#E3B4A5 → #9F6558**.

The darker Honey endpoint and lighter Clay starting point deliberately keep the segment
boundary distinguishable on small percentage bars.

The bar sits on a Soft Cream or low-opacity espresso track. Explicit `YES`/`NO` labels,
counts, and percentages remain visible; color is never the only distinction. Main metric
text remains Espresso Ink rather than being fully recolored. Do not show names beside
either answer, and do not use green/red or teal/rose success/failure semantics.

**Named-answer result.** After voting completes, show two equally weighted columns:
`YES` and `NO`. Every player appears exactly once, and names retain Session player order
within their respective column. An aggregate summary may remain visible. The column
headings and count badges may use Result Honey and Result Clay as restrained accents—
roughly 12-16% tinted fill and 35-45% border/mark opacity—but the column surfaces and all
name rows stay neutral Warm Paper/Soft Cream with Espresso text. Do not color individual
names or render answer-colored player chips. On passive displays, headings and totals
remain fixed while only the variable name rows auto-page.

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

**Language scale.** Interface and Card language controls use the same themed searchable
list: a warm search field, native/localized names, visible locale code, a bounded scroll
region, and a clear selected state. Ordered fallback languages use numbered warm rows
with explicit move/remove controls. Do not render hundreds of equal-weight language
buttons into the page.

**Hosted people.** Additional people represented by one device autosave after edits and
flush before Start. A bounded warm status row communicates pending, saving, and saved
state; there is no detached Save button that can be overlooked.

**Modal motion.** Backdrop fades in over roughly 180 ms. The modal
arrives over roughly 260 ms from about 20 px lower and 97% scale. Tabs
themselves do not use the playful button rotation.

## 7.1 Account and authentication surfaces

Account pages are part of the game SPA and use the same Warm Paper surfaces, 20-28 px
corners, sunflower actions, espresso text, tactile states, and generous sectional
spacing as setup. Semantic form controls remain accessible but must never retain a
plain browser-default appearance.

**Authentication choice.** Existing-account login and new-account registration are
equal, visible ways forward. On wide screens they occupy separate cards divided by a
vertical rule with “or”; on narrow screens the rule rotates horizontally and the cards
stack. Registration is a full secondary button, never a quiet text link. Password
recovery and activation resend remain smaller warm pill actions below the login form.

**OIDC provider.** Provider login is a deliberate full-width action section, separated
from local credentials by a labelled horizontal divider. It uses an espresso surface,
warm-paper text, a sunflower icon block, provider name, and a short redirect hint so it
cannot visually merge into the containing card or appear attached to a corner.

**Account overview.** Authenticated management uses five golden-capsule tabs:
DataSpaces, Groups, Card management, signed-in devices, and data/account actions. The first tab begins with a
short explanation of what a DataSpace separates and explicitly notes that quick rounds
remain unsaved. The selected DataSpace is visible in the page header and in its list
row. Create, rename/default, device revocation, export, sign-out, and destructive actions
live in individually bounded sections rather than one continuous control list.

**Main-menu ownership status.** When a DataSpace is available, a small warm context chip
in the corner status area names it without interrupting the hero-to-play hierarchy. It
remains readable with long names; authenticated use may link the chip to Account
management. Anonymous public quick play shows no misleading DataSpace status.

**Group management.** The Account Groups tab uses a searchable, paged master/detail
layout: the bounded list stays quick with hundreds of Groups and the selected Group owns
the only visible editor. Name/member edits, history reset, and full deletion are
sectionalized. Reset and deletion use themed inline confirmations; deletion requires the
exact Group name. The setup wizard retains selection and quick creation but no maintenance
or destructive actions.

**Destructive actions.** DataSpace and account deletion use raspberry-accented inset
cards and require typing the affected name. Confirmation controls are part of the themed
page; do not delegate the core flow to an unstyled browser dialog. Disabled deletion of
the final DataSpace includes a visible reason.

**Game continuity.** Help and Account destinations launched from in-game settings open
separately so the active game remains intact in its original tab.

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

Question Category or DareType selects the adaptive background family. The Card's derived
global intensity tunes that family's color, density, opacity, and motion so the atmosphere
tracks the same progression players see in the global meter. Between Cards, the last active
family and global intensity remain in place instead of jumping back to a generic lobby scene.
A Childhood question therefore stays golden/amber and a SEX dare stays berry/raspberry,
while both still deepen consistently as global intensity rises.

The active Card shows both values as a compact pair of symbol-led five-mark meters: a Card
symbol for relative Card intensity and a globe symbol for derived global intensity. No
visible descriptive labels accompany the meters. Accessible names still identify both
values for assistive technology.

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
reveals aggregate totals and its two-segment comparison bar. Named-answer mode reveals
both answer columns together as one deliberate result state rather than animating names
one by one, which could suggest an order or ranking that does not exist.

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

**Room access addresses.** Every QR treatment also includes the complete Room URL list
as quiet, warm-paper supporting copy. Long URLs wrap within their surface. Personal
devices may use a bounded scroll region for many local interfaces; passive displays use
the established measured automatic paging treatment instead of document scrolling.

**Room departure.** The Leave Room action is the first action in the Room settings tab,
before join information and service links. Its quiet danger surface keeps it easy to
find without competing with the active game outside settings.

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
| Use Honey/Clay only for explicit post-reveal answer comparison.               | Use green/red or teal/rose to imply that one answer is better or worse.       |

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

- Anonymous results retain a clearly labelled Honey/Clay percentage bar; color is not
  the only carrier of `YES`/`NO` identity.

- Named-answer results use two equally weighted columns, preserve Session player order
  within each column, and keep individual player rows visually neutral.

- Reduced-motion presentation remains complete and visually coherent.

## Card-management workspace

Card management uses the same Warm Paper surfaces, rounded edges, tactile controls,
Sunflower primary actions, Espresso text, icon language, and visible focus treatment as
game setup. It is a bounded master/detail workspace, never an unstyled administration
table. Every input—including search, numeric fields, file import, and structured filter
selects—receives an intentional Golden Mischief surface, focus ring, and touch target.
Main directive choices use themed segmented controls instead of browser-native selects.
Ordinal custom values use a shared themed range control, with the least intense value
on the left and the most intense value on the right. This includes General → Explicit
social sensitivity and Card intensity 1 → 5. Returning to Custom restores the person's
last in-editor value. A new custom sensitivity begins at Explicit, while a new custom
Card-intensity replacement begins at 1 and explains that the value replaces every
matching Card rather than limiting allowed intensity. The same scale component presents
the explicit game-level maximum social sensitivity in Customize Experience. The
Child-friendly profile appears in the ordinary profile
selector and copies editable topic, action, flag, sensitivity, and pacing defaults into
the same Customize Experience controls as every other profile.
The one-game Card-management workspace omits editable Card-sensitivity directives because
Customize Experience already exposes the Session's maximum social-sensitivity ceiling.
Sensitivity remains a searchable Card facet and rule condition.

The scope summary precedes three consistently named tiers: Scope Defaults, Conditional
Rules, and Card Overrides. Its picker opens only on request, labels DataSpace baseline
and Group overrides as distinct policy levels, and supplies search plus bounded Group
pages. Three-state controls always contain text; color is supplementary.
Defaults group availability/history separately from the explicitly titled **Replace
Card properties** section. Card detail presents each property as a responsive provenance
card showing
Catalog value, effective value, local directive, and source together—never as a wide
table. The rule editor exposes collapsible groups of structured metadata fields rather
than a free-form expression language and shows a full preview count plus a few Card
examples, including a prominent zero-match warning. New rules are disabled drafts and
may be saved without previewing. Preview is clearly labelled as an optional read-only
confidence check; a condition edit only invalidates an earlier preview.

Searchable rule lists render ten entries at a time. Card results are server-filtered and
cursor-paged, render 24 entries at a time, and visibly disclose that only the bounded
page is loaded. DataSpace and policy-scope Group browsers similarly render eight entries
at a time; setup and account Group browsers use bounded pages sized for their context.
Previous and Next actions occupy equal columns. A selected Card exposes its complete
canonical UUID with safe wrapping; IDs are never shortened into ambiguous prefixes.
The taxonomy label and UUID share one aligned metadata row with a visible divider.
Long names wrap inside their master rows so the complete value remains visible without
widening the page; selected detail preserves the same complete value. Empty, loading,
disabled, destructive-confirmation, and no-preview states use complete styled surfaces;
the interface never invokes a native confirmation dialog.

At narrow-phone width the master and detail regions stack, action targets remain at
least 44 CSS pixels, provenance cards become one column, and the page does not overflow.
Tabs may scroll within their own labelled control without widening the viewport. Play
profiles remain the only quick-start content preset, so ordinary games require no
additional policy concept or decision.
The Account version also stacks master/detail regions inside the Account panel even on
a wide viewport, because available component width—not just viewport width—governs
readability. It uses the standard compact Account-tab explainer instead of introducing
a second page-scale heading. Standalone Card management uses the same outer Card frame
as Help and Account. Scope actions share motion, shape, touch size, and no-wrap behavior,
while scope option names and descriptions wrap rather than truncate. In a wide standalone
master/detail view, expanding Card-search Conditions uses normal document flow; the
master pane itself must not gain a competing vertical scrollbar while page space is
available. Only the bounded result list may scroll independently when its own result
height requires it.
Every Card-management button family—including scope rows, segmented decisions, value
chips, rules, and Card results—uses the standard tactile hover lift and press compression.
Scale thumbs and selected ticks respond smoothly. Expanded filters and policy content
enter and leave with a short restrained reveal. Workspace tabs, selected rule/Card
details, inline confirmations, loading/empty states, and the embedded Account tab use the
same restrained panel transition so layout changes never appear as hard jumps. All such
motion obeys both the product reduced-motion preference and the operating-system
preference.

Before-start settings surfaces use one small eligible-Card status chip: a compact numeric
total, proposed player count, and optional starting-pool line. It uses a quiet warm
surface without a raised shadow, updates after a short debounce, retains an accessible
live status, and presents a clear zero/error state without blocking the rest of setup.
The Party Screen lobby keeps this chip beside the compact settings actions so the player
roster remains the dominant content. Once play begins, the Room code joins the round,
Card, remaining-pool, and live chips and receives the same adaptive contrast treatment.
Links from active-game settings open Card management separately and preserve the game.

**End of canonical visual-design scope.**
