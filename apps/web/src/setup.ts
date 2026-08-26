import type {
    CardLanguageSettings,
    EffectiveGameSettings,
    GameProfileSummary,
    RoomGameSettings,
} from "./multiplayer";
import { loadLanguagePreferences } from "./languagePreferences";

export type SetupIntent = "HOST" | "JOIN" | "DISPLAY";
export type DeviceMode = "couch" | "personal" | "party";
export type SetupStep = "intent" | "group" | "mode" | "profile" | "customize" | "screen";
export type GroupChoice = "NONE" | "SELECT" | "NEW";

export type GameSetupState = {
    step: SetupStep;
    intent: SetupIntent | null;
    hostName: string;
    groupChoice: GroupChoice;
    groupId: string | null;
    groupMembers: string[];
    mode: string;
    profileId: string;
    adultContentConfirmed: boolean;
    startingIntensity: 1 | 2 | 3 | 4 | 5;
    maximumIntensity: 1 | 2 | 3 | 4 | 5;
    intensityProgressionUnit: "ROUNDS" | "CARDS";
    intensityProgressionInterval: number;
    intensityProgressionIncrement: number;
    randomQuestionRatio: number;
    letsTalkMetaInterval: number;
    maximumTypeStreak: number;
    enabledQuestionCategoryIds: string[];
    enabledDareTypeIds: string[];
    blockedOperationalFlags: string[];
    maximumSocialSensitivity: EffectiveGameSettings["maximumSocialSensitivity"];
    cardLocale: string;
    cardFallbackEnabled: boolean;
    cardFallbackLocales: string[];
    neverHaveIEverRevealMode: "ANONYMOUS_AGGREGATE" | "NAMED_ANSWERS";
    cardPolicy?: RoomGameSettings["cardPolicy"];
    deviceMode: DeviceMode;
};

const STORAGE_KEY = "party-game:setup";
const defaults: GameSetupState = {
    step: "intent",
    intent: null,
    hostName: "",
    groupChoice: "NONE",
    groupId: null,
    groupMembers: [],
    mode: "CLASSIC_TRUTH_OR_DARE",
    profileId: "PROFILE_FRIENDS",
    adultContentConfirmed: false,
    startingIntensity: 1,
    maximumIntensity: 3,
    intensityProgressionUnit: "CARDS",
    intensityProgressionInterval: 2,
    intensityProgressionIncrement: 1,
    randomQuestionRatio: 0.6,
    letsTalkMetaInterval: 5,
    maximumTypeStreak: 3,
    enabledQuestionCategoryIds: [
        "CAT_EVERYDAY",
        "CAT_CHILDHOOD",
        "CAT_PERSONALITY",
        "CAT_SCENARIO",
        "CAT_FRIENDSHIP",
        "CAT_RELATIONSHIP",
        "CAT_BODY",
    ],
    enabledDareTypeIds: ["DARE_SILLY", "DARE_OTHER", "DARE_TOUCH", "DARE_KISS", "DARE_CLOTHING"],
    blockedOperationalFlags: [],
    maximumSocialSensitivity: "PERSONAL",
    cardLocale: "",
    cardFallbackEnabled: false,
    cardFallbackLocales: [...loadLanguagePreferences().fallbackLocales],
    neverHaveIEverRevealMode: "ANONYMOUS_AGGREGATE",
    cardPolicy: { scopeDefault: {}, conditionalRules: [], exactCards: [] },
    deviceMode: "couch",
};

export function loadSetup(): GameSetupState {
    try {
        const stored = JSON.parse(
            sessionStorage.getItem(STORAGE_KEY) ?? "null",
        ) as Partial<GameSetupState> | null;
        return { ...defaults, ...stored };
    } catch {
        return { ...defaults };
    }
}

