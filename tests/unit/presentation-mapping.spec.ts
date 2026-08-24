import { describe, expect, it } from "vitest";
import {
    atmosphereFor,
    effectForCommand,
    sceneFor,
    type PresentedCard,
} from "../../apps/web/src/presentationMapping";

function presentedCard(overrides: Partial<PresentedCard> = {}): PresentedCard {
    return {
        id: "card",
        cardText: "Text",
        cardType: "QUESTION",
        intensity: 1,
        questionCategoryId: "CAT_PERSONALITY",
        dareTypeId: null,
        ...overrides,
    };
}

describe("presentation mapping", () => {
    it("maps session and card state to one clear scene", () => {
        expect(sceneFor(undefined, null, false)).toBe("MENU");
        expect(sceneFor(undefined, null, true)).toBe("LOBBY");
        expect(sceneFor("SHOWING_CARD", presentedCard(), true)).toBe("QUESTION");
        expect(sceneFor("SHOWING_CARD", presentedCard({ cardType: "DARE" }), true)).toBe("DARE");
        expect(sceneFor("ENDED", presentedCard(), true)).toBe("END");
    });

    it("maps every question taxonomy to its canonical visual family", () => {
        const expected = {
            CURIOSITY: ["CAT_EVERYDAY", "CAT_CHILDHOOD", "CAT_SCENARIO"],
            INNER_SELF: ["CAT_PERSONALITY", "CAT_BODY"],
            CONNECTION: ["CAT_FRIENDSHIP", "CAT_RELATIONSHIP"],
            UNFILTERED: ["CAT_INTOXICATION"],
            INTIMATE_TALK: ["CAT_SEXUALITY", "CAT_SEX_OPENNESS"],
            DESIRE_STORIES: ["CAT_SEX_TENSION", "CAT_SEX_EXPERIENCE"],
        } as const;

        for (const [family, categoryIds] of Object.entries(expected)) {
            for (const questionCategoryId of categoryIds) {
                expect(atmosphereFor(presentedCard({ questionCategoryId }))).toEqual({
                    family,
                    intensity: 1,
                });
            }
        }
    });

    it("maps every dare taxonomy to its canonical visual family", () => {
        const expected = {
            MISCHIEF: ["DARE_SILLY"],
            SOCIAL_CHAOS: ["DARE_THIRD_PARTY"],
            AFFECTION: ["DARE_KISS", "DARE_TOUCH"],
            FLIRT: ["DARE_KISS_SPICY", "DARE_TOUCH_SPICY", "DARE_SEXUAL_TENSION"],
            REVEAL: ["DARE_CLOTHING", "DARE_NUDITY"],
            HEAT: ["DARE_TOUCH_SEXY", "DARE_BORDERLINE_SEX", "DARE_SEX"],
            GENERIC_DARE: ["DARE_OTHER"],
        } as const;

        for (const [family, dareTypeIds] of Object.entries(expected)) {
            for (const dareTypeId of dareTypeIds) {
                expect(
                    atmosphereFor(
                        presentedCard({
                            cardType: "DARE",
                            questionCategoryId: null,
                            dareTypeId,
                        }),
                    ),
                ).toEqual({ family, intensity: 1 });
            }
        }
    });

    it("keeps intensity as a modifier and maps commands without rendering conditionals", () => {
        expect(atmosphereFor(presentedCard({ intensity: 4.4 }))).toEqual({
            family: "INNER_SELF",
            intensity: 4,
        });
        expect(
            atmosphereFor(
                presentedCard({
                    cardType: "CONVERSATION",
                    questionCategoryId: null,
                    intensity: 9,
                }),
            ),
        ).toEqual({ family: "CONVERSATION", intensity: 5 });
        expect(atmosphereFor(null)).toBeNull();
        expect(effectForCommand("command.submitVote")).toBe("vote");
        expect(effectForCommand("command.advanceSession")).toBe("turn");
        expect(effectForCommand("command.endSession")).toBe("end");
        expect(effectForCommand("command.setBoundaries")).toBe("action");
    });
});
