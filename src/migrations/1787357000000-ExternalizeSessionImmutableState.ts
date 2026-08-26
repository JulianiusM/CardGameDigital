import { createHash } from "node:crypto";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import {
    MigrationInterface,
    QueryRunner,
    Table,
    TableColumn,
    TableForeignKey,
    TableIndex,
} from "typeorm";

const RUNTIME_TABLES = ["game_sessions", "couch_game_sessions"] as const;
const CHUNK_BYTES = 24 * 1024;

type PayloadKind = "COMPILED_CARD_POLICY" | "GROUP_HISTORY";
type PersistedRuntime = {
    compiledCardPolicy?: unknown | null;
    groupHistoryCardIds?: unknown;
    sessionHistory?: unknown;
    [key: string]: unknown;
};

function encode(payloadKind: PayloadKind, payload: unknown) {
    const uncompressed = Buffer.from(JSON.stringify(payload), "utf8");
    const compressed = brotliCompressSync(uncompressed, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 },
    });
    const chunks: string[] = [];
    for (let offset = 0; offset < compressed.length; offset += CHUNK_BYTES) {
        chunks.push(compressed.subarray(offset, offset + CHUNK_BYTES).toString("base64"));
    }
    const digest = createHash("sha256")
        .update(payloadKind)
        .update("\0")
        .update(uncompressed)
        .digest("hex");
    return {
        digest,
        chunks,
        uncompressedByteLength: uncompressed.length,
        compressedByteLength: compressed.length,
    };
}

function compactCardIds(compiledCardPolicy: unknown): string[] | null {
    if (
        !compiledCardPolicy ||
        typeof compiledCardPolicy !== "object" ||
        !("cards" in compiledCardPolicy) ||
        !Array.isArray(compiledCardPolicy.cards)
    ) {
        return null;
    }
    const ids = compiledCardPolicy.cards.map((entry) =>
        Array.isArray(entry) ? entry[0] : undefined,
    );
    return ids.every((cardId) => typeof cardId === "string") ? (ids as string[]) : null;
}

function groupHistoryPayload(
    compiledCardPolicy: unknown,
    compiledCardPolicyDigest: string | null,
    cardIds: unknown[],
): unknown {
    if (cardIds.some((cardId) => typeof cardId !== "string")) {
        throw new Error("Active Session contains invalid Group-history Card IDs");
    }
    const stableCardIds = cardIds as string[];
    const compiledCardIds = compactCardIds(compiledCardPolicy);
    if (!compiledCardIds || !compiledCardPolicyDigest) {
        return { format: "CARD_IDS_V1", cardIds: [...stableCardIds].sort() };
    }
    const history = new Set(stableCardIds);
    const bits = Buffer.alloc(Math.ceil(compiledCardIds.length / 8));
    for (const [index, cardId] of compiledCardIds.entries()) {
        if (history.has(cardId)) bits[index >> 3] |= 1 << (index & 7);
    }
    return {
        format: "CARD_ID_BITSET_V1",
        compiledCardPolicyDigest,
        cardCount: compiledCardIds.length,
        bitsBase64: bits.toString("base64"),
    };
}

