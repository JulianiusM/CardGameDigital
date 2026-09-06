import { MESSAGE_KEYS, type MessageKey } from "../localization/keys";
import { randomUUID } from "node:crypto";
import { In, type DataSource, type EntityManager, type SelectQueryBuilder } from "typeorm";
import { CardCatalogVersionEntity } from "./entities/card/CardCatalogVersionEntity";
import { CardEntity } from "./entities/card/CardEntity";
import { DareTypeTranslationEntity } from "./entities/card/DareTypeTranslationEntity";
import { QuestionCategoryTranslationEntity } from "./entities/card/QuestionCategoryTranslationEntity";
import { CardPolicyConditionalRuleEntity } from "./entities/game/CardPolicyConditionalRuleEntity";
import { CardPolicyExactCardEntity } from "./entities/game/CardPolicyExactCardEntity";
import { CardPolicyScopeDefaultEntity } from "./entities/game/CardPolicyScopeDefaultEntity";
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
import { persistenceTransaction } from "./transaction";
import { cardEntityToDomain } from "./cardMapper";
import { TypeOrmCardRepository } from "./TypeOrmCardRepository";

function conflict(message: MessageKey = MESSAGE_KEYS.CARD_POLICY_REVISION_CONFLICT): never {
    throw Object.assign(new Error(message), {
        code: "POLICY_REVISION_CONFLICT",
        status: 409,
    });
}

function parse<T>(json: string): T {
    return JSON.parse(json) as T;
}

export class TypeOrmCardPolicyRepository implements CardPolicyRepository {
    constructor(private readonly dataSource: DataSource) {}

    private async transaction<T>(action: (manager: EntityManager) => Promise<T>): Promise<T> {
        try {
            return await persistenceTransaction(this.dataSource, action);
        } catch (error) {
            const code = (error as { code?: string }).code;
            if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") conflict();
            throw error;
        }
    }

    async load(owner: CardPolicyOwner): Promise<StoredCardPolicyScope> {
        return (await this.loadScopes([owner]))[0];
    }

    async loadScopes(owners: readonly CardPolicyOwner[]): Promise<StoredCardPolicyScope[]> {
        return this.transaction(async (manager) => {
            const scopes: StoredCardPolicyScope[] = [];
            for (const owner of owners) {
                const summary = await this.readSummary(manager, owner);
                const entries = await manager.getRepository(CardPolicyExactCardEntity).find({
                    where: { ownerKey: owner.ownerKey },
                    order: { cardId: "ASC" },
                    take: 50_001,
                });
                this.checkLimit(entries.length, 50_000);
                scopes.push({
                    ...summary,
                    exactCards: entries.map((entry) => this.projectExact(entry)),
                });
            }
            return scopes;
        });
    }

    summary(owner: CardPolicyOwner): Promise<Omit<StoredCardPolicyScope, "exactCards">> {
        return this.transaction((manager) => this.readSummary(manager, owner));
    }

    private async readSummary(manager: EntityManager, owner: CardPolicyOwner) {
        const scope = await manager
            .getRepository(CardPolicyScopeDefaultEntity)
            .findOneBy({ ownerKey: owner.ownerKey });
        const rules = await manager.getRepository(CardPolicyConditionalRuleEntity).find({
            where: { ownerKey: owner.ownerKey },
            order: { ruleOrder: "ASC", id: "ASC" },
            take: 251,
        });
        this.checkLimit(rules.length, 250);
        return {
            owner,
            revision: scope?.scopeRevision ?? 0,
            scopeDefault: scope ? this.projectDefault(scope) : { directives: {}, revision: 0 },
            rules: rules.map((rule) => this.projectRule(rule)),
        };
    }

    private checkLimit(count: number, maximum: number): void {
        if (count > maximum)
            throw Object.assign(new Error(MESSAGE_KEYS.CARD_POLICY_CAPACITY_EXCEEDED), {
                code: "VALIDATION_ERROR",
                status: 400,
            });
    }

