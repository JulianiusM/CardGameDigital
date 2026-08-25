import { describe, expect, it } from "vitest";
import {
    applyCardLanguageSettings,
    applyGameProfile,
    type GameSetupState,
} from "../../apps/web/src/setup";
import type { GameProfileSummary } from "../../apps/web/src/multiplayer";

describe("game setup profile selection", () => {
    it("applies and clones the complete Card-language scope", () => {
        const state = {
            step: "profile",
            intent: "HOST",
            hostName: "Host",
            groupChoice: "NONE",
            groupId: null,
            groupMembers: [],
            mode: "CLASSIC_TRUTH_OR_DARE",
            profileId: "PROFILE_FRIENDS",
            adultContentConfirmed: false,
            enabledQuestionCategoryIds: [],
            enabledDareTypeIds: [],
            blockedOperationalFlags: [],
            startingIntensity: 1,
            maximumIntensity: 3,
            intensityProgressionUnit: "CARDS",
            intensityProgressionInterval: 2,
            intensityProgressionIncrement: 1,
            randomQuestionRatio: 0.5,
            maximumTypeStreak: 3,
            letsTalkMetaInterval: 5,
            cardLocale: "de-DE",
            cardFallbackEnabled: false,
            cardFallbackLocales: [],
            neverHaveIEverRevealMode: "ANONYMOUS_AGGREGATE",
            deviceMode: "couch",
        } satisfies GameSetupState;
        const saved = {
            cardLocale: "en-GB",
            cardFallbackEnabled: true,
            cardFallbackLocales: ["de-DE"],
        };
        const applied = applyCardLanguageSettings(state, saved);
        saved.cardFallbackLocales.push("fr-FR");
        expect(applied).toMatchObject({
            cardLocale: "en-GB",
            cardFallbackEnabled: true,
            cardFallbackLocales: ["de-DE"],
        });
    });

    it("restores canonical values when the already-selected profile is chosen again", () => {
        const customized: GameSetupState = {
            step: "profile",
            intent: "HOST",
            hostName: "Host",
            groupChoice: "NONE",
            groupId: null,
            groupMembers: [],
            mode: "CLASSIC_TRUTH_OR_DARE",
            profileId: "PROFILE_FRIENDS",
            adultContentConfirmed: true,
            enabledQuestionCategoryIds: ["CUSTOM_CATEGORY"],
            enabledDareTypeIds: [],
            blockedOperationalFlags: ["REQUIRES_ALCOHOL"],
            startingIntensity: 4,
            maximumIntensity: 5,
            intensityProgressionUnit: "ROUNDS",
            intensityProgressionInterval: 99,
            intensityProgressionIncrement: 4,
            randomQuestionRatio: 0.1,
            maximumTypeStreak: 9,
            letsTalkMetaInterval: 12,
            cardLocale: "de-DE",
            cardFallbackEnabled: false,
            cardFallbackLocales: [],
            neverHaveIEverRevealMode: "ANONYMOUS_AGGREGATE",
            deviceMode: "couch",
        };
        const profile = {
            id: "PROFILE_FRIENDS",
            name: "Friends",
            description: "",
            editorialStatus: "PUBLISHED",
            requiresAdultConfirmation: false,
            startingIntensity: 1,
            maximumIntensity: 3,
            intensityProgressionUnit: "CARDS",
            intensityProgressionInterval: 2,
            intensityProgressionIncrement: 1,
            enabledQuestionCategoryIds: ["CAT_EVERYDAY"],
            enabledDareTypeIds: ["DARE_SILLY"],
            blockedOperationalFlags: [],
            randomQuestionRatio: 0.6,
            maximumTypeStreak: 3,
            letsTalkMetaInterval: 5,
            immutable: true,
        } satisfies GameProfileSummary;

        expect(applyGameProfile(customized, profile)).toMatchObject({
            profileId: "PROFILE_FRIENDS",
            adultContentConfirmed: false,
            enabledQuestionCategoryIds: ["CAT_EVERYDAY"],
            enabledDareTypeIds: ["DARE_SILLY"],
            blockedOperationalFlags: [],
            startingIntensity: 1,
            maximumIntensity: 3,
            intensityProgressionUnit: "CARDS",
            intensityProgressionInterval: 2,
            intensityProgressionIncrement: 1,
            randomQuestionRatio: 0.6,
            maximumTypeStreak: 3,
            letsTalkMetaInterval: 5,
        });
    });

    it("restores only the dedicated saved Custom configuration", () => {
        const state = {
            step: "profile",
            intent: "HOST",
            hostName: "Host",
            groupChoice: "NONE",
            groupId: null,
            groupMembers: [],
            mode: "CLASSIC_TRUTH_OR_DARE",
            profileId: "PROFILE_FRIENDS",
            adultContentConfirmed: false,
            enabledQuestionCategoryIds: ["OTHER_GAME"],
            enabledDareTypeIds: [],
            blockedOperationalFlags: [],
            startingIntensity: 5,
            maximumIntensity: 5,
            intensityProgressionUnit: "CARDS",
            intensityProgressionInterval: 2,
            intensityProgressionIncrement: 1,
            randomQuestionRatio: 0.6,
            maximumTypeStreak: 3,
            letsTalkMetaInterval: 5,
            cardLocale: "de-DE",
            cardFallbackEnabled: false,
            cardFallbackLocales: [],
            neverHaveIEverRevealMode: "ANONYMOUS_AGGREGATE",
            deviceMode: "couch",
        } satisfies GameSetupState;
        const customProfile = {
            id: "PROFILE_CUSTOM",
            name: "Custom",
            description: "",
            editorialStatus: "PUBLISHED",
            requiresAdultConfirmation: false,
            startingIntensity: 1,
            maximumIntensity: 1,
            intensityProgressionUnit: "CARDS",
            intensityProgressionInterval: 2,
            intensityProgressionIncrement: 1,
            enabledQuestionCategoryIds: [],
            enabledDareTypeIds: [],
            blockedOperationalFlags: [],
            randomQuestionRatio: 0.5,
            maximumTypeStreak: 3,
            letsTalkMetaInterval: 5,
            immutable: true,
        } satisfies GameProfileSummary;

        expect(
            applyGameProfile(state, customProfile, {
                enabledQuestionCategoryIds: ["CAT_FRIENDSHIP"],
                enabledDareTypeIds: ["DARE_SILLY"],
                blockedOperationalFlags: ["INVOLVES_ALCOHOL"],
                startingIntensity: 2,
                maximumIntensity: 4,
                intensityProgressionUnit: "ROUNDS",
                intensityProgressionInterval: 3,
                intensityProgressionIncrement: 0.5,
                randomQuestionRatio: 0.7,
                maximumTypeStreak: 4,
                letsTalkMetaInterval: 6,
            }),
        ).toMatchObject({
            profileId: "PROFILE_CUSTOM",
            enabledQuestionCategoryIds: ["CAT_FRIENDSHIP"],
            enabledDareTypeIds: ["DARE_SILLY"],
            blockedOperationalFlags: ["INVOLVES_ALCOHOL"],
            startingIntensity: 2,
            maximumIntensity: 4,
        });
    });
});
