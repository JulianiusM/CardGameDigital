import type { GameProfile, PlayableCard, PlayerBoundaries } from "../../packages/game-core";
import type {
    CardRepository,
    CardLocalizationPolicy,
} from "../../packages/application/repositories";

export const testCatalogAccess = {
    async catalogProvenance() {
        return {
            catalogId: "test",
            sequence: 1,
            catalogVersion: "test-1",
            contract: "game-card-catalog/v2",
            artifactDigest: "0".repeat(64),
        };
    },
    async *scan(
        this: {
            listActive(localization: CardLocalizationPolicy): Promise<readonly PlayableCard[]>;
        },
        localization: CardLocalizationPolicy,
    ) {
        yield* await this.listActive(localization);
    },
    async groupHistoryWindow(_space: string, groupId: string, before: number) {
        return { groupId, before, after: null };
    },
};
export async function testCardById(
    this: { listActive(localization: CardLocalizationPolicy): Promise<readonly PlayableCard[]> },
    id: string,
    localization: CardLocalizationPolicy,
) {
    return (await this.listActive(localization)).find((card) => card.id === id) ?? null;
}
import {
    CARD_TYPES,
    DARE_TYPES,
    INTENSITY_PROGRESSION_UNITS,
    QUESTION_CATEGORIES,
    SOCIAL_SENSITIVITIES,
} from "../../packages/game-core";

export function card(overrides: Partial<PlayableCard> & Pick<PlayableCard, "id">): PlayableCard {
    const { id, ...properties } = overrides;
    return {
        id,
        cardText: "Card",
        locale: "en-GB",
        cardType: CARD_TYPES.QUESTION,
        yesNoAnswerPossible: false,
        questionCategoryId: QUESTION_CATEGORIES.EVERYDAY,
        dareTypeId: null,
        dareAffinityCategoryId: null,
        intensity: 1,
        alwaysEligible: false,
        repeatableInSession: false,
        repeatCooldown: 0,
        weight: 1,
        socialSensitivity: SOCIAL_SENSITIVITIES.GENERAL,
        minimumPlayerCount: 2,
        maximumPlayerCount: null,
        active: true,
        operationalFlags: [],
        ...properties,
    };
}

export function profile(overrides: Partial<GameProfile> = {}): GameProfile {
    return {
        id: "custom",
        name: "Custom",
        enabledQuestionCategoryIds: new Set(Object.values(QUESTION_CATEGORIES)),
        enabledDareTypeIds: new Set(Object.values(DARE_TYPES)),
        blockedOperationalFlags: new Set(),
        maximumSocialSensitivity: SOCIAL_SENSITIVITIES.EXPLICIT,
        startingIntensity: 1,
        maximumIntensity: 5,
        intensityProgressionUnit: INTENSITY_PROGRESSION_UNITS.ROUNDS,
        intensityProgressionInterval: 2,
        intensityProgressionIncrement: 1,
        randomQuestionRatio: 0.6,
        maximumTypeStreak: 3,
        letsTalkMetaInterval: 2,
        ...overrides,
    };
}

export function boundaries(overrides: Partial<PlayerBoundaries> = {}): PlayerBoundaries {
    return {
        disabledQuestionCategoryIds: new Set(),
        disabledDareTypeIds: new Set(),
        blockedOperationalFlags: new Set(),
        ...overrides,
    };
}

export type TestCardRepository = CardRepository & {
    listActive(localization: CardLocalizationPolicy): Promise<readonly PlayableCard[]>;
    findEligibleCandidates(...args: unknown[]): Promise<readonly PlayableCard[]>;
};
