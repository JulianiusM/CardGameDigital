import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DataSource } from "typeorm";
import { afterEach, describe, expect, it } from "vitest";
import { dataSourceOptions } from "../../src/modules/database/dataSource";
import { DataSpace } from "../../src/modules/database/entities/user/DataSpace";
import { resolveSettings } from "../../src/modules/settings";

let source: DataSource | undefined;
let directory: string | undefined;
afterEach(async () => {
    if (source?.isInitialized) await source.destroy();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

describe("SQLite migration path", () => {
    it("migrates an empty database, enables WAL, and persists a DataSpace", async () => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "card-game-sqlite-"));
        const dbFile = path.join(directory, "game.sqlite");
        const settings = resolveSettings({ DB_FILE: dbFile }, "/dev/null");
        source = new DataSource(dataSourceOptions(settings));
        await source.initialize();
        await source.runMigrations({ transaction: "all" });
        await source.query("PRAGMA journal_mode = WAL");

        const repository = source.getRepository(DataSpace);
        await repository.save(repository.create({ name: "Local", defaultForOwner: true }));

        expect(await repository.count()).toBe(1);
        expect((await source.query("PRAGMA journal_mode"))[0].journal_mode).toBe("wal");
        expect(
            await source.query(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='data_spaces'",
            ),
        ).toHaveLength(1);
    });

    it("creates only the fresh account ownership schema", async () => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), "card-game-schema-"));
        const dbFile = path.join(directory, "schema.sqlite");
        source = new DataSource(
            dataSourceOptions(resolveSettings({ DB_FILE: dbFile }, "/dev/null")),
        );
        await source.initialize();
        await source.runMigrations({ transaction: "all" });

        const columns = await source.query("PRAGMA table_info(data_spaces)");
        expect(columns.map(({ name }: { name: string }) => name)).not.toContain("guest_id");
        expect(
            await source.query(
                "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('guests', 'profiles')",
            ),
        ).toHaveLength(0);
    });
});
