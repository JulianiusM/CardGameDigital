import { describe, expect, expectTypeOf, it } from "vitest";
import { CARD_TYPES } from "../../packages/game-core";
import {
    cardPolicyRuleCreateRequestSchema,
    cardPolicyRulePreviewRequestSchema,
    cardPolicySearchSchema,
    cardPolicySessionSearchRequestSchema,
    decodeEligibilityPreview,
    eligibilityPreviewSchema,
    portableCardPolicyScopeSchema,
    sessionCardPolicySchema,
    type CardPolicyRuleCreateRequest,
    type EligibilityPreview,
    type PortableCardPolicy,
} from "../../packages/protocol";

describe("Card-policy protocol", () => {
    it("uses one policy shape for persisted and pending scopes", () => {
        expect(sessionCardPolicySchema.parse({})).toEqual({
            scopeDefault: {},
            conditionalRules: [],
            exactCards: [],
        });
        expect(
            portableCardPolicyScopeSchema.parse({
                format: "party-game-card-policy/v2",
                scopeDefault: {},
                rules: [],
                exactCards: [],
            }),
        ).toEqual({
            format: "party-game-card-policy/v2",
            scopeDefault: {},
            rules: [],
            exactCards: [],
        });
        expectTypeOf<PortableCardPolicy>().toMatchTypeOf<{
            format: "party-game-card-policy/v2";
            scopeDefault: object;
            rules: object[];
            exactCards: object[];
        }>();
    });

    it("coerces the canonical Card search request once at the server boundary", () => {
        expect(
            cardPolicySearchSchema.parse({
                locale: "en-GB",
                limit: "12",
                playerCount: "4",
                yesNoAnswerPossible: "true",
            }),
        ).toMatchObject({ limit: 12, playerCount: 4, yesNoAnswerPossible: true });
        expect(
            cardPolicySessionSearchRequestSchema.parse({
                sessionPolicy: {},
                search: { locale: "en-GB", limit: "8" },
            }),
        ).toEqual({
            sessionPolicy: { scopeDefault: {}, conditionalRules: [], exactCards: [] },
            search: { locale: "en-GB", limit: 8 },
        });
    });

    it("shares strict rule request definitions between browser and server", () => {
        const request = cardPolicyRuleCreateRequestSchema.parse({
            name: "Questions",
            enabled: true,
            predicate: { cardTypes: [CARD_TYPES.QUESTION] },
            directives: { availability: "INCLUDE" },
        });
        expectTypeOf(request).toEqualTypeOf<CardPolicyRuleCreateRequest>();
        expect(
            cardPolicyRulePreviewRequestSchema.safeParse({
                predicate: {},
                locale: "en-GB",
                browserOnly: true,
            }).success,
        ).toBe(false);
    });

    it("validates known response fields while accepting additive server fields", () => {
        const response = {
            total: 9,
            availableAtStart: 4,
            byType: { QUESTION: 5, DARE: 3, CONVERSATION_META: 1 },
            atStartByType: { QUESTION: 2, DARE: 2, CONVERSATION_META: 0 },
            playerCount: 4,
        };
        expect(eligibilityPreviewSchema.parse(response)).toEqual(response);
        const decoded = decodeEligibilityPreview({
            ...response,
            futurePoolMetric: 7,
        });
        expectTypeOf(decoded).toEqualTypeOf<EligibilityPreview>();
        expect(decoded).toMatchObject({ total: 9, futurePoolMetric: 7 });
        expect(() => decodeEligibilityPreview({ ...response, total: "nine" })).toThrow();
    });
});
