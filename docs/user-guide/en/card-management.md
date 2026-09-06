# Card management

Card management is optional. If you leave every choice at **Inherit**, the producer
catalog, selected profile, and normal game setup keep deciding which Cards appear. This
is the best default for a quick game.

## Choose where a change applies

On a local installation, open **Card management** from the main menu. On a public
instance, sign in and open the **Card management** Account tab. The current DataSpace is
the baseline for all its saved Groups. **Choose DataSpace / Group** opens two explicitly
labelled levels: return to the shared DataSpace baseline, or search the bounded Group
list and select one only when that Group needs inherited exceptions.

The standalone local workspace follows the same outer Card layout as Help and Account.
Inside Account it behaves like the other tabs: the Account heading stays in place and a
compact tab explainer introduces the policy controls. Change, export, and import actions
share the same styled, non-wrapping button treatment.

Changes affect future games. A running game keeps the policy it started with. The
Customize step can also open a **This game** scope; those choices apply only to the game
being prepared and do not alter saved policy.

## Choose Child-friendly when children play

**Child-friendly** is a normal quick-start profile. It enables everyday, childhood,
personality, scenario, friendship, relationship, and body questions; keeps only silly,
ordinary-contact, and generic dares; blocks third-party, substance, clothing-removal,
and nudity requirements; and starts with a **Deep personal** sensitivity ceiling and
maximum intensity 3. Continue to **Customize Experience** if any value should change—the
profile does not lock or hide any setting.

## Start with Scope Defaults

**Scope Defaults** are the simplest way to make a broad change. Availability and history
choices are separate from **replacing Card properties**. Each control can inherit, use
the Catalog value, or hold an explicit local value as appropriate. A custom value
replaces the relative value of every matching Card; it is not an allowed maximum.

Ordered values use one left-to-right scale. Social sensitivity runs from **General** to
**Explicit**, and Card intensity runs from **1** to **5**. When you switch to **Replace
value**, the editor restores the last replacement entered for that item. If there is no
earlier value, it starts at the least restrictive end of the sensitivity range
(**Explicit**). A new custom Card intensity instead starts at **1**, preventing a low
starting intensity from accidentally removing every matching Card from the opening
pool. Higher replacement values carry an explicit warning. Player-count decisions use
the same Inherit/Catalog/Replace value control as the other values, followed by minimum
and optional maximum fields only when needed.

The ordinary **Maximum social sensitivity** setting is always a General-to-Explicit
slider and belongs to the selected game profile/configuration. Topic, dare, and
operational restrictions use the ordinary Customize Experience settings or explicit
Card policies; there is no additional situation layer to reconcile.

Setup, Customize Experience, Couch player setup, and the Room lobby show the eligible
Card count before start. The large number covers the full configured intensity
progression; a smaller line shows how many Cards are available at the start. The server
includes language, mode, profile, sensitivity, inherited Card policy, Group history, and
player count. Private player boundaries can still reduce the count when the game starts
and are never revealed by this preview.

## Add a Conditional Rule

Use a rule when a stable type, taxonomy, sensitivity, flag, or catalog range needs the
same treatment. New rules start disabled. Give the rule a clear name, select structured
conditions, choose its result, then optionally select **Preview matches**. The preview
counts the complete catalog but shows only a few examples; it neither changes nor saves
the rule and is never required for Save. Deliberately enable the disabled draft when it
is ready to affect play. Card wording is never stored as a rule condition.

Rules run in the order shown. Use the arrow actions to move a selected rule. Search and
bounded pages keep the list usable when many rules exist.

## Change one Card

**Card Overrides** searches the catalog on the server. Open **Conditions** for taxonomy
or operational filters, then page through the bounded result. In the wide side-by-side
workspace, opening Conditions grows with the page instead of introducing a second pane
scrollbar. Previous and Next use equal-size controls. Selecting a Card shows its full
canonical UUID together with its Catalog value, effective value, local decision, and the
source responsible for every managed property. Leave fields inherited unless the Card
genuinely needs an exception.

Applying an override to every search result requires an inline confirmation. The server
checks the count again and stores stable Card IDs, not the search phrase. Removing an
override returns the Card to normal inheritance.

## Import and export

**Export scope** downloads only the selected DataSpace or Group policy. **Import scope**
validates a package and asks for confirmation before replacing that scope. Import does
not change the producer catalog or copy ownership IDs. Keep exported policy files as
configuration data and inspect their origin before importing them.

## Changes made elsewhere

If a policy changed or a rule was removed while you were editing, the error explains
what happened. Your unsaved edit stays visible until you choose **Reload policy**;
reloading replaces it with the latest saved version. Review that version before making
another change. If a Group is unavailable, choose another scope or check **Account**
in the separate tab. A loading failure offers **Try loading again**. These actions
leave any active game's captured policy unchanged.
