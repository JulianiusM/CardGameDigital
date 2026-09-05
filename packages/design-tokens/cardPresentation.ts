import {
    DARE_TYPES,
    QUESTION_CATEGORIES,
    type DareTypeId,
    type QuestionCategoryId,
} from "../game-core/cards/taxonomy";
import type { GoldenMischiefAtmosphereFamily } from "./goldenMischief";

/** Canonical Card taxonomy-to-atmosphere mapping shared by every visual client. */
export const QUESTION_VISUAL_FAMILY_BY_CATEGORY_ID = {
    [QUESTION_CATEGORIES.EVERYDAY]: "CURIOSITY",
    [QUESTION_CATEGORIES.CHILDHOOD]: "CURIOSITY",
    [QUESTION_CATEGORIES.SCENARIO]: "CURIOSITY",
    [QUESTION_CATEGORIES.PERSONALITY]: "INNER_SELF",
    [QUESTION_CATEGORIES.BODY]: "INNER_SELF",
    [QUESTION_CATEGORIES.FRIENDSHIP]: "CONNECTION",
    [QUESTION_CATEGORIES.RELATIONSHIP]: "CONNECTION",
    [QUESTION_CATEGORIES.INTOXICATION]: "UNFILTERED",
    [QUESTION_CATEGORIES.SEXUALITY]: "INTIMATE_TALK",
    [QUESTION_CATEGORIES.SEX_OPENNESS]: "INTIMATE_TALK",
    [QUESTION_CATEGORIES.SEX_TENSION]: "DESIRE_STORIES",
    [QUESTION_CATEGORIES.SEX_EXPERIENCE]: "DESIRE_STORIES",
} as const satisfies Readonly<Record<QuestionCategoryId, GoldenMischiefAtmosphereFamily>>;

/** Canonical Dare taxonomy-to-atmosphere mapping shared by every visual client. */
export const DARE_VISUAL_FAMILY_BY_TYPE_ID = {
    [DARE_TYPES.SILLY]: "MISCHIEF",
    [DARE_TYPES.THIRD_PARTY]: "SOCIAL_CHAOS",
    [DARE_TYPES.KISS]: "AFFECTION",
    [DARE_TYPES.TOUCH]: "AFFECTION",
    [DARE_TYPES.KISS_SPICY]: "FLIRT",
    [DARE_TYPES.TOUCH_SPICY]: "FLIRT",
    [DARE_TYPES.SEXUAL_TENSION]: "FLIRT",
    [DARE_TYPES.CLOTHING]: "REVEAL",
    [DARE_TYPES.NUDITY]: "REVEAL",
    [DARE_TYPES.TOUCH_SEXY]: "HEAT",
    [DARE_TYPES.BORDERLINE_SEX]: "HEAT",
    [DARE_TYPES.SEX]: "HEAT",
    [DARE_TYPES.OTHER]: "GENERIC_DARE",
} as const satisfies Readonly<Record<DareTypeId, GoldenMischiefAtmosphereFamily>>;

export type GoldenMischiefCardVisualFamily =
    | (typeof QUESTION_VISUAL_FAMILY_BY_CATEGORY_ID)[QuestionCategoryId]
    | (typeof DARE_VISUAL_FAMILY_BY_TYPE_ID)[DareTypeId];
