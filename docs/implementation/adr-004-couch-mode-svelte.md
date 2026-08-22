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
- Ich hab noch nie aggregate voting;
- Let's Talk meta scheduling through the shared domain engine;
- skip, advance, explicit pool exhaustion, and end Session;
- responsive layout and reduced-motion behavior.

## Authority and privacy

Runtime state lives in the server process for this vertical slice, not browser
storage. Commands include the current revision and stale revisions are rejected.
Snapshots expose aggregate votes and voter completion, not individual answer
values. Phase 5 will persist and synchronize this same aggregate through Rooms;
it will not introduce another game engine.

## Offline behavior

Vite bundles all required gameplay JavaScript and CSS. The UI uses system fonts
and CSS visuals and has no runtime CDN or remote-asset dependency.
