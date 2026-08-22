# ADR-010: Presentation and release artifacts

## Status

Implemented for Phase 9; platform archives remain CI-verified.

## Decision

- Browser presentation uses canonical design tokens, responsive layouts, an
  animated local CSS background, card transitions, keyboard focus indicators,
  forced-color support, and both operating-system and explicit reduced-motion
  preferences.
- The root experience follows the GDD setup hierarchy: a restrained main menu
  leads into separate Mode, Device, Profile, and Group screens. Player entry is
  the final device-specific step, while advanced controls and in-game settings
  stay in collapsible panels or a modal instead of competing with the card.
- Ambient music and interaction/reveal effects are original WAV assets bundled
  by Vite. Six scene loops crossfade between menu, lobby, question, dare,
  conversation, and end states. Card taxonomy also changes color and motion.
  Audio is enabled by an explicit user gesture, preferences stay on the device,
  and gameplay never requests a CDN or cloud media service.
- The end screen deliberately makes the social close primary and keeps cards,
  rounds, and duration secondary, with actions for another round or a new game.
- German editorial UI copy is centralized in `messages.de.ts`. Components retain
  only protocol/state identifiers and non-editorial technical values.
- Portable and public artifacts are generated from the same `dist` output and
  locked production dependency graph. Portable output includes the current Node
  runtime, native Argon2 and SQLite bindings, launchers, local configuration, and
  writable data directory. Public output omits the embedded runtime.
- Release smoke checks assert the server, Svelte bundle, lockfile, native
  dependencies, and portable runtime/data/config layout before archives upload.

## Remaining platform gate

CI must execute packaging independently on every supported OS/architecture; a
single machine cannot produce or validate another platform's native bindings.
