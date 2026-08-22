/* Copyright 2026 Julian Malovanij, Apache-2.0 */

import fs from "node:fs";
import path from "node:path";
import { DataSource, DataSourceOptions } from "typeorm";
import settings, { Settings } from "../settings";
import { entities, migrations, subscribers } from "./__index__";
import { DataSpace } from "./entities/user/DataSpace";

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

export async function initDataSource(): Promise<DataSource> {
    if (AppDataSource?.isInitialized) return AppDataSource;
    if (!settings.value.initialized) await settings.read();
    AppDataSource = new DataSource(dataSourceOptions(settings.value));
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: "all" });
    if (settings.value.dbType === "sqlite") {
        await AppDataSource.query("PRAGMA journal_mode = WAL");
        await AppDataSource.query("PRAGMA foreign_keys = ON");
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
