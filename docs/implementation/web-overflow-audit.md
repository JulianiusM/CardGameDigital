# Web text overflow audit — 2026-09-05

The audit preserves the existing panel arrangement, columns, breakpoints, spacing,
and font sizes. Changes constrain and scroll text within its own reading area.
HTTP and WebSocket contracts are unchanged.

## Findings and corrections

| Input / surface                                           | Finding                                                                                                                               | Correction                                                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 40-character player names using wide Latin and CJK glyphs | Personal voting widened a 320px document to roughly 625px; public roster rows clipped names; active-player names occupied five lines. | Native horizontal text scrolling in active-player, participant, voting-progress, ballot, and named-result labels.                                |
| 80-character Card taxonomy labels                         | Classifications took multiple lines and consumed the fixed Card's reading space.                                                      | Classification copy scrolls within one text line; Card geometry and typography stay intact.                                                      |
| Long host status and Room settings                        | Host connection/reconnection copy pushed the lobby departure control out of view.                                                     | The status and settings copy scrolls within the existing text slots.                                                                             |
| 10,000-character Card wording in management               | Result previews and the selected heading expanded into extremely tall text blocks, separating wording from its controls.              | Native vertical text windows: three lines for previews, four for the heading. Full text remains selectable and accessible by keyboard and touch. |
| Joined emoji and combining accents in Card pages          | Code-point pagination could split a visible character across pages.                                                                   | Grapheme-safe pagination, with bounded measurement work for long sources.                                                                        |
| Automatic public roster pages                             | A fixed page timer could replace a name before its horizontal scrolling finished.                                                     | Roster advancement observes label reading deadlines and hover/focus pauses.                                                                      |

Long-name departure notifications also pushed the lower lobby controls out of view.
Notification copy now scrolls within two text lines, waits for its reading deadline
before automatic dismissal, and pauses while focused, hovered, or the page is hidden.

The regression audit checks painted geometry and actual text endpoints. Scrolling text
is measured within its native clipping window; hidden overflow is still reported.
Tests also reconstruct complete paginated Card sources and check every grapheme boundary.

## Coverage

- Home, hosting wizard, joining, Couch lobby/play/summary, Personal play, Party Screen
  lobby/play/results, private choices and boundaries, reconnect and host replacement,
  settings and destructive-action recovery, Help, Card management, authentication,
  Account, DataSpaces, and Groups.
- 320×568 phones, 390×844 phones, 800×600 displays, 844×390 landscape displays,
  desktop viewports, and 1920×1080 TVs; German and English interfaces.
- 20 Couch players, configured 1,000-player Room ceiling, 1,000 Groups/rules,
  10,000-character Cards, 500-character notifications, 200-character searches,
  maximum locale/taxonomy labels, large URLs, and maximum-length account/group data.
- Keyboard scrolling to both ends, native scroll offsets, focus/hover behavior,
  reduced motion, forced colors, and 200% text scaling in management.

## Remaining limits under the no-layout-change constraint

Two existing viewport combinations fail even with ordinary names (`Anna`, `Ben`) and
ordinary Card copy. These were reproduced separately, without hostile input. The visual
inspection also found clipped choice-button corners in the existing narrow Couch layout:

| Existing layout                        | Reproduced result                                                                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Personal Never Have I Ever at 844×390  | Fixed chrome and voting leave the Card text viewport with **0px height**.                                                                            |
| Passive Party Screen voting at 320×568 | The roster reading region has **15px height** for a **44px row**, clipping even an ordinary player name and voting state.                            |
| Couch Truth/Dare choice at 320px width | The buttons' existing minimum widths exceed the Card's content width. The Card clips the outer button corners, although both labels remain readable. |

Text scrolling cannot make these zero-height or sub-line reading areas usable while
retaining their geometry. Their layout has therefore been left unchanged as requested.
The new text-overflow matrix explicitly excludes these two combinations; they are
limitations, not passing checks. Local evidence is in
`.tmp/overflow-layout-limit-personal.png`, `.tmp/overflow-layout-limit-display.png`,
and `.tmp/overflow-layout-probe.log`.
The Couch button clipping is visible in
`.tmp/visual-audit/10-couch-choice-max-active-name.png`; changing button widths or Card
spacing to repair it would also violate the layout constraint.

## Validation results

Chromium inspection produced **170 captured surfaces with no text-overflow, overlap,
truncation, or target-size findings** in the audited matrix. The geometry limits above
are recorded separately and are not claimed as fixes or passing coverage.

| Exact command                                                                                                          | Result                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run build`                                                                                                        | Passed; Svelte reported zero errors and warnings.                                                                                    |
| `npm run format:check`                                                                                                 | Passed, including Kodi static checks.                                                                                                |
| `npm run typecheck:test`                                                                                               | Passed.                                                                                                                              |
| `npm test`                                                                                                             | 372 passed, 1 skipped; the opt-in MariaDB catalog advisory-lock test was disabled.                                                   |
| `npm run e2e:visual -- --output=.tmp/overflow-visual-results`                                                          | 13 passed; one newly added keyboard assertion ran before resize measurement settled. The test now waits for the rendered state.      |
| `npm run e2e:visual -- --grep 'text overflow\|500-character\|replacement-host' --output=.tmp/overflow-focused-results` | All 4 affected tests passed on rerun, including the corrected assertion, Card results, Unicode, notifications, and host replacement. |
| `npm run e2e -- --grep 'account entry\|maximum-length'`                                                                | 2 passed in the public account test configuration below.                                                                             |
| `git diff --check`                                                                                                     | Passed.                                                                                                                              |

## Reproduction

Use `npm run build` before browser tests. The visual suite writes PNGs and geometry JSON
to `.tmp/visual-audit/`. These artifacts and disposable databases are ignored by Git.

- `npm run e2e:visual -- --grep 'text overflow'` exercises the added game/text cases.
- `npm run e2e:visual` runs the complete visual matrix, including management text windows.
- `npm run e2e -- --grep 'account entry|maximum-length'` covers authentication and
  maximum-length Account/Group data. This requires the disposable MariaDB profile and
  a public account runtime. The local audit used `DEPLOYMENT_MODE=public`,
  `AUTH_MODE=account`, `PUBLIC_RUNTIME_SECURITY=development`, and `SETTINGS_FILE=NUL`.
