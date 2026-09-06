# Migration folder

In this folder, the typescript migrations should go.

`1787351000000-AddScopedCardManagement.ts` adds catalog-v2 producer fields, portable
owner-scoped Card-policy tables, and migrates persisted GameSession runtime JSON from
version 3 to version 4. The migration writes an explicit empty compiled policy for
already-active Sessions; all newly started Sessions compile against catalog v2.

`1787352000000-AddMaximumSocialSensitivity.ts` adds the persisted DataSpace quick-game
maximum social-sensitivity default. Existing rows receive `EXPLICIT`, matching the
behavior before the independent sensitivity gate existed.

`1787353000000-NormalizeProfileIdentifiers.ts` converts persisted settings and active
session JSON from the four superseded profile IDs to the consolidated six-profile
taxonomy. Multiple old profiles intentionally converge, so this data normalization is
not reversed by `down`.

`1787354000000-ExpandSessionRuntimeStorage.ts` widens MariaDB/MySQL Room settings and
Session runtime snapshots to `LONGTEXT`. It also clears references to syntactically
corrupt Session snapshots and removes those unrecoverable rows so Rooms can start again.

`1787355000000-RebaseGroupHistoryOnCatalog.ts` starts a fresh Card-history epoch for
Groups older than the currently installed catalog. Future catalog applications perform
the same rebase transactionally while retaining the earlier appearance records.

`1787356000000-CompactSessionCardPolicy.ts` migrates active Session runtime from version
4 to version 5. It preserves every effective Card selection value in compact tuples and
removes repeated per-Card JSON keys/provenance.

`1787357000000-ExternalizeSessionImmutableState.ts` moves compiled policy and frozen
Group-history inputs out of active Session rows into content-addressed, Brotli-compressed
payloads with bounded chunks. Group history is converted from UUIDs to an exact bitset
indexed by the frozen compiled Card order. The migration also removes duplicated Session
history when complete normalized appearance rows exist. Runtime loads rehydrate all
three inputs, while every insert and hot-row update remains independent of catalog and
accumulated Group-history size.

`1787359000000-ScrubExpiredPrivateBoundaries.ts` removes private boundaries from ended
or detached Session snapshots and terminal participant/Room records while retaining
active recovery and continuing lobby values. It changes data only, keeps runtime v5,
and preserves non-sensitive history. Its `down` cannot reconstruct erased private data.
Pre-migration backups remain subject to the operator retention policy documented in
`docs/contracts/infrastructure.md`.

`1787360000000-AddCardPolicyScopeRevisions.ts` adds an aggregate clock to each policy
scope, backfilling existing revisions and missing empty anchors without resetting rows.

`1787361000000-FreezeSessionCatalogs.ts` adds shared immutable catalog references and
moves runtime to v6. Pre-v6 games end because their original localized catalog was not
stored. Historical appearances/policy/history remain; active Cards, votes and private
boundaries are cleared. The migration processes 25 hot rows at a time. Its `down` rejects
downgrades; restore a matching backup/server version instead.

`1787362000000-UseLiveSessionCatalog.ts` supersedes the v6 catalog-freezing design.
It ends old runtimes, removes all three obsolete catalog/policy/history payload references,
adds the sparse `policy_input_digest`, deletes unreferenced old payloads in batches, and
adds indexed last-seen/Group-history lookups. Producer Card weights use `DOUBLE`.
The migration is resumable after implicit-commit DDL and preserves saved appearances.
Runtime v7 never restores a catalog snapshot or full appearance archive. The earlier
migration files remain historical upgrade steps, not current runtime behavior.
