import {
    CARD_TYPES,
    DARE_TYPES,
    GAME_MODES,
    SOCIAL_SENSITIVITIES,
    eligibilityReasons,
    maximumGlobalIntensityScore,
    type GameMode,
    type GameProfile,
    type Card,
} from "../game-core";

/** Consent covers the full configured progression, including policy overrides.
 * History, today's roster and private exclusions cannot stand in for confirmation.
 * Lowering a Card's sensitivity through policy cannot remove its adult classification.
 */
export function requiresAdultConfirmation(input: {
    mode: GameMode;
    profile: GameProfile;
    cards: readonly Card[];
    effectiveCards: readonly Card[];
}): boolean {
    const originals = new Map(input.cards.map((card) => [card.id, card]));
    return input.effectiveCards.some((card) => {
        const original = originals.get(card.id) ?? card;
        const adult =
            original.socialSensitivity === SOCIAL_SENSITIVITIES.EXPLICIT ||
            card.socialSensitivity === SOCIAL_SENSITIVITIES.EXPLICIT ||
            card.dareTypeId === DARE_TYPES.BORDERLINE_SEX ||
            card.dareTypeId === DARE_TYPES.SEX;
        if (!adult) return false;
        if (input.mode === GAME_MODES.NEVER_HAVE_I_EVER && card.cardType !== CARD_TYPES.QUESTION)
            return false;
        if (input.mode === GAME_MODES.LETS_TALK && card.cardType === CARD_TYPES.DARE) return false;
        if (
            (input.mode === GAME_MODES.CLASSIC || input.mode === GAME_MODES.RANDOM) &&
            card.cardType === CARD_TYPES.CONVERSATION_META
        )
            return false;
        const reasons = eligibilityReasons(card, {
            cardType: card.cardType,
            requireYesNoAnswer: input.mode === GAME_MODES.NEVER_HAVE_I_EVER,
            profile: input.profile,
            boundaries: [],
            maximumIntensityScore: maximumGlobalIntensityScore(input.profile.maximumIntensity),
            sessionHistory: [],
            groupHistoryCardIds: new Set(),
        });
        return reasons.every((reason) => reason === "HISTORY" || reason === "PLAYER_COUNT");
    });
}
