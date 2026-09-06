import { describe, expect, it } from "vitest";
import type { DataSource, EntitySubscriberInterface } from "typeorm";
import { TypeOrmCardPolicyRepository } from "../../packages/persistence/TypeOrmCardPolicyRepository";
import { CardPolicyScopeDefaultEntity } from "../../packages/persistence/entities/game/CardPolicyScopeDefaultEntity";
import { CardEntity } from "../../packages/persistence/entities/card/CardEntity";
import { DataSpace } from "../../packages/persistence/entities/user/DataSpace";
import type { CardPolicyOwner } from "../../packages/application/cardPolicyRepository";

export function policyCommitTests(getSource: () => DataSource): void {
    async function fixture() {
        const source = getSource();
        const space = await source
            .getRepository(DataSpace)
            .save({ name: "Policy commits", defaultForOwner: false });
        const owner: CardPolicyOwner = {
            dataSpaceId: space.id,
            groupId: null,
            ownerKey: `DATASPACE:${space.id}`,
            name: "DataSpace",
        };
        const card = await source
            .getRepository(CardEntity)
            .findOneOrFail({ where: {}, select: { id: true } });
        return {
            source,
            owner,
            cardId: card.id,
            first: new TypeOrmCardPolicyRepository(source),
            second: new TypeOrmCardPolicyRepository(source),
        };
    }

    async function oneWinner(operations: Promise<unknown>[]) {
        const results = await Promise.allSettled(operations);
        expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
        const failure = results.find(
            (result) => result.status === "rejected",
        ) as PromiseRejectedResult;
        expect(failure.reason).toMatchObject({ code: "POLICY_REVISION_CONFLICT", status: 409 });
    }

    describe("authoritative policy commits", () => {
        it("permits one same-base default, rule, override, and delete writer", async () => {
            const { first, second, owner, cardId } = await fixture();
            await oneWinner([
                first.putDefault(owner, { availability: "INCLUDE" }, 0),
                second.putDefault(owner, { availability: "EXCLUDE" }, 0),
            ]);
            const input = { name: "Rule", enabled: true, predicate: {}, directives: {} };
            const rule = await first.createRule(owner, input);
            await oneWinner([
                first.updateRule(owner, rule.id, { ...input, name: "First" }, rule.revision),
                second.updateRule(owner, rule.id, { ...input, name: "Second" }, rule.revision),
            ]);
            await oneWinner([
                first.putExactCard(owner, cardId, { availability: "INCLUDE" }, 0),
                second.putExactCard(owner, cardId, { availability: "EXCLUDE" }, 0),
            ]);
            const scope = await first.load(owner);
            await oneWinner([
                first.deleteExactCard(owner, cardId, scope.exactCards[0].revision),
                second.deleteExactCard(owner, cardId, scope.exactCards[0].revision),
            ]);
            const current = (await first.load(owner)).rules[0];
            await oneWinner([
                first.deleteRule(owner, current.id, current.revision),
                second.updateRule(owner, current.id, input, current.revision),
            ]);
            expect((await first.load(owner)).revision).toBe(6);
        });

        it("rejects unseen edits during import, reorder and bulk, preserving the monotonic clock", async () => {
            const { first, second, owner, cardId } = await fixture();
            const input = { name: "Rule", enabled: true, predicate: {}, directives: {} };
            const rule = await first.createRule(owner, input);
            const base = await first.load(owner);
            await second.updateRule(owner, rule.id, { ...input, name: "Unseen" }, rule.revision);
            const portable = {
                scopeDefault: {},
                rules: [input],
                exactCards: [{ cardId, directives: {} }],
            };
            await expect(first.replaceScope(owner, portable, base.revision)).rejects.toMatchObject({
                code: "POLICY_REVISION_CONFLICT",
            });
            await expect(first.reorderRules(owner, [rule.id], base.revision)).rejects.toMatchObject(
                { code: "POLICY_REVISION_CONFLICT" },
            );
            await expect(
                first.putExactCards(owner, [cardId], {}, base.revision),
            ).rejects.toMatchObject({ code: "POLICY_REVISION_CONFLICT" });
            const beforeImport = await first.load(owner);
            await first.replaceScope(owner, portable, beforeImport.revision);
            const imported = await first.load(owner);
            expect(imported.revision).toBe(beforeImport.revision + 1);
            expect(imported.exactCards[0].revision).toBe(imported.revision);
            const stale = imported.exactCards[0].revision;
            await first.deleteExactCard(owner, cardId, stale);
            const recreated = await first.putExactCard(owner, cardId, {}, 0);
            expect(recreated!.revision).toBeGreaterThan(stale);
            await expect(
                second.putExactCard(owner, cardId, { availability: "EXCLUDE" }, stale),
            ).rejects.toMatchObject({ code: "POLICY_REVISION_CONFLICT" });
        });

        it("reads multiple scopes from one database snapshot", async () => {
            const { source, owner, first, second } = await fixture();
            const otherSpace = await source
                .getRepository(DataSpace)
                .save({ name: "Second policy scope", defaultForOwner: false });
            const other: CardPolicyOwner = {
                ...owner,
                dataSpaceId: otherSpace.id,
                ownerKey: `DATASPACE:${otherSpace.id}`,
            };
            await first.putDefault(owner, {}, 0);
            await first.putDefault(other, {}, 0);
            let write: Promise<unknown> | undefined;
            const subscriber: EntitySubscriberInterface = {
                async afterLoad(entity, event) {
                    if (
                        event?.metadata.target !== CardPolicyScopeDefaultEntity ||
                        entity.ownerKey !== owner.ownerKey ||
                        write
                    )
                        return;
                    write = second.putDefault(other, { availability: "EXCLUDE" }, 1);
                    if (source.options.type !== "better-sqlite3") await write;
                },
            };
            source.subscribers.push(subscriber);
            try {
                const scopes = await first.loadScopes([owner, other]);
                expect(scopes.map(({ revision }) => revision)).toEqual([1, 1]);
                expect(scopes[1].scopeDefault.directives).toEqual({});
            } finally {
                source.subscribers.splice(source.subscribers.indexOf(subscriber), 1);
                await write;
            }
            expect((await first.load(other)).revision).toBe(2);
        });
    });
}
