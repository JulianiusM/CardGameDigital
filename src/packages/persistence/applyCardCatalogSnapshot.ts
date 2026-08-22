import type { DataSource, EntityManager, QueryRunner } from "typeorm";
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

export type CardCatalogApplyResult = "APPLIED" | "UNCHANGED" | "NEWER_INSTALLED";
const CATALOG_LOCK_NAME = "game_card_catalog_apply_v1";

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
    const installed = await versions.findOne({
        where: { catalogId: artifact.catalog.catalogId },
        order: { sequence: "DESC" },
    });
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
    const reusedVersion = await versions.findOneBy({
        catalogId: artifact.catalog.catalogId,
        catalogVersion: artifact.catalog.catalogVersion,
    });
    if (reusedVersion) {
        throw new Error(
            `Immutable Card catalog version '${artifact.catalog.catalogVersion}' was reused`,
        );
    }
    return null;
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

async function reconcileTaxonomies(
    manager: EntityManager,
    artifact: ValidatedCardCatalogArtifact,
): Promise<void> {
    const categories = manager.getRepository(QuestionCategoryEntity);
    const categoryLocalizations = manager.getRepository(QuestionCategoryTranslationEntity);
    for (const category of artifact.catalog.questionCategories) {
        await categories.upsert({ id: category.id }, ["id"]);
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
    for (const dareType of artifact.catalog.dareTypes) {
        await dareTypes.upsert({ id: dareType.id }, ["id"]);
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
    for (const card of artifact.catalog.cards) {
        await cards.upsert(
            {
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
                active: card.lifecycle === "ACTIVE",
            },
            ["id"],
        );
        await flags.delete({ cardId: card.id });
        if (card.operationalFlags.length) {
            await flags.insert(card.operationalFlags.map((flag) => ({ cardId: card.id, flag })));
        }
        const incomingLocales = new Set(card.localizations.map((item) => item.locale));
        for (const stored of await localizations.findBy({ cardId: card.id })) {
            if (!incomingLocales.has(stored.locale)) {
                await localizations.update(
                    { cardId: card.id, locale: stored.locale },
                    { active: false, updatedAt },
                );
            }
        }
        for (const localization of card.localizations) {
            await localizations.upsert(
                {
                    cardId: card.id,
                    locale: localization.locale,
                    text: localization.text,
                    active: true,
                    updatedAt,
                },
                ["cardId", "locale"],
            );
        }
    }
}

async function assertConsistent(manager: EntityManager, defaultLocale: string): Promise<void> {
    const defaults = await manager.getRepository(LocaleEntity).countBy({
        active: true,
        isDefault: true,
    });
    if (defaults !== 1)
        throw new Error(`Card catalog requires one active default locale; found ${defaults}`);
    const activeCards = await manager.getRepository(CardEntity).findBy({ active: true });
    for (const card of activeCards) {
        const localization = await manager.getRepository(CardLocalizationEntity).findOneBy({
            cardId: card.id,
            locale: defaultLocale,
            active: true,
        });
        if (!localization) throw new Error(`Active Card ${card.id} lacks default-locale content`);
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
            const decision = await decide(queryRunner.manager, artifact);
            if (decision) {
                await queryRunner.rollbackTransaction();
                return decision;
            }
            await reconcileLocales(queryRunner.manager, artifact);
            await reconcileTaxonomies(queryRunner.manager, artifact);
            await reconcileCards(queryRunner.manager, artifact);
            await assertConsistent(queryRunner.manager, artifact.catalog.defaultLocale);
            await queryRunner.manager.getRepository(CardCatalogVersionEntity).insert({
                catalogId: artifact.catalog.catalogId,
                sequence: artifact.catalog.sequence,
                catalogVersion: artifact.catalog.catalogVersion,
                artifactDigest: artifact.artifactDigest,
                generatedAt: new Date(artifact.catalog.generatedAt),
                appliedAt: new Date(),
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
