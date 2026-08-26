import { describe, expect, it } from "vitest";
import {
    cardPolicyScopeFromJson,
    eligibilityReasons,
    resolveCardPolicy,
} from "../../src/packages/game-core";
import { boundaries, card, profile } from "../support/game";

const exact = (
    cardId: string,
    directives: Parameters<typeof cardPolicyScopeFromJson>[0]["scopeDefault"],
) => [{ cardId, directives: directives ?? {} }];

describe("scoped Card policy", () => {
    it("applies scope specificity after within-scope specificity", () => {
        const producer = card({ id: "10000000-0000-4000-8000-000000000001" as never });
        const dataSpace = cardPolicyScopeFromJson({
            name: "DataSpace",
            exactCards: exact(producer.id, { availability: "EXCLUDE" }),
        });
        const group = cardPolicyScopeFromJson({
            name: "Group",
            scopeDefault: { availability: "INCLUDE" },
            conditionalRules: [
                {
                    id: "20000000-0000-4000-8000-000000000001",
                    name: "Questions",
                    order: 10,
                    enabled: true,
                    predicate: { cardTypes: ["QUESTION"] },
                    directives: { availability: "EXCLUDE" },
                },
            ],
            exactCards: exact(producer.id, { availability: "INCLUDE" }),
        });

        const effective = resolveCardPolicy({ card: producer, dataSpace, group });
        expect(effective.policyAvailable).toBe(true);
        expect(effective.provenance.availability).toBe("Group Exact Card");
    });

    it("restores producer scalar and player-count values with CATALOG", () => {
        const producer = card({
            id: "10000000-0000-4000-8000-000000000002" as never,
            intensity: 2,
            minimumPlayerCount: 2,
            maximumPlayerCount: 8,
        });
        const dataSpace = cardPolicyScopeFromJson({
            name: "DataSpace",
            scopeDefault: {
                intensity: { mode: "SET", value: 4 },
                playerCount: { mode: "SET", value: { minimum: 3, maximum: 6 } },
            },
        });
        const group = cardPolicyScopeFromJson({
            name: "Group",
            scopeDefault: {
                intensity: { mode: "CATALOG" },
                playerCount: { mode: "CATALOG" },
            },
        });

        const effective = resolveCardPolicy({ card: producer, dataSpace, group });
        expect(effective.intensity).toBe(2);
        expect([effective.minimumPlayerCount, effective.maximumPlayerCount]).toEqual([2, 8]);
    });

    it("lets Session availability reverse persistent availability without bypassing hard gates", () => {
        const producer = card({ id: "10000000-0000-4000-8000-000000000003" as never });
        const dataSpace = cardPolicyScopeFromJson({
            name: "DataSpace",
            exactCards: exact(producer.id, { availability: "EXCLUDE" }),
        });
        const session = cardPolicyScopeFromJson({
            name: "Session",
            exactCards: exact(producer.id, { availability: "INCLUDE" }),
        });
        const effective = resolveCardPolicy({ card: producer, dataSpace, session });
        expect(effective.policyAvailable).toBe(true);

        const inactive = resolveCardPolicy({ card: { ...producer, active: false }, session });
        expect(
            eligibilityReasons(inactive, {
                cardType: "QUESTION",
                profile: profile(),
                boundaries: [boundaries()],
                maximumIntensityScore: 20,
                sessionHistory: [],
                groupHistoryCardIds: new Set(),
                playerCount: 2,
            }),
        ).toContain("INACTIVE");
    });

    it.each([
        [{ minimumPlayerCount: 2, maximumPlayerCount: null }, 2, false],
        [{ minimumPlayerCount: 3, maximumPlayerCount: null }, 2, true],
        [{ minimumPlayerCount: 2, maximumPlayerCount: 4 }, 5, true],
        [{ minimumPlayerCount: 2, maximumPlayerCount: 4 }, 4, false],
    ])(
        "enforces the authoritative roster against the atomic range",
        (range, playerCount, excluded) => {
            const reasons = eligibilityReasons(
                card({ id: "10000000-0000-4000-8000-000000000005" as never, ...range }),
                {
                    cardType: "QUESTION",
                    profile: profile(),
                    boundaries: [boundaries()],
                    maximumIntensityScore: 20,
                    sessionHistory: [],
                    groupHistoryCardIds: new Set(),
                    playerCount,
                },
            );
            expect(reasons.includes("PLAYER_COUNT")).toBe(excluded);
        },
    );
});
