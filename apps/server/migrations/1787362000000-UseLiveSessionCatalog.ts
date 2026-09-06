import {
    type MigrationInterface,
    type QueryRunner,
    TableColumn,
    TableForeignKey,
    TableIndex,
} from "typeorm";

/** Forward-only, resumable on engines whose DDL commits implicitly. Historical
 * appearances and stable Card IDs are retained; obsolete active runtimes end. */
export class UseLiveSessionCatalog1787362000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        for (const table of ["game_sessions", "couch_game_sessions"]) {
            if (!(await runner.hasColumn(table, "policy_input_digest")))
                await runner.addColumn(
                    table,
                    new TableColumn({
                        name: "policy_input_digest",
                        type: "varchar",
                        length: "64",
                        isNullable: true,
                    }),
                );
            while (true) {
                const [row] = await runner.query(
                    `SELECT id, revision, runtime_state_json FROM ${table} WHERE runtime_state_version < 7 ORDER BY id LIMIT 1`,
                );
                if (!row) break;
                const runtime = JSON.parse(row.runtime_state_json);
                const appearances =
                    table === "game_sessions" ? "card_appearances" : "couch_card_appearances";
                const [last] = await runner.query(
                    `SELECT MAX(sequence) AS total FROM ${appearances} WHERE session_id = ?`,
                    [row.id],
                );
                const revision = Number(row.revision) + Number(runtime.state !== "ENDED");
                for (const key of ["frozenCatalog", "compiledCardPolicy"]) delete runtime[key];
                Object.assign(runtime, {
                    version: 7,
                    state: "ENDED",
                    revision,
                    currentCard: null,
                    pendingCardType: null,
                    votes: [],
                    voterIds: [],
                    boundariesByPlayer: [],
                    sessionHistory: [],
                    groupHistoryCardIds: [],
                    catalog: null,
                    policySnapshot: null,
                    historyContext: null,
                    historyIndex: [],
                    cardsShown: Number(last.total ?? 0),
                    poolRevision: 0,
                    sessionCardPolicy: { scopeDefault: {}, conditionalRules: [], exactCards: [] },
                });
                await runner.query(
                    `UPDATE ${table} SET runtime_state_version = 7, runtime_state_json = ?, revision = ?, policy_input_digest = NULL, ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP) WHERE id = ?`,
                    [JSON.stringify(runtime), revision, row.id],
                );
            }
            for (const column of [
                "compiled_card_policy_digest",
                "group_history_digest",
                "frozen_catalog_digest",
            ]) {
                const schema = await runner.getTable(table);
                if (!schema?.findColumnByName(column)) continue;
                for (const key of schema.foreignKeys.filter((key) =>
                    key.columnNames.includes(column),
                ))
                    await runner.dropForeignKey(table, key);
                await runner.dropColumn(table, column);
            }
            const schema = (await runner.getTable(table))!;
            if (!schema.foreignKeys.some((key) => key.columnNames.includes("policy_input_digest")))
                await runner.createForeignKey(
                    table,
                    new TableForeignKey({
                        name: `FK_${table}_policy_input`,
                        columnNames: ["policy_input_digest"],
                        referencedTableName: "session_immutable_payloads",
                        referencedColumnNames: ["digest"],
                        onDelete: "RESTRICT",
                    }),
                );
            if (!schema.indices.some((index) => index.name === `IDX_${table}_policy_input`))
                await runner.createIndex(
                    table,
                    new TableIndex({
                        name: `IDX_${table}_policy_input`,
                        columnNames: ["policy_input_digest"],
                    }),
                );
        }
        for (const table of ["card_appearances", "couch_card_appearances"]) {
            for (const [suffix, columns] of [
                ["last_seen", ["session_id", "card_id", "sequence"]],
                ["group_seen", ["group_id", "card_id", "shown_at"]],
            ] as const) {
                const name = `IDX_${table}_${suffix}`;
                if (!(await runner.getTable(table))!.indices.some((index) => index.name === name))
                    await runner.createIndex(
                        table,
                        new TableIndex({ name, columnNames: [...columns] }),
                    );
            }
        }
        const weight = (await runner.getTable("cards"))!.findColumnByName("weight")!;
        if (weight.type !== "double")
            await runner.changeColumn(
                "cards",
                weight,
                new TableColumn({
                    name: "weight",
                    type: "double",
                    default: weight.default,
                    isNullable: weight.isNullable,
                }),
            );
        while (true) {
            const rows = await runner.query(
                `SELECT digest FROM session_immutable_payloads p WHERE NOT EXISTS (SELECT 1 FROM game_sessions s WHERE s.policy_input_digest = p.digest) AND NOT EXISTS (SELECT 1 FROM couch_game_sessions s WHERE s.policy_input_digest = p.digest) LIMIT 16`,
            );
            if (!rows.length) break;
            for (const row of rows)
                await runner.query("DELETE FROM session_immutable_payloads WHERE digest = ?", [
                    row.digest,
                ]);
        }
    }

    async down(): Promise<void> {
        throw new Error(
            "Session input archives were removed; restore a matching backup to downgrade",
        );
    }
}
