import {
    MAXIMUM_CARD_TEXT_BYTES,
    MAXIMUM_CARD_TEXT_CHARACTERS,
} from "../card-catalog-contract/contentLimits";
import { serializeSqliteConnection } from "./transaction";
import { endSessionsFromOtherCatalogs } from "./catalogSessionLifetime";
import { In, type DataSource, type EntityManager, type QueryRunner } from "typeorm";
import {
    catalogFileCards,
    type CatalogFileArtifact,
    type CardCatalogCard,
    type ValidatedCardCatalogArtifact,
} from "../card-catalog-contract";
import { CardCatalogVersionEntity } from "./entities/card/CardCatalogVersionEntity";
import { CardEntity } from "./entities/card/CardEntity";
import { CardLocalizationEntity } from "./entities/card/CardLocalizationEntity";
import { CardOperationalFlagEntity } from "./entities/card/CardOperationalFlagEntity";
import { DareTypeEntity } from "./entities/card/DareTypeEntity";
import { DareTypeTranslationEntity } from "./entities/card/DareTypeTranslationEntity";
import { LocaleEntity } from "./entities/card/LocaleEntity";
import { QuestionCategoryEntity } from "./entities/card/QuestionCategoryEntity";
import { QuestionCategoryTranslationEntity } from "./entities/card/QuestionCategoryTranslationEntity";
import { DataSpaceGameSettingsEntity } from "./entities/game/DataSpaceGameSettingsEntity";
import { GroupEntity } from "./entities/game/GroupEntity";
import { resolveProducerCardMetadata } from "../card-catalog-contract";

export type CardCatalogApplyResult = "APPLIED" | "UNCHANGED" | "NEWER_INSTALLED";
const CATALOG_LOCK_NAME = "game_card_catalog_apply_v1";
const DEVELOPMENT_FIXTURE_VERSION_PREFIX = "development-fixture";
const DATABASE_BATCH_SIZE = 48;
type CatalogArtifact = ValidatedCardCatalogArtifact | CatalogFileArtifact;
function catalogCardCount(artifact: CatalogArtifact): number {
    return "file" in artifact ? artifact.cardCount : artifact.catalog.cards.length;
}
async function* catalogCards(artifact: CatalogArtifact): AsyncIterable<CardCatalogCard> {
    if ("file" in artifact) yield* catalogFileCards(artifact);
    else yield* artifact.catalog.cards;
}

export function isDevelopmentCardCatalogVersion(catalogVersion: string): boolean {
    return catalogVersion.startsWith(DEVELOPMENT_FIXTURE_VERSION_PREFIX);
}

function isCatalogLineageReplacement(
    installed: CardCatalogVersionEntity | null,
    artifact: CatalogArtifact,
): boolean {
    if (!installed) return false;
    return (
        installed.catalogId !== artifact.catalog.catalogId ||
        isDevelopmentCardCatalogVersion(installed.catalogVersion)
    );
}

function nextAppliedAt(installed: CardCatalogVersionEntity | null): Date {
    const previous = installed?.appliedAt.getTime() ?? 0;
    return new Date(Math.max(Date.now(), previous + 1_000));
}

function batches<T>(values: readonly T[]): T[][] {
    const result: T[][] = [];
    for (let index = 0; index < values.length; index += DATABASE_BATCH_SIZE) {
        result.push(values.slice(index, index + DATABASE_BATCH_SIZE));
    }
    return result;
}

async function acquireCatalogLock(queryRunner: QueryRunner): Promise<void> {
    const type = queryRunner.dataSource.options.type;
    if (type !== "mariadb" && type !== "mysql") return;
    const rows = (await queryRunner.query("SELECT GET_LOCK(?, 30) AS acquired", [
        CATALOG_LOCK_NAME,
    ])) as Array<{ acquired: number | string | null }>;
    if (Number(rows[0]?.acquired) !== 1) throw new Error("Could not acquire Card catalog lock");
}

