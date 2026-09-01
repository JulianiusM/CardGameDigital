import { randomUUID } from "node:crypto";
import { In, type DataSource, type SelectQueryBuilder } from "typeorm";
import { CardCatalogVersionEntity } from "../../modules/database/entities/card/CardCatalogVersionEntity";
import { CardEntity } from "../../modules/database/entities/card/CardEntity";
import { DareTypeTranslationEntity } from "../../modules/database/entities/card/DareTypeTranslationEntity";
import { QuestionCategoryTranslationEntity } from "../../modules/database/entities/card/QuestionCategoryTranslationEntity";
import { CardPolicyConditionalRuleEntity } from "../../modules/database/entities/game/CardPolicyConditionalRuleEntity";
import { CardPolicyExactCardEntity } from "../../modules/database/entities/game/CardPolicyExactCardEntity";
import { CardPolicyScopeDefaultEntity } from "../../modules/database/entities/game/CardPolicyScopeDefaultEntity";
import type {
    CardPolicyOwner,
    CardPolicyRepository,
    ManagedCardSearch,
    ManagedCatalogCard,
    PortableCardPolicyScope,
    StoredCardPolicyScope,
    StoredExactCardPolicy,
    StoredPolicyDefault,
    StoredPolicyRule,
} from "../application/cardPolicyRepository";
import type { CardPolicyDirectives, CardPolicyPredicate } from "../game-core";
import { cardEntityToDomain } from "./cardMapper";

function conflict(): never {
    throw Object.assign(new Error("Card policy changed in another tab"), {
        code: "POLICY_REVISION_CONFLICT",
        status: 409,
    });
}

function parse<T>(json: string): T {
    return JSON.parse(json) as T;
}

export class TypeOrmCardPolicyRepository implements CardPolicyRepository {
    constructor(private readonly dataSource: DataSource) {}

    async load(owner: CardPolicyOwner): Promise<StoredCardPolicyScope> {
        const [scopeDefault, rules, exactCards] = await Promise.all([
            this.dataSource
                .getRepository(CardPolicyScopeDefaultEntity)
                .findOneBy({ ownerKey: owner.ownerKey }),
            this.dataSource.getRepository(CardPolicyConditionalRuleEntity).find({
                where: { ownerKey: owner.ownerKey },
                order: { ruleOrder: "ASC", id: "ASC" },
            }),
            this.dataSource.getRepository(CardPolicyExactCardEntity).find({
                where: { ownerKey: owner.ownerKey },
                order: { cardId: "ASC" },
            }),
        ]);
        return {
            owner,
            scopeDefault: scopeDefault
                ? this.projectDefault(scopeDefault)
                : { directives: {}, revision: 0 },
            rules: rules.map((rule) => this.projectRule(rule)),
            exactCards: exactCards.map((entry) => this.projectExact(entry)),
        };
    }

    async putDefault(
        owner: CardPolicyOwner,
        directives: CardPolicyDirectives,
        expectedRevision: number,
    ): Promise<StoredPolicyDefault> {
        return this.dataSource.transaction(async (manager) => {
            const repository = manager.getRepository(CardPolicyScopeDefaultEntity);
            const current = await repository.findOneBy({ ownerKey: owner.ownerKey });
            if ((current?.revision ?? 0) !== expectedRevision) conflict();
            const now = new Date();
            const saved = await repository.save(
                repository.create({
                    ownerKey: owner.ownerKey,
                    dataSpaceId: owner.dataSpaceId,
                    groupId: owner.groupId,
                    directivesJson: JSON.stringify(directives),
                    revision: expectedRevision + 1,
                    createdAt: current?.createdAt ?? now,
                    updatedAt: now,
                }),
            );
            return this.projectDefault(saved);
        });
    }

