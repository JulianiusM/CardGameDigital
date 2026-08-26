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
- Let's Talk selects ordinary questions and schedules `CONVERSATION_META` Cards
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

Persisted GameSession runtime is version 5. Version 2 introduced progression policy
inside the frozen Session profile; version 3 records `completed`, `skipped`, and
`vetoed` as separate authoritative CardAppearance outcomes; version 4 adds the immutable
compiled Card-policy snapshot and pending Session policy. Version 5 compacts that
snapshot into per-Card positional values. Persistence then removes the compact compiled
policy and frozen Group history from the hot runtime row, stores each independently by
content digest in compressed bounded chunks, and rehydrates both before restoring the
aggregate. Group history uses an exact bitset against the frozen compiled Card order, so
its storage is one bit per current Card rather than one UUID per seen Card. Played-Card
history is rehydrated from its normalized appearance rows instead of being duplicated in runtime JSON. Accompanying database migrations upgrade stored
active runtimes instead of inferring old versions during normal gameplay. Because
version 2 encoded both skip and veto as `skipped`, migrated historical vetoes remain
classified as skips; version 3 and later record all new outcomes exactly.

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
