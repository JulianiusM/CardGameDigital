# Implementation Documentation vs Canonical Design — Gap Report

**Comparison target:** updated GDD v1.3, TAD v1.2, Visual & Interaction Design v1.1  
**Evidence reviewed:** attached `docs/implementation`, `docs/contracts`,
`docs/ARCHITECTURE.md`, `docs/README.md`, and user-guide documentation.

This report describes what the supplied implementation documentation says. It does not
claim to have inspected the source code itself.

## 1. New Never Have I Ever requirements

### 1.1 Named-answer reveal is not implemented/documented

**Design:** `Ich hab noch nie` has two pre-Session reveal settings:

- `ANONYMOUS_AGGREGATE`
- `NAMED_ANSWERS`

**Current implementation documentation:**

- `implementation/adr-004-couch-mode-svelte.md` describes only aggregate voting.
- `implementation/adr-006-browser-multiplayer-roles.md` states that individual
  Never-Have-I-Ever vote values are never broadcast.
- `implementation/migration-progress.md` says Couch exposes aggregate voting and keeps
  individual values inside the Session aggregate.
- `contracts/http-api.md` contains no reveal-mode field.
- `contracts/websocket-v2.md` contains no reveal-mode setting and no named-result shape.
- the original user guides documented aggregate results only.

**Required change:** add the reveal setting to canonical configuration and expose named
answers only after the result transition when configured.

**Priority:** blocking for the requested feature.

---

### 1.2 Per-player voting completion exists partially but is not a complete public contract

**Design:** while voting is open, every presentation shows every current voter's
`PENDING` / `VOTED` status.

**Current implementation documentation:**

- `implementation/adr-004-couch-mode-svelte.md` explicitly says Couch snapshots expose
  voter completion.
- `implementation/adr-006-browser-multiplayer-roles.md` documents private vote values
  but does not define a required all-player completion roster.
- `contracts/websocket-v2.md` does not document the voter-progress projection shape.
- the original user guides did not tell players that the shared/public UI shows who has
  already voted.

**Assessment:** partly implemented/documented for Couch, but not specified strongly
enough as a cross-topology contract.

**Required change:** standardize one projection shape for Couch HTTP and Room WebSocket
snapshots and make it visible on host/mobile/display presentations.

**Priority:** blocking for the requested feature.

---

### 1.3 Reveal-mode immutability is not represented

**Design:** reveal behavior is chosen before Session start and cannot change during the
active Session.

**Current implementation documentation:** no such setting currently exists.

**Required change:** treat it like pre-Session Room/Couch configuration and reject any
attempt to mutate it after Session start.

**Priority:** blocking for the requested feature.

---

## 2. Existing release/implementation gaps unrelated to the new feature

### 2.1 Canonical production Card catalog is still missing

The GDD requires the real German Card collection as canonical product content.

`implementation/core-release-audit.md` explicitly marks the production catalog as a
blocker because the approximately 2,000-card source/catalog has not been supplied to the
repository.

The catalog contract and reconciliation machinery are documented as implemented, but the
actual production content is not.

**Classification:** known content/release blocker.

---

### 2.2 MariaDB public deployment is implemented but not externally verified

The TAD requires MariaDB/MySQL for public deployment.

`implementation/migration-progress.md` and `core-release-audit.md` state that MariaDB
migration/repository behavior still requires execution against a MariaDB service.

**Classification:** implementation exists; verification gap.

---

### 2.3 SMTP, real OIDC provider, HTTPS proxy, and public browser flows remain unverified

The public architecture requires these integrations.

The implementation documents explicitly list them as staging/CI verification gates.

**Classification:** implementation exists; external integration verification gap.

---

### 2.4 Cross-platform portable release artifacts are not yet verified

The TAD requires redistributable portable packages on supported OS/architectures.

`adr-010-presentation-and-release-artifacts.md` and `core-release-audit.md` state that
packaging scripts exist, but each target must still be built and verified on its own
platform/architecture.

**Classification:** packaging implemented; release verification gap.

---

### 2.5 Browser Playwright verification/screenshots remain environment-gated

Several migration phases remain `IMPLEMENTED` rather than `VERIFIED` because a browser
binary was unavailable in the repository environment.

**Classification:** automated workflow exists; execution/verification gap.

