import type { CardId } from "../index";

export type CardAppearance = {
    cardId: CardId;
    sequence: number;
    roundNumber: number;
    playerId: string | null;
    skipped: boolean;
};

export function isAllowedByHistory(
    card: {
        id: CardId;
        alwaysEligible: boolean;
        repeatableInSession: boolean;
        repeatCooldown: number;
    },
    sessionHistory: readonly CardAppearance[],
    groupHistoryCardIds: ReadonlySet<CardId>,
): boolean {
    const sessionAppearances = sessionHistory.filter((entry) => entry.cardId === card.id);
    if (sessionAppearances.length && !card.repeatableInSession) return false;
    if (sessionAppearances.length) {
        const last = sessionAppearances[sessionAppearances.length - 1];
        const otherCardsSince = sessionHistory.length - last.sequence;
        if (otherCardsSince < card.repeatCooldown) return false;
    }
    if (groupHistoryCardIds.has(card.id) && !card.alwaysEligible) return false;
    return true;
}
