# Documentation

## Product and architecture

- [Repository overview](../README.md)
- [Game Design Document](GAME_DESIGN.md)
- [Technical Architecture Document](TECHNICAL_ARCHITECTURE.md)
- [Visual & Interaction Design](VISUAL_INTERACTION_DESIGN.md)
- [Implementation ADRs and progress](implementation/)
- [Core release audit](implementation/core-release-audit.md)
- [Implementation review and corrective-action baseline — 2026-09-05](implementation/implementation-review-2026-09-05.md)
- [Corrective Phase 3: authoritative snapshots and commits — 2026-09-05](implementation/corrective-phase-3-2026-09-05.md)
- [Corrective Phase 3 follow-up: live catalog and bounded data — 2026-09-06](implementation/corrective-phase-3-rework-2026-09-06.md)
- [Corrective Phase 4: wire capacity and policy transfer — 2026-09-06](implementation/corrective-phase-4-2026-09-06.md)
- [Corrective Phase 5: recovery and actionable errors — 2026-09-06](implementation/corrective-phase-5-2026-09-06.md)
- [Corrective Phase 6: retention and operational budgets — 2026-09-06](implementation/corrective-phase-6-2026-09-06.md)
- [Corrective Phase 2: consent and refusal — 2026-09-05](implementation/corrective-phase-2-2026-09-05.md)

## Interfaces and operations

- [External interface contracts](contracts/README.md)
- [HTTP API v1](contracts/http-api.md)
- [WebSocket protocol v4](contracts/websocket-v4.md)
- [Retired WebSocket protocol v2](contracts/websocket-v2.md)
- [Retired WebSocket protocol v1](contracts/websocket-v1.md)
- [Bundled Card catalog](contracts/card-catalog-v2.md)
- [Historical immutable Card catalog v1](contracts/card-catalog-v1.md)
- [Infrastructure integrations](contracts/infrastructure.md)
- [Release bundles](contracts/release-bundles.md)

## Players

The localized Markdown in [`user-guide/`](user-guide/) is bundled with releases and
served by `/api/v1/help`. German and English directories must contain equivalent topic
coverage. [`user-guide/topics.json`](user-guide/topics.json) is the single registry for
topic slugs and explicit spaced numeric order. Add one registry entry plus the localized
Markdown files for a new topic; filenames do not carry ordering and the API/Svelte tabs
need no edits. The Svelte Help screen discovers documents through the API.

## Contributors and agents

- [Repository instructions](../AGENTS.md)
- [Code style and architectural rules](implementation/code-style.md)
- [Testing guide](TESTING_GUIDE.md)

Documentation is part of each contract. Update it in the same change as behavior,
configuration, transport schemas, or player workflows.