async function releaseCatalogLock(queryRunner: QueryRunner): Promise<void> {
    const type = queryRunner.dataSource.options.type;
    if (type !== "mariadb" && type !== "mysql") return;
    await queryRunner.query("SELECT RELEASE_LOCK(?)", [CATALOG_LOCK_NAME]);
}

async function decide(
    manager: EntityManager,
    artifact: CatalogArtifact,
): Promise<CardCatalogApplyResult | null> {
    const versions = manager.getRepository(CardCatalogVersionEntity);
    const releases = await versions.find({
        where: { catalogId: artifact.catalog.catalogId },
        order: { sequence: "DESC" },
    });
    const incomingIsFixture = isDevelopmentCardCatalogVersion(artifact.catalog.catalogVersion);
    const productionInstalled = releases.some(
        ({ catalogVersion }) => !isDevelopmentCardCatalogVersion(catalogVersion),
    );
    if (incomingIsFixture && productionInstalled) return "NEWER_INSTALLED";
    const installed = releases.find(
        ({ catalogVersion }) =>
            isDevelopmentCardCatalogVersion(catalogVersion) === incomingIsFixture,
    );
    if (!installed) return null;
    if (installed.sequence > artifact.catalog.sequence) return "NEWER_INSTALLED";
    if (installed.sequence === artifact.catalog.sequence) {
        if (installed.artifactDigest !== artifact.artifactDigest) {
            throw new Error(
                `Immutable Card catalog release ${artifact.catalog.catalogId}/${artifact.catalog.sequence} was reused with different bytes`,
            );
        }
        return "UNCHANGED";
    }
    const reusedVersion = releases.some(
        ({ catalogVersion }) => catalogVersion === artifact.catalog.catalogVersion,
    );
    if (reusedVersion) {
        throw new Error(
            `Immutable Card catalog version '${artifact.catalog.catalogVersion}' was reused`,
        );
    }
    return null;
}

async function removeDevelopmentFixtureReleases(
    manager: EntityManager,
    artifact: CatalogArtifact,
): Promise<void> {
    if (isDevelopmentCardCatalogVersion(artifact.catalog.catalogVersion)) return;
    const versions = manager.getRepository(CardCatalogVersionEntity);
    const fixtureReleases = (await versions.find()).filter(({ catalogVersion }) =>
        isDevelopmentCardCatalogVersion(catalogVersion),
    );
    for (const fixture of fixtureReleases) {
        await versions.delete({ catalogId: fixture.catalogId, sequence: fixture.sequence });
    }
}

async function reconcileLocales(manager: EntityManager, artifact: CatalogArtifact): Promise<void> {
    const repository = manager.getRepository(LocaleEntity);
    await repository
        .createQueryBuilder()
        .update()
        .set({ active: false, isDefault: false })
        .where("active = :active OR is_default = :active", { active: true })
        .execute();
    for (const locale of artifact.catalog.locales) {
        await repository.upsert(
            {
                id: locale.id,
                displayName: locale.nativeName,
                active: locale.active,
                isDefault: locale.id === artifact.catalog.defaultLocale,
            },
            ["id"],
        );
    }
}

function availableSavedCardLanguages(
    raw: string | null,
    activeLocales: ReadonlySet<string>,
): string | null {
    if (!raw) return null;
    const value = JSON.parse(raw) as {
        cardLocale?: unknown;
        cardFallbackEnabled?: unknown;
        cardFallbackLocales?: unknown;
    };
    if (typeof value.cardLocale !== "string" || !activeLocales.has(value.cardLocale)) return null;
    const fallbackLocales = Array.isArray(value.cardFallbackLocales)
        ? value.cardFallbackLocales.filter(
              (locale): locale is string =>
                  typeof locale === "string" &&
                  locale !== value.cardLocale &&
                  activeLocales.has(locale),
          )
        : [];
    return JSON.stringify({
        cardLocale: value.cardLocale,
        cardFallbackEnabled: value.cardFallbackEnabled === true && fallbackLocales.length > 0,
        cardFallbackLocales: fallbackLocales,
    });
}

