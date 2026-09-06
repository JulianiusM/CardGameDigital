import { type MigrationInterface, type QueryRunner, TableColumn, TableForeignKey } from "typeorm";

export class FreezeSessionCatalogs1787361000000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        for (const table of ["game_sessions", "couch_game_sessions"]) {
            if (!(await queryRunner.hasColumn(table, "frozen_catalog_digest")))
                await queryRunner.addColumn(
                    table,
                    new TableColumn({
                        name: "frozen_catalog_digest",
                        type: "varchar",
                        length: "64",
                        isNullable: true,
                    }),
                );
            if (
                !(await queryRunner.getTable(table))!.foreignKeys.some((key) =>
                    key.columnNames.includes("frozen_catalog_digest"),
                )
            )
                await queryRunner.createForeignKey(
                    table,
                    new TableForeignKey({
                        name: `FK_${table}_frozen_catalog`,
                        columnNames: ["frozen_catalog_digest"],
                        referencedTableName: "session_immutable_payloads",
                        referencedColumnNames: ["digest"],
                        onDelete: "RESTRICT",
                    }),
                );
            let after = "";
            while (true) {
                const rows = await queryRunner.manager
                    .createQueryBuilder()
                    .select(["id", "runtime_state_json", "revision", "ended_at"])
                    .from(table, "session")
                    .where("id > :after", { after })
                    .andWhere("runtime_state_version < 6")
                    .orderBy("id", "ASC")
                    .limit(25)
                    .getRawMany<{
                        id: string;
                        runtime_state_json: string;
                        revision: number;
                        ended_at: Date | null;
                    }>();
                if (!rows.length) break;
                for (const row of rows) {
                    const runtime = JSON.parse(row.runtime_state_json);
                    if (runtime.version >= 6) continue;
                    if (runtime.version !== 5)
                        throw new Error("Catalog freezing requires runtime v5");
                    // v5 never retained localized membership/text. Inventing a past
                    // catalog from today's release would silently change active games.
                    const revision = row.revision + Number(runtime.state !== "ENDED");
                    Object.assign(runtime, {
                        version: 6,
                        frozenCatalog: null,
                        state: "ENDED",
                        revision,
                        currentCard: null,
                        pendingCardType: null,
                        votes: [],
                        voterIds: [],
                        boundariesByPlayer: [],
                    });
                    const endedAt = row.ended_at ? new Date(row.ended_at) : new Date();
                    await queryRunner.query(
                        `UPDATE ${table} SET runtime_state_version = 6, runtime_state_json = ?, revision = ?, ended_at = ? WHERE id = ?`,
                        [
                            JSON.stringify(runtime),
                            revision,
                            endedAt.toISOString().slice(0, 23).replace("T", " "),
                            row.id,
                        ],
                    );
                }
                after = rows.at(-1)!.id;
            }
        }
    }

    async down(): Promise<void> {
        throw new Error(
            "Frozen Session catalogs cannot be downgraded; restore a database backup with its matching server version",
        );
    }
}
