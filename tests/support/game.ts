import type { GameProfile, PlayableCard, PlayerBoundaries } from "../../packages/game-core";
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
