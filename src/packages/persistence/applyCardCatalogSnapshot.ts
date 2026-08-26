import { In, type DataSource, type EntityManager, type QueryRunner } from "typeorm";
import type { ValidatedCardCatalogArtifact } from "../card-catalog-contract";
import { CardCatalogVersionEntity } from "../../modules/database/entities/card/CardCatalogVersionEntity";
import { CardEntity } from "../../modules/database/entities/card/CardEntity";
import { CardLocalizationEntity } from "../../modules/database/entities/card/CardLocalizationEntity";
import { CardOperationalFlagEntity } from "../../modules/database/entities/card/CardOperationalFlagEntity";
import { DareTypeEntity } from "../../modules/database/entities/card/DareTypeEntity";
import { DareTypeTranslationEntity } from "../../modules/database/entities/card/DareTypeTranslationEntity";
import { LocaleEntity } from "../../modules/database/entities/card/LocaleEntity";
import { QuestionCategoryEntity } from "../../modules/database/entities/card/QuestionCategoryEntity";
import { QuestionCategoryTranslationEntity } from "../../modules/database/entities/card/QuestionCategoryTranslationEntity";
import { DataSpaceGameSettingsEntity } from "../../modules/database/entities/game/DataSpaceGameSettingsEntity";
import { GroupEntity } from "../../modules/database/entities/game/GroupEntity";
import { resolveProducerCardMetadata } from "../card-catalog-contract";

export type CardCatalogApplyResult = "APPLIED" | "UNCHANGED" | "NEWER_INSTALLED";
const CATALOG_LOCK_NAME = "game_card_catalog_apply_v1";
const DEVELOPMENT_FIXTURE_VERSION_PREFIX = "development-fixture";
const DATABASE_BATCH_SIZE = 250;

export function isDevelopmentCardCatalogVersion(catalogVersion: string): boolean {
    return catalogVersion.startsWith(DEVELOPMENT_FIXTURE_VERSION_PREFIX);
}

function isCatalogLineageReplacement(
    installed: CardCatalogVersionEntity | null,
    artifact: ValidatedCardCatalogArtifact,
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
    const type = queryRunner.connection.options.type;
    if (type !== "mariadb" && type !== "mysql") return;
    const rows = (await queryRunner.query("SELECT GET_LOCK(?, 30) AS acquired", [
        CATALOG_LOCK_NAME,
    ])) as Array<{ acquired: number | string | null }>;
    if (Number(rows[0]?.acquired) !== 1) throw new Error("Could not acquire Card catalog lock");
}

async function releaseCatalogLock(queryRunner: QueryRunner): Promise<void> {
    const type = queryRunner.connection.options.type;
    if (type !== "mariadb" && type !== "mysql") return;
    await queryRunner.query("SELECT RELEASE_LOCK(?)", [CATALOG_LOCK_NAME]);
}

