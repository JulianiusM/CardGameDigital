import { MESSAGE_KEYS } from "../../localization/keys";
import type { Card } from "../cards/card";
import type { RandomSource } from "../random/randomSource";

export class CardPoolExhaustedError extends Error {
    readonly code = "CARD_POOL_EXHAUSTED";
    constructor() {
        super(MESSAGE_KEYS.GAME_CARD_POOL_EXHAUSTED);
        this.name = "CardPoolExhaustedError";
    }
}

export function selectWeighted<T extends Card>(cards: readonly T[], random: RandomSource): T {
    if (!cards.length) throw new CardPoolExhaustedError();
    const total = cards.reduce((sum, card) => sum + card.weight, 0);
    let cursor = random.nextFloat() * total;
    for (const card of cards) {
        cursor -= card.weight;
        if (cursor < 0) return card;
    }
    return cards.at(-1)!;
}