    async createRule(
        owner: CardPolicyOwner,
        input: {
            name: string;
            enabled: boolean;
            predicate: CardPolicyPredicate;
            directives: CardPolicyDirectives;
        },
    ): Promise<StoredPolicyRule> {
        return this.dataSource.transaction(async (manager) => {
            const repository = manager.getRepository(CardPolicyConditionalRuleEntity);
            const highest = await repository.findOne({
                where: { ownerKey: owner.ownerKey },
                order: { ruleOrder: "DESC" },
            });
            const now = new Date();
            return this.projectRule(
                await repository.save(
                    repository.create({
                        id: randomUUID(),
                        ownerKey: owner.ownerKey,
                        dataSpaceId: owner.dataSpaceId,
                        groupId: owner.groupId,
                        name: input.name,
                        ruleOrder: (highest?.ruleOrder ?? 0) + 10,
                        enabled: input.enabled,
                        predicateJson: JSON.stringify(input.predicate),
                        directivesJson: JSON.stringify(input.directives),
                        revision: 1,
                        createdAt: now,
                        updatedAt: now,
                    }),
                ),
            );
        });
    }

    async updateRule(
        owner: CardPolicyOwner,
        id: string,
        input: {
            name: string;
            enabled: boolean;
            predicate: CardPolicyPredicate;
            directives: CardPolicyDirectives;
        },
        expectedRevision: number,
    ): Promise<StoredPolicyRule | null> {
        const repository = this.dataSource.getRepository(CardPolicyConditionalRuleEntity);
        const current = await repository.findOneBy({ id, ownerKey: owner.ownerKey });
        if (!current) return null;
        if (current.revision !== expectedRevision) conflict();
        current.name = input.name;
        current.enabled = input.enabled;
        current.predicateJson = JSON.stringify(input.predicate);
        current.directivesJson = JSON.stringify(input.directives);
        current.revision++;
        current.updatedAt = new Date();
        return this.projectRule(await repository.save(current));
    }

    async deleteRule(
        owner: CardPolicyOwner,
        id: string,
        expectedRevision: number,
    ): Promise<boolean> {
        const repository = this.dataSource.getRepository(CardPolicyConditionalRuleEntity);
        const current = await repository.findOneBy({ id, ownerKey: owner.ownerKey });
        if (!current) return false;
        if (current.revision !== expectedRevision) conflict();
        await repository.delete({ id, ownerKey: owner.ownerKey });
        return true;
    }

    async reorderRules(
        owner: CardPolicyOwner,
        ids: readonly string[],
    ): Promise<readonly StoredPolicyRule[]> {
        return this.dataSource.transaction(async (manager) => {
            const repository = manager.getRepository(CardPolicyConditionalRuleEntity);
            const rules = await repository.findBy({ ownerKey: owner.ownerKey });
            if (
                rules.length !== ids.length ||
                rules.some(({ id }) => !ids.includes(id)) ||
                new Set(ids).size !== ids.length
            ) {
                throw Object.assign(new Error("Rule order must contain every scoped rule once"), {
                    code: "VALIDATION_ERROR",
                    status: 400,
                });
            }
            for (const [index, rule] of rules.entries()) {
                rule.ruleOrder = -1000 - index;
            }
            await repository.save(rules);
            const byId = new Map(rules.map((rule) => [rule.id, rule]));
            for (const [index, id] of ids.entries()) {
                const rule = byId.get(id)!;
                rule.ruleOrder = (index + 1) * 10;
                rule.revision++;
                rule.updatedAt = new Date();
            }
            return (await repository.save(ids.map((id) => byId.get(id)!))).map((rule) =>
                this.projectRule(rule),
            );
        });
    }

