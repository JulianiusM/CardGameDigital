import { describe, expect, it } from "vitest";
import {
    CARD_TYPES,
    GAME_MODES,
    GameSession,
    SequenceRandomSource,
} from "../../src/packages/game-core";
import { card, profile } from "../support/game";

const players = [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
];

describe("deterministic game simulations", () => {
    it("balances Random Wahrheit oder Pflicht toward the configured target and caps streaks", () => {
        const session = new GameSession(
            {
                id: "random",
                mode: GAME_MODES.RANDOM,
                players,
                cardLocale: "en-GB",
                profile: profile({ randomQuestionRatio: 0.6, maximumTypeStreak: 3 }),
            },
            new SequenceRandomSource([0.2, 0.8, 0.4]),
        );
        const cards = [
            card({ id: "q" as never, repeatableInSession: true }),
            card({
                id: "d" as never,
                cardType: CARD_TYPES.DARE,
                questionCategoryId: null,
                dareTypeId: "DARE_SILLY",
                repeatableInSession: true,
            }),
        ];
        const sequence: string[] = [];
        for (let turn = 0; turn < 1000; turn++) {
            sequence.push(session.startTurn(session.revision, cards).cardType);
            session.advance(session.revision);
        }
        const ratio =
            sequence.filter((type) => type === CARD_TYPES.QUESTION).length / sequence.length;
        expect(ratio).toBeCloseTo(0.6, 2);
        expect(sequence.join(",")).not.toMatch(
            /QUESTION,QUESTION,QUESTION,QUESTION|DARE,DARE,DARE,DARE/,
        );
    });

    it("schedules Gespräch separately and continues normal questions after meta exhaustion", () => {
        const session = new GameSession(
            {
                id: "talk",
                mode: GAME_MODES.LETS_TALK,
                players,
                cardLocale: "en-GB",
                profile: profile({ letsTalkMetaInterval: 2 }),
            },
            new SequenceRandomSource([0]),
        );
        const cards = [
            card({ id: "q" as never, repeatableInSession: true }),
            card({
                id: "m1" as never,
                cardType: CARD_TYPES.CONVERSATION,
                questionCategoryId: null,
            }),
            card({
                id: "m2" as never,
                cardType: CARD_TYPES.CONVERSATION,
                questionCategoryId: null,
            }),
        ];
        const types: string[] = [];
        for (let turn = 0; turn < 9; turn++) {
            types.push(session.startTurn(session.revision, cards).cardType);
            session.advance(session.revision);
        }
        expect(types).toEqual([
            "QUESTION",
            "QUESTION",
            "CONVERSATION",
            "QUESTION",
            "QUESTION",
            "CONVERSATION",
            "QUESTION",
            "QUESTION",
            "QUESTION",
        ]);
    });
});
