# Implementation review against the design documents — 2026-09-05

## Assessment

**The implementation is substantial, but it is not fully implemented or fully conformant to the current design.** All four game modes, all three browser topologies, localized content, persistent groups, public accounts, scoped Card policy, and a Kodi client exist. The shared engine and repository boundaries are real, and the main automated suites pass. Nevertheless, executable probes reproduced failures in privacy, adult confirmation, refusal, catalog freezing, optimistic concurrency, and transport capacity.

The most urgent corrections are:

1. Stop exposing live Never Have I Ever answer totals before reveal (**F01**).
2. Require adult confirmation for the effective configuration, including edited presets and Custom (**F02**).
3. Make skip/veto succeed even when no replacement Card is eligible (**F03**).
4. Give late joiners a private boundary-enrollment step before they enter the active roster (**F04**).
5. Remove private boundaries when their operational purpose ends (**F05**).
6. Make a Session's frozen catalog/policy inputs actually govern subsequent selection (**F07**).
7. Make valid Room snapshots fit the native protocol's supported receive capacity (**F09**).
8. Bind OIDC email verification to the exact email address being linked (**F10**, conditional on provider claims).

These are release-readiness concerns within implemented flows. They should not be obscured by a large feature checklist or by tests that assert only the intended projection. Later native platforms and optional management features are a separate backlog.

Named reusable custom-profile CRUD is also absent. ADR-007 calls it a release gate while the existing gap report calls it later work; that scope conflict needs an explicit decision.

This document is a corrective-action baseline, not an implementation change. Findings describe the reviewed revision; proposed corrections and acceptance criteria have **not** been implemented by this review.

## Review baseline and method

| Item                    | Baseline                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| Review date             | 2026-09-05                                                                                                     |
| Source revision         | `b2dc27313b4d59df62aeafdbc7642b0d1a1cf21f`                                                                     |
| Working tree at start   | Clean                                                                                                          |
| Product definition      | [GDD 1.4](../GAME_DESIGN.md)                                                                                   |
| Architecture definition | [TAD 1.2](../TECHNICAL_ARCHITECTURE.md)                                                                        |
| Presentation definition | [VID 1.3](../VISUAL_INTERACTION_DESIGN.md)                                                                     |
| Supporting decisions    | [Implementation ADRs](./), especially ADR-003 and ADR-005 through ADR-013                                      |
| External interfaces     | [HTTP, WebSocket v2, catalog v2, infrastructure, and release contracts](../contracts/README.md)                |
| Runtime used for checks | Windows, Node.js `v24.13.0`, npm `11.6.2`, Chromium; SQLite and the configured disposable MariaDB test profile |
| Application versions    | Server/web `0.0.1`; Kodi `0.3.4`                                                                               |

The review traced requirements through domain rules, application services, transport schemas and projections, persistence adapters/entities/migrations, Svelte screens, Kodi decoding/transport, catalog data, tests, and CI/release workflows. It also ran the checks recorded below and small deterministic probes against the built implementation and actual TypeORM adapters.

Evidence labels used below:

- **Reproduced:** exercised in this review using the existing suite or a focused probe. A domain/service probe is identified as such; it is not presented as a complete browser/network exploit.
- **Source-confirmed:** the relevant implementation paths establish the discrepancy; the complete user scenario was not executed.
- **Risk:** a specific failure condition follows from the implementation, but its production frequency or measured impact remains unknown.
- **Deferred / optional / external:** absent work that is not automatically a defect in the declared first-release scope.

Priority labels are corrective priorities: **P1** should be resolved before releasing the affected capability as design-complete; **P2** should be scheduled before broader public use, catalog growth, or operational expansion. A P1 finding can have a narrow prerequisite, such as enabling OIDC. The review does not assign a misleading percentage of completion: requirements vary greatly in scope and several specifications conflict.

## Requirement coverage

“Present” means a meaningful implementation and supporting evidence exist, not that every edge case is proven correct. Findings qualify the status of the affected rows.