---

### 2.6 Native Kodi and Android/Fire TV clients are part of the architecture but are not

represented as implemented

The GDD/TAD identify Kodi and Android-family TV clients as target native clients.

The supplied implementation progress describes Svelte browser roles for Couch, Personal,
Party Screen, Host, Display, and Mobile, but does not identify a completed native Kodi
or Kotlin/Compose TV client.

The web shared-display implementation satisfies the play-topology requirement, but not
the complete native-client platform target.

**Classification:** planned architectural extension / implementation gap.

---

## 3. Documentation inconsistencies and drift

### 3.1 `docs/ARCHITECTURE.md` still labels the WebSocket runtime link as protocol 1

The same document later says the external contract is WebSocket protocol v2, and
`contracts/README.md` declares v1 retired.

**Required documentation correction:** change the runtime diagram to protocol 2.

---

### 3.2 `adr-004-couch-mode-svelte.md` contains historical Pug migration language

ADR-004 says existing Pug account and administrative pages continue to operate.

`implementation/current-state.md` says the old Pug views/page controllers/template
renderer have been removed and the Svelte application is now the sole presentation.

The ADR may remain historically accurate as an old decision record, but readers need a
clear superseded note or updated consequence section so it is not mistaken for current
architecture.

**Classification:** historical documentation drift.

---

### 3.3 Built-in GameProfile editorial status is contradictory inside implementation docs

`implementation/adr-007-profiles-and-private-boundaries.md` states that built-in
selections are immutable, reviewed application data with production `PUBLISHED` status.

`implementation/migration-progress.md` states that built-in selections are editorial
drafts pending production-catalog review.

The GDD says exact built-in defaults require editorial validation.

**Required clarification:** choose one current truth. Until final editorial review is
complete, implementation documentation should describe those defaults as drafts rather
than production-approved values.

**Classification:** documentation contradiction with potential product-content impact.

---

### 3.4 `docs/README.md` still points readers at WebSocket protocol v1

The documentation index lists the v1 contract even though `contracts/README.md` marks
v2 current and v1 retired.

**Required documentation correction:** make v2 the primary link and optionally retain
v1 only as historical documentation.

---

## 4. Canonical design consistency fixed in the updated design set

The supplied GDD previously described source/Access reconciliation and translation
review as though those responsibilities lived directly in the game application, while
the current TAD and implementation establish a third-party/external catalog producer
that publishes one normalized FULL `game-card-catalog/v1` artifact.

The updated GDD now distinguishes:

- **producer/editorial pipeline:** Access/source mapping, stable UUID assignment,
  translation review, release assembly;
- **game runtime:** validate and reconcile the approved FULL snapshot.

This removes that cross-document ambiguity.

The TAD's older runtime-test wording around source edits/stale translations was also
normalized to the current producer-boundary architecture.

---

## 5. Items that are aligned and should be preserved

The implementation documentation is already aligned with the canonical design on:

- one shared framework-independent `GameSession` engine for all four modes;
- separate QuestionCategory, DareType, and Dare Affinity semantics;
- server-authoritative selection and state;
- revision checks;
- per-Room command serialization;
- commit-before-broadcast;
- Session and Group history;
- `AlwaysEligible` / `RepeatableInSession` separation;
- deterministic randomness abstraction;
- anonymous Room participation;
- DataSpace/account separation;
- private boundary handling;
- late-join/reconnect topology;
- locally bundled web assets and offline LAN play;
- SQLite local / MariaDB public database split;
- Svelte presentation with no client-side authoritative card engine.

These should be extended rather than replaced when implementing the Never Have I Ever
changes.

## 6. Recommended order of remediation

1. Implement `neverHaveIEverRevealMode` in game-core/configuration.
2. Standardize the voting progress/result projection.
3. Update Couch and Room transports.
4. Update Svelte setup/voting/result UI.
5. Extend protocol/API contracts and tests.
6. Update ADR-003, ADR-004, ADR-006 and migration/current-state documentation.
7. Correct protocol-v1 documentation drift.
8. Resolve the GameProfile editorial-status contradiction.
9. Run browser/MariaDB/public integration verification when environments are available.
10. Continue native Kodi/Android-family client implementation as a separate platform
    milestone.
