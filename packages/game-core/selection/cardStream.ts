import type { Card, CardId } from "../index";
import type { RandomSource } from "../random/randomSource";

/** Metadata only. Persistent adapters attach indexed history facts for this page. */
export type CardCandidate = Card & {
    lastShownSequence?: number | null;
    seenInGroup?: boolean;
};
export type CardStream = AsyncIterable<CardCandidate> | Iterable<CardCandidate>;

export type GroupHistoryWindow = {
    groupId: string;
    after: number | null;
    before: number;
};
export type CardHistoryContext = {
    sessionId: string;
    topology: "ROOM" | "COUCH";
    group: GroupHistoryWindow | null;
};

/** Exponential race in log space: probability is weight / total weight, including
 * extreme finite weights without overflow or underflow in the score calculation.
 * Page order, previous appearances and cooldown expiry confer no preference. Only
 * one candidate is retained; the complete stream must be consumed before revealing. */
export class WeightedCardReservoir {
    count = 0;
    selected: Card | null = null;
    private score = Infinity;

    add(card: Card, random?: RandomSource): void {
        this.count++;
        if (!random) return;
        if (!Number.isFinite(card.weight) || card.weight <= 0)
            throw new RangeError("Card weight must be positive and finite");
        const score =
            Math.log(-Math.log1p(-Math.max(Number.MIN_VALUE, random.nextFloat()))) -
            Math.log(card.weight);
        if (this.selected === null || score < this.score) {
            // Discard query/history facts. No localization enters this object.
            const {
                lastShownSequence: _last,
                seenInGroup: _seen,
                ...metadata
            } = card as CardCandidate;
            this.selected = metadata;
            this.score = score;
        }
    }
}

export type SessionHistoryIndex = readonly [CardId, number][];
