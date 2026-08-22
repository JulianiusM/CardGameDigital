import { describe, expect, it } from "vitest";
import {
    CARD_TYPES,
    DARE_TYPES,
    OPERATIONAL_FLAGS,
    QUESTION_CATEGORIES,
} from "../../src/packages/game-core";
import { normalizeCards } from "../../src/tooling/card-import/normalize";

const base = {
    CardText: "Eine Karte",
    Origin: "Originalspiel",
    OriginCategory: "Quelle",
    YesNoAnswerPossible: false,
    Intensity: 2,
    AlwaysEligible: false,
    RepeatableInSession: false,
    RepeatCooldown: 0,
    Weight: 1,
    Active: true,
    OperationalFlags: [],
};

describe("card catalog normalization", () => {
    it("keeps QuestionCategory and DareType as independent primary classifications", () => {
        const catalog = normalizeCards(
            [
                { ...base, ID: 1, Type: "Fragen", Category: "Freundschaft", DareType: null },
                {
                    ...base,
                    ID: 2,
                    Type: "Pflicht",
                    Category: "Freundschaft",
                    DareType: "Kuss-Spicy",
                },
            ],
            "access-export",
            "2026.08",
        );

        expect(catalog.cards.map((card) => card.sourceId)).toEqual(["1", "2"]);
        const question = catalog.cards.find((card) => card.cardType === CARD_TYPES.QUESTION)!;
        const dare = catalog.cards.find((card) => card.cardType === CARD_TYPES.DARE)!;
        expect(question).toMatchObject({
            questionCategoryId: QUESTION_CATEGORIES.FRIENDSHIP,
            dareTypeId: null,
            dareAffinityCategoryId: null,
        });
        expect(dare).toMatchObject({
            questionCategoryId: null,
            dareTypeId: DARE_TYPES.KISS_SPICY,
            dareAffinityCategoryId: QUESTION_CATEGORIES.FRIENDSHIP,
        });
    });

    it("leaves stable identity resolution to source reconciliation and preserves source content", () => {
        const input = [
            { ...base, ID: "legacy-42", Type: "Fragen", Category: "CAT_EVERYDAY", DareType: null },
        ];
        const first = normalizeCards(input, "access-export", "v1");
        const second = normalizeCards(input, "access-export", "v2");
        expect(first.cards[0].sourceId).toBe("legacy-42");
        expect(second.cards[0].sourceId).toBe("legacy-42");
        expect(first.cards[0]).toMatchObject({
            origin: "Originalspiel",
            originCategory: "Quelle",
            sourceTranslation: {
                locale: "de-DE",
                text: "Eine Karte",
                revision: 1,
                status: "PUBLISHED",
            },
        });
        expect(first.cards[0].sourceTranslation.contentHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("retains malformed rows and distinguishes errors from warnings", () => {
        const catalog = normalizeCards(
            [
                { ...base, ID: 1, Type: "Pflicht", Category: null, DareType: "Sonstiges" },
                { ...base, ID: 2, Type: "Fragen", Category: "Nicht vorhanden", DareType: null },
                { ID: 3, Type: "Fragen" },
            ],
            "access-export",
            "v1",
        );
        expect(catalog.cards).toHaveLength(1);
        expect(catalog.rejectedRawCards).toHaveLength(2);
        expect(catalog.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    severity: "WARNING",
                    code: "DARE_AFFINITY_MISSING",
                    sourceIdentifier: "1",
                }),
                expect.objectContaining({
                    severity: "ERROR",
                    code: "UNKNOWN_QUESTION_CATEGORY",
                    sourceIdentifier: "2",
                }),
                expect.objectContaining({
                    severity: "ERROR",
                    code: "RAW_CARD_INVALID",
                    sourceIdentifier: "3",
                }),
            ]),
        );
        expect(catalog.rawCards).toHaveLength(3);
    });

    it("normalizes operational flags without deriving them from category", () => {
        const catalog = normalizeCards(
            [
                {
                    ...base,
                    ID: 4,
                    Type: "Pflicht",
                    Category: "Trunkenheit",
                    DareType: "Sonstiges",
                    OperationalFlags: [OPERATIONAL_FLAGS.INVOLVES_ALCOHOL],
                },
            ],
            "source",
            "v1",
        );
        expect(catalog.cards[0].dareAffinityCategoryId).toBe(QUESTION_CATEGORIES.INTOXICATION);
        expect(catalog.cards[0].operationalFlags).toEqual([OPERATIONAL_FLAGS.INVOLVES_ALCOHOL]);
    });
});
