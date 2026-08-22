import type { GameProfile, PlayableCard, PlayerBoundaries } from "../../src/packages/game-core";
import { CARD_TYPES, DARE_TYPES, QUESTION_CATEGORIES } from "../../src/packages/game-core";

export function card(overrides: Partial<PlayableCard> & Pick<PlayableCard, "id">): PlayableCard {
    return {
        id: overrides.id,
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
        active: true,
        operationalFlags: [],
        ...overrides,
    };
}

export function profile(overrides: Partial<GameProfile> = {}): GameProfile {
    return {
        id: "custom",
        name: "Custom",
        enabledQuestionCategoryIds: new Set(Object.values(QUESTION_CATEGORIES)),
        enabledDareTypeIds: new Set(Object.values(DARE_TYPES)),
        blockedOperationalFlags: new Set(),
        maximumIntensity: 5,
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
