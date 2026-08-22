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

    it("maps taxonomy and commands without nested rendering conditionals", () => {
        expect(atmosphereFor(presentedCard())).toBe("CAT_PERSONALITY");
        expect(effectForCommand("command.submitVote")).toBe("vote");
        expect(effectForCommand("command.advanceSession")).toBe("turn");
        expect(effectForCommand("command.endSession")).toBe("end");
        expect(effectForCommand("command.setBoundaries")).toBe("action");
    });
});
