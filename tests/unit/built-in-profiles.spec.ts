import { describe, expect, it } from "vitest";
import {
    BUILT_IN_GAME_PROFILES,
    BUILT_IN_PROFILE_IDS,
    DARE_TYPES,
    QUESTION_CATEGORIES,
} from "../../src/packages/game-core";

describe("built-in GameProfiles", () => {
    it("keeps question categories and DareTypes independently configurable", () => {
        const colleagues = BUILT_IN_GAME_PROFILES.find(
            (profile) => profile.id === BUILT_IN_PROFILE_IDS.COLLEAGUES,
        )!;
        expect(colleagues.enabledQuestionCategoryIds.has(QUESTION_CATEGORIES.FRIENDSHIP)).toBe(
            true,
        );
        expect(colleagues.enabledDareTypeIds.has(DARE_TYPES.SILLY)).toBe(true);
        expect(colleagues.enabledDareTypeIds.has(DARE_TYPES.THIRD_PARTY)).toBe(false);
        expect(colleagues.editorialStatus).toBe("PUBLISHED");
        expect(colleagues.requiresAdultConfirmation).toBe(false);
    });

    it("requires deliberate confirmation for the explicit profile", () => {
        const spicy = BUILT_IN_GAME_PROFILES.find(
            ({ id }) => id === BUILT_IN_PROFILE_IDS.COUPLES_SPICY,
        )!;
        expect(spicy.requiresAdultConfirmation).toBe(true);
        expect(spicy.enabledDareTypeIds.has(DARE_TYPES.SEX)).toBe(true);
    });

    it("does not enable explicit DareTypes in lower-risk profiles", () => {
        for (const profile of BUILT_IN_GAME_PROFILES.filter(
            ({ id }) => id !== BUILT_IN_PROFILE_IDS.COUPLES_SPICY,
        )) {
            expect(profile.enabledDareTypeIds.has(DARE_TYPES.SEX)).toBe(false);
            expect(profile.enabledDareTypeIds.has(DARE_TYPES.BORDERLINE_SEX)).toBe(false);
        }
    });
});
