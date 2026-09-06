# ADR-010: Presentation and release artifacts

## Status

Implemented for Phase 9; platform archives remain CI-verified.

## Decision

- Browser presentation uses the canonical Golden Mischief tokens, responsive layouts,
  a persistent adaptive backdrop, card transitions, keyboard focus indicators,
  forced-color support, and both operating-system and explicit reduced-motion
  preferences. Reading surfaces are near-solid Warm Paper or Soft Cream with Espresso
  text; dominant glass and cool-purple scene styling are not part of the browser theme.
- The root experience follows the GDD setup hierarchy: a restrained main menu
  leads into separate Mode, Device, Profile, and Group screens. Player entry is
  the final device-specific step, while advanced controls and in-game settings
  stay in collapsible panels or a modal instead of competing with the card.
- Ambient music and interaction/reveal effects are original WAV assets bundled
  by Vite. Six scene loops crossfade between menu, lobby, question, dare,
  conversation, and end states. A centralized presentation mapping assigns every
  Question Category and DareType to its canonical visual family; derived global Card
  intensity tunes that family's warm gradient, SVG motif opacity, row spacing, and
  density and persists between Cards. The Card surface presents relative and derived global intensity as separate
  Card-symbol and globe-symbol meters. Background motifs are selected independently at random from the active
  family's bundled SVG symbol set and placed in fixed-pixel, evenly spaced slots rather
  than precomposed moving lane images. The measured viewport determines how many parallel
  tracks and slots are needed, so resizing changes coverage rather than symbol spacing.
  Identical adjoining track segments provide seamless same-direction drift. Track speed is
  expressed in pixels per second, so viewport width changes loop duration rather than visible
  velocity. A persistent canvas renders the separately moving gradient as a continuous periodic
  color field, not as repeated CSS tiles or finite color layers. Every time-dependent term shares
  one linear phase along the opposite diagonal, while a cross-axis warp keeps the broad regions
  organic on wide displays; the phase completes in 20-28 seconds without an edge, reset, or resize
  jump. Family and intensity changes interpolate the field's two colors and warm highlight over
  1.0-1.2 seconds without replacing the canvas. The same field sampler reads the gradient beneath
  each visible SVG and derives its actual color from that local value. Bright families receive a
  darker relative; sufficiently dark Heat regions receive a lighter warm relative. This tone
  strategy remains part of the centralized family/intensity mapping and does not rely on browser
  blend modes. Family changes likewise fade symbols in place, same-family Cards do not remount the
  backdrop, and the oversized field preserves corner coverage at phone and display sizes. Audio is
  enabled by an explicit user gesture, preferences stay on the device, and gameplay never requests
  a CDN or cloud media service.
- The end screen deliberately makes the social close primary and keeps cards,
  rounds, and duration secondary, with actions for another round or a new game.
- German editorial UI copy is centralized in `messages.de.ts`. Components retain
  only protocol/state identifiers and non-editorial technical values.
- Server and browser presentation form the indivisible `server-web` release unit. They
  share one version, manifest, tag namespace, archive, and release workflow. No release
  command publishes either component independently.
- Portable and public artifacts share one source revision/version and coupled server/web
  build. Portable includes a Node single executable application, locked production
  packages with native Argon2/SQLite bindings, and writable local data. Its executable
  starts directly with local/no-account/SQLite defaults. Public is a platform-independent
  application-only archive started via the host's installed Node 24 process and production
  packages, with enforced-public/account/MariaDB defaults. Public never bundles Node,
  modules, native bindings, or service infrastructure, and refuses development catalogs.
- Kodi and Android-family clients are separate release units with independent versions,
  manifests, workflows, tag namespaces, and archives. They remain protocol consumers
  and are never folded into the server-web artifact.
- Release checks assert edition contents and manifest v2, run actual entrypoints outside
  the checkout, and verify browser assets/readiness. Portable launches with an empty PATH;
  public rejects missing managed configuration and excludes infrastructure. Six native
  portable targets and one public archive carry the same source SHA/version. CI includes
  format and desktop/phone visual gates. Publication verifies all seven archive manifests
  and tags that exact tested source; it never advances the branch. Releases are serialized.

## Remaining platform gate

The configured release matrix must complete on every supported OS/architecture; a
single development machine cannot validate another platform's native bindings.
