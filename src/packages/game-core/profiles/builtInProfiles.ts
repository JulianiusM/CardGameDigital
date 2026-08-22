import { MESSAGE_KEYS } from "../../localization/keys";
import type { MessageKey } from "../../localization/keys";
import {
    DARE_TYPES,
    OPERATIONAL_FLAGS,
    QUESTION_CATEGORIES,
    type DareTypeId,
    type OperationalFlag,
    type QuestionCategoryId,
} from "../cards/taxonomy";
import { validateGameProfile, type GameProfile } from "./gameProfile";

export const BUILT_IN_PROFILE_IDS = {
    COLLEAGUES: "PROFILE_COLLEAGUES",
    FRIENDS: "PROFILE_FRIENDS",
    BEST_FRIENDS: "PROFILE_BEST_FRIENDS",
    COUPLES: "PROFILE_COUPLES",
    COUPLES_SPICY: "PROFILE_COUPLES_SPICY",
} as const;

export type BuiltInGameProfile = GameProfile & {
    readonly nameKey: MessageKey;
    readonly descriptionKey: MessageKey;
    readonly editorialStatus: "PUBLISHED";
    readonly requiresAdultConfirmation: boolean;
};

type ProfileInput = {
    id: string;
    nameKey: MessageKey;
    descriptionKey: MessageKey;
    questions: readonly QuestionCategoryId[];
    dares: readonly DareTypeId[];
    blockedFlags?: readonly OperationalFlag[];
    maximumIntensity: 1 | 2 | 3 | 4 | 5;
    randomQuestionRatio?: number;
    requiresAdultConfirmation?: boolean;
};

function profile(input: ProfileInput): BuiltInGameProfile {
    return {
        ...validateGameProfile({
            id: input.id,
            name: input.id,
            enabledQuestionCategoryIds: new Set(input.questions),
            enabledDareTypeIds: new Set(input.dares),
            blockedOperationalFlags: new Set(input.blockedFlags ?? []),
            maximumIntensity: input.maximumIntensity,
            randomQuestionRatio: input.randomQuestionRatio ?? 0.6,
            maximumTypeStreak: 3,
            letsTalkMetaInterval: 5,
        }),
        nameKey: input.nameKey,
        descriptionKey: input.descriptionKey,
        editorialStatus: "PUBLISHED",
        requiresAdultConfirmation: input.requiresAdultConfirmation ?? false,
    };
}

const commonQuestions = [
    QUESTION_CATEGORIES.EVERYDAY,
    QUESTION_CATEGORIES.CHILDHOOD,
    QUESTION_CATEGORIES.PERSONALITY,
    QUESTION_CATEGORIES.SCENARIO,
    QUESTION_CATEGORIES.FRIENDSHIP,
] as const;
const playfulDares = [DARE_TYPES.SILLY, DARE_TYPES.OTHER] as const;

export const BUILT_IN_GAME_PROFILES: readonly BuiltInGameProfile[] = [
    profile({
        id: BUILT_IN_PROFILE_IDS.COLLEAGUES,
        nameKey: MESSAGE_KEYS.PROFILE_COLLEAGUES_NAME,
        descriptionKey: MESSAGE_KEYS.PROFILE_COLLEAGUES_DESCRIPTION,
        questions: commonQuestions,
        dares: playfulDares,
        blockedFlags: [OPERATIONAL_FLAGS.INVOLVES_THIRD_PARTY],
        maximumIntensity: 2,
    }),
    profile({
        id: BUILT_IN_PROFILE_IDS.FRIENDS,
        nameKey: MESSAGE_KEYS.PROFILE_FRIENDS_NAME,
        descriptionKey: MESSAGE_KEYS.PROFILE_FRIENDS_DESCRIPTION,
        questions: [...commonQuestions, QUESTION_CATEGORIES.RELATIONSHIP, QUESTION_CATEGORIES.BODY],
        dares: [...playfulDares, DARE_TYPES.TOUCH, DARE_TYPES.KISS, DARE_TYPES.CLOTHING],
        maximumIntensity: 3,
    }),
    profile({
        id: BUILT_IN_PROFILE_IDS.BEST_FRIENDS,
        nameKey: MESSAGE_KEYS.PROFILE_BEST_FRIENDS_NAME,
        descriptionKey: MESSAGE_KEYS.PROFILE_BEST_FRIENDS_DESCRIPTION,
        questions: [
            ...commonQuestions,
            QUESTION_CATEGORIES.RELATIONSHIP,
            QUESTION_CATEGORIES.BODY,
            QUESTION_CATEGORIES.SEX_OPENNESS,
            QUESTION_CATEGORIES.SEX_TENSION,
        ],
        dares: [
            ...playfulDares,
            DARE_TYPES.TOUCH,
            DARE_TYPES.TOUCH_SPICY,
            DARE_TYPES.KISS,
            DARE_TYPES.KISS_SPICY,
            DARE_TYPES.CLOTHING,
        ],
        maximumIntensity: 4,
    }),
    profile({
        id: BUILT_IN_PROFILE_IDS.COUPLES,
        nameKey: MESSAGE_KEYS.PROFILE_COUPLES_NAME,
        descriptionKey: MESSAGE_KEYS.PROFILE_COUPLES_DESCRIPTION,
        questions: [
            QUESTION_CATEGORIES.EVERYDAY,
            QUESTION_CATEGORIES.PERSONALITY,
            QUESTION_CATEGORIES.RELATIONSHIP,
            QUESTION_CATEGORIES.BODY,
            QUESTION_CATEGORIES.SEXUALITY,
            QUESTION_CATEGORIES.SEX_OPENNESS,
            QUESTION_CATEGORIES.SEX_TENSION,
            QUESTION_CATEGORIES.SEX_EXPERIENCE,
        ],
        dares: [
            ...playfulDares,
            DARE_TYPES.TOUCH,
            DARE_TYPES.TOUCH_SPICY,
            DARE_TYPES.KISS,
            DARE_TYPES.KISS_SPICY,
            DARE_TYPES.CLOTHING,
            DARE_TYPES.NUDITY,
            DARE_TYPES.SEXUAL_TENSION,
        ],
        maximumIntensity: 4,
    }),
    profile({
        id: BUILT_IN_PROFILE_IDS.COUPLES_SPICY,
        nameKey: MESSAGE_KEYS.PROFILE_COUPLES_SPICY_NAME,
        descriptionKey: MESSAGE_KEYS.PROFILE_COUPLES_SPICY_DESCRIPTION,
        questions: Object.values(QUESTION_CATEGORIES),
        dares: Object.values(DARE_TYPES),
        maximumIntensity: 5,
        randomQuestionRatio: 0.5,
        requiresAdultConfirmation: true,
    }),
];

export function builtInGameProfile(id: string): BuiltInGameProfile | null {
    return BUILT_IN_GAME_PROFILES.find((candidate) => candidate.id === id) ?? null;
}
