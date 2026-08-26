import { describe, expect, it } from "vitest";
import {
    CARD_TYPES,
    DARE_TYPE_INTENSITY_BASE_OFFSETS,
    DARE_TYPES,
    GAME_MODES,
    GameSession,
    INTENSITY_PROGRESSION_UNITS,
    QUESTION_CATEGORY_INTENSITY_BASE_OFFSETS,
    QUESTION_CATEGORIES,
    SequenceRandomSource,
    globalCardIntensityLevel,
    globalCardIntensityScore,
    intensityMaximumScoreForProgress,
} from "../../src/packages/game-core";
import { card, profile } from "../support/game";

const players = [
    { id: "a", name: "Anna" },
    { id: "b", name: "Ben" },
];

describe("global Card intensity", () => {
    it("allows adjacent taxonomy ranges to overlap without collapsing distant content", () => {
        const strongestEveryday = card({ id: "everyday-high" as never, intensity: 5 });
        const mildestPersonal = card({
            id: "personal-low" as never,
            questionCategoryId: QUESTION_CATEGORIES.PERSONALITY,
            intensity: 1,
        });
        const strongestPersonal = card({
            id: "personal-high" as never,
            questionCategoryId: QUESTION_CATEGORIES.PERSONALITY,
            intensity: 5,
        });
        const mildestRelationship = card({
            id: "relationship-low" as never,
            questionCategoryId: QUESTION_CATEGORIES.RELATIONSHIP,
            intensity: 1,
        });
        const mildestSexualDare = card({
            id: "sexual-dare-low" as never,
            cardType: CARD_TYPES.DARE,
            questionCategoryId: null,
            dareTypeId: DARE_TYPES.SEX,
            intensity: 1,
        });

        expect(globalCardIntensityScore(strongestEveryday)).toBeGreaterThan(
            globalCardIntensityScore(mildestPersonal),
        );
        expect(globalCardIntensityScore(strongestPersonal)).toBeGreaterThan(
            globalCardIntensityScore(mildestRelationship),
        );
        expect(globalCardIntensityScore(strongestPersonal)).toBeLessThan(
            globalCardIntensityScore(mildestSexualDare),
        );
        expect(globalCardIntensityLevel(strongestEveryday)).toBe(2);
        expect(globalCardIntensityLevel(mildestPersonal)).toBe(1);
        expect(globalCardIntensityLevel(mildestSexualDare)).toBe(4);
    });

    it("applies configurable start, end, unit, interval, and smooth increment", () => {
        const base = {
            startingIntensity: 2 as const,
            maximumIntensity: 5 as const,
            intensityProgressionInterval: 2,
            intensityProgressionIncrement: 1,
        };
        expect(
            intensityMaximumScoreForProgress(
                { ...base, intensityProgressionUnit: INTENSITY_PROGRESSION_UNITS.ROUNDS },
                { roundNumber: 1, cardsShown: 99 },
            ),
        ).toBe(8);
        expect(
            intensityMaximumScoreForProgress(
                { ...base, intensityProgressionUnit: INTENSITY_PROGRESSION_UNITS.ROUNDS },
                { roundNumber: 3, cardsShown: 0 },
            ),
        ).toBe(9);
        expect(
            intensityMaximumScoreForProgress(
                { ...base, intensityProgressionUnit: INTENSITY_PROGRESSION_UNITS.CARDS },
                { roundNumber: 1, cardsShown: 4 },
            ),
        ).toBe(10);
        expect(
            intensityMaximumScoreForProgress(
                { ...base, intensityProgressionUnit: INTENSITY_PROGRESSION_UNITS.CARDS },
                { roundNumber: 1, cardsShown: 99 },
            ),
        ).toBe(20);
    });

    it("supports half-point progression without crossing the configured end", () => {
        const progression = {
            startingIntensity: 1 as const,
            maximumIntensity: 2 as const,
            intensityProgressionUnit: INTENSITY_PROGRESSION_UNITS.CARDS,
            intensityProgressionInterval: 2,
            intensityProgressionIncrement: 0.5,
        };

        expect(
            intensityMaximumScoreForProgress(progression, { roundNumber: 1, cardsShown: 1 }),
        ).toBe(4);
        expect(
            intensityMaximumScoreForProgress(progression, { roundNumber: 1, cardsShown: 2 }),
        ).toBe(4.5);
        expect(
            intensityMaximumScoreForProgress(progression, { roundNumber: 1, cardsShown: 4 }),
        ).toBe(5);
        expect(
            intensityMaximumScoreForProgress(progression, { roundNumber: 1, cardsShown: 99 }),
        ).toBe(8);
    });

    it("increases round-based intensity after the configured number of complete rounds", () => {
        const mild = card({ id: "mild" as never, intensity: 4, repeatableInSession: true });
        const nextLevel = card({
            id: "next-level" as never,
            intensity: 5,
            repeatableInSession: true,
        });
        const session = new GameSession(
            {
                id: "round-progression",
                mode: GAME_MODES.CLASSIC,
                players,
                profile: profile({
                    maximumIntensity: 2,
                    intensityProgressionUnit: INTENSITY_PROGRESSION_UNITS.ROUNDS,
                    intensityProgressionInterval: 1,
                }),
                cardLocale: "en-GB",
            },
            new SequenceRandomSource([0]),
        );

        expect(session.currentMaximumIntensityScore).toBe(4);
        expect(() => session.chooseCardType(0, CARD_TYPES.QUESTION, [nextLevel])).toThrow(
            /game.cardPoolExhausted/,
        );
        session.chooseCardType(0, CARD_TYPES.QUESTION, [mild]);
        session.advance(1);
        session.chooseCardType(2, CARD_TYPES.QUESTION, [mild]);
        session.advance(3);

        expect(session.roundNumber).toBe(2);
        expect(session.currentMaximumIntensityScore).toBe(5);
        expect(session.toRuntimeState()).toMatchObject({
            version: 5,
            profile: {
                startingIntensity: 1,
                maximumIntensity: 2,
                intensityProgressionUnit: "ROUNDS",
                intensityProgressionInterval: 1,
                intensityProgressionIncrement: 1,
            },
        });
        expect(() => session.chooseCardType(4, CARD_TYPES.QUESTION, [nextLevel])).not.toThrow();
    });

    it("can increase by displayed Card count before a large-player round completes", () => {
        const mild = card({ id: "card-mild" as never, intensity: 4, repeatableInSession: true });
        const nextLevel = card({
            id: "card-next-level" as never,
            intensity: 5,
            repeatableInSession: true,
        });
        const session = new GameSession(
            {
                id: "card-progression",
                mode: GAME_MODES.CLASSIC,
                players: [...players, { id: "c", name: "Carla" }],
                profile: profile({
                    maximumIntensity: 2,
                    intensityProgressionUnit: INTENSITY_PROGRESSION_UNITS.CARDS,
                    intensityProgressionInterval: 2,
                }),
                cardLocale: "en-GB",
            },
            new SequenceRandomSource([0]),
        );

        session.chooseCardType(0, CARD_TYPES.QUESTION, [mild]);
        session.advance(1);
        expect(session.currentMaximumIntensityScore).toBe(4);
        session.chooseCardType(2, CARD_TYPES.QUESTION, [mild]);
        session.advance(3);

        expect(session.roundNumber).toBe(1);
        expect(session.currentMaximumIntensityScore).toBe(5);
        expect(() => session.chooseCardType(4, CARD_TYPES.QUESTION, [nextLevel])).not.toThrow();
    });

    it("counts each completed Never Have I Ever Card as a round", () => {
        const session = new GameSession(
            {
                id: "never-progression",
                mode: GAME_MODES.NEVER_HAVE_I_EVER,
                players,
                profile: profile({
                    maximumIntensity: 2,
                    intensityProgressionUnit: INTENSITY_PROGRESSION_UNITS.ROUNDS,
                    intensityProgressionInterval: 1,
                }),
                cardLocale: "en-GB",
            },
            new SequenceRandomSource([0]),
        );
        const yesNo = card({
            id: "mild-never" as never,
            intensity: 4,
            yesNoAnswerPossible: true,
            repeatableInSession: true,
        });

        session.startTurn(0, [yesNo]);
        session.submitVote(1, "a", "YES");
        session.submitVote(2, "b", "NO");
        session.advance(3);

        expect(session.roundNumber).toBe(2);
        expect(session.currentMaximumIntensityScore).toBe(5);
    });
});
