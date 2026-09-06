import {
    sessionPolicyResolver,
    type GameSession,
    type CardStream,
    type CardCandidate,
    type PlayableCard,
} from "../game-core";
import type { CardLocalizationPolicy, CardRepository } from "./repositories";
import { requiresAdultConfirmation } from "./adultConfirmation";
import { MESSAGE_KEYS } from "../localization/keys";

/** Text is read only for the currently displayed Card, never for draw candidates. */
export async function currentSessionCard(
    session: GameSession,
    cards: CardRepository,
    localization: CardLocalizationPolicy,
): Promise<PlayableCard | null> {
    if (!session.currentCard) return null;
    const rendering = await cards.getById(session.currentCard.id, localization);
    if (!rendering)
        throw Object.assign(new Error(MESSAGE_KEYS.GAME_STALE_REVISION), {
            code: "STALE_SESSION_REVISION",
        });
    return { ...session.currentCard, cardText: rendering.cardText, locale: rendering.locale };
}

export async function* consentCheckedCards(
    session: GameSession,
    cards: CardStream,
    confirmed: boolean,
): AsyncIterable<CardCandidate> {
    const resolve = sessionPolicyResolver(session.policySnapshot, session.sessionCardPolicy);
    for await (const card of cards) {
        if (
            !confirmed &&
            requiresAdultConfirmation({
                mode: session.mode,
                profile: session.profile,
                cards: [card],
                effectiveCards: [resolve(card)],
            })
        )
            throw Object.assign(new Error(MESSAGE_KEYS.GAME_ADULT_CONFIRMATION_REQUIRED), {
                code: "VALIDATION_ERROR",
            });
        yield card;
    }
}
