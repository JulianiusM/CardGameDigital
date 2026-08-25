# Code formatting and readability

Phase 0–6 migration code is formatted with Prettier using the repository-level
`.prettierrc.json`. The configuration includes the Svelte plugin so TypeScript,
Svelte markup, CSS, JSON, migrations, tests, and implementation documentation
share a reproducible layout.

Use these commands before committing migration work:

```sh
npm run format
npm run format:check
```

Formatting is deliberately mechanical. Comments are reserved for architectural
ordering, security, privacy, serialization, and lifecycle decisions that are not
obvious from the code itself. Comments should explain **why** a constraint exists
rather than restating individual expressions.

Presentation components follow the same rule as server adapters: an entry-point
component coordinates state but does not own every screen. Lobby, gameplay, card,
summary, settings, and setup views are separate components with explicit callback
props. Repeated domain-to-presentation decisions belong in typed mapping functions,
not nested template conditionals. Shared card and summary components are used by
both Couch and Room presentations so visual behavior cannot silently diverge.

## Localization is an architectural boundary

User-facing text must live in a locale catalog. Svelte components import the
locale-neutral `i18n` facade and server adapters translate stable message keys from
`packages/localization`; neither layer imports a language-specific catalog directly.
Email subjects and bodies follow the same rule. Locale detection is centralized,
uses explicit local/account preference, browser languages, and an ordered fallback on
the client, and the `Accept-Language` header on the server. Selectors enumerate the same
central registry. Adding an interface language therefore means registering one
structurally compatible catalog, not editing components, services, or routes.

Tests reject language-specific imports outside the localization composition root,
literal account/help copy in components, and prose passed directly to application
errors. Protocol identifiers, domain IDs, URLs, and developer diagnostics are not
editorial copy and remain code constants.

## Readable control flow

Do not encode control flow or type design as nested conditional expressions. Use
named types, `if`/`else`, `switch`, or small mapping functions so each branch can be
read, tested, and changed independently. Architecture tests specifically protect the
localization composition root from recursive conditional-type tricks.

Localization keys are exported constants, not repeated string literals. Server
catalogs live in one file per locale and implement the explicit shared catalog type.
Ordinary UI localization resolves a regional tag to its base language and then to
the declared default locale. Card rendering is deliberately stricter: it uses an
explicit card locale and excludes missing translations unless a game configuration
opts into a named fallback locale.
