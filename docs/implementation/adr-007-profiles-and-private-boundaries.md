# ADR-007: Data-driven GameProfiles and private Room boundaries

## Status

Accepted for Phase 7.

## Decision

- Built-in GameProfiles use stable identifiers and independent QuestionCategory,
  DareType, operational-flag, intensity, ratio, streak, and meta-card settings.
- Built-in selections are immutable, reviewed application data and carry the
  production `PUBLISHED` editorial status.
- The explicit `PROFILE_COUPLES_SPICY` profile requires a deliberate adult-content
  confirmation at both the browser and application-service boundaries.
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

## Consequences

- Disabled DareTypes cannot be restored by intensity escalation because taxonomy
  and intensity remain independent eligibility stages.
- `Unbeteiligte Dritte` can be disabled independently as a DareType and through
  its operational flag.
- Changing boundaries after Session start is intentionally rejected for this MVP
  slice, avoiding a non-atomic active-pool change. A future settings transition
  may add transactional mid-Session changes with an explicit revision.
- Final catalog review, public adult-content policy/legal review, and custom
  profile CRUD remain visible release gates rather than hidden assumptions.
