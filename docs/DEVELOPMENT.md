# Development guide

## Prerequisites and setup

Use Node.js 24.x and npm 10 or newer.

```bash
npm ci
npm run build
npm test
```

Local defaults need no external database. The server creates a SQLite database under
`data/`. For public-database integration work, use the repository MariaDB compose file
and environment settings described in the root README.

## Common commands

```bash
npm run server:dev       # TypeScript server with reload
npm run build:web        # rebuild Svelte client
npm run build            # server, web, and bundled help
npm run typeorm:migrate  # explicit migration run
npm run generate         # regenerate TypeORM entity/migration index
npm run format           # format supported sources and documentation
npm run format:check
npm test
npm run e2e              # requires Playwright browsers
```

## Change workflow

1. Identify the owning layer in [`ARCHITECTURE.md`](ARCHITECTURE.md).
2. Read the applicable ADR and external contract.
3. Add or update the cheapest test that demonstrates the behavior.
4. Implement domain/use-case behavior before transport mapping when both change.
5. Add a migration and entity together for schema changes; run `npm run generate`.
6. Update player help for user-visible workflows and contract docs for external changes.
7. Run the checks required by [`AGENTS.md`](../AGENTS.md).
8. Review the complete diff for duplicated rules, leaked secrets, and stale docs.

## Adding an HTTP endpoint

- Put parsing and response projection in `src/routes/api`.
- Validate untrusted input with Zod.
- Put reusable behavior in an application service, not the route.
- Authenticate/authorize against account, DataSpace, Room, and participant state as
  appropriate.
- Return a stable machine error code and localized human message.
- Update `docs/contracts/http-api.md` and add an integration test.

## Changing WebSocket behavior

- Update strict schemas in `src/packages/protocol` first.
- Preserve the envelope, request correlation, optimistic revision, and viewer-specific
  snapshot behavior.
- Never trust claimed roles/capabilities over the credential-authenticated participant.
- Update `docs/contracts/websocket-v1.md` and WebSocket integration tests.
- A breaking change requires protocol version 2; do not silently redefine version 1.

## Changing cards or imports

Never add player text to `CardEntity` or derive UUIDs from text. Extend normalized
metadata and source rendering separately. Preserve source reconciliation, translation
status/revision, and soft retirement. Update the importer contract and catalog
persistence tests.

## Localization

Browser components use `apps/web/src/i18n.ts`. Server code uses exported
`MESSAGE_KEYS`; locale-specific text lives in separate catalog files. German and English
player-help directories must contain matching topic slugs. UI fallback and card-content
fallback are deliberately different policies.

## Code style

Prefer named functions, guard clauses, explicit types at boundaries, and one source of
truth. Do not use nested ternaries, recursive conditional-type tricks, try/catch around
imports, or mode-specific copies of game rules. Comments explain constraints and
security decisions, not syntax.