| Design area                                                                              | Implementation and evidence                                                                                                                                 | Assessment                                                                                    |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| One authoritative engine; GDD §3.3, TAD §§4, 8, ADR-003                                  | `packages/game-core` supplies Session rules to Couch and Room services; framework dependencies stay outside the engine. Architecture and engine tests pass. | Present; lifecycle and persistence exceptions in F12/F20.                                     |
| Stable UUIDs and separate renderings; GDD §§3.5–3.7, 19–35                               | Normalized Cards, locales and taxonomy translations; catalog reconciliation preserves identity and retires removed Cards.                                   | Present. Source/editorial lineage outside this repository is not independently verified.      |
| Card classifications, flags, social sensitivity and player ranges; GDD §§5–18, 50–51, 89 | Explicit types and validated catalog metadata feed eligibility and policy compilation.                                                                      | Present; effective adult gating is incomplete, F02.                                           |
| Card language versus UI language; GDD §§20–29, 72–73; TAD §§28–32                        | UI fallback, explicit Card fallback policy, coverage/count reporting, localized renderings with stable IDs.                                                 | Present; English content coverage is very small.                                              |
| Classic Truth or Dare; GDD §37                                                           | Deliberate type choice, reveal, rotation, revisioned commands.                                                                                              | Present; skip failure F03.                                                                    |
| Random Truth or Dare; GDD §38                                                            | Shared weighted selection, ratio control and maximum type streak.                                                                                           | Present; same refusal/catalog defects apply.                                                  |
| Never Have I Ever; GDD §39                                                               | Frozen voter set, anonymous/named modes, progress, reveal and advancement; canonical privacy projection exists.                                             | Incomplete privacy across the full payload, F01; refusal F03.                                 |
| Let's Talk; GDD §40                                                                      | Questions and deliberately scheduled Conversation Meta Cards through the shared engine.                                                                     | Present; one visual test stops before its Meta/exhaustion assertions, F17.                    |
| Couch topology; GDD §41, ADR-009                                                         | HTTP-driven shared-device play without manufacturing a Room; optional owned persistence.                                                                    | Present; recovery, concurrency and cleanup gaps F06/F12/F13.                                  |
| Personal topology; GDD §41                                                               | Private choice/vote/boundary UI, participant credentials and role-specific snapshots.                                                                       | Present; F01/F04/F05 qualify privacy claims.                                                  |
| Party Screen / TV + phones; GDD §§41–42, ADR-012                                         | Display bootstrap, first connected phone becomes Host, passive display, roster/text pagination.                                                             | Present in enabled deployments; public bootstrap is disabled by default. Native capacity F09. |
| Host transfer, reconnect and closure; TAD §§53, 55–60, ADR-012                           | Central Host-selection decision, transactional participant lifecycle, persisted deadlines, reconnect grace, revision checks.                                | Substantial; cross-operation atomicity risk F20.                                              |
| UUID-based Group/Session history; GDD §§43–49                                            | Shared history reads across Room/Couch and locales; appearance records include skipped/vetoed outcomes.                                                     | Present; F03 prevents the outcome commit in one refusal case.                                 |
| Repeat controls and cooldown; GDD §§46–49                                                | `alwaysEligible` and `repeatableInSession` have separate effects; cooldown and weighting are engine decisions.                                              | Present and covered by focused/simulation tests.                                              |
| Independent intensity settings/progression; GDD §14                                      | Starting/maximum intensity, progression unit/interval/increment, overlapping ranges and next-selection ceiling.                                             | Present; do not restore obsolete fixed restrictions on editable presets.                      |
| Built-in profiles and editable setup; GDD §§53–54, 62–64, ADR-007                        | Built-ins initialize editable settings; Custom represents current settings.                                                                                 | Present for setup; named reusable custom-profile CRUD is absent; F02.                         |
| Private boundaries; GDD §§55–57, 79, ADR-007                                             | Lobby boundary submission, question versus all-player filtering, private values excluded from public DTOs.                                                  | Incomplete for late joiners and terminal retention, F04/F05.                                  |
| Skip and anonymous veto; GDD §§58, 81                                                    | Shared replacement path and Room private-veto permission.                                                                                                   | Fails when the matching replacement pool is empty, F03.                                       |
| Pool exhaustion; GDD §52                                                                 | Explicit errors, eligible-count previews and recovery/end UI; no automatic filter relaxation.                                                               | Present for selection; refusal must be committed independently, F03.                          |
| Scoped Card management; GDD §89, ADR-011                                                 | DataSpace → Group → Session precedence, defaults/rules/exact overrides, server previews, bulk operations, portable import/export.                           | Substantial; F07/F08/F11/F16 and preview specification conflict F19.                          |
| Frozen policy/provenance; GDD §89, TAD §105                                              | Compact per-Card policy values, catalog provenance, compressed immutable policy/history payloads.                                                           | Incomplete catalog freeze, F07; revision metadata can misrepresent changes, F08.              |
| Management UX at scale; VID Card-management workspace                                    | Server-paged Card queries, bounded rendered ownership/rule lists, detail drawers, narrow-phone layouts.                                                     | Present; API byte limits and actual selection/broadcast scale remain gaps, F11/F14.           |
| DataSpaces and Groups; GDD §§43–44, 78; TAD §51                                          | Account/local ownership, Group CRUD, reset/delete workflows, saved settings, history isolation.                                                             | Present, with integration coverage; not a general history analytics interface.                |
| Public local-account authentication; TAD §52, ADR-008                                    | Password hashing, activation/reset tokens, session regeneration/revocation, owned resources and account deletion.                                           | Present; live mail delivery was not tested.                                                   |
| OIDC; TAD §52, infrastructure contract                                                   | Discovery, PKCE/state/nonce, canonical callback and account linking.                                                                                        | Present with a conditional identity-linking defect, F10.                                      |
| LAN/offline operation; TAD §§4.3, 13–16, 77                                              | Bundled assets, local SQLite, QR/link construction, DNS-SD discovery and persisted installation identity.                                                   | Present; physical LAN/router/device combinations were not exercised.                          |
| Persistence portability and restart; TAD §§18–19, 60–66                                  | SQLite/MariaDB adapters, transactional Room commits, versioned runtime and migrations, backup implementation.                                               | Present; F05–F08/F12/F20; optional catalog-MariaDB test skipped in this run.                  |
| Protocol validation and confidentiality; TAD §§55–57, 78–83                              | Zod at boundaries, hashed participant credentials, role checks, encrypted creation replay, socket limits.                                                   | Present but insufficient as a complete guarantee, F01/F09/F11/F15.                            |
| Golden Mischief presentation; GDD §§66–73, VID §§2–16                                    | Shared tokens/motifs, themed controls, responsive layouts, motion/audio preferences, focus and overflow handling.                                           | Substantially implemented; visual gate incomplete, F17; recovery F13.                         |
| Kodi; TAD §74, ADR-013                                                                   | Python client, generated shared definitions/localization, HTTP and WebSocket adapters, discovery, view/effect separation, packaging workflow.               | Present; 276 Python tests pass; F09 and real-device QA remain.                                |
| Android TV / Google TV / Fire TV; TAD §75                                                | Architectural description, no corresponding application implementation.                                                                                     | Deferred platform work.                                                                       |
| Coupled server/web and independent native release; TAD §§16, 94–96, ADR-010/013          | Server/web bundle tooling, six-target release matrix, independent Kodi release.                                                                             | Present in code/workflows; source pinning risk F18; matrix not executed here.                 |
| Operational cleanup, abuse controls and observability; TAD §§61, 82–84                   | Structured logging, health endpoints, selected HTTP/socket limits and Room lifecycle metrics.                                                               | Partial: retention and expensive public work are not adequately bounded, F05/F06/F14/F15.     |

## Catalog facts and content readiness

The checked-in [catalog](../../catalog/card-catalog.json) is **not a four-Card fixture**. Older statements in the repository overview, gap report and release audit must not be used as the current inventory.

| Property                                        | Observed value                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Contract / catalog                              | `game-card-catalog/v2` / `core`                                                             |
| Sequence / version                              | `1` / `2026.08.25-1`                                                                        |
| Generated timestamp                             | `2026-08-25T18:46:59Z`                                                                      |
| Exact artifact SHA-256                          | `cd50fdcf7eb4eb67e4dca26848460b34476cae125e619ba6357efeec4b7590c5`                          |
| Cards                                           | 1,940; all active, none retired in this release                                             |
| German renderings                               | 1,940 / 1,940, 100%                                                                         |
| English renderings                              | 10 / 1,940, approximately 0.5%                                                              |
| Missing taxonomy labels in the declared locales | 0                                                                                           |
| Social sensitivity distribution                 | GENERAL 894; PERSONAL 112; CLOSE_PERSONAL 393; DEEP_PERSONAL 72; INTIMATE 214; EXPLICIT 255 |
| Sensitivity metadata sources                    | 1,787 inherit taxonomy defaults; 153 have Card overrides                                    |
| Player-range exceptions                         | One Card has a higher minimum than two; none has a finite maximum                           |

Build-time catalog validation passed. This verifies schema and structural consistency; it does not establish editorial approval, suitability of every prompt, source rights, or semantic continuity of producer-assigned UUIDs. Those require producer/release evidence. Sparse player-range exceptions are a useful editorial review target, not proof of wrong metadata.

The English pool can exhaust rapidly because missing translations are excluded by default and the ten translated Cards are further filtered by mode, profile, history and boundaries. The GDD explicitly permits shipping without an additional complete translated catalog. Therefore this is a content-readiness limitation, not a missing localization architecture. State it clearly wherever English Card-language support is advertised.

## Findings and corrective acceptance criteria

### F01 — P1: Live answer totals bypass the private voting projection

**Evidence: reproduced in Couch service and Room display projection.** GDD §39/§79 and TAD's Never Have I Ever projection require answers to remain private until reveal. [CouchSessionService](../../packages/application/couchSessionService.ts#L347) and [RoomService.project](../../packages/application/roomService.ts#L1221) both publish `voteResult: session.voteResult()` alongside the correctly restricted `neverHaveIEverVoting` projection. [GameSession.voteResult](../../packages/game-core/sessions/session.ts#L594) returns actual totals in every state.

