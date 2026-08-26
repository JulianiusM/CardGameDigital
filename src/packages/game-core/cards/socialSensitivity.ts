export const SOCIAL_SENSITIVITIES = {
    GENERAL: "GENERAL",
    PERSONAL: "PERSONAL",
    CLOSE_PERSONAL: "CLOSE_PERSONAL",
    DEEP_PERSONAL: "DEEP_PERSONAL",
    INTIMATE: "INTIMATE",
    EXPLICIT: "EXPLICIT",
} as const;

export type SocialSensitivity = (typeof SOCIAL_SENSITIVITIES)[keyof typeof SOCIAL_SENSITIVITIES];

export const SOCIAL_SENSITIVITY_ORDER: readonly SocialSensitivity[] = Object.freeze([
    SOCIAL_SENSITIVITIES.GENERAL,
    SOCIAL_SENSITIVITIES.PERSONAL,
    SOCIAL_SENSITIVITIES.CLOSE_PERSONAL,
    SOCIAL_SENSITIVITIES.DEEP_PERSONAL,
    SOCIAL_SENSITIVITIES.INTIMATE,
    SOCIAL_SENSITIVITIES.EXPLICIT,
]);

export function compareSocialSensitivity(
    left: SocialSensitivity,
    right: SocialSensitivity,
): number {
    return SOCIAL_SENSITIVITY_ORDER.indexOf(left) - SOCIAL_SENSITIVITY_ORDER.indexOf(right);
}
