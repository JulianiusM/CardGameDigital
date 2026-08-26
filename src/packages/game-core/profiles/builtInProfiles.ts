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
import { INTENSITY_PROGRESSION_UNITS, type Intensity } from "../cards/intensity";
import { validateGameProfile, type GameProfile } from "./gameProfile";
import { SOCIAL_SENSITIVITIES, type SocialSensitivity } from "../cards/socialSensitivity";

export const BUILT_IN_PROFILE_IDS = {
    CHILD_FRIENDLY: "PROFILE_CHILD_FRIENDLY",
    ACQUAINTANCES: "PROFILE_ACQUAINTANCES",
    FRIENDS: "PROFILE_FRIENDS",
    CLOSE_FRIENDS: "PROFILE_CLOSE_FRIENDS",
    SPICY: "PROFILE_SPICY",
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
    maximumSocialSensitivity: SocialSensitivity;
    maximumIntensity: Intensity;
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
            maximumSocialSensitivity: input.maximumSocialSensitivity,
            startingIntensity: 1,
            maximumIntensity: input.maximumIntensity,
            intensityProgressionUnit: INTENSITY_PROGRESSION_UNITS.CARDS,
            intensityProgressionInterval: 2,
            intensityProgressionIncrement: 1,
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
const externalSubstanceFlags = [
    OPERATIONAL_FLAGS.INVOLVES_THIRD_PARTY,
    OPERATIONAL_FLAGS.INVOLVES_ALCOHOL,
    OPERATIONAL_FLAGS.INVOLVES_RECREATIONAL_SUBSTANCES,
] as const;
const friendsBlockedFlags = [
    ...externalSubstanceFlags,
    OPERATIONAL_FLAGS.REMOVES_CLOTHING,
    OPERATIONAL_FLAGS.REQUIRES_NUDITY,
] as const;
const acquaintancesBlockedFlags = [
    ...friendsBlockedFlags,
    OPERATIONAL_FLAGS.REQUIRES_PHYSICAL_CONTACT,
] as const;
export const BUILT_IN_GAME_PROFILES: readonly BuiltInGameProfile[] = [
    profile({
        id: BUILT_IN_PROFILE_IDS.CHILD_FRIENDLY,
        nameKey: MESSAGE_KEYS.PROFILE_CHILD_FRIENDLY_NAME,
        descriptionKey: MESSAGE_KEYS.PROFILE_CHILD_FRIENDLY_DESCRIPTION,
        questions: [...commonQuestions, QUESTION_CATEGORIES.RELATIONSHIP, QUESTION_CATEGORIES.BODY],
        dares: [...playfulDares, DARE_TYPES.TOUCH],
        blockedFlags: friendsBlockedFlags,
        maximumSocialSensitivity: SOCIAL_SENSITIVITIES.CLOSE_PERSONAL,
        maximumIntensity: 3,
    }),
    profile({
        id: BUILT_IN_PROFILE_IDS.ACQUAINTANCES,
        nameKey: MESSAGE_KEYS.PROFILE_ACQUAINTANCES_NAME,
        descriptionKey: MESSAGE_KEYS.PROFILE_ACQUAINTANCES_DESCRIPTION,
        questions: commonQuestions,
        dares: playfulDares,
        blockedFlags: acquaintancesBlockedFlags,
        maximumSocialSensitivity: SOCIAL_SENSITIVITIES.PERSONAL,
        maximumIntensity: 2,
    }),
    profile({
        id: BUILT_IN_PROFILE_IDS.FRIENDS,
        nameKey: MESSAGE_KEYS.PROFILE_FRIENDS_NAME,
        descriptionKey: MESSAGE_KEYS.PROFILE_FRIENDS_DESCRIPTION,
        questions: [
            ...commonQuestions,
            QUESTION_CATEGORIES.RELATIONSHIP,
            QUESTION_CATEGORIES.BODY,
            QUESTION_CATEGORIES.SEXUALITY,
            QUESTION_CATEGORIES.SEX_OPENNESS,
            QUESTION_CATEGORIES.INTOXICATION,
        ],
        dares: [...playfulDares, DARE_TYPES.TOUCH, DARE_TYPES.TOUCH_SPICY],
        blockedFlags: friendsBlockedFlags,
        maximumSocialSensitivity: SOCIAL_SENSITIVITIES.DEEP_PERSONAL,
        maximumIntensity: 3,
    }),
    profile({
        id: BUILT_IN_PROFILE_IDS.CLOSE_FRIENDS,
        nameKey: MESSAGE_KEYS.PROFILE_CLOSE_FRIENDS_NAME,
        descriptionKey: MESSAGE_KEYS.PROFILE_CLOSE_FRIENDS_DESCRIPTION,
        questions: [
            ...commonQuestions,
            QUESTION_CATEGORIES.RELATIONSHIP,
            QUESTION_CATEGORIES.BODY,
            QUESTION_CATEGORIES.INTOXICATION,
            QUESTION_CATEGORIES.SEXUALITY,
            QUESTION_CATEGORIES.SEX_OPENNESS,
            QUESTION_CATEGORIES.SEX_TENSION,
            QUESTION_CATEGORIES.SEX_EXPERIENCE,
        ],
        dares: [
            ...playfulDares,
            DARE_TYPES.TOUCH,
            DARE_TYPES.TOUCH_SPICY,
            DARE_TYPES.TOUCH_SEXY,
            DARE_TYPES.KISS,
            DARE_TYPES.CLOTHING,
            DARE_TYPES.NUDITY,
            DARE_TYPES.SEXUAL_TENSION,
        ],
        blockedFlags: externalSubstanceFlags,
        maximumSocialSensitivity: SOCIAL_SENSITIVITIES.INTIMATE,
        maximumIntensity: 4,
    }),
    profile({
        id: BUILT_IN_PROFILE_IDS.SPICY,
        nameKey: MESSAGE_KEYS.PROFILE_SPICY_NAME,
        descriptionKey: MESSAGE_KEYS.PROFILE_SPICY_DESCRIPTION,
        questions: Object.values(QUESTION_CATEGORIES),
        dares: Object.values(DARE_TYPES),
        blockedFlags: externalSubstanceFlags,
        maximumSocialSensitivity: SOCIAL_SENSITIVITIES.EXPLICIT,
        maximumIntensity: 5,
        randomQuestionRatio: 0.5,
        requiresAdultConfirmation: true,
    }),
];

export function builtInGameProfile(id: string): BuiltInGameProfile | null {
    return BUILT_IN_GAME_PROFILES.find((candidate) => candidate.id === id) ?? null;
}
