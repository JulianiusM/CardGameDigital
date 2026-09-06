# ADR-007: Data-driven GameProfiles and private Room boundaries

## Status

Accepted for Phase 7.

## Decision

- Built-in GameProfiles use stable identifiers and independent QuestionCategory,
  DareType, operational-flag, intensity, ratio, streak, and meta-card settings.
- Built-in selections are immutable, reviewed application data and carry the
  production `PUBLISHED` editorial status.
- Built-in operational defaults are conservative and stored with each profile.
  All presets block third-party, alcohol, and recreational-drug requirements.
  Child-friendly enables non-sexual categories and silly, ordinary-contact, and generic
  dares with a Deep personal ceiling and maximum intensity 3; every copied setting
  remains editable before play.
  Acquaintances & Colleagues also blocks contact, private-space, clothing-removal, and
  nudity requirements; Good Friends permits ordinary consensual contact; Close Friends
  combines trusted-group breadth with an intimate range. `PROFILE_CUSTOM` begins with
  every operational rule blocked.
- Adult confirmation follows effective content, independent of the editable preset
  identifier. Both start services and the public eligibility preview evaluate the full
  configured intensity ceiling and compiled policy. Potentially eligible Cards classified
  EXPLICIT by the catalog or effective policy, and the explicit BORDERLINE_SEX/SEX
  DareTypes, require confirmation. Lowering sensitivity through policy cannot erase a
  catalog adult classification. History, private boundaries, and current player count
  do not substitute for consent, since they can change during play. Mode, taxonomy,
  operational restrictions, intensity, and policy exclusions still narrow this decision.
- Each authenticated Room participant submits boundaries privately over the
  WebSocket protocol before Session start. Question categories, DareTypes, and
  operational flags remain three separate arrays.
- Participant boundaries are persisted in a dedicated table keyed by participant.
  A Session loads them into the shared game engine at start. The engine applies
  the active player's question restrictions for turn-based questions and the
  group-wide intersection for dares, Never-Have-I-Ever, and conversation content.
- Public snapshots reveal only whether the requesting participant has configured
  boundaries. They never include boundary values or identify another participant
  as the source of an exclusion.
- Boundary persistence is limited to active recovery and the unexpired continuing
  Room lobby. Ended Session runtimes discard their copy; participant leave/expiry
  removes their row and every represented-player copy. Room closure and owned-data
  deletion remove the remaining values. The data-only
  `1787359000000-ScrubExpiredPrivateBoundaries` migration applies this lifetime to
  existing records; backup retention remains an explicit operator responsibility in
  the infrastructure contract.

## Consequences

- Disabled DareTypes cannot be restored by intensity escalation because taxonomy
  and intensity remain independent eligibility stages.
- `Unbeteiligte Dritte` can be disabled independently as a DareType and through
  its operational flag.
- Existing Session players cannot change their frozen boundaries. A first-time late
  joiner remains a Room participant outside the Session roster until they submit private
  choices, including an explicit empty selection. The application serializes enrollment
  with draws and the repository commits the boundary row, all represented players and
  their runtime boundaries together under the Room lock and Session revision. Reconnect
  does not duplicate enrollment. The current voting roster remains frozen; accepted
  choices affect subsequent Cards. No extra public boundary-status field is exposed.
- Final catalog review, public adult-content policy/legal review, and custom
  profile CRUD remain visible release gates rather than hidden assumptions.
