# ADR-003: One deterministic Session engine

## Status

Accepted and verified for Phase 3.

## Decision

All game modes use the same framework-independent `GameSession` aggregate. The
aggregate owns state, revision, current player, rounds, shown-card history,
ephemeral votes, current card, and mode pacing. Express, TypeORM, WebSockets,
Svelte, account code, and email code are not imported by `game-core`.

The four modes vary selection and transitions inside this shared lifecycle:

- Classic waits for the active player's question/dare choice before selection.
- Random selects a type by target-ratio correction and caps identical streaks.
- Ich hab noch nie selects only yes/no-capable questions, freezes the current Card's
  voter set, and collects votes. Its Session-owned reveal policy defaults to anonymous
  aggregate and may authorize named answers only after every required vote exists.
- Let's Talk selects ordinary questions and schedules `CONVERSATION` meta cards
  separately; exhausted meta cards fall back to normal questions.

Every accepted command checks the caller's expected revision. Invalid states
and stale revisions use stable error codes. A shown card is committed to
history at reveal time, so skip cannot make it unseen.

The Never-Have-I-Ever voter IDs and ephemeral votes are part of the versioned active
runtime snapshot for reconnect/restart recovery. Late Session players are eligible from
the next Card, temporarily disconnected voters remain pending, and advancing clears both
the fixed voter set and its answers.

## Eligibility and repetition

Eligibility is a composable pure pipeline. Question Category, DareType, player
boundaries, operational flags, intensity, active state, Session history, Group
history, repeat rules, and weight remain separate stages. Dare Affinity is not
a hard eligibility switch. No filter is relaxed when the pool is empty.

Intensity eligibility uses independent numeric base offsets owned by `game-core`, not
catalog or persistence metadata. Fractional hard-coded values fine-tune the amount of
overlap for each actual Question Category and DareType relationship. The Card's relative
1–5 value produces an internal score; public intensity is
`min(5, ceil(score / 4))`.

Settings provide starting intensity, ending `maximumIntensity`, progression unit
(`ROUNDS` or `CARDS`), positive interval, and a half-point increment from 0.5 through 4.
The Session raises its internal score ceiling by that increment after each interval and
caps it at the configured end. The built-in default is one point every two displayed
Cards, avoiding a four-point band jump. Never Have I Ever advances a round after each
completed all-player Card; Card pacing uses displayed appearance count. Exhaustion never
advances progression early.

Persisted GameSession runtime is version 2 because progression policy is frozen into the
Session profile. Runtime version 1 is rejected rather than inferred with hidden defaults.

`AlwaysEligible` ignores Group history only. `RepeatableInSession` is required
for same-Session repetition. Cooldown counts other displayed cards since the
last appearance, matching the GDD's recommended semantics.

## Randomness

The domain depends on `RandomSource`. The application adapter uses
`node:crypto.randomInt`; tests use `SequenceRandomSource`. Domain selection
never calls `Math.random()`.

## Consequences

- Couch, Personal, and Party Screen modes can call the same engine later.
- Persistence and transport adapters serialize authoritative results but do not
  reproduce gameplay rules.
- Built-in GameProfile category selections stay data-driven and are deferred to
  editorial validation rather than being guessed in code.
