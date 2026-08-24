import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppDataSource, initDataSource } from "../../src/modules/database/dataSource";
import { CardCatalogVersionEntity } from "../../src/modules/database/entities/card/CardCatalogVersionEntity";
import { CardEntity } from "../../src/modules/database/entities/card/CardEntity";
import settings from "../../src/modules/settings";

let directory: string;
let databaseFile: string;

beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-startup-"));
    databaseFile = path.join(directory, "game.sqlite");
    const existing = new Database(databaseFile);
    existing.exec("CREATE TABLE pre_upgrade_marker (value TEXT NOT NULL)");
    existing.prepare("INSERT INTO pre_upgrade_marker (value) VALUES (?)").run("preserved");
    existing.close();
    Object.assign(process.env, {
        SETTINGS_FILE: "/dev/null",
        DEPLOYMENT_MODE: "local",
        AUTH_MODE: "none",
        DB_TYPE: "sqlite",
        DB_FILE: databaseFile,
        SESSION_SECRET: "catalog_startup_test_secret",
    });
    await settings.read("/dev/null");
    await initDataSource();
});

afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("bundled catalog startup", () => {
    it("backs up existing SQLite, migrates, and applies the offline catalog before ready", async () => {
        const backupName = fs
            .readdirSync(directory)
            .find((name) => name.startsWith("game.sqlite.pre-schema-") && name.endsWith(".bak"));
        expect(backupName).toBeDefined();
        const backupFile = path.join(directory, backupName!);
        expect(fs.existsSync(backupFile)).toBe(true);
        const backup = new Database(backupFile, { readonly: true });
        expect(backup.prepare("SELECT value FROM pre_upgrade_marker").get()).toEqual({
            value: "preserved",
        });
        backup.close();
        expect(await AppDataSource.getRepository(CardCatalogVersionEntity).count()).toBe(1);
        expect(await AppDataSource.getRepository(CardEntity).countBy({ active: true })).toBe(4);
    });
});
