import { describe, expect, it } from "vitest";
import {
    CARD_TYPES,
    DARE_TYPES,
    GAME_MODES,
    GameSession,
    InvalidGameStateError,
    QUESTION_CATEGORIES,
    SESSION_STATES,
    SequenceRandomSource,
    StaleSessionRevisionError,
} from "../../src/packages/game-core";
import { card, profile } from "../support/game";

const players = [
    { id: "a", name: "Anna" },
    { id: "b", name: "Ben" },
];
const repeatQuestion = card({ id: "q" as never, repeatableInSession: true });
const repeatDare = card({
    id: "d" as never,
    cardType: CARD_TYPES.DARE,
    questionCategoryId: null,
    dareTypeId: DARE_TYPES.SILLY,
    repeatableInSession: true,
});

describe("shared GameSession state machine", () => {
    it("runs Classic turns, records skipped revealed cards, rotates players and completes rounds", () => {
        const session = new GameSession(
            { id: "s", mode: GAME_MODES.CLASSIC, players, profile: profile(), cardLocale: "en-GB" },
            new SequenceRandomSource([0]),
        );
        expect(session.activePlayer?.id).toBe("a");
        session.chooseCardType(0, CARD_TYPES.QUESTION, [repeatQuestion]);
        expect(session.state).toBe(SESSION_STATES.SHOWING_CARD);
        session.skipCard(1, [card({ id: "replacement" as never })]);
        expect(session.sessionHistory[0].skipped).toBe(true);
        session.advance(2);
        expect(session.activePlayer?.id).toBe("b");
        session.chooseCardType(3, CARD_TYPES.DARE, [repeatDare]);
        session.advance(4);
        expect(session.roundNumber).toBe(2);
        expect(session.activePlayer?.id).toBe("a");
    });

    it("rejects stale revisions and commands invalid for the current mode/state", () => {
        const session = new GameSession(
            { id: "s", mode: GAME_MODES.CLASSIC, players, profile: profile(), cardLocale: "en-GB" },
            new SequenceRandomSource([0]),
        );
        expect(() => session.chooseCardType(1, CARD_TYPES.QUESTION, [repeatQuestion])).toThrow(
            StaleSessionRevisionError,
        );
        expect(() => session.advance(0)).toThrow(InvalidGameStateError);
        expect(session.revision).toBe(0);
    });

    it("does not mutate authoritative history when a skip replacement is exhausted", () => {
        const session = new GameSession(
            { id: "s", mode: GAME_MODES.CLASSIC, players, profile: profile(), cardLocale: "en-GB" },
            new SequenceRandomSource([0]),
        );
        session.chooseCardType(0, CARD_TYPES.QUESTION, [card({ id: "one-off" as never })]);
        expect(() => session.skipCard(1, [session.currentCard!])).toThrowError(
            /game.cardPoolExhausted/,
        );
        expect(session.revision).toBe(1);
        expect(session.sessionHistory).toHaveLength(1);
        expect(session.sessionHistory[0].skipped).toBe(false);
    });

    it("runs Never Have I Ever with only yes/no questions and synchronized aggregate voting", () => {
        const session = new GameSession(
            {
                id: "s",
                mode: GAME_MODES.NEVER_HAVE_I_EVER,
                players,
                profile: profile(),
                cardLocale: "en-GB",
            },
            new SequenceRandomSource([0]),
        );
        const yesNo = card({ id: "yes" as never, yesNoAnswerPossible: true });
        session.startTurn(0, [repeatQuestion, yesNo]);
        expect(session.currentCard?.id).toBe(yesNo.id);
        expect(session.activePlayer).toBeNull();
        session.submitVote(1, "a", "YES");
        session.submitVote(2, "b", "NO");
        expect(session.state).toBe(SESSION_STATES.SHOWING_RESULTS);
        expect(session.voteResult()).toEqual({ yes: 1, no: 1, total: 2 });
        session.advance(3);
        expect(session.state).toBe(SESSION_STATES.WAITING_FOR_PLAYER);
    });

    it("keeps question and dare profile configuration independent", () => {
        const restrictive = profile({
            enabledQuestionCategoryIds: new Set([QUESTION_CATEGORIES.EVERYDAY]),
            enabledDareTypeIds: new Set(),
        });
        const session = new GameSession(
            {
                id: "s",
                mode: GAME_MODES.CLASSIC,
                players,
                profile: restrictive,
                cardLocale: "en-GB",
            },
            new SequenceRandomSource([0]),
        );
        expect(() => session.chooseCardType(0, CARD_TYPES.DARE, [repeatDare])).toThrowError(
            /game.cardPoolExhausted/,
        );
        expect(session.revision).toBe(0);
    });
});
