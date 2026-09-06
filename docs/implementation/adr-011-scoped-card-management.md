# ADR-011: Scoped Card management

## Status

Accepted.

## Decision

Card policy is sparse and scoped to DataSpace, optional Group, and pending Session.
Each scope has one Scope Default, ordered Conditional Rules, and Exact Card policies.
Within-scope precedence is default → rules → exact; cross-scope precedence is DataSpace
→ Group → Session. Producer metadata is immutable input and `CATALOG` restores its
resolved value.

Separate named situation bundles are not part of the model. They would duplicate the
content dimensions already owned by GameProfiles and Conditional Rules, introduce a
second activation and precedence path, and expose a player-facing concept whose
distinction from a profile is too small. The child-safety use case is
`PROFILE_CHILD_FRIENDLY`, an ordinary built-in profile whose category, DareType,
operational-flag, intensity, and sensitivity defaults remain editable through normal
game settings.

Session runtime **v7** records the catalog fingerprint and captured sparse DataSpace,
Group and Session policy inputs. It stores no catalog membership, metadata array,
translation snapshot, compiled per-Card policy or Group-history bitset. A changed catalog
ends incompatible active games atomically at startup. Same-fingerprint recovery remains
available; this is not a save-and-quit feature. Saved Group history never blocks catalog
updates and keeps its stable Card UUIDs.

Each draw scans every localized candidate in 256-Card metadata pages. Indexed lookups
supply that Card's last Session appearance and membership in the Group history window
captured at start. The engine reevaluates current progression, roster, boundaries,
cooldown and captured policy, then runs a weighted reservoir for each relevant Card type.
Cooldown expiry only makes a Card eligible again; it provides no priority. Only the
selected Card's chosen rendering is fetched. Fallback availability uses one `EXISTS`
query per page across the ordered locale set, without joining or loading translations.

Sparse policy inputs alone use content-addressed Brotli chunks (24 KiB binary / 32 KiB
Base64), with digest lookup before compression and validated size/count metadata on
recovery. Ended games detach them; bounded cleanup runs at end, account/DataSpace
deletion, catalog replacement and periodically. Identical live decoded inputs share weak
references. Runtime retains the most recent two appearances plus a total shown counter;
persistent draws query normalized history without loading the archive. Unsaved Rooms
retain one last-seen row per played Card and erase those rows when the game ends.
Saved sessions retain their required appearance archive.

Management uses server-side cursor search and preview for the global catalog. The web
client renders bounded pages for Cards, rules, Groups, and DataSpaces and expands only
one editor. Rule predicates are structured metadata only. Match preview is an optional,
read-only confidence check and never a save prerequisite; changing a predicate merely
marks a previous preview stale. New rules are disabled by default, so a draft cannot
affect play before the owner deliberately enables it. Bulk changes
reconfirm the complete server result count and persist Card UUIDs, never search text.
Pending-game eligibility preview is also server-side and reuses captured policy resolution plus core
eligibility at starting and maximum intensity. It includes proposed roster size and
shared Group history, but excludes private player boundaries.

## Consequences

- DataSpace/Group edits affect future Sessions only.
- Policies remain compact for large catalogs and retain stable UUID/taxonomy IDs.
- Starting a Session loads only its DataSpace scope and optional selected Group scope;
  policies belonging to other Groups do not enter the Session input.
- Only sparse policy inputs are retained per active game and deduplicated by content.
  Catalog growth does not create per-Session catalog storage. Rule evaluation costs
  CPU at draw time; prepared indexes and precedence avoid re-sorting/shadowed work.
- Local and public deployments share the same repository and resolver; only ownership
  resolution differs.
- Session Include may deliberately reverse persistent availability but cannot bypass
  hard lifecycle, localization, mode, profile taxonomy/sensitivity, boundary, or
  adult-confirmation gates.
- The ordinary quick-game path remains unchanged because empty policy means complete
  inheritance; advanced policy controls require deliberate navigation.
- Large catalogs do not become client authority or an unbounded DOM. Ownership summary
  APIs remain complete snapshots, with bounded search/paging as a presentation concern.

## Rejected alternatives

- A single global intensity rule was rejected because Card intensity is relative to its
  Question Category or DareType, and the adaptive background already selects that
  taxonomy-specific family.
- Free-form predicates and text-based rules were rejected because they are difficult to
  validate, localize, explain, and preserve across wording changes.
- Loading the catalog into a table was rejected because it does not scale, makes
  provenance unreadable on phones, and encourages client-side policy resolution.
- Automatic activation of new rules was rejected because an unpreviewed broad match can
  silently change an entire future game.
- A second kind of named situation preset was rejected because it would repeat the same
  metadata filters as profiles and rules while multiplying persistence, protocol, UI,
  localization, precedence, and documentation paths. A normal editable Child-friendly
  profile retains the useful quick-start behavior.