    async putExactCard(
        owner: CardPolicyOwner,
        cardId: string,
        directives: CardPolicyDirectives,
        expectedRevision: number,
    ): Promise<StoredExactCardPolicy | null> {
        return this.dataSource.transaction(async (manager) => {
            if (!(await manager.getRepository(CardEntity).existsBy({ id: cardId }))) return null;
            const repository = manager.getRepository(CardPolicyExactCardEntity);
            const current = await repository.findOneBy({ ownerKey: owner.ownerKey, cardId });
            if ((current?.revision ?? 0) !== expectedRevision) conflict();
            const now = new Date();
            const saved = await repository.save(
                repository.create({
                    id: current?.id ?? randomUUID(),
                    ownerKey: owner.ownerKey,
                    dataSpaceId: owner.dataSpaceId,
                    groupId: owner.groupId,
                    cardId,
                    directivesJson: JSON.stringify(directives),
                    revision: expectedRevision + 1,
                    createdAt: current?.createdAt ?? now,
                    updatedAt: now,
                }),
            );
            return this.projectExact(saved);
        });
    }

    async deleteExactCard(
        owner: CardPolicyOwner,
        cardId: string,
        expectedRevision: number,
    ): Promise<boolean> {
        const repository = this.dataSource.getRepository(CardPolicyExactCardEntity);
        const current = await repository.findOneBy({ ownerKey: owner.ownerKey, cardId });
        if (!current) return false;
        if (current.revision !== expectedRevision) conflict();
        await repository.delete({ id: current.id });
        return true;
    }

    async replaceScope(owner: CardPolicyOwner, input: PortableCardPolicyScope): Promise<void> {
        await this.dataSource.transaction(async (manager) => {
            const cardIds = input.exactCards.map(({ cardId }) => cardId);
            let existingCardCount = 0;
            for (let index = 0; index < cardIds.length; index += 500) {
                existingCardCount += await manager.getRepository(CardEntity).countBy({
                    id: In(cardIds.slice(index, index + 500)),
                });
            }
            if (existingCardCount !== cardIds.length) {
                throw Object.assign(new Error("Imported Card policy references an unknown Card"), {
                    code: "CARD_NOT_FOUND",
                    status: 400,
                });
            }

            await manager.getRepository(CardPolicyExactCardEntity).delete({
                ownerKey: owner.ownerKey,
            });
            await manager.getRepository(CardPolicyConditionalRuleEntity).delete({
                ownerKey: owner.ownerKey,
            });
            await manager.getRepository(CardPolicyScopeDefaultEntity).delete({
                ownerKey: owner.ownerKey,
            });

            const now = new Date();
            await manager.getRepository(CardPolicyScopeDefaultEntity).insert({
                ownerKey: owner.ownerKey,
                dataSpaceId: owner.dataSpaceId,
                groupId: owner.groupId,
                directivesJson: JSON.stringify(input.scopeDefault),
                revision: 1,
                createdAt: now,
                updatedAt: now,
            });
            if (input.rules.length) {
                await manager.getRepository(CardPolicyConditionalRuleEntity).insert(
                    input.rules.map((rule, index) => ({
                        id: randomUUID(),
                        ownerKey: owner.ownerKey,
                        dataSpaceId: owner.dataSpaceId,
                        groupId: owner.groupId,
                        name: rule.name,
                        ruleOrder: (index + 1) * 10,
                        enabled: rule.enabled,
                        predicateJson: JSON.stringify(rule.predicate),
                        directivesJson: JSON.stringify(rule.directives),
                        revision: 1,
                        createdAt: now,
                        updatedAt: now,
                    })),
                );
            }
            if (input.exactCards.length) {
                for (let index = 0; index < input.exactCards.length; index += 500) {
                    await manager.getRepository(CardPolicyExactCardEntity).insert(
                        input.exactCards.slice(index, index + 500).map((entry) => ({
                            id: randomUUID(),
                            ownerKey: owner.ownerKey,
                            dataSpaceId: owner.dataSpaceId,
                            groupId: owner.groupId,
                            cardId: entry.cardId,
                            directivesJson: JSON.stringify(entry.directives),
                            revision: 1,
                            createdAt: now,
                            updatedAt: now,
                        })),
                    );
                }
            }
        });
    }

