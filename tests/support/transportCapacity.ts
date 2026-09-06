import {
    CARD_TYPES,
    DARE_TYPES,
    OPERATIONAL_FLAGS,
    QUESTION_CATEGORIES,
    SOCIAL_SENSITIVITIES,
} from "../../packages/game-core";
import { defaultRoomGameSettings } from "../../packages/application/roomGameSettings";
import { cardPolicyRuleSchema, sessionCardPolicySchema } from "../../packages/protocol/cardPolicy";
import { MAX_POLICY_RULES, MAX_SESSION_EXACT_CARDS } from "../../packages/protocol/limits";

export const capacityId = (index: number) =>
    `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
export const maximumDirectives = {
    availability: "INCLUDE",
    alwaysEligible: "DISABLE",
    repeatableInSession: "DISABLE",
    repeatCooldown: { mode: "SET", value: Number.MAX_SAFE_INTEGER },
    intensity: { mode: "SET", value: 5 },
    weight: { mode: "SET", value: Number.MAX_VALUE },
    socialSensitivity: { mode: "SET", value: "CLOSE_PERSONAL" },
    playerCount: {
        mode: "SET",
        value: { minimum: Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
    },
} as const;

export function maximumPolicyRule(index = 1, name = "界".repeat(100)) {
    return cardPolicyRuleSchema.parse({
        id: capacityId(index),
        name,
        enabled: false,
        order: Number.MAX_SAFE_INTEGER,
        predicate: {
            cardTypes: Object.values(CARD_TYPES),
            questionCategoryIds: Object.values(QUESTION_CATEGORIES),
            dareTypeIds: Object.values(DARE_TYPES),
            dareAffinityCategoryIds: Object.values(QUESTION_CATEGORIES),
            socialSensitivities: Object.values(SOCIAL_SENSITIVITIES),
            operationalFlagsAll: Object.values(OPERATIONAL_FLAGS),
            operationalFlagsAny: Object.values(OPERATIONAL_FLAGS),
            operationalFlagsNone: Object.values(OPERATIONAL_FLAGS),
            yesNoAnswerPossible: true,
            minimumIntensity: 1,
            maximumIntensity: 5,
            alwaysEligible: false,
            repeatableInSession: false,
            minimumRepeatCooldown: Number.MAX_SAFE_INTEGER,
            maximumRepeatCooldown: Number.MAX_SAFE_INTEGER,
            minimumWeight: Number.MAX_VALUE,
            maximumWeight: Number.MAX_VALUE,
            minimumPlayerCountAtLeast: Number.MAX_SAFE_INTEGER,
            maximumPlayerCountAtMost: Number.MAX_SAFE_INTEGER,
            lifecycle: "RETIRED",
        },
        directives: maximumDirectives,
    });
}

export function maximumSessionPolicy(name?: string) {
    return sessionCardPolicySchema.parse({
        scopeDefault: maximumDirectives,
        conditionalRules: Array.from({ length: MAX_POLICY_RULES }, (_, i) =>
            maximumPolicyRule(i + 1, name),
        ),
        exactCards: Array.from({ length: MAX_SESSION_EXACT_CARDS }, (_, i) => ({
            cardId: capacityId(i + 1),
            directives: maximumDirectives,
        })),
    });
}

export function maximumRoomSettings() {
    const settings = defaultRoomGameSettings();
    return {
        ...settings,
        profileId: "PROFILE_CUSTOM",
        mode: "NEVER_HAVE_I_EVER" as const,
        adultContentConfirmed: true,
        neverHaveIEverRevealMode: "NAMED_ANSWERS" as const,
        cardFallbackEnabled: true,
        cardFallbackLocales: Array.from(
            { length: 100 },
            (_, i) => `en-${String(i).padStart(3, "0")}-${"a".repeat(28)}`,
        ),
        cardPolicy: maximumSessionPolicy(),
        configuration: {
            ...settings.configuration,
            enabledQuestionCategoryIds: Object.values(QUESTION_CATEGORIES),
            enabledDareTypeIds: Object.values(DARE_TYPES),
            blockedOperationalFlags: Object.values(OPERATIONAL_FLAGS),
        },
    };
}
