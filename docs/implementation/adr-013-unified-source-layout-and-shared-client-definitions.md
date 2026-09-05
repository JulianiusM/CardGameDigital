# ADR-013: Unified source layout and shared client definitions

## Status

Implemented.

## Context

The incremental migration deliberately left the Express server in `src`, reusable
packages in `src/packages`, the browser under `apps`, the Kodi client under `clients`,
and maintenance programs under a flat `scripts` directory. Those temporary locations
outlived the migration and made equivalent applications look architecturally different.
They also encouraged browser/native copies of protocol DTOs, Card presentation maps,
Golden Mischief values, and Kodi localization identifiers.

## Decision

- All deployable application source lives under `apps`: `server`, `web`, and `kodi`.
  Source placement is independent from release-unit policy. Server and web retain their
  coupled `server-web` version and artifact; Kodi retains its own manifest, version,
  workflow, and archive.
- Framework-independent domain, application, persistence, protocol, localization, and
  design definitions live in top-level `packages`. TypeORM entities belong to
  `packages/persistence`; server-specific account/help orchestration belongs to
  `apps/server`.
- Build, generation, migration, release, and test setup programs live in named
  `tooling` subdirectories. Generated outputs are checked without rewriting the
  working tree during tests.
- Zod protocol schemas and their inferred DTO types are the TypeScript HTTP/WebSocket
  contract source. Server adapters validate shared request and response shapes. Browser
  decoders validate known fields while retaining the documented additive-field rule.
- `packages/design-tokens` owns Golden Mischief colors and RGB channels, base Card
  atmospheres, and all Question/Dare taxonomy-to-family decisions. Web CSS, Kodi data,
  raster assets, and the tokenized Kodi WindowXML source consume those definitions;
  renderers retain only platform-specific behavior.
- `packages/localization/clientVocabulary.ts` owns stable bilingual terms that have the
  same product meaning in browser and native clients. Platform prose remains local.
  `packages/localization/kodiCatalog.json` owns Kodi-only copy, stable numeric IDs, and
  the native locale/settings manifest. Generation produces `strings.py`, both PO files,
  `settings.xml`, and Python settings metadata, deriving release version metadata from
  `apps/kodi/addon.xml`.

## Compatibility

The move changes repository paths and source provenance only. HTTP API v1, WebSocket
protocol v2, Card/catalog semantics, database migrations, browser URLs, Kodi add-on ID,
release-unit boundaries, and archive naming remain unchanged. Release launchers use the
server entry point's new compiled path.

## Enforcement

Architecture tests verify package dependency direction, the unified application
taxonomy, protocol ownership, shared vocabulary use, generated-token parity, exhaustive
cross-client Card presentation mappings, and independent release workflows. Generation
checks reject drift in the database index, web CSS tokens, Kodi protocol/design/skin
artifacts, localization/settings outputs, and unexpected files in generated directories.