async function decide(
    manager: EntityManager,
    artifact: ValidatedCardCatalogArtifact,
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
    const reusedVersion = releases.find(
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
    artifact: ValidatedCardCatalogArtifact,
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

async function reconcileLocales(
    manager: EntityManager,
    artifact: ValidatedCardCatalogArtifact,
): Promise<void> {
    const repository = manager.getRepository(LocaleEntity);
    const incoming = new Set(artifact.catalog.locales.map((locale) => locale.id));
    for (const stored of await repository.find()) {
        if (!incoming.has(stored.id)) {
            await repository.update({ id: stored.id }, { active: false, isDefault: false });
        }
    }
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
    artifact: ValidatedCardCatalogArtifact,
): Promise<void> {
    const activeLocales = new Set(
        artifact.catalog.locales.filter(({ active }) => active).map(({ id }) => id),
    );
    const settings = manager.getRepository(DataSpaceGameSettingsEntity);
    for (const stored of await settings.find()) {
        const normalized = availableSavedCardLanguages(
            stored.cardLanguageSettingsJson,
            activeLocales,
        );
        if (normalized !== stored.cardLanguageSettingsJson) {
            await settings.update(
                { dataSpaceId: stored.dataSpaceId },
                { cardLanguageSettingsJson: normalized },
            );
        }
    }
    const groups = manager.getRepository(GroupEntity);
    for (const stored of await groups.find()) {
        const normalized = availableSavedCardLanguages(
            stored.cardLanguageSettingsJson,
            activeLocales,
        );
        if (normalized !== stored.cardLanguageSettingsJson) {
            await groups.update({ id: stored.id }, { cardLanguageSettingsJson: normalized });
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
    artifact: ValidatedCardCatalogArtifact,
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

async function reconcileCards(
    manager: EntityManager,
    artifact: ValidatedCardCatalogArtifact,
): Promise<void> {
    const cards = manager.getRepository(CardEntity);
    const localizations = manager.getRepository(CardLocalizationEntity);
    const flags = manager.getRepository(CardOperationalFlagEntity);
    const incomingCardIds = new Set(artifact.catalog.cards.map((card) => card.id));
    for (const stored of await cards.find({ select: { id: true } })) {
        if (!incomingCardIds.has(stored.id))
            await cards.update({ id: stored.id }, { active: false });
    }
    const updatedAt = new Date();
    const cardRows = artifact.catalog.cards.map((card) => {
        const producerMetadata = resolveProducerCardMetadata(artifact.catalog, card);
        return {
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
            ...producerMetadata,
            active: card.lifecycle === "ACTIVE",
        };
    });
    for (const batch of batches(cardRows)) await cards.upsert(batch, ["id"]);

    const incomingIds = [...incomingCardIds];
    for (const batch of batches(incomingIds)) {
        await flags.delete({ cardId: In(batch) });
        await localizations.update({ cardId: In(batch) }, { active: false, updatedAt });
    }
    const flagRows = artifact.catalog.cards.flatMap((card) =>
        card.operationalFlags.map((flag) => ({ cardId: card.id, flag })),
    );
    for (const batch of batches(flagRows)) await flags.insert(batch);
    const localizationRows = artifact.catalog.cards.flatMap((card) =>
        card.localizations.map((localization) => ({
            cardId: card.id,
            locale: localization.locale,
            text: localization.text,
            active: true,
            updatedAt,
        })),
    );
    for (const batch of batches(localizationRows)) {
        await localizations.upsert(batch, ["cardId", "locale"]);
    }
}

async function assertConsistent(manager: EntityManager, defaultLocale: string): Promise<void> {
    const defaults = await manager.getRepository(LocaleEntity).countBy({
        active: true,
        isDefault: true,
    });
    if (defaults !== 1)
        throw new Error(`Card catalog requires one active default locale; found ${defaults}`);
    const activeCards = await manager.getRepository(CardEntity).find({
        where: { active: true },
        select: { id: true },
    });
    const localizedCardIds = new Set(
        (
            await manager.getRepository(CardLocalizationEntity).find({
                where: { locale: defaultLocale, active: true },
                select: { cardId: true },
            })
        ).map(({ cardId }) => cardId),
    );
    for (const card of activeCards) {
        if (!localizedCardIds.has(card.id)) {
            throw new Error(`Active Card ${card.id} lacks default-locale content`);
        }
    }
}

export async function applyCardCatalogSnapshot(
    dataSource: DataSource,
    artifact: ValidatedCardCatalogArtifact,
): Promise<CardCatalogApplyResult> {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    let lockAcquired = false;
    try {
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
                await queryRunner.commitTransaction();
                return decision;
            }
            await reconcileLocales(queryRunner.manager, artifact);
            await reconcileSavedCardLanguages(queryRunner.manager, artifact);
            await reconcileTaxonomies(queryRunner.manager, artifact);
            await reconcileCards(queryRunner.manager, artifact);
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
                cardCount: artifact.catalog.cards.length,
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
