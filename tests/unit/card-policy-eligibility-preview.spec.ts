import { describe, expect, it } from "vitest";
import type {
    CardPolicyOwner,
    CardPolicyRepository,
} from "../../packages/application/cardPolicyRepository";
import { CardPolicyService } from "../../packages/application/cardPolicyService";
import {
    CARD_TYPES,
    DARE_TYPES,
    GAME_MODES,
    SOCIAL_SENSITIVITIES,
    type CardPolicyDirectives,
} from "../../packages/game-core";
import { card, profile } from "../support/game";

const repository = {
    catalogProvenance: async () => ({
        catalogId: "preview-test",
        sequence: 1,
        catalogVersion: "preview-test-1",
        contract: "game-card-catalog/v2",
        artifactDigest: "0".repeat(64),
    }),
} as unknown as CardPolicyRepository;

function repositoryWithDataSpaceDefault(directives: CardPolicyDirectives): CardPolicyRepository {
    return {
        ...repository,
        loadScopes: async (owners: CardPolicyOwner[]) =>
            owners.map((owner) => ({
                revision: owner.name === "DataSpace" ? 1 : 0,
                owner,
                scopeDefault: {
                    directives: owner.name === "DataSpace" ? directives : {},
                    revision: owner.name === "DataSpace" ? 1 : 0,
                },
                rules: [],
                exactCards: [],
            })),
    } as unknown as CardPolicyRepository;
}

const sessionPolicy = {
    scopeDefault: {},
    conditionalRules: [],
    exactCards: [],
};

describe("Card-policy eligibility preview", () => {
    it("counts the mode-specific pool at the starting and maximum intensity ceilings", async () => {
        const service = new CardPolicyService(repository);
        const result = await service.eligibilityPreview({
            cards: [
                card({ id: "q-start" as never, intensity: 1 }),
                card({ id: "q-later" as never, intensity: 5 }),
                card({
                    id: "q-explicit" as never,
                    socialSensitivity: SOCIAL_SENSITIVITIES.EXPLICIT,
                }),
                card({
                    id: "d-start" as never,
                    cardType: CARD_TYPES.DARE,
                    questionCategoryId: null,
                    dareTypeId: DARE_TYPES.OTHER,
                }),
                card({
                    id: "meta" as never,
                    cardType: CARD_TYPES.CONVERSATION_META,
                    questionCategoryId: null,
                }),
            ],
            profile: profile({
                startingIntensity: 1,
                maximumIntensity: 5,
                maximumSocialSensitivity: SOCIAL_SENSITIVITIES.PERSONAL,
            }),
            sessionPolicy,
            mode: GAME_MODES.CLASSIC,
            playerCount: 4,
            groupHistoryCardIds: new Set(),
        });

        expect(result).toMatchObject({
            total: 3,
            availableAtStart: 2,
            playerCount: 4,
            byType: { QUESTION: 2, DARE: 1, CONVERSATION_META: 0 },
            atStartByType: { QUESTION: 1, DARE: 1, CONVERSATION_META: 0 },
        });
    });

    it("uses yes/no capability and shared Group history for Never Have I Ever", async () => {
        const service = new CardPolicyService(repository);
        const seen = card({ id: "seen" as never, yesNoAnswerPossible: true });
        const result = await service.eligibilityPreview({
            cards: [
                seen,
                card({ id: "eligible" as never, yesNoAnswerPossible: true }),
                card({ id: "not-yes-no" as never, yesNoAnswerPossible: false }),
            ],
            profile: profile(),
            sessionPolicy,
            mode: GAME_MODES.NEVER_HAVE_I_EVER,
            playerCount: 3,
            groupHistoryCardIds: new Set([seen.id]),
        });

        expect(result.total).toBe(1);
        expect(result.byType.QUESTION).toBe(1);
        expect(result.byType.DARE).toBe(0);
    });

    it("does not subtract Group history when the DataSpace default ignores it", async () => {
        const service = new CardPolicyService(
            repositoryWithDataSpaceDefault({ alwaysEligible: "ENABLE" }),
        );
        const seen = card({ id: "seen-by-group" as never });
        const unseen = card({ id: "not-seen-by-group" as never });

        const result = await service.eligibilityPreview({
            cards: [seen, unseen],
            dataSpaceId: "data-space",
            groupId: "group",
            profile: profile(),
            sessionPolicy,
            mode: GAME_MODES.CLASSIC,
            playerCount: 2,
            groupHistoryCardIds: new Set([seen.id]),
        });

        expect(result.total).toBe(2);
        expect(result.availableAtStart).toBe(2);
    });

    it("captures only sparse policy, without catalog entries", async () => {
        const service = new CardPolicyService(repository);
        expect(await service.captureSessionPolicy({})).toEqual({ dataSpace: null, group: null });
    });
});
