# Corrective Phase 2 — consent and refusal

Scope: F02, F03 and F04 from the [implementation review](implementation-review-2026-09-05.md).
Phase 1 privacy, retention and identity corrections remain in place.

## Corrective work plan and implementation

1. **F02 — derive consent from effective content.** One application decision now serves
   Couch start, Room start and the eligibility preview. It evaluates the full configured
   intensity ceiling, mode, taxonomy, flags and compiled policy. Catalog or effective
   EXPLICIT classification and explicit SEX/BORDERLINE_SEX DareTypes require confirmation
   when potentially eligible. Policy cannot remove catalog adult classification by lowering
   sensitivity. History, current roster size and private exclusions do not substitute for
   consent. Every preset remains editable. Web and Kodi use the server preview for the
   confirmation prompt; the server rejects unconfirmed starts before persisting a Session.
2. **F03 — commit refusal even without replacement.** Skip/veto mark the appearance seen
   and refused, clear the Card, answers and frozen voter IDs, and commit a new revision.
   A replacement still uses the same filters and Card type. If unavailable, Classic returns
   to choice and other modes return to ready without consuming the turn. Clients can choose
   another available type/draw or end, with an explicit exhausted presentation at zero Cards.
   Snapshots clear every connected viewer; replacement events describe actual replacement
   draws only. Couch and Kodi preserve alternative-type recovery after a failed choice.
3. **F04 — enroll late joiners privately.** Authentication alone leaves a newcomer outside
   the Session. Their private screen submits choices (including explicit empty choices) via
   `command.setBoundaries`. Enrollment commits the boundary row, represented-player roster
   entries and copied runtime restrictions together under the Room lock and optimistic
   revision. Existing players' choices remain frozen. Current Never Have I Ever voters do
   not change; subsequent Cards include the new restrictions. Reconnect preserves enrollment.

## Contracts and compatibility

The mandatory enrollment step requires **WebSocket protocol v3**. Server, web and generated
Kodi definitions/fixtures negotiate v3; v1/v2 clients receive the stable unsupported-version
error and must upgrade. The previous v2 contract is retained as historical documentation.
No legacy auto-enrollment path remains. HTTP v1 gains the additive preview boolean
`adultConfirmationRequired`; refusal retains existing response shapes/states. Database
schemas and Session runtime v5 are unchanged; no new migration is needed for this phase.

See [WebSocket v3](../contracts/websocket-v3.md), [HTTP](../contracts/http-api.md),
[ADR-007](adr-007-profiles-and-private-boundaries.md) and
[ADR-009](adr-009-play-topologies-and-ephemeral-rooms.md).

## Verification

Regression coverage includes Custom and edited presets, all three interface locales,
policy availability and sensitivity overrides, all four modes, Couch/Room persistence,
HOST/PLAYER/DISPLAY envelopes, partially completed voting, same-type exhaustion,
late-join reconnect, represented players, queued draws, stale enrollment, terminal
participants and transaction rollback after a failed appearance write. The persistence
checks run against both SQLite and MariaDB.

Desktop and 320-pixel phone audits cover effective adult confirmation, private enrollment
and exhaustion recovery. The earlier ambiguous Conversation Meta audit locator is scoped
to the gameplay actions; its exhaustion scenario now exercises an actual final-card skip
with a deliberately bounded two-Card pool.

Final successful checks:

- `npm run format:check` — passed, including Kodi static checks.
- `npm run build` — passed; Svelte reports zero errors and zero warnings.
- `npm run typecheck:test` — passed.
- `npm test` — 63 files and 453 tests passed; one optional MariaDB catalog-lock test
  skipped. Generated-artifact checks and the Phase 2 SQLite/MariaDB regressions passed.
- `npm run kodi:test` — 276 tests passed.
- `npm run e2e:couch -- --grep "edited profiles require adult confirmation|a player joining during active play" --reporter=line`
  — two tests passed.
- `npm run e2e:visual -- --grep "waiting, Conversation Meta|Personal play, reconnecting|anonymous Never Have I Ever results" --reporter=line`
  — three tests passed.
- `npm run e2e:couch -- --grep "a player joining during active play" --reporter=line`
  — one test passed after the final enrollment spacing adjustment. This repeats one
  of the five distinct browser scenarios above.
- `git diff --check` — passed.

The optional catalog-lock test requires `CARD_CATALOG_MARIADB_TEST=1`; its skip does
not apply to the Phase 2 MariaDB persistence suite, which ran. Browser captures in
`.tmp/visual-audit/` were inspected for confirmation, enrollment and exhaustion;
enrollment was inspected again after the final spacing change. These generated
captures remain local. Native Kodi validation covers its tests and generated contracts;
this phase does not claim a physical-TV usability audit or completion of later review phases.

## Protocol v3 follow-up audit

The follow-up audit confirmed that the server and browser handshake/envelope paths,
HTTP server information, generated Kodi schemas/fixtures, native socket validation and
both release packagers already used v3. It found missed hardcoded v2 values in the
server's DNS-SD advertisement, Kodi's DNS-SD acceptance filter, and native diagnostic,
server-detail and compatibility-error text. Those consumers now use the same shared
TypeScript version or generated native constant. Current documentation and contract
indexes are aligned; historical v1/v2 contracts and the original review remain historical.

The discovery regression now builds the actual server advertisement before checking its
TXT data. Native DNS tests exercise current-version discovery and reject older/newer
hints, and server-info validation reports the version actually required by the client.

Follow-up checks (the full-suite results above predate this audit):

- `npm run build` — passed; zero Svelte errors and warnings, with Kodi artifacts regenerated.
- `npm run format:check` — passed, including Kodi static checks.
- `npm run kodi:check` — generated-artifact verification, static checks and all 276 native tests passed.
- `npx vitest run tests/unit/local-discovery.spec.ts tests/unit/protocol.spec.ts tests/unit/kodi-client-contract.spec.ts tests/unit/release-bundle.spec.ts tests/architecture/release-boundaries.spec.ts`
  — five files and 36 tests passed.
- `git diff --check` — passed.

The rendered English/German server-detail text and diagnostics were also checked against
the outgoing native envelope version and generated server-info fixture; all report v3.
