# Repository instructions for agents and contributors

## Mission

Maintain one understandable, server-authoritative party game. Prefer information
hiding, DRY, KISS, explicit interfaces, and small named decisions over compatibility
layers or clever abstractions. This is fresh development: do not add legacy fallbacks
unless a current contract explicitly requires them.

## Read before editing

1. `README.md` for setup and repository boundaries.
2. The Game Design Document for player-facing behavior.
3. The Technical Architecture Document and the ADR relevant to the change.
4. `docs/contracts/` before changing any HTTP, WebSocket, importer, persistence, mail,
   OIDC, or deployment interface.
5. More deeply nested `AGENTS.md` files, if any; they override this file in their tree.

## Architectural boundaries

- `src/packages/game-core` is framework-independent domain code.
- `src/packages/application` owns use cases and ports, not Express or TypeORM details.
- `src/packages/persistence` implements ports and owns persistence mapping.
- `src/modules` and `src/routes` are infrastructure/transport adapters.
- `apps/web` consumes contracts; it must not become authoritative for game state.
- A logical Card has a stable UUID and no player-facing text. Text belongs to localized
  renderings. Never derive a card UUID from text and never hard-delete historical cards.
- UI localization may fall back to the configured default locale. Card content excludes
  missing translations unless the explicit deployment policy enables fallback.
- User-facing text belongs in locale catalogs. Use exported message-key constants; do
  not repeat localization key strings in services or routes.

## Maintainability rules

- Do not use nested ternaries or recursive conditional-type tricks. Prefer named types,
  guard clauses, `if`/`else`, `switch`, or a small mapping function.
- Avoid mode-specific copies of gameplay rules. Couch, Personal, and Party Screen use
  the same game engine and repository contracts.
- Validate untrusted input at transport/import boundaries with Zod.
- Never put `try`/`catch` around imports.
- Do not log credentials, tokens, passwords, boundary values, or session secrets.
- Preserve optimistic revisions and transactional commits for authoritative Rooms.
- Add migrations/entities together and regenerate `src/modules/database/__index__.ts`
  with `npm run generate`.

## Contract changes

When changing an external contract:

1. Update its schema/type and adapter.
2. Update the matching file in `docs/contracts/`.
3. Add or update a contract/integration test.
4. State compatibility impact. Protocol-breaking WebSocket changes require a new
   protocol version rather than silently changing v1.

## Required checks

Run the smallest focused test while iterating, then before committing run:

```bash
npm run format:check
npm run build
npm test
git diff --check
```

Run relevant Playwright tests for perceptible browser behavior. If browser binaries are
unavailable, report that environmental limitation rather than claiming the test passed.
Do not describe a test as executed unless its exact command was run.

## Git and delivery

- Keep generated build output, databases, artifacts, secrets, and local settings out of
  commits.
- Use a concise imperative commit message.
- Review `git diff` and `git status` before committing.
- Document user-visible changes and exact checks in the final response.