    async listMatchingCardIds(
        search: Omit<ManagedCardSearch, "cursor" | "limit">,
    ): Promise<string[]> {
        const rows = await this.cardSearchQuery({ ...search, limit: 1 })
            .select("card.id", "id")
            .distinct(true)
            .orderBy("card.id", "ASC")
            .getRawMany<{ id: string }>();
        return rows.map(({ id }) => id);
    }

    async putExactCards(
        owner: CardPolicyOwner,
        cardIds: readonly string[],
        directives: CardPolicyDirectives,
    ): Promise<number> {
        await this.dataSource.transaction(async (manager) => {
            const repository = manager.getRepository(CardPolicyExactCardEntity);
            for (let index = 0; index < cardIds.length; index += 500) {
                const ids = cardIds.slice(index, index + 500);
                const existing = await repository.findBy({
                    ownerKey: owner.ownerKey,
                    cardId: In(ids),
                });
                const byCardId = new Map(existing.map((entry) => [entry.cardId, entry]));
                const now = new Date();
                await repository.save(
                    ids.map((cardId) => {
                        const current = byCardId.get(cardId);
                        return repository.create({
                            id: current?.id ?? randomUUID(),
                            ownerKey: owner.ownerKey,
                            dataSpaceId: owner.dataSpaceId,
                            groupId: owner.groupId,
                            cardId,
                            directivesJson: JSON.stringify(directives),
                            revision: (current?.revision ?? 0) + 1,
                            createdAt: current?.createdAt ?? now,
                            updatedAt: now,
                        });
                    }),
                );
            }
        });
        return cardIds.length;
    }

    async searchCards(search: ManagedCardSearch) {
        const completeSearch = { ...search, cursor: undefined };
        const total = await this.cardSearchQuery(completeSearch).getCount();
        const entities = await this.cardSearchQuery(search)
            .orderBy("card.id", "ASC")
            .take(search.limit + 1)
            .getMany();
        const hasMore = entities.length > search.limit;
        const selected = entities.slice(0, search.limit);
        const labels = await this.taxonomyLabels(selected, search.locale);
        return {
            cards: selected.map((card) => this.toManagedCard(card, search.locale, labels)),
            total,
            nextCursor: hasMore ? (selected.at(-1)?.id ?? null) : null,
        };
    }

    async listPolicyCards(locale: string): Promise<readonly ManagedCatalogCard[]> {
        const entities = await this.cardSearchQuery({ locale, limit: 1 }).getMany();
        const labels = await this.taxonomyLabels(entities, locale);
        return entities.map((card) => this.toManagedCard(card, locale, labels));
    }

    async catalogProvenance() {
        const version = await this.dataSource.getRepository(CardCatalogVersionEntity).findOne({
            where: {},
            order: { appliedAt: "DESC", sequence: "DESC" },
        });
        if (!version) throw new Error("No Card catalog version is installed");
        return {
            catalogId: version.catalogId,
            sequence: version.sequence,
            catalogVersion: version.catalogVersion,
            contract: version.contract,
            artifactDigest: version.artifactDigest,
        };
    }

