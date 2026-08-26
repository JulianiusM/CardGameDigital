/* Copyright 2026 Julian Malovanij, Apache-2.0 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DataSource, DataSourceOptions } from "typeorm";
import settings, { isPublicRuntimeSecurityEnforced, Settings } from "../settings";
import { entities, migrations, subscribers } from "./__index__";
import { DataSpace } from "./entities/user/DataSpace";
import { applyBundledCardCatalog, bundledCardCatalogArtifact } from "./bundledCardCatalog";
import { LocaleEntity } from "./entities/card/LocaleEntity";
import { CardCatalogVersionEntity } from "./entities/card/CardCatalogVersionEntity";
import { logEvent } from "../structuredLogger";

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

async function backupSqliteBeforeUpgrade(config: Settings, catalogSequence: number): Promise<void> {
    if (config.dbType !== "sqlite" || config.dbFile === ":memory:") return;
    const database = path.resolve(config.dbFile);
    if (!fs.existsSync(database) || fs.statSync(database).size === 0) return;
    const migrationName = migrations.at(-1)?.name ?? "schema";
    const schemaVersion = migrationName.match(/\d{13}$/)?.[0] ?? "unknown";
    const backup = `${database}.pre-schema-${schemaVersion}-catalog-${catalogSequence}.bak`;
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
    const catalogArtifact = bundledCardCatalogArtifact(
        settings.value.deploymentMode,
        settings.value.testMode || !isPublicRuntimeSecurityEnforced(settings.value),
    );
    await backupSqliteBeforeUpgrade(settings.value, catalogArtifact.catalog.sequence);
    AppDataSource = new DataSource(dataSourceOptions(settings.value));
    await AppDataSource.initialize();
    if (settings.value.dbType === "sqlite") {
        await AppDataSource.query("PRAGMA foreign_keys = ON");
    }
    await AppDataSource.runMigrations({ transaction: "all" });
    const catalogResult = await applyBundledCardCatalog(AppDataSource, catalogArtifact);
    const installedCatalog = await AppDataSource.getRepository(CardCatalogVersionEntity).findOne({
        where: { catalogId: catalogArtifact.catalog.catalogId },
        order: { sequence: "DESC" },
    });
    logEvent(
        "info",
        "catalog.startup",
        {
            result: catalogResult,
            catalogId: catalogArtifact.catalog.catalogId,
            catalogVersion: catalogArtifact.catalog.catalogVersion,
            sequence: catalogArtifact.catalog.sequence,
            cardCount: catalogArtifact.catalog.cards.length,
            installedCatalogVersion: installedCatalog?.catalogVersion,
            installedSequence: installedCatalog?.sequence,
        },
        settings.value.logLevel,
    );
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
    }
    if (settings.value.deploymentMode === "local" && settings.value.dbType === "sqlite") {
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
