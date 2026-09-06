import { type MigrationInterface, type QueryRunner, Table, TableColumn, TableIndex } from "typeorm";

export class BoundGameRetention1787363000000 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        if (!(await runner.hasTable("game_capacity")))
            await runner.createTable(
                new Table({
                    name: "game_capacity",
                    columns: [{ name: "id", type: "integer", isPrimary: true }],
                }),
            );
        if (!(await runner.query("SELECT id FROM game_capacity WHERE id = 1")).length)
            await runner.query("INSERT INTO game_capacity (id) VALUES (1)");
        if (!(await runner.hasColumn("couch_game_sessions", "last_active_at")))
            await runner.addColumn(
                "couch_game_sessions",
                new TableColumn({
                    name: "last_active_at",
                    type: "datetime",
                    default: "'1970-01-01 00:00:00'",
                }),
            );
        // Do not grant abandoned records a new lease on migration or restore.
        await runner.query(
            "UPDATE couch_game_sessions SET last_active_at = started_at WHERE last_active_at = '1970-01-01 00:00:00'",
        );
        const indexes: [string, string, string[]][] = [
            ["room_create_idempotency", "IDX_room_create_resource", ["resource_id", "state"]],
            ["rooms", "IDX_room_retention", ["data_space_id", "closed_at"]],
            ["rooms", "IDX_room_expiry", ["closed_at", "expires_at"]],
            ["game_sessions", "IDX_game_session_retention", ["ended_at", "room_id"]],
            ["couch_game_sessions", "IDX_couch_session_retention", ["ended_at", "last_active_at"]],
        ];
        for (const [table, name, columnNames] of indexes)
            if (!(await runner.getTable(table))!.indices.some((index) => index.name === name))
                await runner.createIndex(table, new TableIndex({ name, columnNames }));
    }
    async down(): Promise<void> {
        throw new Error("Game retention is irreversible; restore the matching backup to downgrade");
    }
}