    /** Keep one clock even for empty scopes. Row revisions use this clock, so
     * deleting and recreating an override cannot resurrect an old revision. */
    private async advanceScope(
        manager: EntityManager,
        owner: CardPolicyOwner,
        expected?: number,
    ): Promise<number> {
        const repository = manager.getRepository(CardPolicyScopeDefaultEntity);
        const now = new Date();
        await repository
            .createQueryBuilder()
            .insert()
            .values({
                ownerKey: owner.ownerKey,
                dataSpaceId: owner.dataSpaceId,
                groupId: owner.groupId,
                directivesJson: "{}",
                revision: 0,
                scopeRevision: 0,
                createdAt: now,
                updatedAt: now,
            })
            .orUpdate(["owner_key"], ["owner_key"])
            .execute();
        const query = repository
            .createQueryBuilder("scope")
            .where("scope.ownerKey = :ownerKey", owner);
        if (this.dataSource.options.type !== "better-sqlite3") query.setLock("pessimistic_write");
        const current = await query.getOneOrFail();
        if (expected !== undefined && current.scopeRevision !== expected) conflict();
        if (current.scopeRevision >= 2_147_483_647) conflict();
        const revision = current.scopeRevision + 1;
        const result = await repository.update(
            { ownerKey: owner.ownerKey, scopeRevision: current.scopeRevision },
            {
                scopeRevision: revision,
                updatedAt: now,
            },
        );
        if (result.affected !== 1) conflict();
        return revision;
    }

