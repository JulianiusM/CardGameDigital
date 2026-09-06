import type { CardId } from "../index";

export type CardAppearance = {
    cardId: CardId;
    sequence: number;
    roundNumber: number;
    playerId: string | null;
    skipped: boolean;
    completed: boolean;
    vetoed: boolean;
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
    lastSequenceByCardId?: ReadonlyMap<CardId, number>,
    cardsShown = sessionHistory.length,
): boolean {
    let lastSequence = lastSequenceByCardId?.get(card.id);
    if (!lastSequenceByCardId) {
        for (let index = sessionHistory.length - 1; index >= 0; index--) {
            if (sessionHistory[index].cardId === card.id) {
                lastSequence = sessionHistory[index].sequence;
                break;
            }
        }
    }
    if (lastSequence !== undefined && !card.repeatableInSession) return false;
    if (lastSequence !== undefined && cardsShown - lastSequence < card.repeatCooldown) return false;
    if (groupHistoryCardIds.has(card.id) && !card.alwaysEligible) return false;
    return true;
}
