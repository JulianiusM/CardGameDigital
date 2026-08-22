import {
    BUILT_IN_PROFILE_IDS,
    GAME_MODES,
    OPERATIONAL_FLAGS,
    builtInGameProfile,
    type DareTypeId,
    type GameMode,
    type GameProfile,
    type OperationalFlag,
    type QuestionCategoryId,
    validateGameProfile,
} from "../game-core";

export const CUSTOM_GAME_PROFILE_ID = "PROFILE_CUSTOM";

export type EffectiveGameSettings = {
    enabledQuestionCategoryIds: QuestionCategoryId[];
    enabledDareTypeIds: DareTypeId[];
    blockedOperationalFlags: OperationalFlag[];
    maximumIntensity: 1 | 2 | 3 | 4 | 5;
    randomQuestionRatio: number;
    maximumTypeStreak: number;
    letsTalkMetaInterval: number;
};

export type RoomGameSettings = {
    mode: GameMode;
    profileId: string;
    groupId: string | null;
    adultContentConfirmed: boolean;
    cardLocale: string;
    configuration: EffectiveGameSettings;
};

export type VersionedRoomGameSettings = RoomGameSettings & {
    revision: number;
    updatedByParticipantId: string | null;
};

export function effectiveSettingsFromProfile(profileId: string): EffectiveGameSettings {
    const profile = builtInGameProfile(profileId);
    if (profile) {
        return {
            enabledQuestionCategoryIds: [...profile.enabledQuestionCategoryIds],
            enabledDareTypeIds: [...profile.enabledDareTypeIds],
            blockedOperationalFlags: [...profile.blockedOperationalFlags],
            maximumIntensity: profile.maximumIntensity,
            randomQuestionRatio: profile.randomQuestionRatio,
            maximumTypeStreak: profile.maximumTypeStreak,
            letsTalkMetaInterval: profile.letsTalkMetaInterval,
        };
    }
    if (profileId !== CUSTOM_GAME_PROFILE_ID) throw new Error("Unknown GameProfile");
    return {
        enabledQuestionCategoryIds: [],
        enabledDareTypeIds: [],
        blockedOperationalFlags: Object.values(OPERATIONAL_FLAGS),
        maximumIntensity: 1,
        randomQuestionRatio: 0.5,
        maximumTypeStreak: 3,
        letsTalkMetaInterval: 5,
    };
}

export function defaultRoomGameSettings(): RoomGameSettings {
    return {
        mode: GAME_MODES.CLASSIC,
        profileId: BUILT_IN_PROFILE_IDS.FRIENDS,
        groupId: null,
        adultContentConfirmed: false,
        cardLocale: "de-DE",
        configuration: effectiveSettingsFromProfile(BUILT_IN_PROFILE_IDS.FRIENDS),
    };
}

export function roomSettingsGameProfile(settings: RoomGameSettings): GameProfile {
    if (!builtInGameProfile(settings.profileId) && settings.profileId !== CUSTOM_GAME_PROFILE_ID)
        throw new Error("Unknown GameProfile");
    return validateGameProfile({
        id: settings.profileId,
        name: settings.profileId,
        enabledQuestionCategoryIds: new Set(settings.configuration.enabledQuestionCategoryIds),
        enabledDareTypeIds: new Set(settings.configuration.enabledDareTypeIds),
        blockedOperationalFlags: new Set(settings.configuration.blockedOperationalFlags),
        maximumIntensity: settings.configuration.maximumIntensity,
        randomQuestionRatio: settings.configuration.randomQuestionRatio,
        maximumTypeStreak: settings.configuration.maximumTypeStreak,
        letsTalkMetaInterval: settings.configuration.letsTalkMetaInterval,
    });
}

export function profileRequiresAdultConfirmation(profileId: string): boolean {
    return builtInGameProfile(profileId)?.requiresAdultConfirmation ?? false;
}
