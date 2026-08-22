# Documentation

## Product and architecture

- [Repository overview](../README.md)
- [Game Design Document](../Multiplayer%20Party%20Card%20Game%20%E2%80%94%20Game%20Design%20Document%281%29.md)
- [Technical Architecture Document](../Multiplayer%20Party%20Card%20Game%20%E2%80%94%20Technical%20Architecture%20Document.md)
- [Implementation ADRs and progress](implementation/)
- [Core release audit](implementation/core-release-audit.md)

## Interfaces and operations

- [External interface contracts](contracts/README.md)
- [HTTP API v1](contracts/http-api.md)
- [WebSocket protocol v1](contracts/websocket-v1.md)
- [Bundled Card catalog](contracts/card-catalog-v1.md)
- [Infrastructure integrations](contracts/infrastructure.md)

## Players

The localized Markdown in [`user-guide/`](user-guide/) is bundled with releases and
served by `/api/v1/help`. German and English directories must contain equivalent topic
coverage. The Svelte Help screen discovers documents through the API.

## Contributors and agents

- [Repository instructions](../AGENTS.md)
- [Code style and architectural rules](implementation/code-style.md)
- [Testing guide](TESTING_GUIDE.md)

Documentation is part of each contract. Update it in the same change as behavior,
configuration, transport schemas, or player workflows.
