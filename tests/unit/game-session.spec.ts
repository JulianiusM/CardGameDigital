import { describe, expect, it } from "vitest";
import {
    CARD_TYPES,
    DARE_TYPES,
    GAME_MODES,
    GameSession,
    InvalidGameStateError,
    NEVER_HAVE_I_EVER_REVEAL_MODES,
    OPERATIONAL_FLAGS,
    QUESTION_CATEGORIES,
    SESSION_STATES,
    SequenceRandomSource,
    StaleSessionRevisionError,
} from "../../packages/game-core";
import { boundaries, card, profile } from "../support/game";
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
    it("owns and discards boundaries when players leave or the Session ends", () => {
        const supplied = new Map([
            ["a", boundaries({ disabledDareTypeIds: new Set([DARE_TYPES.NUDITY]) })],
            [
                "b",
                boundaries({
                    disabledQuestionCategoryIds: new Set([QUESTION_CATEGORIES.SEX_EXPERIENCE]),
                }),
            ],
            ["outside-roster", boundaries()],
        ]);
        const session = new GameSession(
            {
                id: "private-lifecycle",
                mode: GAME_MODES.CLASSIC,
                players,
                profile: profile(),
                cardLocale: "en-GB",
                boundariesByPlayer: supplied,
            },
            new SequenceRandomSource([0]),
        );
        expect(session.toRuntimeState().boundariesByPlayer.map(([id]) => id)).toEqual(["a", "b"]);
        session.removePlayers(0, new Set(["b"]));
        const active = session.toRuntimeState();
        expect(active.boundariesByPlayer.map(([id]) => id)).toEqual(["a"]);
        session.end(1);
        expect(session.toRuntimeState().boundariesByPlayer).toEqual([]);
        expect(supplied.size).toBe(3);
        expect(
            GameSession.restore(
                { ...active, state: SESSION_STATES.ENDED },
                new SequenceRandomSource([0]),
            ).toRuntimeState().boundariesByPlayer,
        ).toEqual([]);
    });
    it("runs Classic turns, records skipped revealed cards, rotates players and completes rounds", async () => {
        const session = new GameSession(
            { id: "s", mode: GAME_MODES.CLASSIC, players, profile: profile(), cardLocale: "en-GB" },
            new SequenceRandomSource([0]),
        );
        expect(session.activePlayer?.id).toBe("a");
        await session.chooseCardType(0, CARD_TYPES.QUESTION, [repeatQuestion]);
        expect(session.state).toBe(SESSION_STATES.SHOWING_CARD);
        await session.skipCard(1, [card({ id: "replacement" as never })]);
        expect(session.sessionHistory[0]).toMatchObject({
            skipped: true,
            completed: false,
            vetoed: false,
        });
        session.advance(2);
        expect(session.sessionHistory[1]).toMatchObject({
            skipped: false,
            completed: true,
            vetoed: false,
        });
        expect(session.activePlayer?.id).toBe("b");
        await session.chooseCardType(3, CARD_TYPES.DARE, [repeatDare]);
        session.advance(4);
        expect(session.roundNumber).toBe(2);
        expect(session.activePlayer?.id).toBe("a");
    });
    it("projects the distinct authoritative Card pool remaining after history", async () => {
        const session = new GameSession(
            {
                id: "pool",
                mode: GAME_MODES.CLASSIC,
                players,
                profile: profile(),
                cardLocale: "en-GB",
            },
            new SequenceRandomSource([0]),
        );
        const first = card({ id: "first" as never });
        const second = card({ id: "second" as never });
        const dare = card({
            id: "pool-dare" as never,
            cardType: CARD_TYPES.DARE,
            questionCategoryId: null,
            dareTypeId: DARE_TYPES.SILLY,
        });
        const cards = [first, second, dare];
        expect(await session.remainingEligibleCardCount(cards)).toBe(3);
        await session.chooseCardType(0, CARD_TYPES.QUESTION, cards);
        expect(await session.remainingEligibleCardCount(cards)).toBe(2);
    });
    it("applies captured sparse policy before Group history", async () => {
        const seen = card({ id: "captured-history" as never });
        const session = new GameSession(
            {
                id: "s",
                mode: GAME_MODES.CLASSIC,
                players,
                profile: profile(),
                cardLocale: "en-GB",
                groupHistoryCardIds: new Set([seen.id]),
                policySnapshot: {
                    dataSpace: {
                        scopeDefault: { alwaysEligible: "ENABLE" },
                        conditionalRules: [],
                        exactCards: [],
                    },
                    group: null,
                },
            },
            new SequenceRandomSource([0]),
        );
        expect(await session.remainingEligibleCardCount([seen])).toBe(1);
        expect((await session.chooseCardType(0, CARD_TYPES.QUESTION, [seen])).id).toBe(seen.id);
    });
    it("rejects stale revisions and commands invalid for the current mode/state", async () => {
        const session = new GameSession(
            { id: "s", mode: GAME_MODES.CLASSIC, players, profile: profile(), cardLocale: "en-GB" },
            new SequenceRandomSource([0]),
        );
        await expect(
            session.chooseCardType(1, CARD_TYPES.QUESTION, [repeatQuestion]),
        ).rejects.toThrow(StaleSessionRevisionError);
        expect(() => session.advance(0)).toThrow(InvalidGameStateError);
        expect(session.revision).toBe(0);
    });
    it("commits refusal and offers another type when the replacement pool is exhausted", async () => {
        const session = new GameSession(
            { id: "s", mode: GAME_MODES.CLASSIC, players, profile: profile(), cardLocale: "en-GB" },
            new SequenceRandomSource([0]),
        );
        await session.chooseCardType(0, CARD_TYPES.QUESTION, [card({ id: "one-off" as never })]);
        expect(await session.skipCard(1, [session.currentCard!, repeatDare])).toBeNull();
        expect(session.revision).toBe(2);
        expect(session.currentCard).toBeNull();
        expect(session.state).toBe(SESSION_STATES.CHOOSING_CARD_TYPE);
        expect(session.sessionHistory).toHaveLength(1);
        expect(session.sessionHistory[0].skipped).toBe(true);
        expect((await session.chooseCardType(2, CARD_TYPES.DARE, [repeatDare])).id).toBe(
            repeatDare.id,
        );
    });
    it("records private veto separately from an ordinary skip", async () => {
        const session = new GameSession(
            { id: "s", mode: GAME_MODES.CLASSIC, players, profile: profile(), cardLocale: "en-GB" },
            new SequenceRandomSource([0]),
        );
        await session.chooseCardType(0, CARD_TYPES.QUESTION, [repeatQuestion]);
        await session.vetoCard(1, [card({ id: "veto-replacement" as never })]);
        expect(session.sessionHistory[0]).toMatchObject({
            skipped: false,
            completed: false,
            vetoed: true,
        });
    });
    it("runs Never Have I Ever with only yes/no questions and synchronized aggregate voting", async () => {
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
        await session.startTurn(0, [repeatQuestion, yesNo]);
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
    it("freezes the Never Have I Ever voter set for the current card", async () => {
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
        await session.startTurn(0, [
            card({ id: "fixed-voter-card" as never, yesNoAnswerPossible: true }),
        ]);
        session.addPlayers(1, [{ id: "late", name: "Late" }], new Map([["late", boundaries()]]));
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
                startedAt: 123456,
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
        expect(restored.startedAt).toBe(123456);
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
    it("adds a newly connected player once without resetting active play", async () => {
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
        await session.chooseCardType(0, CARD_TYPES.QUESTION, [repeatQuestion]);
        session.addPlayers(1, [{ id: "c", name: "Carla" }], new Map([["c", boundaries()]]));
        session.addPlayers(2, [{ id: "c", name: "Carla" }], new Map([["c", boundaries()]]));
        expect(session.players.map(({ id }) => id)).toEqual(["a", "b", "c"]);
        expect(session.activePlayer?.id).toBe("a");
        expect(session.currentCard?.id).toBe(repeatQuestion.id);
        expect(session.revision).toBe(2);
    });
    it("abandons an active player's Card when that player leaves", async () => {
        const session = new GameSession(
            {
                id: "active-player-left",
                mode: GAME_MODES.CLASSIC,
                players,
                profile: profile(),
                cardLocale: "en-GB",
            },
            new SequenceRandomSource([0]),
        );
        await session.chooseCardType(0, CARD_TYPES.QUESTION, [repeatQuestion]);
        session.removePlayers(1, new Set(["a"]));
        expect(session.activePlayer?.id).toBe("b");
        expect(session.currentCard).toBeNull();
        expect(session.state).toBe(SESSION_STATES.CHOOSING_CARD_TYPE);
        expect(session.revision).toBe(2);
    });
    it("keeps question and dare profile configuration independent", async () => {
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
        await expect(session.chooseCardType(0, CARD_TYPES.DARE, [repeatDare])).rejects.toThrowError(
            /game.cardPoolExhausted/,
        );
        expect(session.revision).toBe(0);
    });
    it("applies every player's private boundaries to Let's Talk conversation cards", async () => {
        const session = new GameSession(
            {
                id: "lets-talk-boundaries",
                mode: GAME_MODES.LETS_TALK,
                players,
                profile: profile({ letsTalkMetaInterval: 1 }),
                boundariesByPlayer: new Map([
                    [
                        "b",
                        boundaries({
                            blockedOperationalFlags: new Set([
                                OPERATIONAL_FLAGS.REQUIRES_PHYSICAL_CONTACT,
                            ]),
                        }),
                    ],
                ]),
                cardLocale: "en-GB",
            },
            new SequenceRandomSource([0]),
        );
        const question = card({ id: "question" as never, repeatableInSession: true });
        const blockedConversation = card({
            id: "blocked-conversation" as never,
            cardType: CARD_TYPES.CONVERSATION_META,
            questionCategoryId: null,
            operationalFlags: [OPERATIONAL_FLAGS.REQUIRES_PHYSICAL_CONTACT],
        });
        const allowedConversation = card({
            id: "allowed-conversation" as never,
            cardType: CARD_TYPES.CONVERSATION_META,
            questionCategoryId: null,
        });
        await session.startTurn(0, [question, blockedConversation, allowedConversation]);
        session.advance(1);
        await session.startTurn(2, [question, blockedConversation, allowedConversation]);
        expect(session.currentCard?.id).toBe(allowedConversation.id);
    });
});
