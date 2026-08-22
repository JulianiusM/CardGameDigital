import { describe, expect, it } from "vitest";
import {
    CARD_TYPES,
    CardPoolExhaustedError,
    DARE_TYPES,
    eligibilityReasons,
    eligibleCards,
    OPERATIONAL_FLAGS,
    QUESTION_CATEGORIES,
    SequenceRandomSource,
    selectWeighted,
} from "../../src/packages/game-core";
import { boundaries, card, profile } from "../support/game";

const request = () => ({
    cardType: CARD_TYPES.QUESTION,
    profile: profile(),
    boundaries: [boundaries()],
    maximumIntensity: 5,
    sessionHistory: [],
    groupHistoryCardIds: new Set(),
});

describe("composable card eligibility", () => {
    it("filters questions by yes/no, QuestionCategory, profile, boundaries, intensity and active state", () => {
        const question = card({ id: "q" as never, yesNoAnswerPossible: false });
        expect(eligibilityReasons(question, { ...request(), requireYesNoAnswer: true })).toContain(
            "YES_NO_REQUIRED",
        );
        expect(
            eligibilityReasons(question, {
                ...request(),
                profile: profile({ enabledQuestionCategoryIds: new Set() }),
            }),
        ).toContain("QUESTION_CATEGORY");
        expect(
            eligibilityReasons(question, {
                ...request(),
                boundaries: [
                    boundaries({
                        disabledQuestionCategoryIds: new Set([QUESTION_CATEGORIES.EVERYDAY]),
                    }),
                ],
            }),
        ).toContain("QUESTION_BOUNDARY");
        expect(
            eligibilityReasons(
                { ...question, intensity: 4 },
                { ...request(), maximumIntensity: 3 },
            ),
        ).toContain("INTENSITY");
        expect(eligibilityReasons({ ...question, active: false }, request())).toContain("INACTIVE");
    });

    it("uses DareType as the dare hard filter and DareAffinity only as metadata", () => {
        const dare = card({
            id: "d" as never,
            cardType: CARD_TYPES.DARE,
            questionCategoryId: null,
            dareTypeId: DARE_TYPES.KISS,
            dareAffinityCategoryId: QUESTION_CATEGORIES.SEX_TENSION,
        });
        const dareRequest = {
            ...request(),
            cardType: CARD_TYPES.DARE,
            profile: profile({ enabledQuestionCategoryIds: new Set() }),
        };
        expect(eligibilityReasons(dare, dareRequest)).toEqual([]);
        expect(
            eligibilityReasons(dare, {
                ...dareRequest,
                profile: profile({ enabledDareTypeIds: new Set() }),
            }),
        ).toContain("DARE_TYPE");
        expect(
            eligibilityReasons(dare, {
                ...dareRequest,
                boundaries: [boundaries({ disabledDareTypeIds: new Set([DARE_TYPES.KISS]) })],
            }),
        ).toContain("DARE_BOUNDARY");
    });

    it("applies operational boundaries without category inference", () => {
        const dare = card({
            id: "alcohol" as never,
            cardType: CARD_TYPES.DARE,
            questionCategoryId: null,
            dareTypeId: DARE_TYPES.OTHER,
            operationalFlags: [OPERATIONAL_FLAGS.INVOLVES_ALCOHOL],
        });
        expect(
            eligibilityReasons(dare, {
                ...request(),
                cardType: CARD_TYPES.DARE,
                boundaries: [
                    boundaries({
                        blockedOperationalFlags: new Set([OPERATIONAL_FLAGS.INVOLVES_ALCOHOL]),
                    }),
                ],
            }),
        ).toContain("OPERATIONAL_FLAG");
    });

    it("enforces Session history, Group history, AlwaysEligible and repeat cooldown", () => {
        const normal = card({ id: "normal" as never });
        const appearance = {
            cardId: normal.id,
            sequence: 1,
            roundNumber: 1,
            playerId: "p",
            skipped: true,
        };
        expect(
            eligibleCards([normal], { ...request(), sessionHistory: [appearance] }),
        ).toHaveLength(0);
        expect(
            eligibleCards([normal], { ...request(), groupHistoryCardIds: new Set([normal.id]) }),
        ).toHaveLength(0);
        expect(
            eligibleCards([{ ...normal, alwaysEligible: true }], {
                ...request(),
                groupHistoryCardIds: new Set([normal.id]),
            }),
        ).toHaveLength(1);
        const repeatable = { ...normal, repeatableInSession: true, repeatCooldown: 2 };
        expect(
            eligibleCards([repeatable], {
                ...request(),
                sessionHistory: [
                    appearance,
                    { ...appearance, cardId: "other" as never, sequence: 2 },
                ],
            }),
        ).toHaveLength(0);
        expect(
            eligibleCards([repeatable], {
                ...request(),
                sessionHistory: [
                    appearance,
                    { ...appearance, cardId: "a" as never, sequence: 2 },
                    { ...appearance, cardId: "b" as never, sequence: 3 },
                ],
            }),
        ).toHaveLength(1);
    });

    it("selects by editorial weight only after eligibility and reports exhaustion", () => {
        const low = card({ id: "low" as never, weight: 1 });
        const high = card({ id: "high" as never, weight: 3 });
        expect(selectWeighted([low, high], new SequenceRandomSource([0.1]))).toBe(low);
        expect(selectWeighted([low, high], new SequenceRandomSource([0.9]))).toBe(high);
        expect(() => selectWeighted([], new SequenceRandomSource([0]))).toThrow(
            CardPoolExhaustedError,
        );
    });
});
