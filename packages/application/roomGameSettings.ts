import {
    BUILT_IN_PROFILE_IDS,
    GAME_MODES,
    INTENSITY_PROGRESSION_UNITS,
    NEVER_HAVE_I_EVER_REVEAL_MODES,
    OPERATIONAL_FLAGS,
    SOCIAL_SENSITIVITIES,
    builtInGameProfile,
    type DareTypeId,
    type GameMode,
    type GameProfile,
    type Intensity,
    type IntensityProgressionUnit,
    type OperationalFlag,
    type NeverHaveIEverRevealMode,
    type QuestionCategoryId,
    type SocialSensitivity,
    emptySessionCardPolicy,
    type SessionCardPolicyInput,
    validateGameProfile,
} from "../game-core";

export const CUSTOM_GAME_PROFILE_ID = "PROFILE_CUSTOM";
export const DEFAULT_INTENSITY_PROGRESSION = {
    startingIntensity: 1,
    intensityProgressionUnit: INTENSITY_PROGRESSION_UNITS.CARDS,
    intensityProgressionInterval: 2,
    intensityProgressionIncrement: 1,
} as const;

export type EffectiveGameSettings = {
    enabledQuestionCategoryIds: QuestionCategoryId[];
    enabledDareTypeIds: DareTypeId[];
    blockedOperationalFlags: OperationalFlag[];
    maximumSocialSensitivity: SocialSensitivity;
    startingIntensity: Intensity;
    maximumIntensity: Intensity;
    intensityProgressionUnit: IntensityProgressionUnit;
    intensityProgressionInterval: number;
    intensityProgressionIncrement: number;
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
    cardFallbackEnabled: boolean;
    cardFallbackLocales: string[];
    neverHaveIEverRevealMode: NeverHaveIEverRevealMode;
    configuration: EffectiveGameSettings;
    cardPolicy: SessionCardPolicyInput;
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
            maximumSocialSensitivity: profile.maximumSocialSensitivity,
            startingIntensity: profile.startingIntensity,
            maximumIntensity: profile.maximumIntensity,
            intensityProgressionUnit: profile.intensityProgressionUnit,
            intensityProgressionInterval: profile.intensityProgressionInterval,
            intensityProgressionIncrement: profile.intensityProgressionIncrement,
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
        maximumSocialSensitivity: SOCIAL_SENSITIVITIES.EXPLICIT,
        ...DEFAULT_INTENSITY_PROGRESSION,
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
        cardFallbackEnabled: false,
        cardFallbackLocales: [],
        neverHaveIEverRevealMode: NEVER_HAVE_I_EVER_REVEAL_MODES.ANONYMOUS_AGGREGATE,
        configuration: effectiveSettingsFromProfile(BUILT_IN_PROFILE_IDS.FRIENDS),
        cardPolicy: emptySessionCardPolicy(),
    };
}

export function normalizeRoomGameSettings(
    settings: Omit<
        RoomGameSettings,
        "neverHaveIEverRevealMode" | "cardFallbackEnabled" | "cardFallbackLocales" | "cardPolicy"
    > &
        Partial<
            Pick<
                RoomGameSettings,
                | "neverHaveIEverRevealMode"
                | "cardFallbackEnabled"
                | "cardFallbackLocales"
                | "cardPolicy"
            >
        >,
): RoomGameSettings {
    return {
        ...settings,
        configuration: {
            ...settings.configuration,
            startingIntensity:
                settings.configuration.startingIntensity ??
                DEFAULT_INTENSITY_PROGRESSION.startingIntensity,
            intensityProgressionUnit:
                settings.configuration.intensityProgressionUnit ??
                DEFAULT_INTENSITY_PROGRESSION.intensityProgressionUnit,
            intensityProgressionInterval:
                settings.configuration.intensityProgressionInterval ??
                DEFAULT_INTENSITY_PROGRESSION.intensityProgressionInterval,
            intensityProgressionIncrement:
                settings.configuration.intensityProgressionIncrement ??
                DEFAULT_INTENSITY_PROGRESSION.intensityProgressionIncrement,
            maximumSocialSensitivity:
                settings.configuration.maximumSocialSensitivity ?? SOCIAL_SENSITIVITIES.EXPLICIT,
        },
        neverHaveIEverRevealMode:
            settings.neverHaveIEverRevealMode ?? NEVER_HAVE_I_EVER_REVEAL_MODES.ANONYMOUS_AGGREGATE,
        cardFallbackEnabled: settings.cardFallbackEnabled ?? false,
        cardFallbackLocales: [...(settings.cardFallbackLocales ?? [])],
        cardPolicy: settings.cardPolicy ?? emptySessionCardPolicy(),
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
        maximumSocialSensitivity: settings.configuration.maximumSocialSensitivity,
        startingIntensity: settings.configuration.startingIntensity,
        maximumIntensity: settings.configuration.maximumIntensity,
        intensityProgressionUnit: settings.configuration.intensityProgressionUnit,
        intensityProgressionInterval: settings.configuration.intensityProgressionInterval,
        intensityProgressionIncrement: settings.configuration.intensityProgressionIncrement,
        randomQuestionRatio: settings.configuration.randomQuestionRatio,
        maximumTypeStreak: settings.configuration.maximumTypeStreak,
        letsTalkMetaInterval: settings.configuration.letsTalkMetaInterval,
    });
}

export function profileRequiresAdultConfirmation(profileId: string): boolean {
    return builtInGameProfile(profileId)?.requiresAdultConfirmation ?? false;
}
