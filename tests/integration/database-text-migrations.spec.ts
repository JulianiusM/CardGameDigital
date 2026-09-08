import { randomUUID } from "node:crypto";
import { DataSource, type DataSourceOptions } from "typeorm";
import { afterEach, describe, expect, it } from "vitest";
import { entities, migrations } from "../../apps/server/src/modules/database/__index__";
import { defaultRoomGameSettings } from "../../packages/application/roomGameSettings";

const mysqlEnabled = process.env.MYSQL_MIGRATION_TEST === "1";

function sourceOptions(type: "better-sqlite3" | "mysql"): DataSourceOptions {
    if (type === "better-sqlite3") return { type, database: ":memory:", entities, migrations };
    return {
        type,
        host: process.env.MYSQL_TEST_HOST ?? "127.0.0.1",
        port: Number(process.env.MYSQL_TEST_PORT ?? 3307),
        username: process.env.MYSQL_TEST_USER ?? "root",
        password: process.env.MYSQL_TEST_PASSWORD ?? "",
        database: "card_game_migration_test",
        entities,
        migrations,
    };
}

describe.each(["better-sqlite3", "mysql"] as const)("%s text-column migrations", (type) => {
    describe.skipIf(type === "mysql" && !mysqlEnabled)("portable defaults", () => {
        let source: DataSource;

        afterEach(async () => {
            if (source?.isInitialized) await source.destroy();
        });

        async function initialize(selected = migrations): Promise<void> {
            source = new DataSource({ ...sourceOptions(type), migrations: selected });
            await source.initialize();
            // The MySQL suite owns this fixed disposable schema, never an operator database.
            await source.dropDatabase();
            if (type === "mysql") {
                await source.query(
                    "SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'",
                );
            }
        }

        it("runs the complete migration chain and can restart without pending migrations", async () => {
            await initialize();
            expect(await source.runMigrations({ transaction: "all" })).toHaveLength(
                migrations.length,
            );
            expect(await source.runMigrations({ transaction: "all" })).toEqual([]);
            const runner = source.createQueryRunner();
            try {
                for (const [table, column] of [
                    ["game_groups", "members_json"],
                    ["rooms", "game_settings_json"],
                ]) {
                    const definition = (await runner.getTable(table))!.findColumnByName(column)!;
                    expect(definition.isNullable).toBe(false);
                    expect(definition.default).toBeUndefined();
                }
            } finally {
                await runner.release();
            }
        }, 60_000);

        it("backfills existing Rooms before requiring settings and preserves Group members", async () => {
            const index = migrations.findIndex(
                ({ name }) => name === "AddAuthoritativeRoomSettings1787338000000",
            );
            expect(index).toBeGreaterThan(0);
            await initialize(migrations.slice(0, index));
            await source.runMigrations({ transaction: "all" });
            const dataSpaceId = randomUUID();
            const groupId = randomUUID();
            const roomId = randomUUID();
            const now = "2026-09-08 12:00:00";
            const members = JSON.stringify(["Ada", "Lin"]);
            await source.query("INSERT INTO data_spaces (id, name) VALUES (?, ?)", [
                dataSpaceId,
                "Saved",
            ]);
            await source.query(
                "INSERT INTO game_groups (id, data_space_id, name, members_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                [groupId, dataSpaceId, "Friends", members, now, now],
            );
            await source.query(
                "INSERT INTO rooms (id, code, data_space_id, group_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
                [roomId, "BEFORE", dataSpaceId, groupId, now, "2026-09-09 12:00:00"],
            );
            const runner = source.createQueryRunner();
            try {
                await new migrations[index]().up(runner);
                const [room] = await runner.query(
                    "SELECT group_id, game_settings_json, settings_revision, settings_updated_by FROM rooms WHERE id = ?",
                    [roomId],
                );
                expect(room).toEqual({
                    group_id: groupId,
                    game_settings_json: JSON.stringify(defaultRoomGameSettings()),
                    settings_revision: 0,
                    settings_updated_by: null,
                });
                expect(
                    await runner.query("SELECT members_json FROM game_groups WHERE id = ?", [
                        groupId,
                    ]),
                ).toEqual([{ members_json: members }]);
                const column = (await runner.getTable("rooms"))!.findColumnByName(
                    "game_settings_json",
                )!;
                expect(column.isNullable).toBe(false);
                expect(column.default).toBeUndefined();
                await expect(
                    runner.query("UPDATE rooms SET game_settings_json = NULL WHERE id = ?", [
                        roomId,
                    ]),
                ).rejects.toThrow();
                await new migrations[index]().down(runner);
                expect(await runner.hasColumn("rooms", "game_settings_json")).toBe(false);
                expect(
                    await runner.query("SELECT group_id FROM rooms WHERE id = ?", [roomId]),
                ).toEqual([{ group_id: groupId }]);
            } finally {
                await runner.release();
            }
        }, 60_000);
    });
});
