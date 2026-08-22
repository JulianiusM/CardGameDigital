import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DataSource, EntityManager } from "typeorm";
import { CardCatalogVersionEntity } from "../../modules/database/entities/card/CardCatalogVersionEntity";
import { CardEntity } from "../../modules/database/entities/card/CardEntity";
import { CardOperationalFlagEntity } from "../../modules/database/entities/card/CardOperationalFlagEntity";
import { CardSourceEntity } from "../../modules/database/entities/card/CardSourceEntity";
import { CardTranslationEntity } from "../../modules/database/entities/card/CardTranslationEntity";
import { LocaleEntity } from "../../modules/database/entities/card/LocaleEntity";
import { RawCardImportEntity } from "../../modules/database/entities/card/RawCardImportEntity";
import type { CardCatalog, ImportIssue, NormalizedCard } from "../../tooling/card-import/normalize";
import { CARD_TYPES, DARE_TYPES, OPERATIONAL_FLAGS, QUESTION_CATEGORIES } from "../game-core";

const questionCategorySchema = z.enum(Object.values(QUESTION_CATEGORIES) as [string, ...string[]]);
const dareTypeSchema = z.enum(Object.values(DARE_TYPES) as [string, ...string[]]);
const normalizedCardSchema = z
    .object({
        sourceId: z.string().min(1),
        origin: z.string().min(1),
        originCategory: z.string().nullable(),
        sourceTranslation: z
            .object({
                locale: z.string().min(2).max(35),
                text: z.string().min(1),
                revision: z.number().int().positive(),
                contentHash: z.string().regex(/^[a-f0-9]{64}$/),
                status: z.literal("PUBLISHED"),
            })
            .strict(),
        cardType: z.enum(Object.values(CARD_TYPES) as [string, ...string[]]),
        yesNoAnswerPossible: z.boolean(),
        questionCategoryId: questionCategorySchema.nullable(),
        dareTypeId: dareTypeSchema.nullable(),
        dareAffinityCategoryId: questionCategorySchema.nullable(),
        intensity: z.number().int().min(1).max(5),
        alwaysEligible: z.boolean(),
        repeatableInSession: z.boolean(),
        repeatCooldown: z.number().int().nonnegative(),
        weight: z.number().positive(),
        active: z.boolean(),
        operationalFlags: z.array(
            z.enum(Object.values(OPERATIONAL_FLAGS) as [string, ...string[]]),
        ),
    })
    .strict()
    .superRefine((card, context) => {
        if (
            card.cardType === CARD_TYPES.QUESTION &&
            (!card.questionCategoryId || card.dareTypeId || card.dareAffinityCategoryId)
        ) {
            context.addIssue({ code: "custom", message: "Question taxonomy is inconsistent" });
        }
        if (card.cardType === CARD_TYPES.DARE && (card.questionCategoryId || !card.dareTypeId)) {
            context.addIssue({ code: "custom", message: "Dare taxonomy is inconsistent" });
        }
        if (card.cardType === CARD_TYPES.CONVERSATION && card.dareTypeId) {
            context.addIssue({
                code: "custom",
                message: "Conversation cards cannot have a DareType",
            });
        }
        if (new Set(card.operationalFlags).size !== card.operationalFlags.length) {
            context.addIssue({ code: "custom", message: "Operational flags must be unique" });
        }
    });

const catalogBoundarySchema = z
    .object({
        schemaVersion: z.literal(2),
        catalogVersion: z.string().min(1),
        generatedAt: z.iso.datetime(),
        sourceName: z.string().min(1),
        sourceLocale: z.string().min(2).max(35),
        sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
        rawCards: z.array(z.unknown()),
        cards: z.array(normalizedCardSchema),
        rejectedRawCards: z.array(z.unknown()),
        issues: z.array(z.object({ severity: z.enum(["ERROR", "WARNING"]) }).passthrough()),
    })
    .passthrough();

function sourceIdentifier(raw: unknown, index: number): string {
    const value = (raw as { ID?: unknown })?.ID;
    return typeof value === "string" || typeof value === "number"
        ? String(value)
        : `row-${index + 1}`;
}

async function resolveCardId(
    manager: EntityManager,
    sourceNamespace: string,
    card: NormalizedCard,
    newCardId: string,
): Promise<string> {
    const sources = manager.getRepository(CardSourceEntity);
    const existing = await sources.findOneBy({ sourceNamespace, sourceId: card.sourceId });
    if (existing) return existing.cardId;
    await sources.save(
        sources.create({
            sourceNamespace,
            sourceId: card.sourceId,
            cardId: newCardId,
            origin: card.origin,
            originCategory: card.originCategory,
        }),
    );
    return newCardId;
}

