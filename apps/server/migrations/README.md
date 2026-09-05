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
