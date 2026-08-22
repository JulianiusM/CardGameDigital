import type { RoomGameSettings } from "./multiplayer";

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
    maximumIntensity: 1 | 2 | 3 | 4 | 5;
    randomQuestionRatio: number;
    letsTalkMetaInterval: number;
    maximumTypeStreak: number;
    enabledQuestionCategoryIds: string[];
    enabledDareTypeIds: string[];
    blockedOperationalFlags: string[];
    cardLocale: string;
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
    maximumIntensity: 3,
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
    cardLocale: "de-DE",
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
        configuration: {
            enabledQuestionCategoryIds: state.enabledQuestionCategoryIds,
            enabledDareTypeIds: state.enabledDareTypeIds,
            blockedOperationalFlags: state.blockedOperationalFlags,
            maximumIntensity: state.maximumIntensity,
            randomQuestionRatio: state.randomQuestionRatio,
            maximumTypeStreak: state.maximumTypeStreak,
            letsTalkMetaInterval: state.letsTalkMetaInterval,
        },
    };
}

export function hasMeaningfulSetup(state = loadSetup()): boolean {
    return state.intent !== null || state.step !== "intent";
}
