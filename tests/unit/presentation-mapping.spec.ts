import { describe, expect, it } from "vitest";
import {
    DARE_VISUAL_FAMILY_BY_TYPE_ID,
    GOLDEN_MISCHIEF_ATMOSPHERES,
    QUESTION_VISUAL_FAMILY_BY_CATEGORY_ID,
} from "../../packages/design-tokens";
import { DARE_TYPE_IDS, QUESTION_CATEGORY_IDS } from "../../packages/game-core/cards/taxonomy";
import {
    atmosphereFor,
    effectForCommand,
    motifSymbolFor,
    sceneFor,
    type PresentedCard,
} from "../../apps/web/src/presentationMapping";

function presentedCard(overrides: Partial<PresentedCard> = {}): PresentedCard {
    return {
        id: "card",
        cardText: "Text",
        cardType: "QUESTION",
        cardIntensity: 1,
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
                expect(QUESTION_VISUAL_FAMILY_BY_CATEGORY_ID[questionCategoryId]).toBe(family);
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
                expect(DARE_VISUAL_FAMILY_BY_TYPE_ID[dareTypeId]).toBe(family);
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

    it("covers every Card taxonomy with a shared base atmosphere", () => {
        expect(Object.keys(QUESTION_VISUAL_FAMILY_BY_CATEGORY_ID).sort()).toEqual(
            [...QUESTION_CATEGORY_IDS].sort(),
        );
        expect(Object.keys(DARE_VISUAL_FAMILY_BY_TYPE_ID).sort()).toEqual(
            [...DARE_TYPE_IDS].sort(),
        );

        const mappedFamilies = new Set([
            ...Object.values(QUESTION_VISUAL_FAMILY_BY_CATEGORY_ID),
            ...Object.values(DARE_VISUAL_FAMILY_BY_TYPE_ID),
        ]);
        for (const family of mappedFamilies) {
            expect(GOLDEN_MISCHIEF_ATMOSPHERES).toHaveProperty(family);
        }
    });

    it("generates the same classification maps for the native client", () => {
        const generated = JSON.parse(
            fs.readFileSync("apps/kodi/resources/data/design-tokens.json", "utf8"),
        ) as {
            presentation: {
                questionFamilyByCategoryId: Record<string, string>;
                dareFamilyByTypeId: Record<string, string>;
            };
        };
        expect(generated.presentation.questionFamilyByCategoryId).toEqual(
            QUESTION_VISUAL_FAMILY_BY_CATEGORY_ID,
        );
        expect(generated.presentation.dareFamilyByTypeId).toEqual(DARE_VISUAL_FAMILY_BY_TYPE_ID);

        const nativeProjection = fs.readFileSync("apps/kodi/resources/lib/presentation.py", "utf8");
        expect(nativeProjection).not.toContain('"CAT_EVERYDAY":');
        expect(nativeProjection).not.toContain('"DARE_SILLY":');
    });

    it("uses global intensity as the family modifier and maps commands centrally", () => {
        expect(atmosphereFor(presentedCard({ cardIntensity: 4.4, intensity: 2 }))).toEqual({
            family: "INNER_SELF",
            intensity: 2,
        });
        expect(
            atmosphereFor(
                presentedCard({
                    cardType: "CONVERSATION_META",
                    questionCategoryId: null,
                    cardIntensity: 9,
                    intensity: 3,
                }),
            ),
        ).toEqual({ family: "CONVERSATION", intensity: 3 });
        expect(atmosphereFor(null)).toBeNull();
        expect(effectForCommand("command.submitVote")).toBe("vote");
        expect(effectForCommand("command.advanceSession")).toBe("turn");
        expect(effectForCommand("command.endSession")).toBe("end");
        expect(effectForCommand("command.setBoundaries")).toBe("action");
    });

    it("chooses one stable symbol from the Card's visual family", () => {
        const card = presentedCard({ id: "card-42", questionCategoryId: "CAT_PERSONALITY" });
        expect(motifSymbolFor(card)).toBe(motifSymbolFor({ ...card }));
        expect(["mirror", "fingerprint", "eye", "silhouette", "contour", "spark"]).toContain(
            motifSymbolFor(card),
        );
    });
});
import fs from "node:fs";