With one of two Couch voters having answered YES, `neverHaveIEverVoting.result` is `null`, but `voteResult` already contains one YES. A Room DISPLAY projection has the same leak. Progress identifies who has submitted; observing successive totals can therefore associate a particular answer with a player, including in anonymous mode. Hiding the result panel in the UI does not protect the wire data.

**Correction:** derive every outward voting field from one privacy decision. Remove or consistently mask the unrestricted projection, document compatibility impact, and version any breaking WebSocket change.

**Done when:** tests inspect the complete serialized Couch response and HOST/PLAYER/DISPLAY envelopes before, during and after reveal, including sequential-vote differencing. No pre-reveal YES/NO totals or answer identities are recoverable from alternate fields.

### F02 — P1: Adult confirmation checks a preset ID rather than effective settings

**Evidence: reproduced in Couch; shared guard confirmed in Room.** [profileRequiresAdultConfirmation](../../packages/application/roomGameSettings.ts#L174) only looks up the built-in profile's flag. Both Session-start services use it, while [roomSettingsGameProfile](../../packages/application/roomGameSettings.ts#L153) accepts the supplied editable configuration. The browser editor similarly keys the prompt to the preset.

A probe supplied `PROFILE_CUSTOM`, Spicy-equivalent enabled types and intensity settings, and `adultContentConfirmed: false`. Session creation succeeded and selected an EXPLICIT `DARE_SEX` Card. An edited non-Spicy preset can reach the same configuration. This bypasses the implemented deliberate-confirmation mechanism and conflicts with GDD §§80–81/89 and ADR-007.

**Correction:** define the adult-confirmation requirement from effective content-enabling settings and applicable policy, and enforce it on the server before play. Keep presets editable as designed; a fixed restriction on one preset does not solve this defect.

**Done when:** both topologies reject unconfirmed effective adult configurations for Custom and edited presets, accept explicit confirmation, and continue to allow non-adult configurations. Exercise relevant policy overrides and all supported locales.

### F03 — P1: Skip and veto fail when a replacement cannot be selected

**Evidence: reproduced in the shared engine through Couch service.** GDD §58 and §81 require skipping to remain possible. [GameSession.replaceCard](../../packages/game-core/sessions/session.ts#L558) selects a replacement of the pending type before recording refusal, clearing votes or changing the current Card. If selection throws `CARD_POOL_EXHAUSTED`, the application never commits a revised state.

With a single eligible Never Have I Ever Card and one submitted answer, skip throws, the refused Card remains current, and the revision is unchanged. A different Card type being available does not fix an empty replacement pool for the pending type. During voting, normal advance is also disallowed until results, leaving an especially poor refusal path. Other connected displays retain the original Card.

**Correction:** commit refusal independently of replacement success: mark the appearance as seen and skipped/vetoed, clear sensitive answer state, and enter an explicit state from which the group can choose a safe next action or end. Keep all content filters intact.

**Done when:** final-Card skip and veto remove the Card on every viewer, retain correct history, and offer recovery without requiring an answer. Cover all modes, both services, exhausted same-type pools and partially completed voting.

### F04 — P1: Late joiners enter an active Session without boundary enrollment

**Evidence: source-confirmed.** [RoomService.addConnectedParticipant](../../packages/application/roomService.ts#L642) adds an authenticated connected player's roster entry immediately. [setBoundaries](../../packages/application/roomService.ts#L840) rejects changes once a Session exists. [GameSession.addPlayers](../../packages/game-core/sessions/session.ts#L486) does not add boundary values, and selection substitutes `EMPTY_BOUNDARIES` for missing entries.

A person joining after start can therefore participate in the next Card without a chance to set private exclusions. GDD §89 explicitly includes late joiners in subsequent eligibility. ADR-007's prohibition on mid-Session editing does not define safe first-time enrollment, so the combination is incomplete.

**Correction:** introduce a private pending-enrollment step before a late joiner becomes an eligible Session player, or keep that participant outside the active Session until the next game. Define first-time enrollment separately from changing an existing player's frozen choices. Commit roster and accepted boundaries together.

**Done when:** a late joiner's rejected DareType affects the next eligible group Card, never appears in public data, and cannot race with a draw. The current Never Have I Ever voter set remains frozen.

### F05 — P1: Private boundaries survive their active purpose in persistent records

**Evidence: ended runtime reproduced; persistence retention source-confirmed.** TAD §61 and GDD §79 distinguish active recovery data from long-term sensitive records. [GameSession.end](../../packages/game-core/sessions/session.ts#L618) clears votes but retains `boundariesByPlayer`; `toRuntimeState()` serializes it. Removing players also leaves their entries in that map. [Immutable payload externalization](../../packages/persistence/sessionImmutablePayloadStore.ts#L130) does not remove boundary values from the runtime JSON.

[Room boundary rows](../../packages/persistence/TypeOrmRealtimeRoomRepository.ts#L420) are separately persisted. Terminal participant/Room transitions and `clearEndedRuntime` do not delete them; the latter disconnects the active-session pointer rather than deleting historical runtime rows. The ended-runtime probe retained its private boundary record. No terminal-retention policy is enforced by these paths.

**Correction:** separate data needed for an active Session or an explicitly continuing lobby from the minimal ended record. Scrub terminal runtime boundaries and delete participant boundary rows when their purpose ends. Address already persisted records and document backup retention; preserve non-sensitive Card history.

**Done when:** database-level tests after end, leave, close, expiry, restart and owned-data deletion find no unjustified boundary values, while reconnect during an active game still restores them correctly.

### F06 — P2: Ephemeral sessions and immutable payloads lack bounded cleanup

**Evidence: source-confirmed resource-retention risk.** [CouchSessionService](../../packages/application/couchSessionService.ts#L91) retains Session and ownership maps without terminal eviction or expiry, including anonymous EPHEMERAL games. Each cached Session can retain compiled catalog data and accumulated history. [Room creation](../../packages/application/roomService.ts#L301) gives Rooms a 24-hour expiry, but lifecycle expiration closes records rather than purging unowned Room/session/appearance data. Account deletion does not apply to unowned Rooms.

The content-addressed [immutable payload store](../../packages/persistence/sessionImmutablePayloadStore.ts) has no corresponding orphan collection path. Replay tombstone pruning exists; it should not be mistaken for general game-data cleanup. Over a long-running installation these paths allow heap or storage growth unrelated to active games.

**Correction:** define retention separately for recoverable active games, ended owned history, anonymous games and shared immutable blobs. Add bounded cache eviction and scheduled persistence cleanup with reference-safe blob collection.

**Done when:** repeated create/end/expire cycles converge to documented memory and storage bounds, cleanup survives restart, and retained Group history and live snapshots remain intact. Combine public creation limits with F15.

### F07 — P1: Frozen catalog provenance does not freeze the actual selection inputs

**Acceptance revised 2026-09-06:** the product clarification requires stability during
one active game, no save-and-quit, and catalog updates independent of saved Group history.
The [Phase 3 correction](corrective-phase-3-rework-2026-09-06.md) replaces the original
cross-release catalog snapshot requirement. The evidence below records the original defect.

**Evidence: reproduced in the engine; live repository reads source-confirmed.** GDD §89 says later policy or catalog edits cannot mutate an active Session. The compiled policy stores compact effective values, but not all catalog membership, type/taxonomy, flags and rendering inputs. Subsequent [Couch selections](../../packages/application/couchSessionService.ts#L256) and [Room selections](../../packages/application/roomService.ts#L993) fetch the current active localized catalog.

[applyCompiledPolicy](../../packages/game-core/sessions/session.ts#L657) returns a Card unchanged when its ID is absent from the saved compilation. In the probe, a snapshot excluded Card A; supplying the current catalog as A plus newly introduced B allowed B to be selected even though B was never compiled. Existing Cards also obtain unsnapshotted fields from current rows. Retirements or removed translations change available membership after restart/catalog reconciliation. The stored digest does not prevent this.

**Correction:** use the installed catalog generation directly, retain its fingerprint and sparse policy inputs for the current game, and end incompatible active games atomically when installing a different catalog. Keep stable Card IDs and saved Group history. Do not persist catalog or translation snapshots.

**Done when:** same-fingerprint recovery preserves policy and history; a changed catalog ends incompatible active games, releases their temporary inputs, and serves new games without Group-history version locks. Each draw considers every currently eligible Card, including progression changes and expired cooldowns, using ordinary weights without cooldown priority. Cover new/retired Cards, translation changes, long multilingual catalogs, and both database modes without per-Session catalog storage.

### F08 — P2: Card-policy revisions do not reliably prevent lost updates

**Evidence: concurrent rule updates reproduced against the actual SQLite TypeORM adapter.** [updateRule](../../packages/persistence/TypeOrmCardPolicyRepository.ts#L124) reads a row, compares its revision and then calls `save` without a revision condition in the write. Two concurrent updates using revision 1 both succeeded and returned revision 2 in the probe. The second can silently overwrite the first. Deletes have the same read/check/write separation; a transaction around default/exact writes alone does not make their initial reads compare-and-swap operations.

There are related scope-consistency risks: reordering and scope replacement lack an expected aggregate scope revision, replacement resets row revisions, and [maximumRevision](../../packages/application/cardPolicyService.ts#L322) is only the maximum individual row revision. Editing another row can leave that maximum unchanged. It is not a unique revision of the complete policy or proof that compilation read one coherent scope state.

**Correction:** use conditional database writes/deletes with the caller's expected revision, and a monotonic scope revision plus suitable transactional isolation for reorder, replacement and compilation. Treat revision provenance accurately.

**Done when:** simultaneous same-base writes have one winner and one conflict in SQLite and MariaDB; import/reorder cannot overwrite an unseen edit; compilation represents a coherent policy revision. Preserve ownership checks and define API compatibility for new concurrency fields.

### F09 — P1: A valid Room at default capacity exceeds Kodi's receive limit

**Evidence: schema-valid snapshot reproduced and rejected by the real Python decoder.** [Protocol limits](../../packages/protocol/limits.ts) define 65,536 bytes. Server WebSocket `maxPayload` restricts inbound messages, while [send](../../apps/server/src/modules/websocket.ts#L545) serializes outbound snapshots without a corresponding size check. [Kodi decode_envelope](../../apps/kodi/resources/lib/protocol/validation.py#L742) and its transport enforce that limit on received messages, including fragments.

A snapshot containing 99 voting players and one display, within the default 100-participant capacity, with allowed 40-character CJK names, was accepted by `roomSnapshotEnvelopeSchema`. After one answer, its encoded size was **70,176 UTF-8 bytes**. The Python decoder returned `WebSocket message exceeds 64 KiB`. Higher configured capacities and larger settings make this worse. Browser rendering tests with 1,000 mocked participants do not establish native wire compatibility.

**Correction:** establish coordinated inbound/outbound byte budgets and a projection or versioned delivery mechanism that supports the advertised capacity. An arbitrary server-only limit increase will not repair installed native clients. Avoid silent truncation of required player state.

**Done when:** real server-to-Kodi fixtures at supported maximum roster, name, Card-text, voting and settings sizes decode and resynchronize successfully. Measure UTF-8 bytes, test fragmented delivery, and state protocol compatibility.

### F10 — P1 for OIDC deployments: Email verification can be inherited by a different address

**Evidence: source-confirmed conditional security defect; no live-provider account takeover was attempted.** [OIDC callback](../../apps/server/src/modules/oidc.ts#L128) merges `{ ...claims, ...userInfo }`. If an ID token provides verified email A and UserInfo supplies email B but omits `email_verified`, B inherits A's `true` flag. Subject equality is checked, but the email/verification pair is not kept together.

[findOrCreateUserFromOidc](../../apps/server/src/modules/database/services/UserService.ts#L282) allows a verified-email match to attach the OIDC identity to an existing local account and activate it. The dangerous prerequisite is a provider returning different email addresses across the two sources with an omitted verification flag in UserInfo; a provider returning consistent claims does not trigger this path.

**Correction:** resolve identity claims as coherent values with provenance. A verification flag must apply to the exact selected email. If UserInfo changes the address without proving verification, do not auto-link that address. Define how existing links to other identities are handled.

**Done when:** callback tests cover equal emails, changed emails, omitted/false verification, unavailable UserInfo and conflicting existing links. An address change never inherits verification from another address, and legitimate verified linking still works.

### F11 — P2: Valid policy documents exceed HTTP and WebSocket body budgets

**Evidence: schema-valid byte-size probes; rejection limits confirmed in source.** The [policy schemas](../../packages/protocol/cardPolicy.ts#L118) permit 50,000 portable exact overrides and 1,000 Session overrides. The global [Express JSON parser](../../apps/server/src/app.ts#L80) uses the installed body-parser default of 102,400 bytes; no import-specific parser precedes it.

A valid document with 1,500 actual catalog UUIDs and simple EXCLUDE directives is **135,082 bytes**, already larger than the HTTP limit. It fits within the current 1,940-Card catalog and the advertised schema, so valid exports can become impossible to reimport. A valid 1,000-entry Session policy is **90,056 bytes before its WebSocket command envelope**, exceeding the 65,536-byte transport maximum. Including such settings in Room snapshots also contributes to F09.

**Correction:** define supported object counts and encoded byte budgets together. Use bounded import endpoints, staged policy resources or another explicit transport design that can carry valid configurations. Validate limits before a user invests in an unsavable draft. Do not raise every public request limit indiscriminately.

**Done when:** every supported export round-trips through the actual HTTP adapter, and maximum supported Session settings can be saved and received by all clients. Include long Unicode names, predicates and mixed directives; return an actionable localized error for unsupported input.

### F12 — P2: Couch persistence accepts stale proposals; its cache does not resynchronize

**Evidence: stale write reproduced against the actual SQLite adapter; cache behavior source-confirmed.** [TypeOrmCouchSessionRepository.save](../../packages/persistence/TypeOrmCouchSessionRepository.ts#L84) rereads the existing row and uses that row's revision as the update condition, rather than the revision from which the caller derived its proposal. The port does not accept an explicit expected revision.

The probe created two proposals from revision 0: reveal a Card and end the Session. Saving both succeeded. The stored state ended at revision 1 with the first proposal's appearance row still present. The normal service queue protects one process, so this is primarily a multiple-instance/out-of-band-writer risk. [Couch service lookup](../../packages/application/couchSessionService.ts#L309) also returns a cached Session without checking the persisted revision, unlike Room's reload path.

**Correction:** make the expected base revision part of the repository contract and perform a real compare-and-swap. Define cache invalidation and deployment ownership explicitly. If multiple server writers are unsupported, state and enforce that limitation while retaining correct repository conflict detection.

**Done when:** independent repository/service instances cannot overwrite a committed proposal from the same base; runtime, appearances and revision remain consistent after rejection; stale cached reads recover safely.

### F13 — P2: Couch loses recovery information on transient failures

**Evidence: source-confirmed browser recovery defect.** On mount, [Couch.svelte](../../apps/web/src/Couch.svelte#L57) turns every failure of `couchApi.get(storedSessionId)` into `null`, then removes the stored Session ID. A temporary network/server error therefore destroys the browser's recovery pointer to a still-valid game.

The [command handler](../../apps/web/src/Couch.svelte#L105) displays a stale-revision notification without fetching authoritative state. If the server committed a command but its response was lost, the browser keeps the old revision and subsequent commands continue to conflict until a successful reload. Reload is itself vulnerable to the first defect. TAD §71 requires resynchronization after connection loss and stale state.

**Correction:** preserve the recovery pointer until a definitive not-found/expired result or explicit user action. Fetch the authoritative snapshot on ambiguous command failure or revision conflict; do not blindly repeat a possibly committed mutation.

**Done when:** browser tests simulate a response lost after commit, a temporary GET failure on reload, and eventual reconnection. The same game resumes at the authoritative revision without duplicate draws, lost history or accidental new-game creation.

### F14 — P2: Snapshot fan-out repeatedly performs catalog/history work

**Evidence: source-confirmed scaling risk; no production latency/load benchmark was performed.** [refreshRoom](../../apps/server/src/modules/websocket.ts#L199) gets a full snapshot to obtain participants, then requests another full snapshot for each peer. [RoomService.snapshot](../../packages/application/roomService.ts#L584) reloads runtime, reads the localized catalog and computes remaining eligible counts. [loadRuntime](../../packages/persistence/TypeOrmRealtimeRoomRepository.ts#L484) reads appearances and rehydrates immutable payloads even before the service's revision-cache comparison can help.

Selection/counting maps catalog candidates through policy, while [history eligibility](../../packages/game-core/history/history.ts) scans Session history per candidate. With P peers, C Cards and H appearances, this structure can repeat work resembling O(P × C × H) during one broadcast, including voting updates. Runtime copying and serialization add allocations. The [50,000-Card scale test](../../tests/simulation/card-policy-scale.spec.ts) checks compilation, compressed payloads and raw Map lookups; it does not measure an actual long-history draw or multi-peer broadcast.

**Correction:** measure the complete command-to-broadcast path, share safe common projection work, index history by Card, and cache immutable/revisioned data at explicit boundaries. Preserve per-viewer privacy rather than caching one unrestricted DTO for all roles.

**Done when:** representative 1,940- and 50,000-Card games meet explicit latency, memory and database-query budgets with long histories and supported peer counts. Include reconnect storms, voting fan-out and cold restart; retain deterministic results.

### F15 — P2: Public expensive work and anonymous Couch creation are insufficiently bounded

**Evidence: source-confirmed exposure; no denial-of-service load test was executed.** [HTTP limiters](../../apps/server/src/app.ts#L155) cover account routes, Room creation and Room joining. Anonymous Couch creation/commands and public pending-Session Card search/eligibility compilation are not covered by comparable request/work quotas. [optionalSessionOwner](../../apps/server/src/routes/api/cardPolicy.ts#L80) intentionally permits unowned public previews, which can compile a full catalog with supplied rules. Repeated Couch creation also interacts with F06's retained Session maps.

There **is** a per-socket message limiter as well as participant command limits; the defect is incomplete coverage and bounded-work policy, not the absence of all rate limiting. Authentication alone would also not bound expensive owned previews.

**Correction:** introduce proportionate limits for anonymous active games and CPU-heavy operations, with bounded queues/backpressure and observable rejection reasons. Account for many legitimate devices sharing one LAN address.

**Done when:** repetitive create/preview workloads stay within a declared resource budget, normal multi-device play remains usable, and overload returns predictable localized errors without exposing private input.

### F16 — P2: Expected policy errors lose their actionable localized meaning

**Evidence: source-confirmed.** The [policy conflict helper](../../packages/persistence/TypeOrmCardPolicyRepository.ts#L24) raises a plain English message with `POLICY_REVISION_CONFLICT`. [translateError](../../packages/localization/messages.ts#L53) recognizes message-key constants and otherwise substitutes the generic internal-error message. Several [policy routes](../../apps/server/src/routes/api/cardPolicy.ts) similarly construct expected errors with strings such as `GROUP_NOT_FOUND` and `CARD_POLICY_RULE_NOT_FOUND` rather than message keys.

This loses the useful distinction between “another tab changed this policy,” “the selected resource no longer exists,” and an internal failure. It also departs from the repository's user-facing-message rule. The protocol error code can still be correct; this finding concerns presentation and recovery guidance.

**Correction:** give expected errors stable codes plus exported localization keys and suitable recovery actions at the adapter/UI boundary. Keep persistence details out of player messages.

**Done when:** policy conflict, deleted rule and inaccessible/deleted Group scenarios produce the intended German and English messages and allow reload/reselection without losing an unrelated active game.

### F17 — P2: The visual gate currently fails and is absent from CI

**Evidence: executed visual-suite failure; workflow source-confirmed.** `npm run e2e:visual` finished with **13 passed, 1 failed**. At [visual-audit.spec.ts:1382](../../tests/e2e/visual-audit.spec.ts#L1382), a strict locator for the button named `Weiter` matches both Card-text next-page navigation and turn advancement when the production Card text paginates on a narrow phone.

This is a test-target ambiguity, not evidence that the screen has a geometry failure. It stops that scenario before its subsequent Conversation Meta and exhausted-Couch assertions. Files left from older runs cannot substitute for those assertions. Distinct accessible descriptions for page navigation and game advancement would also make the two actions clearer to assistive-technology users.

[CI](../../.github/workflows/ci.yml) runs build, Vitest coverage, test type checking, Kodi checks, packaging smoke tests and functional browser suites, but does not run `npm run format:check` or `npm run e2e:visual`. The release workflow calls that CI, so this visual failure is not a release gate. Most Vitest setup uses a small [catalog fixture](../../tests/support/env.ts), while built-server browser tests use the larger real catalog.

**Correction:** scope the advance locator to its intended control, clarify accessible action names where appropriate, and run the agreed visual/format gates in CI. Retain both deterministic small fixtures and representative production-catalog cases.

**Done when:** the complete visual scenario reaches waiting, Meta and exhaustion assertions; the relevant gate fails CI on regression; tests inspect entire privacy payloads and real transport sizes rather than only intended fields or rendered DOM.

### F18 — P2: Release jobs can build and tag different source revisions

**Evidence: workflow-confirmed risk; no release was published during this review.** The [release workflow](../../.github/workflows/release.yml) runs CI and then independently checks out `${{ github.ref }}` in validation, platform packaging and publication jobs. For a branch dispatch, that ref is mutable. A branch advancing between jobs can make the tested source, platform archives and eventual version commit/tag differ.

The final verification checks archive count and target names, not that every archive came from one source SHA. Coupled server/web packaging within an individual job is implemented, but the broader release can still lack a single reproducible source baseline. Concurrent release runs add another race.

**Correction:** select one immutable source/version baseline for CI and all builds, carry its identity in release manifests, verify all artifacts against it, and make tag creation refer to that same baseline. Serialize conflicting releases.

**Done when:** advancing the branch while a release runs cannot change the build inputs or tag target unexpectedly; all twelve server/web archives prove matching source and version; retry/concurrent runs cannot publish a mixed set.

### F19 — P2: Design documents and existing audits give conflicting completion criteria

**Evidence: document comparison.** Several discrepancies affect what corrective work should mean:

- GDD §89 requires a new rule and its current conditions to be previewed before save/enable. ADR-011 and TAD §105 describe an optional informational preview whose invalidation does not block saving; the implementation follows the latter. The VID also presents an optional preview workflow. This needs an explicit product decision, not an unexplained claim that either side is fully satisfied.
- GDD §14, VID §11 and the browser use global Card intensity for the shared atmosphere. The [WebSocket v2 contract](../contracts/websocket-v2.md) instead tells clients to use relative `currentCard.cardIntensity` to tune category/type-specific visual families without distinguishing that from the atmosphere. Clarify which presentation uses each value so native implementers do not infer a different background rule. This is ambiguous guidance, not a demonstrated browser rendering defect.
- The [older gap report](../IMPLEMENTATION_DESIGN_GAP_REPORT.md), [core release audit](core-release-audit.md) and repository overview contain obsolete four-Card/missing-catalog statements. Prior completion assessments also predate current GDD/VID versions. The real inventory is recorded above.
- Early TAD catalog/localization/application descriptions still mention ingest/publication concepts whose operational ownership moved to the external producer in §§22/34. Distinguish producer responsibilities from game-runtime import/reconciliation and optional future management capabilities.
- ADR-007 lists custom-profile CRUD as a visible release gate; the older gap report lists named reusable profiles as deliberately later work. Current per-scope Custom settings do not implement named reusable profiles. Resolve the scope discrepancy explicitly.

**Correction:** establish one current acceptance matrix with explicit required, optional, deferred and external scope. Resolve contradictions in the owning design/ADR and update its dependent contract, help and audit text. Preserve historical audit dates rather than presenting them as current release assurance.

**Done when:** a contributor can determine rule-preview behavior, intensity presentation, catalog inventory and first-release scope without choosing between contradictory documents. Claims of completion identify the assessed commit and actual checks.

### F20 — P2: Related Room lifecycle and Session changes commit separately

**Evidence: source-confirmed failure-injection risk.** [leaveParticipant](../../packages/application/roomService.ts#L660) first commits removal from the Session roster, then invokes a separate persistence transaction for participant lifecycle/Host changes. [closeRoom](../../packages/application/roomService.ts#L935) similarly ends runtime before closing the Room. Authentication/activation and adding the player to a running Session also cross commit boundaries.

Each individual transaction can be correct while a failure between them leaves presence, role, roster and current-voter state temporarily inconsistent. Per-Room serialization and “commit before broadcast” do not make two database commits atomic. Existing successful lifecycle tests do not establish recovery at every intermediate failure point.

**Correction:** make one application operation encompass the required Room and Session mutations in one transaction, or persist an explicit recoverable operation with deterministic reconciliation. Coordinate this with late-join enrollment and terminal privacy cleanup.

**Done when:** failures after each write boundary, followed by restart/retry, converge to one coherent role/roster/voter state without duplicate actions, unauthorized advancement or stranded participants. Verify SQLite and MariaDB.

### F21 — P2: Configuration aliases silently override canonical values

**Evidence: reproduced in settings resolution and during public E2E startup.** [settings.keyMap and resolveSettings](../../apps/server/src/modules/settings.ts#L413) process `HTTP_PORT` before `APP_PORT`, and `PUBLIC_URL` before `ROOT_URL`. Both pairs write the same internal fields, so a later alias silently wins even when the canonical environment variable was explicitly provided. E2E-prefixed values have the same issue.

A deterministic call with canonical port 3027/public URL on 3027 and aliases on 3001 resolved to port 3001 and the alias URL. The public browser harness waited for its explicitly selected 3027 health endpoint while the server listened on 3001. Correcting both aliases in the isolated test environment allowed the suite to pass. The same ordering exists outside E2E and can change an operator's bind/link configuration unexpectedly.

**Correction:** define canonical precedence explicitly or reject conflicting synonyms with an actionable configuration error. Retain aliases only where a current contract requires them, and document supported behavior. Do not rely on object iteration order as the policy.

**Done when:** canonical-only, alias-only, equal-value, conflicting-value and E2E override tests prove deterministic settings. Browser base URL, server listener and generated public links agree on the resolved configuration.

## Missing, partial and deliberately later capabilities

This inventory answers “what is missing?” without treating every future-facing design paragraph as a first-release defect.

| ID  | Capability                                         | Current implementation / gap                                                                                                                                                                   | Required disposition                                                                                                                                                                                                         |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M01 | Named reusable custom GameProfiles                 | Current Custom configuration is stored per DataSpace/no-Group or Group scope. There is no named profile collection, profile entity/repository/API, or create/rename/delete/select workflow.    | **Scope conflict:** ADR-007 calls this a release gate; the old gap report calls it later work. Implement owned, reusable profiles or explicitly amend that acceptance decision before claiming full completion.              |
| M02 | Time/Card-count Session targets                    | Play is open-ended; no target configuration and target-reached/continue flow.                                                                                                                  | Optional in GDD §60. Keep visible in the backlog; do not confuse it with the implemented progression counters.                                                                                                               |
| M03 | Pause and live content-setting changes             | Active settings are substantially read-only for game rules; boundary changes are intentionally rejected after start. No general pause/resume state or transactional live reconfiguration.      | GDD §65 says the modal “may contain” these features. Defer explicitly unless required by a chosen release; preserve ADR-007's freeze until a replacement transition is designed. F04 still needs safe first-time enrollment. |
| M04 | Native account authorization                       | Kodi has capability-aware device-flow code; the server advertises `nativeDeviceAuthorization: false` and no authorization descriptor/endpoints.                                                | Deliberately unavailable under the HTTP contract. Public account-owned native play is not implemented end to end. Do not advertise the client-side flow as working against this server.                                      |
| M05 | Android-family native applications                 | No Android TV, Google TV or Fire TV app.                                                                                                                                                       | Explicit future architecture target in current-state/release documentation. The three supported browser topologies are not substitutes for these native deliverables.                                                        |
| M06 | General account/DataSpace import                   | Account export and targeted Card-policy import/export exist; no general restore/import flow for Groups, history, preferences and future user-created resources.                                | A policy import is not a full data import. Specify supported format, ownership, collision and size semantics if TAD §68 is brought into release scope.                                                                       |
| M07 | Card authoring, translation review and publication | Game runtime validates/reconciles an immutable producer catalog; it does not provide the producer's editorial workspace, stale-translation review or UUID lineage registry.                    | External responsibility under GDD §§32–35/74–75 and TAD §§22/34. Obtain release provenance from the producer; do not rebuild that system inside gameplay adapters.                                                           |
| M08 | Custom Card authoring and statistics               | No player-facing custom-Card authoring or general statistics/history analytics workspace. Existing appearances support repeat prevention and export.                                           | Later/optional product work. Retain privacy-minimal history; analytics must not accidentally persist individual answer values.                                                                                               |
| M09 | Complete English Card content                      | English UI/taxonomy support exists, but only 10 Cards have English renderings.                                                                                                                 | Additional complete language content is optional for the first release. For a meaningful English game release, commission/review translations and validate mode-specific eligible pools.                                     |
| M10 | Later localization features                        | No general per-client Card translation during one Session or crowd translation workflow.                                                                                                       | Explicit later scope in GDD §84; one authoritative Card locale per Session is the present contract.                                                                                                                          |
| M11 | Full deployment/device evidence                    | Packaging/discovery/backup/native implementations exist, but a real mail/provider/proxy deployment, restore exercise, complete OS artifact matrix and physical Kodi QA were not run here.      | External validation work, not evidence that the implementation is absent. Record results against the final corrected candidate and actual supported environments.                                                            |
| M12 | Editorial and adult-content release assurance      | Structural catalog validation and one preset confirmation prompt exist. There is no evidence in this review of completed final editorial/profile-to-catalog or public content-policy approval. | A product/release responsibility already named by ADR-007 and existing audits. Keep separate from the concrete technical bypass F02. This review makes no determination about legal compliance.                              |

For M01, an implementation should distinguish a reusable profile definition from a copied Session configuration, preserve user-entered names, enforce DataSpace ownership, and define deletion behavior for existing snapshots. For M06, import must never restore authority merely because an export contains an owner/role identifier. These need deliberate contracts and integration tests when scheduled.

## UX and accessibility assessment

The implementation visibly follows Golden Mischief: warm cream/yellow surfaces, brown readable copy, strong Card hierarchy, themed buttons, motifs, rounded panels and consistent settings surfaces. The review inspected generated home desktop/320-pixel-phone captures and active phone/passive-display captures. Completed browser scenarios exercise desktop, narrow phone, short landscape and TV layouts; public account scenarios also audit desktop and 320 × 568 layouts.

The existing test coverage has useful breadth: long names and URLs, paged passive rosters and Card text, 1,000-entry management lists, 10,000-character text fixtures, forced-colors focus, text zoom, reconnection states and destructive account/Group actions. Completed visual assertions did not report geometry/target-size failures. Active-game Help/Account service destinations have separate-navigation handling and corresponding browser coverage.

Remaining UX work is primarily behavioral:

- **Refusal:** F03 can leave rejected content on the display. An attractive exhausted-pool panel does not repair the underlying uncommitted refusal.
- **Consent:** F02 and F04 must be reflected in reachable, private setup/enrollment flows, including narrow phones and keyboard focus.
- **Recovery:** F13 needs reconnection without deleting the current-game pointer or trapping commands at a stale revision.
- **Error clarity:** F16 needs specific localized guidance. F11 should be caught before users attempt to save/import an unsupported configuration.
- **Action distinction:** F17 exposes ambiguous accessible names for page advancement and turn advancement. Complete the blocked visual scenario after correcting the locator/control semantics.
- **Content expectations:** language selection should continue to show meaningful eligible counts; ten English translations do not establish parity with German gameplay.

No new player-facing flow was changed in this review. Future fixes must repeat desktop and narrow-phone audits for their affected flows, including hierarchy, spacing, contrast, focus, 44-pixel targets, overflow, refusal/destructive recovery and navigation continuity. Automated geometry and four inspected captures do not establish comprehensive screen-reader, switch-control, touch-hardware or real-TV usability certification.

## Architectural and operational risks beyond individual fixes

The main architectural decisions are worth preserving: a framework-independent engine, explicit application ports, stable UUID identity, localized renderings, a single authoritative Session, sparse policy storage and separate native release units. The defects above are mostly incomplete guarantees between these pieces rather than evidence that the core architecture should be replaced.

Corrective work should address these recurring patterns:

| Pattern                                                    | Why it matters                                                                                                                                                                   | Direction                                                                                                                                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multiple representations of one decision                   | Privacy-safe voting data coexists with unrestricted totals; policy provenance coexists with live catalog reads.                                                                  | Give each guarantee one owning decision and test every outward/use path against it.                                                                                                     |
| Transport limits considered separately from schema limits  | A valid domain/protocol object can be unsendable or rejected by another client.                                                                                                  | Treat bytes, cardinality, encoding and client receive behavior as one external contract.                                                                                                |
| In-process coordination treated as persistence correctness | Queues do not supply database compare-and-swap or atomicity across separate transactions.                                                                                        | Put expected revisions and complete commit boundaries in repository contracts.                                                                                                          |
| Terminal data has no explicit owner/lifetime               | Ended games, private boundaries and shared blobs can survive indefinitely.                                                                                                       | Define lifecycle-specific retention and reference-safe cleanup, preserving only justified history.                                                                                      |
| Scale tests stop at an inner algorithm                     | Fast Map lookups and bounded DOM do not bound database hydration, history scans or broadcast work.                                                                               | Measure realistic complete operations and sustained resource use.                                                                                                                       |
| Large orchestration modules accumulate responsibilities    | Room, web and Kodi orchestration must coordinate roles, settings, recovery and presentation; direct database operations in some routes make use-case guarantees harder to reuse. | Extract small named decisions/ports while fixing concrete behavior. Avoid rewriting solely because a file is large, and respect ADR-013's intentional account infrastructure placement. |
| Documentation completion claims have no durable baseline   | Old “verified” and “blocked” statements can outlive both code and design changes.                                                                                                | Record commit, design versions, catalog digest, exact checks and unresolved exceptions for each release assessment.                                                                     |

## Executed validation and its limits

Commands below were actually executed. Counts are per command; the focused Vitest run overlaps `npm test` and must not be added as independent coverage. Scratch probes assert that a suspected defect occurs, so a successful probe means the defect was reproduced, not that product behavior is correct.

| Exact command                                                                                                                                                               | Result                                                                             | What it establishes / does not establish                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run tests/unit/game-session.spec.ts tests/unit/couch-session-service.spec.ts tests/unit/room-service.spec.ts tests/unit/card-policy.spec.ts --reporter=verbose` | Passed: 4 files, 50 tests; 120.42 s                                                | Focused existing engine/service/policy coverage; not the new acceptance tests proposed above.                                                                                                                                                                  |
| `npm test`                                                                                                                                                                  | Passed: 63 files, 374 tests; 1 file/test skipped; 781.15 s                         | Includes successful public-mode MariaDB integration. The optional catalog-MariaDB advisory-lock test was skipped because `CARD_CATALOG_MARIADB_TEST` was not enabled.                                                                                          |
| `npm run build`                                                                                                                                                             | Passed                                                                             | Catalog validation, generated definitions, server compilation, Svelte/Vite build and bundled copies. Svelte reported 0 errors and 0 warnings.                                                                                                                  |
| `npm run typecheck:test`                                                                                                                                                    | Passed                                                                             | TypeScript test type checking.                                                                                                                                                                                                                                 |
| `npm run e2e:couch -- --reporter=line`                                                                                                                                      | Passed: 45 tests; 4.0 min                                                          | Existing Couch, Personal and Party Screen browser gameplay/management scenarios. The script name is narrower than its coverage.                                                                                                                                |
| `npm run e2e:visual`                                                                                                                                                        | **Failed: 13 passed, 1 failed; 6.4 min**                                           | Strict `Weiter` locator ambiguity at `visual-audit.spec.ts:1382`; subsequent assertions in that scenario did not run.                                                                                                                                          |
| `npm run e2e -- --reporter=line`                                                                                                                                            | Final run passed: 3 tests; 2.9 min                                                 | Public/account browser flows against a disposable MariaDB database, including responsive account management. Setup attempts and recovery are recorded below.                                                                                                   |
| `npm run kodi:check`                                                                                                                                                        | Passed: generated/static checks and 276 Python tests; Python test portion 80.846 s | Shared-definition parity and native client test suite, not physical Kodi installation/remote QA or packaging execution.                                                                                                                                        |
| `node .tmp/implementation-review/probes.cjs`                                                                                                                                | 12 observations reproduced                                                         | Live vote totals in both services, failed final-Card skip, adult gate bypass, unknown Card entering a frozen snapshot, retained ended boundaries, oversized native snapshot/policy documents, stale Couch save, concurrent policy update and alias precedence. |
| `python -B .tmp/implementation-review/decode-large-envelope.py`                                                                                                             | Reproduced rejection of the 70,176-byte valid snapshot                             | Runs the actual Kodi decoder on the schema-validated synthetic Room envelope.                                                                                                                                                                                  |
| `npm run format:check`                                                                                                                                                      | Passed                                                                             | Repository-wide Prettier validation and Kodi static checks.                                                                                                                                                                                                    |
| `git diff --check`                                                                                                                                                          | Passed                                                                             | No whitespace errors in the tracked diff. The new document is also included in the repository-wide format check.                                                                                                                                               |

Public E2E setup required three attempts. The first stopped at a missing disposable schema after the integration suite had dropped it; the local E2E profile reused that test database. The review recreated only that explicitly guarded test schema. The second migrated and seeded successfully but timed out because the alias precedence defect in F21 sent the server to a different port/origin than Playwright. The third supplied consistent canonical/alias values in a temporary process environment and passed all three tests. No tracked configuration was altered. CI creates separate test/E2E databases, so the missing-schema condition is not claimed as a production defect.

The public run used a reserved example mail host and did not validate delivery. Some provider/authentication presentation cases use mocked responses. It does not certify a real OIDC provider, real email delivery, TLS termination or reverse-proxy deployment. The full optional catalog-MariaDB lock test is enabled by CI, but was not executed in this local run; successful public-mode MariaDB integration should not be conflated with that skipped test.

Raw command logs, synthetic fixtures and the visual failure trace were retained locally under ignored `.tmp/implementation-review/`. Browser captures use the existing ignored `.tmp/visual-audit/` location. These are review scratch artifacts, not production data or a committed regression suite. Existing captures from earlier runs were not used to claim that the failed scenario's unexecuted tail passed.

Not executed here: publishing a release, the six-platform server/web packaging matrix, native ZIP installation on Kodi, physical LAN discovery/network-fault QA, backup restoration, a sustained public load test, live SMTP/OIDC/TLS validation, or dependency-vulnerability scanning. None is reported as passing.

## Corrective work plan

The work packages below are proposed sequencing and ownership boundaries, not calendar estimates or assigned personnel. Each can become a reviewable issue/PR using its finding's acceptance criteria.

| Order | Work package                                        | Findings / missing scope               | Suggested owning area                                                    | Exit condition                                                                                                                                              |
| ----- | --------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Close privacy and identity exposure                 | F01, F05, F10                          | Application projections, persistence, account/OIDC adapter               | Full-payload privacy regressions pass; terminal sensitive data is removed; verified-email provenance cannot cross addresses.                                |
| 2     | Make consent and refusal unconditional              | F02, F03, F04                          | Shared engine, application services, web/native flows                    | Effective adult gating, late enrollment and final-Card refusal work across all viewers/topologies.                                                          |
| 3     | Enforce authoritative snapshot and commit semantics | F07, F08, F12, F20                     | Application ports and persistence                                        | Live catalog lifetime/full-pool draw tests, same-base writer conflicts and lifecycle failure-injection/restart tests pass in both database modes.           |
| 4     | Align wire contracts and native capacity            | F09, F11                               | Protocol, HTTP/WebSocket adapters, Kodi decoder/transport, management UI | Supported maximum documents traverse real adapters; version/compatibility changes are explicit.                                                             |
| 5     | Restore recovery and understandable errors          | F13, F16; affected UX from 1–4         | Browser client and localized errors                                      | Lost-response/transient-reload recovery and specific error flows pass at desktop and narrow-phone widths.                                                   |
| 6     | Bound operational growth and expensive work         | F06, F14, F15                          | Services, repositories, runtime operations                               | Retention/heap/query/latency budgets hold under sustained representative use and supported participant counts.                                              |
| 7     | Repair release and documentation gates              | F17, F18, F19, F21; M01 scope decision | CI/release, configuration, design ownership                              | All required gates run; release SHA is fixed; canonical settings precedence and current scope are documented.                                               |
| 8     | Finish chosen product scope and external assurance  | M01–M12 as explicitly selected         | Product/content owners, platform and operations work                     | Required missing features have contracts and tests; optional items are clearly deferred; candidate-specific deployment/content/device evidence is recorded. |

Start the F19/M01 scope decision and F17 gate repair alongside the first fixes so they guide subsequent work. Coordinate F04/F05/F20 around one roster/lifecycle transaction design. Resolve F07's catalog lifetime and sparse policy ownership before optimizing draw work under F14. Design F09 and F11 together because Session policy is part of Room wire state. Combine F06 retention with F15 creation quotas rather than assuming either alone bounds resource use.

Every external-contract correction should update its schema/type, adapter, matching `docs/contracts/` file and integration/contract tests, and state compatibility impact. Breaking WebSocket changes require a new protocol version. Persistence changes need matching entities/migrations and regenerated indexes. User-visible flows need the required desktop/phone UX audit.

The implementation should be described as complete for a chosen release only after its applicable P1 findings are closed, the M01 scope conflict is resolved, the full required checks pass including the currently failing visual scenario, and remaining P2/deferred/external items are explicitly accepted and traceable. A passing aggregate test count alone does not satisfy that acceptance standard.