    async putDefault(
        owner: CardPolicyOwner,
        directives: CardPolicyDirectives,
        expectedRevision: number,
    ): Promise<StoredPolicyDefault> {
        return this.transaction(async (manager) => {
            const revision = await this.advanceScope(manager, owner);
            const result = await manager
                .getRepository(CardPolicyScopeDefaultEntity)
                .update(
                    { ownerKey: owner.ownerKey, revision: expectedRevision },
                    { directivesJson: JSON.stringify(directives), revision, updatedAt: new Date() },
                );
            if (result.affected !== 1) conflict();
            return { directives, revision };
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
        return this.transaction(async (manager) => {
            const revision = await this.advanceScope(manager, owner);
            const repository = manager.getRepository(CardPolicyConditionalRuleEntity);
            this.checkLimit((await repository.countBy({ ownerKey: owner.ownerKey })) + 1, 250);
            const highest = await repository.findOne({
                where: { ownerKey: owner.ownerKey },
                order: { ruleOrder: "DESC" },
            });
            const now = new Date();
            const rule = repository.create({
                id: randomUUID(),
                ownerKey: owner.ownerKey,
                dataSpaceId: owner.dataSpaceId,
                groupId: owner.groupId,
                name: input.name,
                enabled: input.enabled,
                ruleOrder: (highest?.ruleOrder ?? 0) + 10,
                predicateJson: JSON.stringify(input.predicate),
                directivesJson: JSON.stringify(input.directives),
                revision,
                createdAt: now,
                updatedAt: now,
            });
            await repository.insert(rule);
            return this.projectRule(rule);
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
        return this.transaction(async (manager) => {
            const revision = await this.advanceScope(manager, owner);
            const repository = manager.getRepository(CardPolicyConditionalRuleEntity);
            const result = await repository.update(
                { id, ownerKey: owner.ownerKey, revision: expectedRevision },
                {
                    name: input.name,
                    enabled: input.enabled,
                    predicateJson: JSON.stringify(input.predicate),
                    directivesJson: JSON.stringify(input.directives),
                    revision,
                    updatedAt: new Date(),
                },
            );
            if (result.affected !== 1) {
                if (!(await repository.existsBy({ id, ownerKey: owner.ownerKey })))
                    conflict(MESSAGE_KEYS.CARD_POLICY_RULE_NOT_FOUND);
                conflict();
            }
            return this.projectRule(
                await repository.findOneByOrFail({ id, ownerKey: owner.ownerKey }),
            );
        });
    }

    async deleteRule(
        owner: CardPolicyOwner,
        id: string,
        expectedRevision: number,
    ): Promise<boolean> {
        return this.transaction(async (manager) => {
            await this.advanceScope(manager, owner);
            const repository = manager.getRepository(CardPolicyConditionalRuleEntity);
            const result = await repository.delete({
                id,
                ownerKey: owner.ownerKey,
                revision: expectedRevision,
            });
            if (result.affected !== 1) {
                if (!(await repository.existsBy({ id, ownerKey: owner.ownerKey })))
                    conflict(MESSAGE_KEYS.CARD_POLICY_RULE_NOT_FOUND);
                conflict();
            }
            return true;
        });
    }

    async reorderRules(
        owner: CardPolicyOwner,
        ids: readonly string[],
        expectedScopeRevision: number,
    ): Promise<readonly StoredPolicyRule[]> {
        return this.transaction(async (manager) => {
            const revision = await this.advanceScope(manager, owner, expectedScopeRevision);
            const repository = manager.getRepository(CardPolicyConditionalRuleEntity);
            const rules = await repository.findBy({ ownerKey: owner.ownerKey });
            const requested = new Set(ids);
            if (
                rules.length !== ids.length ||
                requested.size !== ids.length ||
                rules.some(({ id }) => !requested.has(id))
            ) {
                throw Object.assign(new Error(MESSAGE_KEYS.CARD_POLICY_INVALID_RULE_ORDER), {
                    code: "VALIDATION_ERROR",
                    status: 400,
                });
            }
            // Avoid collisions with the unique order index during a permutation.
            for (const [index, rule] of rules.entries())
                await repository.update({ id: rule.id }, { ruleOrder: -1000 - index });
            const byId = new Map(rules.map((rule) => [rule.id, rule]));
            const ordered: StoredPolicyRule[] = [];
            for (const [index, id] of ids.entries()) {
                const rule = byId.get(id)!;
                rule.ruleOrder = (index + 1) * 10;
                rule.revision = revision;
                rule.updatedAt = new Date();
                await repository.update(
                    { id, ownerKey: owner.ownerKey },
                    { ruleOrder: rule.ruleOrder, revision, updatedAt: rule.updatedAt },
                );
                ordered.push(this.projectRule(rule));
            }
            return ordered;
        });
    }

    async putExactCard(
        owner: CardPolicyOwner,
        cardId: string,
        directives: CardPolicyDirectives,
        expectedRevision: number,
    ): Promise<StoredExactCardPolicy | null> {
        if (!(await this.dataSource.getRepository(CardEntity).existsBy({ id: cardId })))
            return null;
        return this.transaction(async (manager) => {
            const revision = await this.advanceScope(manager, owner);
            const repository = manager.getRepository(CardPolicyExactCardEntity);
            const current = await repository.findOneBy({ ownerKey: owner.ownerKey, cardId });
            if ((current?.revision ?? 0) !== expectedRevision) conflict();
            const now = new Date();
            if (current) {
                const result = await repository.update(
                    { id: current.id, revision: expectedRevision },
                    { directivesJson: JSON.stringify(directives), revision, updatedAt: now },
                );
                if (result.affected !== 1) conflict();
            } else {
                this.checkLimit(
                    (await repository.countBy({ ownerKey: owner.ownerKey })) + 1,
                    50_000,
                );
                await repository.insert({
                    id: randomUUID(),
                    ownerKey: owner.ownerKey,
                    dataSpaceId: owner.dataSpaceId,
                    groupId: owner.groupId,
                    cardId,
                    directivesJson: JSON.stringify(directives),
                    revision,
                    createdAt: now,
                    updatedAt: now,
                });
            }
            return { cardId, directives, revision };
        });
    }

    async deleteExactCard(
        owner: CardPolicyOwner,
        cardId: string,
        expectedRevision: number,
    ): Promise<boolean> {
        return this.transaction(async (manager) => {
            await this.advanceScope(manager, owner);
            const result = await manager
                .getRepository(CardPolicyExactCardEntity)
                .delete({ ownerKey: owner.ownerKey, cardId, revision: expectedRevision });
            if (result.affected !== 1) conflict();
            return true;
        });
    }

    async replaceScope(
        owner: CardPolicyOwner,
        input: PortableCardPolicyScope,
        expectedScopeRevision: number,
    ): Promise<void> {
        this.checkLimit(input.rules.length, 250);
        this.checkLimit(input.exactCards.length, 50_000);
        await this.transaction(async (manager) => {
            const revision = await this.advanceScope(manager, owner, expectedScopeRevision);
            const cardIds = input.exactCards.map(({ cardId }) => cardId);
            let existingCardCount = 0;
            for (let index = 0; index < cardIds.length; index += 500) {
                existingCardCount += await manager
                    .getRepository(CardEntity)
                    .countBy({ id: In(cardIds.slice(index, index + 500)) });
            }
            if (existingCardCount !== cardIds.length || new Set(cardIds).size !== cardIds.length) {
                throw Object.assign(new Error(MESSAGE_KEYS.CARD_POLICY_UNKNOWN_CARD), {
                    code: "CARD_NOT_FOUND",
                    status: 400,
                });
            }
            await manager
                .getRepository(CardPolicyExactCardEntity)
                .delete({ ownerKey: owner.ownerKey });
            await manager
                .getRepository(CardPolicyConditionalRuleEntity)
                .delete({ ownerKey: owner.ownerKey });
            const now = new Date();
            await manager.getRepository(CardPolicyScopeDefaultEntity).update(
                { ownerKey: owner.ownerKey },
                {
                    directivesJson: JSON.stringify(input.scopeDefault),
                    revision,
                    updatedAt: now,
                },
            );
            // Write at most one rule's bounded predicate per statement. Never
            // construct a catalog-sized INSERT or return the import in a response.
            for (const [index, rule] of input.rules.entries()) {
                await manager.getRepository(CardPolicyConditionalRuleEntity).insert({
                    id: randomUUID(),
                    ownerKey: owner.ownerKey,
                    dataSpaceId: owner.dataSpaceId,
                    groupId: owner.groupId,
                    name: rule.name,
                    enabled: rule.enabled,
                    ruleOrder: (index + 1) * 10,
                    predicateJson: JSON.stringify(rule.predicate),
                    directivesJson: JSON.stringify(rule.directives),
                    revision,
                    createdAt: now,
                    updatedAt: now,
                });
            }
            for (let index = 0; index < input.exactCards.length; index += 32) {
                await manager.getRepository(CardPolicyExactCardEntity).insert(
                    input.exactCards.slice(index, index + 32).map((entry) => ({
                        id: randomUUID(),
                        ownerKey: owner.ownerKey,
                        dataSpaceId: owner.dataSpaceId,
                        groupId: owner.groupId,
                        cardId: entry.cardId,
                        directivesJson: JSON.stringify(entry.directives),
                        revision,
                        createdAt: now,
                        updatedAt: now,
                    })),
                );
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
            .limit(50_001)
            .getRawMany<{ id: string }>();
        this.checkLimit(rows.length, 50_000);
        return rows.map(({ id }) => id);
    }

    async putExactCards(
        owner: CardPolicyOwner,
        cardIds: readonly string[],
        directives: CardPolicyDirectives,
        expectedScopeRevision: number,
    ): Promise<number> {
        this.checkLimit(cardIds.length, 50_000);
        await this.transaction(async (manager) => {
            const revision = await this.advanceScope(manager, owner, expectedScopeRevision);
            const repository = manager.getRepository(CardPolicyExactCardEntity);
            for (let index = 0; index < cardIds.length; index += 32) {
                const ids = cardIds.slice(index, index + 32);
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
                            revision,
                            createdAt: current?.createdAt ?? now,
                            updatedAt: now,
                        });
                    }),
                );
            }
            this.checkLimit(await repository.countBy({ ownerKey: owner.ownerKey }), 50_000);
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

    scanPolicyCards(locale: string) {
        return new TypeOrmCardRepository(this.dataSource.getRepository(CardEntity)).scan({
            locale,
            missingTranslation: "EXCLUDE",
            includeRetired: true,
        });
    }

    async policyPreviewSamples(
        ids: readonly string[],
        locale: string,
    ): Promise<readonly ManagedCatalogCard[]> {
        if (!ids.length) return [];
        if (ids.length > 20) throw new Error("Policy preview sample is too large");
        const entities = await this.cardSearchQuery({ locale, limit: 20 })
            .andWhere("card.id IN (:...ids)", { ids })
            .getMany();
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
        let taxonomyLabel: string | null = null;
        if (entity.questionCategoryId) {
            taxonomyLabel =
                labels.categories.get(entity.questionCategoryId) ?? entity.questionCategoryId;
        } else if (entity.dareTypeId) {
            taxonomyLabel = labels.dareTypes.get(entity.dareTypeId) ?? entity.dareTypeId;
        }
        return {
            ...card,
            lifecycle: entity.active ? "ACTIVE" : "RETIRED",
            taxonomyLabel,
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
