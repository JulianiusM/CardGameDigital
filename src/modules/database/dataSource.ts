/* Copyright 2026 Julian Malovanij, Apache-2.0 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DataSource, DataSourceOptions } from "typeorm";
import settings, { Settings } from "../settings";
import { entities, migrations, subscribers } from "./__index__";
import { DataSpace } from "./entities/user/DataSpace";
import { applyBundledCardCatalog } from "./bundledCardCatalog";
import { LocaleEntity } from "./entities/card/LocaleEntity";

export function dataSourceOptions(config: Settings): DataSourceOptions {
    const common = {
        entities,
        migrations,
        subscribers,
        synchronize: false,
        migrationsRun: false,
        invalidWhereValuesBehavior: { null: "sql-null" as const, undefined: "ignore" as const },
    };
    if (config.dbType === "sqlite") {
        fs.mkdirSync(path.dirname(path.resolve(config.dbFile)), { recursive: true });
        return { type: "better-sqlite3", database: config.dbFile, ...common };
    }
    return {
        type: config.dbType,
        host: config.dbHost,
        port: config.dbPort,
        username: config.dbUser,
        password: config.dbPassword,
        database: config.dbName,
        timezone: "Z",
        dateStrings: ["DATE"],
        ...common,
    };
}

export let AppDataSource: DataSource;

async function backupSqliteBeforeUpgrade(config: Settings): Promise<void> {
    if (config.dbType !== "sqlite" || config.dbFile === ":memory:") return;
    const database = path.resolve(config.dbFile);
    if (!fs.existsSync(database) || fs.statSync(database).size === 0) return;
    const backup = `${database}.pre-catalog-v1.bak`;
    if (fs.existsSync(backup)) return;
    const connection = new Database(database, { readonly: true });
    try {
        await connection.backup(backup);
    } finally {
        connection.close();
    }
}

export async function initDataSource(): Promise<DataSource> {
    if (AppDataSource?.isInitialized) return AppDataSource;
    if (!settings.value.initialized) await settings.read();
    await backupSqliteBeforeUpgrade(settings.value);
    AppDataSource = new DataSource(dataSourceOptions(settings.value));
    await AppDataSource.initialize();
    if (settings.value.dbType === "sqlite") {
        await AppDataSource.query("PRAGMA foreign_keys = ON");
    }
    await AppDataSource.runMigrations({ transaction: "all" });
    const catalogResult = await applyBundledCardCatalog(AppDataSource);
    console.log(`Card catalog startup result: ${catalogResult}`);
    if (settings.value.cardMissingTranslation === "FALLBACK") {
        const fallbackAvailable = await AppDataSource.getRepository(LocaleEntity).existsBy({
            id: settings.value.cardFallbackLocale,
            active: true,
        });
        if (!fallbackAvailable) {
            throw new Error(
                `Configured Card fallback locale '${settings.value.cardFallbackLocale}' is not active`,
            );
        }
    }
    if (settings.value.dbType === "sqlite") {
        await AppDataSource.query("PRAGMA journal_mode = WAL");
        const repository = AppDataSource.getRepository(DataSpace);
        const count = await repository.count();
        if (count === 0) {
            await repository.save(repository.create({ name: "Local", defaultForOwner: true }));
        } else if (count !== 1) {
            throw new Error(`Local deployment requires exactly one DataSpace; found ${count}`);
        }
    }
    return AppDataSource;
}