export function saveSetup(state: GameSetupState): void {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetSetup(step: SetupStep = "intent"): GameSetupState {
    const state = { ...defaults, step };
    saveSetup(state);
    return state;
}

/**
 * Selecting a built-in profile restores its immutable configuration. Custom is the
 * deliberate exception: an account-owned Custom snapshot can replace its neutral seed.
 */
export function applyGameProfile(
    state: GameSetupState,
    profile: GameProfileSummary,
    savedCustomConfiguration?: EffectiveGameSettings,
): GameSetupState {
    const canonical = {
        ...state,
        profileId: profile.id,
        adultContentConfirmed: false,
        enabledQuestionCategoryIds: [...profile.enabledQuestionCategoryIds],
        enabledDareTypeIds: [...profile.enabledDareTypeIds],
        blockedOperationalFlags: [...profile.blockedOperationalFlags],
        maximumSocialSensitivity: profile.maximumSocialSensitivity,
        startingIntensity: profile.startingIntensity as GameSetupState["startingIntensity"],
        maximumIntensity: profile.maximumIntensity as GameSetupState["maximumIntensity"],
        intensityProgressionUnit: profile.intensityProgressionUnit,
        intensityProgressionInterval: profile.intensityProgressionInterval,
        intensityProgressionIncrement: profile.intensityProgressionIncrement,
        randomQuestionRatio: profile.randomQuestionRatio,
        maximumTypeStreak: profile.maximumTypeStreak,
        letsTalkMetaInterval: profile.letsTalkMetaInterval,
    };
    if (profile.id !== "PROFILE_CUSTOM" || !savedCustomConfiguration) return canonical;
    return applyGameConfiguration(canonical, savedCustomConfiguration);
}

/** Repairs stale browser setup state against the profiles exposed by this deployment. */
export function repairUnavailableGameProfile(
    state: GameSetupState,
    profiles: readonly GameProfileSummary[],
): GameSetupState {
    if (profiles.some(({ id }) => id === state.profileId)) return state;
    const fallback =
        profiles.find(({ id }) => id === "PROFILE_FRIENDS") ??
        profiles.find(({ id }) => id !== "PROFILE_CUSTOM") ??
        profiles[0];
    return fallback ? applyGameProfile(state, fallback) : state;
}

export function applyGameConfiguration(
    state: GameSetupState,
    configuration: EffectiveGameSettings,
): GameSetupState {
    return {
        ...state,
        enabledQuestionCategoryIds: [...configuration.enabledQuestionCategoryIds],
        enabledDareTypeIds: [...configuration.enabledDareTypeIds],
        blockedOperationalFlags: [...configuration.blockedOperationalFlags],
        maximumSocialSensitivity: configuration.maximumSocialSensitivity,
        startingIntensity: configuration.startingIntensity,
        maximumIntensity: configuration.maximumIntensity,
        intensityProgressionUnit: configuration.intensityProgressionUnit,
        intensityProgressionInterval: configuration.intensityProgressionInterval,
        intensityProgressionIncrement: configuration.intensityProgressionIncrement,
        randomQuestionRatio: configuration.randomQuestionRatio,
        maximumTypeStreak: configuration.maximumTypeStreak,
        letsTalkMetaInterval: configuration.letsTalkMetaInterval,
    };
}

export function applyCardLanguageSettings(
    state: GameSetupState,
    settings: CardLanguageSettings,
): GameSetupState {
    return {
        ...state,
        cardLocale: settings.cardLocale,
        cardFallbackEnabled: settings.cardFallbackEnabled,
        cardFallbackLocales: [...settings.cardFallbackLocales],
    };
}

export function setupConfiguration(state: GameSetupState): EffectiveGameSettings {
    return {
        enabledQuestionCategoryIds: [...state.enabledQuestionCategoryIds],
        enabledDareTypeIds: [...state.enabledDareTypeIds],
        blockedOperationalFlags: [...state.blockedOperationalFlags],
        maximumSocialSensitivity: state.maximumSocialSensitivity,
        startingIntensity: state.startingIntensity,
        maximumIntensity: state.maximumIntensity,
        intensityProgressionUnit: state.intensityProgressionUnit,
        intensityProgressionInterval: state.intensityProgressionInterval,
        intensityProgressionIncrement: state.intensityProgressionIncrement,
        randomQuestionRatio: state.randomQuestionRatio,
        maximumTypeStreak: state.maximumTypeStreak,
        letsTalkMetaInterval: state.letsTalkMetaInterval,
    };
}

export function setupHref(step: SetupStep): string {
    return `/play/?setup=${step}`;
}

export function setupRoomSettings(state: GameSetupState): RoomGameSettings {
    return {
        mode: state.mode,
        profileId: state.profileId,
        groupId: state.groupChoice === "SELECT" ? state.groupId : null,
        adultContentConfirmed: state.adultContentConfirmed,
        cardLocale: state.cardLocale,
        cardFallbackEnabled: state.cardFallbackEnabled,
        cardFallbackLocales: [...state.cardFallbackLocales],
        neverHaveIEverRevealMode: state.neverHaveIEverRevealMode,
        cardPolicy: structuredClone(state.cardPolicy ?? defaults.cardPolicy!),
        configuration: setupConfiguration(state),
    };
}

export function hasMeaningfulSetup(state = loadSetup()): boolean {
    return state.intent !== null || state.step !== "intent";
}
