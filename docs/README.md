# Documentation

## Product and architecture

- [Repository overview](../README.md)
- [Game Design Document](GAME_DESIGN.md)
- [Technical Architecture Document](TECHNICAL_ARCHITECTURE.md)
- [Visual & Interaction Design](VISUAL_INTERACTION_DESIGN.md)
- [Golden Mischief web migration guide](VISUAL_STYLE_MIGRATION_GUIDE.md)
- [Implementation ADRs and progress](implementation/)
- [Core release audit](implementation/core-release-audit.md)

## Interfaces and operations

- [External interface contracts](contracts/README.md)
- [HTTP API v1](contracts/http-api.md)
- [WebSocket protocol v2](contracts/websocket-v2.md)
- [Retired WebSocket protocol v1](contracts/websocket-v1.md)
- [Bundled Card catalog](contracts/card-catalog-v1.md)
- [Infrastructure integrations](contracts/infrastructure.md)

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
- [AI coding-agent visual migration prompt](AI_AGENT_VISUAL_MIGRATION_PROMPT.md)

Documentation is part of each contract. Update it in the same change as behavior,
configuration, transport schemas, or player workflows.