async function persistPayload(
    queryRunner: QueryRunner,
    payloadKind: PayloadKind,
    payload: unknown,
): Promise<string> {
    const encoded = encode(payloadKind, payload);
    const existing = (await queryRunner.query(
        "SELECT digest FROM session_immutable_payloads WHERE digest = ?",
        [encoded.digest],
    )) as unknown[];
    if (existing.length) return encoded.digest;
    await queryRunner.query(
        `INSERT INTO session_immutable_payloads
         (digest, payload_kind, compression, chunk_count, uncompressed_byte_length,
          compressed_byte_length, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            encoded.digest,
            payloadKind,
            "brotli",
            encoded.chunks.length,
            encoded.uncompressedByteLength,
            encoded.compressedByteLength,
            new Date().toISOString(),
        ],
    );
    for (const [chunkIndex, payloadBase64] of encoded.chunks.entries()) {
        await queryRunner.query(
            `INSERT INTO session_immutable_payload_chunks
             (payload_digest, chunk_index, payload_base64) VALUES (?, ?, ?)`,
            [encoded.digest, chunkIndex, payloadBase64],
        );
    }
    return encoded.digest;
}

async function externalizeTable(
    queryRunner: QueryRunner,
    table: (typeof RUNTIME_TABLES)[number],
): Promise<void> {
    const rows = (await queryRunner.query(
        `SELECT id, runtime_state_json FROM ${table} WHERE runtime_state_version = 5`,
    )) as Array<{ id: string; runtime_state_json: string }>;
    for (const row of rows) {
        const runtime = JSON.parse(row.runtime_state_json) as PersistedRuntime;
        let compiledCardPolicyDigest: string | null = null;
        let groupHistoryDigest: string | null = null;
        let changed = false;
        const compiledCardPolicy = runtime.compiledCardPolicy;
        if (runtime.compiledCardPolicy) {
            compiledCardPolicyDigest = await persistPayload(
                queryRunner,
                "COMPILED_CARD_POLICY",
                runtime.compiledCardPolicy,
            );
            runtime.compiledCardPolicy = null;
            changed = true;
        }
        if (Array.isArray(runtime.groupHistoryCardIds) && runtime.groupHistoryCardIds.length > 0) {
            groupHistoryDigest = await persistPayload(
                queryRunner,
                "GROUP_HISTORY",
                groupHistoryPayload(
                    compiledCardPolicy,
                    compiledCardPolicyDigest,
                    runtime.groupHistoryCardIds,
                ),
            );
            runtime.groupHistoryCardIds = [];
            changed = true;
        }
        if (Array.isArray(runtime.sessionHistory) && runtime.sessionHistory.length > 0) {
            const appearanceTable =
                table === "game_sessions" ? "card_appearances" : "couch_card_appearances";
            const [countRow] = (await queryRunner.query(
                `SELECT COUNT(*) AS appearance_count FROM ${appearanceTable} WHERE session_id = ?`,
                [row.id],
            )) as Array<{ appearance_count: number | string }>;
            if (Number(countRow?.appearance_count ?? 0) === runtime.sessionHistory.length) {
                runtime.sessionHistory = [];
                changed = true;
            }
        }
        if (!changed) continue;
        await queryRunner.query(
            `UPDATE ${table}
             SET runtime_state_json = ?, compiled_card_policy_digest = ?, group_history_digest = ?
             WHERE id = ?`,
            [JSON.stringify(runtime), compiledCardPolicyDigest, groupHistoryDigest, row.id],
        );
    }
}

/**
 * Stores catalog-sized immutable Session inputs once by content digest. Bounded Brotli chunks
 * keep individual SQL statements independent of catalog and group-history size.
 */
export class ExternalizeSessionImmutableState1787357000000 implements MigrationInterface {
    name = "ExternalizeSessionImmutableState1787357000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: "session_immutable_payloads",
                columns: [
                    { name: "digest", type: "varchar", length: "64", isPrimary: true },
                    { name: "payload_kind", type: "varchar", length: "24" },
                    { name: "compression", type: "varchar", length: "16" },
                    { name: "chunk_count", type: "int" },
                    { name: "uncompressed_byte_length", type: "int" },
                    { name: "compressed_byte_length", type: "int" },
                    { name: "created_at", type: "datetime" },
                ],
            }),
        );
        await queryRunner.createTable(
            new Table({
                name: "session_immutable_payload_chunks",
                columns: [
                    {
                        name: "payload_digest",
                        type: "varchar",
                        length: "64",
                        isPrimary: true,
                    },
                    { name: "chunk_index", type: "int", isPrimary: true },
                    { name: "payload_base64", type: "text" },
                ],
                foreignKeys: [
                    {
                        name: "FK_session_payload_chunk_payload",
                        columnNames: ["payload_digest"],
                        referencedTableName: "session_immutable_payloads",
                        referencedColumnNames: ["digest"],
                        onDelete: "CASCADE",
                    },
                ],
            }),
        );
        for (const table of RUNTIME_TABLES) {
            for (const columnName of ["compiled_card_policy_digest", "group_history_digest"]) {
                await queryRunner.addColumn(
                    table,
                    new TableColumn({
                        name: columnName,
                        type: "varchar",
                        length: "64",
                        isNullable: true,
                    }),
                );
            }
            await queryRunner.createIndex(
                table,
                new TableIndex({
                    name: `IDX_${table}_compiled_policy`,
                    columnNames: ["compiled_card_policy_digest"],
                }),
            );
            await queryRunner.createIndex(
                table,
                new TableIndex({
                    name: `IDX_${table}_group_history`,
                    columnNames: ["group_history_digest"],
                }),
            );
        }
        for (const table of RUNTIME_TABLES) await externalizeTable(queryRunner, table);
        for (const table of RUNTIME_TABLES) {
            await queryRunner.createForeignKey(
                table,
                new TableForeignKey({
                    name: `FK_${table}_compiled_policy`,
                    columnNames: ["compiled_card_policy_digest"],
                    referencedTableName: "session_immutable_payloads",
                    referencedColumnNames: ["digest"],
                    onDelete: "RESTRICT",
                }),
            );
            await queryRunner.createForeignKey(
                table,
                new TableForeignKey({
                    name: `FK_${table}_group_history`,
                    columnNames: ["group_history_digest"],
                    referencedTableName: "session_immutable_payloads",
                    referencedColumnNames: ["digest"],
                    onDelete: "RESTRICT",
                }),
            );
        }
    }

    async down(): Promise<void> {
        // Re-embedding arbitrarily large payloads would recreate the packet failure.
    }
}
