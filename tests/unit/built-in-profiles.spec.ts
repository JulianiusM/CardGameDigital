import { describe, expect, it } from "vitest";
import {
    BUILT_IN_GAME_PROFILES,
    BUILT_IN_PROFILE_IDS,
    DARE_TYPES,
    OPERATIONAL_FLAGS,
    QUESTION_CATEGORIES,
    SOCIAL_SENSITIVITIES,
    validateGameProfile,
} from "../../src/packages/game-core";
import {
    CUSTOM_GAME_PROFILE_ID,
    effectiveSettingsFromProfile,
} from "../../src/packages/application/roomGameSettings";

describe("built-in GameProfiles", () => {
    it("exposes five symmetric presets before Custom", () => {
        expect(BUILT_IN_GAME_PROFILES.map(({ id }) => id)).toEqual([
            BUILT_IN_PROFILE_IDS.CHILD_FRIENDLY,
            BUILT_IN_PROFILE_IDS.ACQUAINTANCES,
            BUILT_IN_PROFILE_IDS.FRIENDS,
            BUILT_IN_PROFILE_IDS.CLOSE_FRIENDS,
            BUILT_IN_PROFILE_IDS.SPICY,
        ]);
    });

    it("keeps question categories and DareTypes independently configurable", () => {
        const acquaintances = BUILT_IN_GAME_PROFILES.find(
            (profile) => profile.id === BUILT_IN_PROFILE_IDS.ACQUAINTANCES,
        )!;
        expect(acquaintances.enabledQuestionCategoryIds.has(QUESTION_CATEGORIES.FRIENDSHIP)).toBe(
            true,
        );
        expect(acquaintances.enabledDareTypeIds.has(DARE_TYPES.SILLY)).toBe(true);
        expect(acquaintances.enabledDareTypeIds.has(DARE_TYPES.THIRD_PARTY)).toBe(false);
        expect(acquaintances.editorialStatus).toBe("PUBLISHED");
        expect(acquaintances.requiresAdultConfirmation).toBe(false);
    });

    it("requires deliberate confirmation for the explicit profile", () => {
        const spicy = BUILT_IN_GAME_PROFILES.find(({ id }) => id === BUILT_IN_PROFILE_IDS.SPICY)!;
        expect(spicy.requiresAdultConfirmation).toBe(true);
        expect(spicy.enabledDareTypeIds.has(DARE_TYPES.SEX)).toBe(true);
    });

    it("provides child-friendly content as an ordinary, fully editable profile", () => {
        const childFriendly = BUILT_IN_GAME_PROFILES.find(
            ({ id }) => id === BUILT_IN_PROFILE_IDS.CHILD_FRIENDLY,
        )!;

        expect(childFriendly.enabledQuestionCategoryIds).toEqual(
            new Set([
                QUESTION_CATEGORIES.EVERYDAY,
                QUESTION_CATEGORIES.CHILDHOOD,
                QUESTION_CATEGORIES.PERSONALITY,
                QUESTION_CATEGORIES.SCENARIO,
                QUESTION_CATEGORIES.FRIENDSHIP,
                QUESTION_CATEGORIES.RELATIONSHIP,
                QUESTION_CATEGORIES.BODY,
            ]),
        );
        expect(childFriendly.enabledDareTypeIds).toEqual(
            new Set([DARE_TYPES.SILLY, DARE_TYPES.OTHER, DARE_TYPES.TOUCH]),
        );
        expect(childFriendly.blockedOperationalFlags).toEqual(
            new Set([
                OPERATIONAL_FLAGS.INVOLVES_THIRD_PARTY,
                OPERATIONAL_FLAGS.INVOLVES_ALCOHOL,
                OPERATIONAL_FLAGS.INVOLVES_RECREATIONAL_SUBSTANCES,
                OPERATIONAL_FLAGS.REMOVES_CLOTHING,
                OPERATIONAL_FLAGS.REQUIRES_NUDITY,
            ]),
        );
        expect(childFriendly.maximumSocialSensitivity).toBe(SOCIAL_SENSITIVITIES.DEEP_PERSONAL);
        expect(childFriendly.maximumIntensity).toBe(3);
        expect(childFriendly.requiresAdultConfirmation).toBe(false);
    });

    it("provides an explicit social-sensitivity ceiling for every preset", () => {
        const byId = new Map(BUILT_IN_GAME_PROFILES.map((profile) => [profile.id, profile]));
        expect(byId.get(BUILT_IN_PROFILE_IDS.ACQUAINTANCES)?.maximumSocialSensitivity).toBe(
            SOCIAL_SENSITIVITIES.GENERAL,
        );
        expect(byId.get(BUILT_IN_PROFILE_IDS.CHILD_FRIENDLY)?.maximumSocialSensitivity).toBe(
            SOCIAL_SENSITIVITIES.DEEP_PERSONAL,
        );
        expect(byId.get(BUILT_IN_PROFILE_IDS.FRIENDS)?.maximumSocialSensitivity).toBe(
            SOCIAL_SENSITIVITIES.PERSONAL,
        );
        expect(byId.get(BUILT_IN_PROFILE_IDS.SPICY)?.maximumSocialSensitivity).toBe(
            SOCIAL_SENSITIVITIES.EXPLICIT,
        );
    });

    it("does not enable explicit DareTypes in lower-risk profiles", () => {
        for (const profile of BUILT_IN_GAME_PROFILES.filter(
            ({ id }) => id !== BUILT_IN_PROFILE_IDS.SPICY,
        )) {
            expect(profile.enabledDareTypeIds.has(DARE_TYPES.SEX)).toBe(false);
            expect(profile.enabledDareTypeIds.has(DARE_TYPES.BORDERLINE_SEX)).toBe(false);
        }
    });

    it("uses conservative, data-driven additional-rule defaults per profile", () => {
        const byId = new Map(BUILT_IN_GAME_PROFILES.map((profile) => [profile.id, profile]));
        const acquaintances = byId.get(BUILT_IN_PROFILE_IDS.ACQUAINTANCES)!;
        const friends = byId.get(BUILT_IN_PROFILE_IDS.FRIENDS)!;
        const closeFriends = byId.get(BUILT_IN_PROFILE_IDS.CLOSE_FRIENDS)!;

        expect(
            acquaintances.blockedOperationalFlags.has(OPERATIONAL_FLAGS.REQUIRES_PHYSICAL_CONTACT),
        ).toBe(true);
        expect(
            friends.blockedOperationalFlags.has(OPERATIONAL_FLAGS.REQUIRES_PHYSICAL_CONTACT),
        ).toBe(false);
        expect(friends.blockedOperationalFlags.has(OPERATIONAL_FLAGS.REMOVES_CLOTHING)).toBe(true);
        expect(closeFriends.blockedOperationalFlags.has(OPERATIONAL_FLAGS.REMOVES_CLOTHING)).toBe(
            false,
        );
        expect(closeFriends.enabledQuestionCategoryIds.has(QUESTION_CATEGORIES.FRIENDSHIP)).toBe(
            true,
        );
        expect(
            closeFriends.enabledQuestionCategoryIds.has(QUESTION_CATEGORIES.SEX_EXPERIENCE),
        ).toBe(true);
        expect(closeFriends.enabledDareTypeIds.has(DARE_TYPES.NUDITY)).toBe(true);
        for (const profile of BUILT_IN_GAME_PROFILES) {
            expect(
                profile.blockedOperationalFlags.has(OPERATIONAL_FLAGS.INVOLVES_THIRD_PARTY),
            ).toBe(true);
            expect(profile.blockedOperationalFlags.has(OPERATIONAL_FLAGS.INVOLVES_ALCOHOL)).toBe(
                true,
            );
            expect(
                profile.blockedOperationalFlags.has(
                    OPERATIONAL_FLAGS.INVOLVES_RECREATIONAL_SUBSTANCES,
                ),
            ).toBe(true);
        }
    });

    it("starts Custom from an explicit neutral operational configuration", () => {
        expect(effectiveSettingsFromProfile(CUSTOM_GAME_PROFILE_ID)).toMatchObject({
            enabledQuestionCategoryIds: [],
            enabledDareTypeIds: [],
            blockedOperationalFlags: Object.values(OPERATIONAL_FLAGS),
            maximumSocialSensitivity: SOCIAL_SENSITIVITIES.EXPLICIT,
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
