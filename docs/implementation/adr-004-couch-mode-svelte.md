# ADR-004: Svelte Couch Mode beside the Blueprint UI

## Status

Implemented; Playwright execution awaits an environment with a browser binary.

## Decision

The first Svelte/Vite client lives in `apps/web` and is emitted to `dist/web`.
The retained Express application serves it at `/play`; existing Pug account and
administrative pages continue to operate. This is a strangler migration, not a
replacement server or a duplicate client-side engine.

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

## Authority and privacy

Runtime state lives in the server process for this vertical slice, not browser
storage. Commands include the current revision and stale revisions are rejected.
Snapshots use the shared application voting projection. They expose every required
voter's Pending/Voted completion without answer values during collection. Anonymous
results remain aggregate-only; named values appear together only after completion.
Ephemeral answers remain only in active runtime recovery state and never enter history.

## Offline behavior

Vite bundles all required gameplay JavaScript and CSS. The UI uses system fonts
and CSS visuals and has no runtime CDN or remote-asset dependency.
