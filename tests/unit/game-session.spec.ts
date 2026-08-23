import { describe, expect, it } from "vitest";
import {
    CARD_TYPES,
    DARE_TYPES,
    GAME_MODES,
    GameSession,
    InvalidGameStateError,
    NEVER_HAVE_I_EVER_REVEAL_MODES,
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
        expect(session.neverHaveIEverRevealMode).toBe(
            NEVER_HAVE_I_EVER_REVEAL_MODES.ANONYMOUS_AGGREGATE,
        );
        session.submitVote(1, "a", "YES");
        session.submitVote(2, "b", "NO");
        expect(session.state).toBe(SESSION_STATES.SHOWING_RESULTS);
        expect(session.voteResult()).toEqual({ yes: 1, no: 1, total: 2 });
        session.advance(3);
        expect(session.state).toBe(SESSION_STATES.WAITING_FOR_PLAYER);
    });

    it("freezes the Never Have I Ever voter set for the current card", () => {
        const session = new GameSession(
            {
                id: "fixed-voters",
                mode: GAME_MODES.NEVER_HAVE_I_EVER,
                players,
                profile: profile(),
                cardLocale: "en-GB",
                neverHaveIEverRevealMode: NEVER_HAVE_I_EVER_REVEAL_MODES.NAMED_ANSWERS,
            },
            new SequenceRandomSource([0]),
        );
        session.startTurn(0, [
            card({ id: "fixed-voter-card" as never, yesNoAnswerPossible: true }),
        ]);
        session.addPlayers(1, [{ id: "late", name: "Late" }]);

        expect(session.votingPlayers.map(({ id }) => id)).toEqual(["a", "b"]);
        expect(() => session.submitVote(2, "late", "YES")).toThrow(/game.unknownPlayer/);
        session.submitVote(2, "a", "YES");
        session.submitVote(3, "b", "NO");
        expect(session.state).toBe(SESSION_STATES.SHOWING_RESULTS);

        const restored = GameSession.restore(
            JSON.parse(JSON.stringify(session.toRuntimeState())),
            new SequenceRandomSource([0]),
        );
        expect(restored.votingPlayers.map(({ id }) => id)).toEqual(["a", "b"]);
        expect(restored.neverHaveIEverRevealMode).toBe(
            NEVER_HAVE_I_EVER_REVEAL_MODES.NAMED_ANSWERS,
        );
    });

    it("restores a Session below the creation minimum and can still end it", () => {
        const session = new GameSession(
            {
                id: "shrinking-session",
                startedAt: 123_456,
                mode: GAME_MODES.CLASSIC,
                players,
                profile: profile(),
                cardLocale: "en-GB",
            },
            new SequenceRandomSource([0]),
        );
        session.removePlayers(0, new Set(["b"]));

        const restored = GameSession.restore(
            session.toRuntimeState(),
            new SequenceRandomSource([0]),
        );
        expect(restored.players.map(({ id }) => id)).toEqual(["a"]);
        expect(restored.startedAt).toBe(123_456);
        expect(() => restored.end(1)).not.toThrow();
        expect(restored.state).toBe(SESSION_STATES.ENDED);
    });

    it("restores an ended Session after its final player has left", () => {
        const session = new GameSession(
            {
                id: "empty-session",
                mode: GAME_MODES.RANDOM,
                players,
                profile: profile(),
                cardLocale: "en-GB",
            },
            new SequenceRandomSource([0]),
        );
        session.removePlayers(0, new Set(players.map(({ id }) => id)));

        const restored = GameSession.restore(
            JSON.parse(JSON.stringify(session.toRuntimeState())),
            new SequenceRandomSource([0]),
        );

        expect(restored.players).toEqual([]);
        expect(restored.state).toBe(SESSION_STATES.ENDED);
        expect(restored.activePlayer).toBeNull();
    });

    it("adds a newly connected player once without resetting active play", () => {
        const session = new GameSession(
            {
                id: "join",
                mode: GAME_MODES.CLASSIC,
                players,
                profile: profile(),
                cardLocale: "en-GB",
            },
            new SequenceRandomSource([0]),
        );
        session.chooseCardType(0, CARD_TYPES.QUESTION, [repeatQuestion]);
        session.addPlayers(1, [{ id: "c", name: "Carla" }]);
        session.addPlayers(2, [{ id: "c", name: "Carla" }]);

        expect(session.players.map(({ id }) => id)).toEqual(["a", "b", "c"]);
        expect(session.activePlayer?.id).toBe("a");
        expect(session.currentCard?.id).toBe(repeatQuestion.id);
        expect(session.revision).toBe(2);
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