    private cardSearchQuery(search: ManagedCardSearch): SelectQueryBuilder<CardEntity> {
        const query = this.dataSource
            .getRepository(CardEntity)
            .createQueryBuilder("card")
            .leftJoinAndSelect("card.flags", "flag")
            .innerJoinAndSelect(
                "card.localizations",
                "localization",
                "localization.locale = :locale AND localization.active = :localizationActive",
                { locale: search.locale, localizationActive: true },
            );
        if (search.cursor) query.andWhere("card.id > :cursor", { cursor: search.cursor });
        if (search.query?.trim()) {
            query.andWhere("LOWER(localization.text) LIKE :text", {
                text: `%${search.query.trim().toLocaleLowerCase()}%`,
            });
        }
        if (search.cardType) query.andWhere("card.cardType = :cardType", search);
        if (search.questionCategoryId)
            query.andWhere("card.questionCategoryId = :questionCategoryId", search);
        if (search.dareTypeId) query.andWhere("card.dareTypeId = :dareTypeId", search);
        if (search.socialSensitivity)
            query.andWhere("card.socialSensitivity = :socialSensitivity", search);
        if (search.operationalFlag) {
            query.innerJoin(
                "card.flags",
                "matchingFlag",
                "matchingFlag.flag = :operationalFlag",
                search,
            );
        }
        if (search.yesNoAnswerPossible !== undefined) {
            query.andWhere("card.yesNoAnswerPossible = :yesNoAnswerPossible", search);
        }
        if (search.playerCount !== undefined) {
            query
                .andWhere("card.minimumPlayerCount <= :playerCount", search)
                .andWhere(
                    "(card.maximumPlayerCount IS NULL OR card.maximumPlayerCount >= :playerCount)",
                    search,
                );
        }
        if (search.lifecycle)
            query.andWhere("card.active = :lifecycleActive", {
                lifecycleActive: search.lifecycle === "ACTIVE",
            });
        return query;
    }

    private async taxonomyLabels(cards: readonly CardEntity[], locale: string) {
        const categoryIds = [
            ...new Set(
                cards.flatMap((card) =>
                    [card.questionCategoryId, card.dareAffinityCategoryId].filter(
                        (id): id is string => Boolean(id),
                    ),
                ),
            ),
        ];
        const dareTypeIds = [
            ...new Set(cards.flatMap((card) => (card.dareTypeId ? [card.dareTypeId] : []))),
        ];
        const [categories, dareTypes] = await Promise.all([
            categoryIds.length
                ? this.dataSource
                      .getRepository(QuestionCategoryTranslationEntity)
                      .findBy(categoryIds.map((categoryId) => ({ categoryId, locale })))
                : [],
            dareTypeIds.length
                ? this.dataSource
                      .getRepository(DareTypeTranslationEntity)
                      .findBy(dareTypeIds.map((dareTypeId) => ({ dareTypeId, locale })))
                : [],
        ]);
        return {
            categories: new Map(categories.map((entry) => [entry.categoryId, entry.label])),
            dareTypes: new Map(dareTypes.map((entry) => [entry.dareTypeId, entry.label])),
        };
    }

    private toManagedCard(
        entity: CardEntity,
        locale: string,
        labels: { categories: ReadonlyMap<string, string>; dareTypes: ReadonlyMap<string, string> },
    ): ManagedCatalogCard {
        const localization = entity.localizations.find((entry) => entry.locale === locale);
        if (!localization) throw new Error("Managed Card lacks requested localization");
        const card = cardEntityToDomain(entity, localization);
        return {
            ...card,
            lifecycle: entity.active ? "ACTIVE" : "RETIRED",
            taxonomyLabel: entity.questionCategoryId
                ? (labels.categories.get(entity.questionCategoryId) ?? entity.questionCategoryId)
                : entity.dareTypeId
                  ? (labels.dareTypes.get(entity.dareTypeId) ?? entity.dareTypeId)
                  : null,
        };
    }

    private projectDefault(entity: CardPolicyScopeDefaultEntity): StoredPolicyDefault {
        return { directives: parse(entity.directivesJson), revision: entity.revision };
    }

    private projectRule(entity: CardPolicyConditionalRuleEntity): StoredPolicyRule {
        return {
            id: entity.id,
            name: entity.name,
            order: entity.ruleOrder,
            enabled: entity.enabled,
            predicate: parse(entity.predicateJson),
            directives: parse(entity.directivesJson),
            revision: entity.revision,
        };
    }

    private projectExact(entity: CardPolicyExactCardEntity): StoredExactCardPolicy {
        return {
            cardId: entity.cardId,
            directives: parse(entity.directivesJson),
            revision: entity.revision,
        };
    }
}