async function reconcileSavedCardLanguages(
    manager: EntityManager,
    artifact: CatalogArtifact,
): Promise<void> {
    const activeLocales = new Set(
        artifact.catalog.locales.filter(({ active }) => active).map(({ id }) => id),
    );
    for (const [table, key] of [
        ["data_space_game_settings", "data_space_id"],
        ["game_groups", "id"],
    ] as const) {
        let after = "";
        while (true) {
            const rows = await manager.query(
                `SELECT ${key} AS owner_id, card_language_settings_json FROM ${table} WHERE ${key} > ? ORDER BY ${key} LIMIT 64`,
                [after],
            );
            if (!rows.length) break;
            for (const row of rows) {
                const normalized = availableSavedCardLanguages(
                    row.card_language_settings_json,
                    activeLocales,
                );
                if (normalized !== row.card_language_settings_json)
                    await manager.query(
                        `UPDATE ${table} SET card_language_settings_json = ? WHERE ${key} = ?`,
                        [normalized, row.owner_id],
                    );
            }
            after = rows.at(-1)!.owner_id;
        }
    }
}

async function rebaseExistingGroupHistory(
    manager: EntityManager,
    catalogAppliedAt: Date,
): Promise<void> {
    const storedDate = catalogAppliedAt.toISOString().replace("T", " ").replace("Z", "");
    await manager.query(
        `UPDATE game_groups
         SET history_reset_at = ?
         WHERE created_at < ?
           AND (history_reset_at IS NULL OR history_reset_at < ?)`,
        [storedDate, storedDate, storedDate],
    );
}

async function reconcileTaxonomies(
    manager: EntityManager,
    artifact: CatalogArtifact,
): Promise<void> {
    const categories = manager.getRepository(QuestionCategoryEntity);
    const categoryLocalizations = manager.getRepository(QuestionCategoryTranslationEntity);
    for (const category of artifact.catalog.taxonomy.questionCategories) {
        await categories.upsert(
            {
                id: category.id,
                defaultSocialSensitivity: category.defaultSocialSensitivity,
                defaultMinimumPlayerCount:
                    category.defaultMinimumPlayerCount ??
                    artifact.catalog.cardDefaults.minimumPlayerCount,
                defaultMaximumPlayerCount: category.defaultMaximumPlayerCount ?? null,
            },
            ["id"],
        );
        for (const localization of category.localizations) {
            await categoryLocalizations.upsert(
                {
                    categoryId: category.id,
                    locale: localization.locale,
                    label: localization.label,
                    description: localization.description ?? null,
                },
                ["categoryId", "locale"],
            );
        }
    }
    const dareTypes = manager.getRepository(DareTypeEntity);
    const dareTypeLocalizations = manager.getRepository(DareTypeTranslationEntity);
    for (const dareType of artifact.catalog.taxonomy.dareTypes) {
        await dareTypes.upsert(
            {
                id: dareType.id,
                defaultSocialSensitivity: dareType.defaultSocialSensitivity,
                defaultMinimumPlayerCount:
                    dareType.defaultMinimumPlayerCount ??
                    artifact.catalog.cardDefaults.minimumPlayerCount,
                defaultMaximumPlayerCount: dareType.defaultMaximumPlayerCount ?? null,
            },
            ["id"],
        );
        for (const localization of dareType.localizations) {
            await dareTypeLocalizations.upsert(
                {
                    dareTypeId: dareType.id,
                    locale: localization.locale,
                    label: localization.label,
                    description: localization.description ?? null,
                },
                ["dareTypeId", "locale"],
            );
        }
    }
}

