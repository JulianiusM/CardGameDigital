# ADR-004: Svelte Couch Mode on the shared browser client

## Status

Implemented. The later Phase 10 cleanup made Svelte the sole browser presentation.

## Decision

The Svelte/Vite client lives in `apps/web`, is emitted to `dist/web`, and is served by
the retained Express application under `/play`. Couch, Room, account, and help flows
now use this one client; the former Pug pages and renderer were removed during Phase 10.
This remains a presentation adapter, not a duplicate client-side engine.

The browser sends setup and command DTOs to `/api/v1/couch`. Zod validates every
request. `CouchSessionService` creates and owns the authoritative `GameSession`,
loads cards from `CardRepository`, invokes domain commands, and returns a
projection. The Svelte component renders projections and never filters or
chooses authoritative cards.

The Couch UI supports:

- setup for every core game mode and one to twenty players;
- active-player and round presentation;
- Classic Question/Dare choice;
- Random automatic type selection;
- Ich hab noch nie voting with anonymous aggregate or named-answer reveal;
- Let's Talk meta scheduling through the shared domain engine;
- skip, advance, explicit pool exhaustion, and end Session;
- responsive layout and reduced-motion behavior.

## Authority, persistence, and privacy

Runtime state is server-authoritative and never browser-authoritative. Creation makes an
explicit persistence decision. `EPHEMERAL` is the default in every deployment and keeps
the active Session only in process memory, with no account, Couch Session,
CardAppearance, or Group-history rows. `DATASPACE` requires the authenticated account's
current DataSpace; commands are owner-scoped, mutations are persisted transactionally
before the in-memory cache is replaced, and the Session can recover after restart.
Same-Session commands are serialized and all commands carry optimistic revisions.
Snapshots use the shared application voting projection. They expose every required
voter's Pending/Voted completion without answer values during collection. Anonymous
results remain aggregate-only; named values appear together only after completion.
Ephemeral answers remain only in active runtime recovery state and never enter history.

## Offline behavior

The browser retains its Session reference through uncertain reloads and failed command
responses. It suspends game controls and reads the authoritative snapshot before play
continues, without replaying a possibly committed mutation. Definitive Session-not-found
clears the reference; account/access failures keep it and offer Account separately.
Recovery takes precedence over the fresh-game setup guard when a Session reference
survives but setup state is absent. Read attempts are bounded and offer explicit retry.
This follows the Phase 3 live-catalog rework: same-catalog automatic recovery is supported,
and a changed catalog can end incompatible games. It adds no save-and-quit behavior.

Vite bundles all required gameplay JavaScript and CSS. The UI uses system fonts
and CSS visuals and has no runtime CDN or remote-asset dependency.
