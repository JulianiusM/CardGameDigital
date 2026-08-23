import { messages } from "./i18n";

export const questionCategoryIds = [
    "CAT_EVERYDAY",
    "CAT_CHILDHOOD",
    "CAT_PERSONALITY",
    "CAT_SCENARIO",
    "CAT_INTOXICATION",
    "CAT_FRIENDSHIP",
    "CAT_RELATIONSHIP",
    "CAT_BODY",
    "CAT_SEXUALITY",
    "CAT_SEX_OPENNESS",
    "CAT_SEX_TENSION",
    "CAT_SEX_EXPERIENCE",
] as const;

export const dareTypeIds = [
    "DARE_SILLY",
    "DARE_THIRD_PARTY",
    "DARE_KISS",
    "DARE_KISS_SPICY",
    "DARE_TOUCH",
    "DARE_TOUCH_SPICY",
    "DARE_TOUCH_SEXY",
    "DARE_CLOTHING",
    "DARE_NUDITY",
    "DARE_SEXUAL_TENSION",
    "DARE_BORDERLINE_SEX",
    "DARE_SEX",
    "DARE_OTHER",
] as const;

export const operationalFlagIds = Object.keys(messages.boundaries.flags);