async function reconcileCards(manager: EntityManager, artifact: CatalogArtifact): Promise<void> {
    const cards = manager.getRepository(CardEntity);
    const localizations = manager.getRepository(CardLocalizationEntity);
    const flags = manager.getRepository(CardOperationalFlagEntity);
    // FULL apply is one transaction: mark the old view inactive, then upsert
    // bounded batches. No catalog-sized ID/text arrays or per-language cross product.
    await cards.createQueryBuilder().update().set({ active: false }).execute();
    const updatedAt = new Date();
    await localizations.createQueryBuilder().update().set({ active: false, updatedAt }).execute();
    let batch: CardCatalogCard[] = [];
    let bytes = 0;
    const flush = async () => {
        if (!batch.length) return;
        await cards.upsert(
            batch.map((card) => ({
                id: card.id,
                cardType: card.cardType,
                yesNoAnswerPossible: card.yesNoAnswerPossible,
                questionCategoryId: card.questionCategoryId,
                dareTypeId: card.dareTypeId,
                dareAffinityCategoryId: card.dareAffinityCategoryId,
                intensity: card.intensity,
                alwaysEligible: card.alwaysEligible,
                repeatableInSession: card.repeatableInSession,
                repeatCooldown: card.repeatCooldown,
                weight: card.weight,
                ...resolveProducerCardMetadata(artifact.catalog, card),
                active: card.lifecycle === "ACTIVE",
            })),
            ["id"],
        );
        await flags.delete({ cardId: In(batch.map(({ id }) => id)) });
        let renderingBatch: Partial<CardLocalizationEntity>[] = [];
        let renderingBytes = 0;
        const flushRenderings = async () => {
            if (!renderingBatch.length) return;
            await localizations.upsert(renderingBatch, ["cardId", "locale"]);
            renderingBatch = [];
            renderingBytes = 0;
        };
        for (const card of batch) {
            if (card.operationalFlags.length)
                await flags.insert(
                    card.operationalFlags.map((flag) => ({ cardId: card.id, flag })),
                );
            for (const localization of card.localizations) {
                const size = Buffer.byteLength(localization.text) * 2 + 256;
                if (
                    renderingBatch.length >= DATABASE_BATCH_SIZE ||
                    renderingBytes + size > 128 * 1024
                )
                    await flushRenderings();
                renderingBatch.push({
                    cardId: card.id,
                    locale: localization.locale,
                    text: localization.text,
                    active: true,
                    updatedAt,
                });
                renderingBytes += size;
            }
        }
        await flushRenderings();
        batch = [];
        bytes = 0;
    };
    for await (const card of catalogCards(artifact)) {
        const size =
            1024 +
            card.localizations.reduce(
                (total, value) => total + Buffer.byteLength(value.text) + 128,
                0,
            );
        if (batch.length >= DATABASE_BATCH_SIZE || bytes + size > 256 * 1024) await flush();
        batch.push(card);
        bytes += size;
    }
    await flush();
}

async function assertConsistent(manager: EntityManager, defaultLocale: string): Promise<void> {
    const defaults = await manager.getRepository(LocaleEntity).countBy({
        active: true,
        isDefault: true,
    });
    if (defaults !== 1)
        throw new Error(`Card catalog requires one active default locale; found ${defaults}`);
    const missing = await manager
        .getRepository(CardEntity)
        .createQueryBuilder("card")
        .where("card.active = :active", { active: true })
        .andWhere(
            "NOT EXISTS (SELECT 1 FROM card_localizations l WHERE l.card_id = card.id AND l.locale = :locale AND l.active = :active)",
            { locale: defaultLocale },
        )
        .getExists();
    if (missing) throw new Error("Active Card lacks default-locale content");
}

export async function applyCardCatalogSnapshot(
    dataSource: DataSource,
    artifact: CatalogArtifact,
): Promise<CardCatalogApplyResult> {
    return serializeSqliteConnection(dataSource, () =>
        applyCatalogTransaction(dataSource, artifact),
    );
}

