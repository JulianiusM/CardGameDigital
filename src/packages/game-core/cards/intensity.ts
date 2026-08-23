import type { Card } from "./card";
import {
    CARD_TYPES,
    DARE_TYPES,
    QUESTION_CATEGORIES,
    type DareTypeId,
    type QuestionCategoryId,
} from "./taxonomy";

export const INTENSITY_LEVELS = [1, 2, 3, 4, 5] as const;
export type Intensity = (typeof INTENSITY_LEVELS)[number];

export const INTENSITY_PROGRESSION_UNITS = {
    ROUNDS: "ROUNDS",
    CARDS: "CARDS",
} as const;
export type IntensityProgressionUnit =
    (typeof INTENSITY_PROGRESSION_UNITS)[keyof typeof INTENSITY_PROGRESSION_UNITS];

type IntensityBaseOffsets<TTaxonomyId extends string> = Readonly<Record<TTaxonomyId, number>>;
const GLOBAL_INTENSITY_SCORE_STEP = 4;
export const INTENSITY_PROGRESSION_INCREMENT_MINIMUM = 0.5;
export const INTENSITY_PROGRESSION_INCREMENT_MAXIMUM = GLOBAL_INTENSITY_SCORE_STEP;

export const QUESTION_CATEGORY_INTENSITY_BASE_OFFSETS: IntensityBaseOffsets<QuestionCategoryId> =
    Object.freeze({
        [QUESTION_CATEGORIES.EVERYDAY]: 0,
        [QUESTION_CATEGORIES.CHILDHOOD]: 1,
        [QUESTION_CATEGORIES.SCENARIO]: 1,
        [QUESTION_CATEGORIES.PERSONALITY]: 2.5,
        [QUESTION_CATEGORIES.FRIENDSHIP]: 3,
        [QUESTION_CATEGORIES.INTOXICATION]: 4.5,
        [QUESTION_CATEGORIES.RELATIONSHIP]: 5,
        [QUESTION_CATEGORIES.BODY]: 6,
        [QUESTION_CATEGORIES.SEXUALITY]: 7,
        [QUESTION_CATEGORIES.SEX_OPENNESS]: 7.5,
        [QUESTION_CATEGORIES.SEX_TENSION]: 9,
        [QUESTION_CATEGORIES.SEX_EXPERIENCE]: 10,
    });

export const DARE_TYPE_INTENSITY_BASE_OFFSETS: IntensityBaseOffsets<DareTypeId> = Object.freeze({
    [DARE_TYPES.SILLY]: 0,
    [DARE_TYPES.OTHER]: 1,
    [DARE_TYPES.THIRD_PARTY]: 3,
    [DARE_TYPES.TOUCH]: 3.5,
    [DARE_TYPES.KISS]: 5,
    [DARE_TYPES.TOUCH_SPICY]: 6,
    [DARE_TYPES.KISS_SPICY]: 7,
    [DARE_TYPES.CLOTHING]: 8,
    [DARE_TYPES.NUDITY]: 10,
    [DARE_TYPES.SEXUAL_TENSION]: 11,
    [DARE_TYPES.TOUCH_SEXY]: 12,
    [DARE_TYPES.BORDERLINE_SEX]: 13.5,
    [DARE_TYPES.SEX]: 14.5,
});

function cardBaseOffset(card: Pick<Card, "cardType" | "questionCategoryId" | "dareTypeId">) {
    if (card.cardType === CARD_TYPES.QUESTION) {
        if (!card.questionCategoryId) throw new Error("Question Card has no QuestionCategory");
        const baseOffset = QUESTION_CATEGORY_INTENSITY_BASE_OFFSETS[card.questionCategoryId];
        if (baseOffset === undefined)
            throw new Error(
                `Question Card has unknown QuestionCategory ${card.questionCategoryId}`,
            );
        return baseOffset;
    }
    if (card.cardType === CARD_TYPES.DARE) {
        if (!card.dareTypeId) throw new Error("Dare Card has no DareType");
        const baseOffset = DARE_TYPE_INTENSITY_BASE_OFFSETS[card.dareTypeId];
        if (baseOffset === undefined)
            throw new Error(`Dare Card has unknown DareType ${card.dareTypeId}`);
        return baseOffset;
    }
    return 0;
}

/** An independently tuned taxonomy range plus the Card's relative 1-5 position within it. */
export function globalCardIntensityScore(
    card: Pick<Card, "cardType" | "questionCategoryId" | "dareTypeId" | "intensity">,
): number {
    return cardBaseOffset(card) + card.intensity;
}

/** The global 1-5 level shown to players. Related taxonomy ranges deliberately overlap. */
export function globalCardIntensityLevel(
    card: Pick<Card, "cardType" | "questionCategoryId" | "dareTypeId" | "intensity">,
): Intensity {
    return Math.min(
        5,
        Math.ceil(globalCardIntensityScore(card) / GLOBAL_INTENSITY_SCORE_STEP),
    ) as Intensity;
}

export function maximumGlobalIntensityScore(maximumIntensity: Intensity): number {
    return maximumIntensity * GLOBAL_INTENSITY_SCORE_STEP;
}

export type IntensityProgression = {
    startingIntensity: Intensity;
    maximumIntensity: Intensity;
    intensityProgressionUnit: IntensityProgressionUnit;
    intensityProgressionInterval: number;
    intensityProgressionIncrement: number;
};

export function intensityScoreForProgress(
    progression: IntensityProgression,
    progress: { roundNumber: number; cardsShown: number },
): number {
    const completed =
        progression.intensityProgressionUnit === INTENSITY_PROGRESSION_UNITS.ROUNDS
            ? Math.max(0, Math.floor(progress.roundNumber) - 1)
            : Math.max(0, Math.floor(progress.cardsShown));
    const increases = Math.floor(completed / progression.intensityProgressionInterval);
    return Math.min(
        maximumGlobalIntensityScore(progression.maximumIntensity),
        maximumGlobalIntensityScore(progression.startingIntensity) +
            increases * progression.intensityProgressionIncrement,
    );
}

export function intensityLevelForProgress(
    progression: IntensityProgression,
    progress: { roundNumber: number; cardsShown: number },
): Intensity {
    return Math.min(
        progression.maximumIntensity,
        Math.ceil(intensityScoreForProgress(progression, progress) / GLOBAL_INTENSITY_SCORE_STEP),
    ) as Intensity;
}

export function intensityMaximumScoreForProgress(
    progression: IntensityProgression,
    progress: { roundNumber: number; cardsShown: number },
): number {
    return intensityScoreForProgress(progression, progress);
}