async function reconcileTranslation(
    manager: EntityManager,
    cardId: string,
    card: NormalizedCard,
): Promise<void> {
    const translations = manager.getRepository(CardTranslationEntity);
    const incoming = card.sourceTranslation;
    const existing = await translations.findOneBy({ cardId, locale: incoming.locale });
    const changed = existing?.contentHash !== incoming.contentHash;
    const revision = changed
        ? Math.max(incoming.revision, (existing?.revision ?? 0) + 1)
        : Math.max(incoming.revision, existing?.revision ?? 0);
    if (changed && existing) {
        await translations
            .createQueryBuilder()
            .update()
            .set({ status: "STALE" })
            .where("card_id = :cardId", { cardId })
            .andWhere("locale != :locale", { locale: incoming.locale })
            .andWhere("source_revision < :revision", { revision })
            .execute();
    }
    await translations.upsert(
        {
            cardId,
            locale: incoming.locale,
            text: incoming.text,
            status: incoming.status,
            revision,
            sourceRevision: revision,
            contentHash: incoming.contentHash,
            updatedAt: new Date(),
        },
        ["cardId", "locale"],
    );
}

async function retireMissingCards(
    manager: EntityManager,
    sourceNamespace: string,
    importedSourceIds: readonly string[],
): Promise<void> {
    const sources = await manager.getRepository(CardSourceEntity).findBy({ sourceNamespace });
    const imported = new Set(importedSourceIds);
    const retiredIds = sources
        .filter((source) => !imported.has(source.sourceId))
        .map((source) => source.cardId);
    if (retiredIds.length) {
        await manager
            .getRepository(CardEntity)
            .createQueryBuilder()
            .update()
            .set({ active: false })
            .whereInIds(retiredIds)
            .execute();
    }
}

export async function applyCardCatalog(
    dataSource: DataSource,
    untrustedCatalog: unknown,
    options: { allowErrors?: boolean } = {},
): Promise<void> {
    const catalog = catalogBoundarySchema.parse(untrustedCatalog) as unknown as CardCatalog;
    if (catalog.cards.some((card) => card.sourceTranslation.locale !== catalog.sourceLocale)) {
        throw new Error("Catalog source translation locale does not match sourceLocale");
    }
    const errors = catalog.issues.filter((entry) => entry.severity === "ERROR");
    if (errors.length && !options.allowErrors)
        throw new Error(`Catalog contains ${errors.length} validation errors`);

    await dataSource.transaction(async (manager) => {
        await manager
            .getRepository(LocaleEntity)
            .upsert({ id: catalog.sourceLocale, displayName: catalog.sourceLocale, active: true }, [
                "id",
            ]);
        await manager.getRepository(CardCatalogVersionEntity).upsert(
            {
                catalogVersion: catalog.catalogVersion,
                schemaVersion: catalog.schemaVersion,
                sourceName: catalog.sourceName,
                sourceDigest: catalog.sourceDigest,
                generatedAt: new Date(catalog.generatedAt),
                appliedAt: new Date(),
            },
            ["catalogVersion"],
        );

        const issuesBySource = new Map<string, ImportIssue[]>();
        for (const entry of catalog.issues) {
            const list = issuesBySource.get(entry.sourceIdentifier) ?? [];
            list.push(entry);
            issuesBySource.set(entry.sourceIdentifier, list);
        }
        const rawImports = manager.getRepository(RawCardImportEntity);
        await rawImports.delete({ catalogVersion: catalog.catalogVersion });
        for (const [index, raw] of catalog.rawCards.entries()) {
            const identifier = sourceIdentifier(raw, index);
            const recordIssues = issuesBySource.get(identifier) ?? [];
            let validationStatus: RawCardImportEntity["validationStatus"] = "VALID";
            if (recordIssues.some((entry) => entry.severity === "ERROR"))
                validationStatus = "ERROR";
            else if (recordIssues.length) validationStatus = "WARNING";
            await rawImports.save(
                rawImports.create({
                    catalogVersion: catalog.catalogVersion,
                    sourceName: catalog.sourceName,
                    sourceIdentifier: identifier,
                    rawPayloadJson: JSON.stringify(raw),
                    validationStatus,
                    issuesJson: JSON.stringify(recordIssues),
                }),
            );
        }

        const cards = manager.getRepository(CardEntity);
        const flags = manager.getRepository(CardOperationalFlagEntity);
        for (const card of catalog.cards) {
            const existingSource = await manager.getRepository(CardSourceEntity).findOneBy({
                sourceNamespace: catalog.sourceName,
                sourceId: card.sourceId,
            });
            const cardId = existingSource?.cardId ?? randomUUID();
            await cards.upsert(
                {
                    id: cardId,
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
                    active: card.active,
                },
                ["id"],
            );
            const resolvedId = await resolveCardId(manager, catalog.sourceName, card, cardId);
            if (resolvedId !== cardId)
                throw new Error("Card source identity changed during reconciliation");
            await manager
                .getRepository(CardSourceEntity)
                .update(
                    { sourceNamespace: catalog.sourceName, sourceId: card.sourceId },
                    { origin: card.origin, originCategory: card.originCategory },
                );
            await reconcileTranslation(manager, cardId, card);
            await flags.delete({ cardId });
            if (card.operationalFlags.length) {
                await flags.insert(card.operationalFlags.map((flag) => ({ cardId, flag })));
            }
        }
        await retireMissingCards(
            manager,
            catalog.sourceName,
            catalog.rawCards.map((raw, index) => sourceIdentifier(raw, index)),
        );
    });
}