async function applyCatalogTransaction(
    dataSource: DataSource,
    artifact: CatalogArtifact,
): Promise<CardCatalogApplyResult> {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    let lockAcquired = false;
    try {
        if (dataSource.options.type !== "better-sqlite3") {
            const [database] = await queryRunner.query(
                "SELECT @@SESSION.sql_mode AS mode, @@max_allowed_packet AS packet",
            );
            if (Number(database.packet) < 1024 * 1024) {
                throw new Error(
                    "Catalog installation requires max_allowed_packet of at least 1 MiB",
                );
            }
            const modes = new Set(String(database.mode).split(",").filter(Boolean));
            modes.add("STRICT_ALL_TABLES");
            await queryRunner.query("SET SESSION sql_mode = ?", [[...modes].join(",")]);
        }
        await acquireCatalogLock(queryRunner);
        lockAcquired = true;
        await queryRunner.startTransaction();
        try {
            const installedCatalog = await queryRunner.manager
                .getRepository(CardCatalogVersionEntity)
                .findOne({ where: {}, order: { appliedAt: "DESC", sequence: "DESC" } });
            const rebaseGroupHistory = isCatalogLineageReplacement(installedCatalog, artifact);
            // The bundled fixture bootstraps local development only. Its deliberately tiny,
            // non-production lineage must never block a producer release, even when an older
            // fixture used another catalog ID or a larger sequence.
            await removeDevelopmentFixtureReleases(queryRunner.manager, artifact);
            const decision = await decide(queryRunner.manager, artifact);
            if (decision) {
                const bytes =
                    dataSource.options.type === "better-sqlite3"
                        ? "LENGTH(CAST(l.text AS BLOB))"
                        : "OCTET_LENGTH(l.text)";
                const characters =
                    dataSource.options.type === "better-sqlite3"
                        ? "LENGTH(l.text)"
                        : "CHAR_LENGTH(l.text)";
                const oversized = await queryRunner.query(
                    `SELECT l.card_id FROM card_localizations l JOIN cards c ON c.id = l.card_id WHERE l.active = 1 AND c.active = 1 AND (${bytes} > ? OR ${characters} > ?) LIMIT 1`,
                    [MAXIMUM_CARD_TEXT_BYTES, MAXIMUM_CARD_TEXT_CHARACTERS],
                );
                if (oversized.length)
                    throw new Error(
                        "Installed Card content exceeds supported rendering bytes or characters; deploy a corrected catalog release",
                    );
                await queryRunner.commitTransaction();
                return decision;
            }
            await reconcileLocales(queryRunner.manager, artifact);
            await reconcileSavedCardLanguages(queryRunner.manager, artifact);
            await reconcileTaxonomies(queryRunner.manager, artifact);
            await reconcileCards(queryRunner.manager, artifact);
            await endSessionsFromOtherCatalogs(queryRunner.manager, artifact.artifactDigest);
            await assertConsistent(queryRunner.manager, artifact.catalog.defaultLocale);
            const appliedAt = nextAppliedAt(installedCatalog);
            if (rebaseGroupHistory) {
                await rebaseExistingGroupHistory(queryRunner.manager, appliedAt);
            }
            await queryRunner.manager.getRepository(CardCatalogVersionEntity).insert({
                catalogId: artifact.catalog.catalogId,
                sequence: artifact.catalog.sequence,
                contract: artifact.catalog.contract,
                catalogVersion: artifact.catalog.catalogVersion,
                artifactDigest: artifact.artifactDigest,
                generatedAt: new Date(artifact.catalog.generatedAt),
                appliedAt,
                defaultLocale: artifact.catalog.defaultLocale,
                cardCount: catalogCardCount(artifact),
                localeCount: artifact.catalog.locales.length,
            });
            await queryRunner.commitTransaction();
            return "APPLIED";
        } catch (error) {
            if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
            throw error;
        }
    } finally {
        try {
            if (lockAcquired) await releaseCatalogLock(queryRunner);
        } finally {
            await queryRunner.release();
        }
    }
}
