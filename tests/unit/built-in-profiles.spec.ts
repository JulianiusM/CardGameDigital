import { describe, expect, it } from "vitest";
import {
    BUILT_IN_GAME_PROFILES,
    BUILT_IN_PROFILE_IDS,
    DARE_TYPES,
    OPERATIONAL_FLAGS,
    QUESTION_CATEGORIES,
    validateGameProfile,
} from "../../src/packages/game-core";
import {
    CUSTOM_GAME_PROFILE_ID,
    effectiveSettingsFromProfile,
} from "../../src/packages/application/roomGameSettings";

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

    it("uses conservative, data-driven additional-rule defaults per profile", () => {
        const byId = new Map(BUILT_IN_GAME_PROFILES.map((profile) => [profile.id, profile]));
        const colleagues = byId.get(BUILT_IN_PROFILE_IDS.COLLEAGUES)!;
        const friends = byId.get(BUILT_IN_PROFILE_IDS.FRIENDS)!;
        const couples = byId.get(BUILT_IN_PROFILE_IDS.COUPLES)!;

        expect(
            colleagues.blockedOperationalFlags.has(OPERATIONAL_FLAGS.REQUIRES_PHYSICAL_CONTACT),
        ).toBe(true);
        expect(
            friends.blockedOperationalFlags.has(OPERATIONAL_FLAGS.REQUIRES_PHYSICAL_CONTACT),
        ).toBe(false);
        expect(friends.blockedOperationalFlags.has(OPERATIONAL_FLAGS.REMOVES_CLOTHING)).toBe(true);
        expect(couples.blockedOperationalFlags.has(OPERATIONAL_FLAGS.REMOVES_CLOTHING)).toBe(false);
        for (const profile of BUILT_IN_GAME_PROFILES) {
            expect(
                profile.blockedOperationalFlags.has(OPERATIONAL_FLAGS.INVOLVES_THIRD_PARTY),
            ).toBe(true);
            expect(profile.blockedOperationalFlags.has(OPERATIONAL_FLAGS.INVOLVES_ALCOHOL)).toBe(
                true,
            );
            expect(
                profile.blockedOperationalFlags.has(OPERATIONAL_FLAGS.INVOLVES_RECREATIONAL_DRUGS),
            ).toBe(true);
        }
    });

    it("starts Custom from an explicit neutral operational configuration", () => {
        expect(effectiveSettingsFromProfile(CUSTOM_GAME_PROFILE_ID)).toMatchObject({
            enabledQuestionCategoryIds: [],
            enabledDareTypeIds: [],
            blockedOperationalFlags: Object.values(OPERATIONAL_FLAGS),
            startingIntensity: 1,
            maximumIntensity: 1,
            intensityProgressionUnit: "CARDS",
            intensityProgressionInterval: 2,
            intensityProgressionIncrement: 1,
        });
    });

    it("rejects progression increments that cannot follow the half-point score scale", () => {
        const friends = BUILT_IN_GAME_PROFILES.find(
            ({ id }) => id === BUILT_IN_PROFILE_IDS.FRIENDS,
        )!;
        expect(() =>
            validateGameProfile({ ...friends, intensityProgressionIncrement: 0.25 }),
        ).toThrow(/half-step/);
        expect(() =>
            validateGameProfile({ ...friends, intensityProgressionIncrement: 4.5 }),
        ).toThrow(/half-step/);
    });
});
