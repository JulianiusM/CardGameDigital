# ADR-011: Scoped, compiled Card management

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

The application compiles policy once when a Session starts and stores catalog digest,
policy revisions, and compact per-Card effective properties in runtime version 5. The
serialized snapshot does not repeat human-readable provenance for every Card; runtime
builds one O(1) Card-ID lookup from the compact tuples. The compiled policy and frozen
Group-history input are content-addressed separately, Brotli-compressed, shared when
identical, and persisted in bounded chunks. Group history is an exact bitset indexed by
the frozen compiled Card order rather than a repeated UUID list. The hot Session row
stores only their digests. Played-Card history remains in normalized appearance rows and
is rehydrated for the engine instead of being copied into that row after every turn.
This preserves exact restart behavior without making any SQL statement proportional to
catalog or Group-history size. Player count is evaluated against the current authoritative roster,
because late joins affect the next Card without rewriting the frozen policy.

Management uses server-side cursor search and preview for the global catalog. The web
client renders bounded pages for Cards, rules, Groups, and DataSpaces and expands only
one editor. Rule predicates are structured metadata only. Match preview is an optional,
read-only confidence check and never a save prerequisite; changing a predicate merely
marks a previous preview stale. New rules are disabled by default, so a draft cannot
affect play before the owner deliberately enables it. Bulk changes
reconfirm the complete server result count and persist Card UUIDs, never search text.
Pending-game eligibility preview is also server-side and reuses compilation plus core
eligibility at starting and maximum intensity. It includes proposed roster size and
shared Group history, but excludes private player boundaries.

## Consequences

- DataSpace/Group edits affect future Sessions only.
- Policies remain compact for large catalogs and retain stable UUID/taxonomy IDs.
- Starting a Session loads only its DataSpace scope and optional selected Group scope;
  policies belonging to hundreds of other Groups neither enter compilation nor enlarge
  the Session snapshot.
- Catalog-sized immutable inputs deduplicate by content and use bounded chunks, so a
  larger catalog increases total storage and one-time setup compilation linearly but
  does not approach the database packet limit in one insert or update.
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
