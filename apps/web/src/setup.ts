export type SetupIntent = "HOST" | "JOIN";
export type DeviceMode = "couch" | "personal" | "party";
export type SetupStep = "intent" | "group" | "mode" | "profile" | "customize" | "screen";

export type GameSetupState = {
    step: SetupStep;
    intent: SetupIntent | null;
    groupId: string | null;
    groupMembers: string[];
    mode: string;
    profileId: string;
    adultContentConfirmed: boolean;
    maximumIntensity: 1 | 2 | 3 | 4 | 5;
    randomQuestionRatio: number;
    letsTalkMetaInterval: number;
    deviceMode: DeviceMode;
};

const STORAGE_KEY = "party-game:setup";
const defaults: GameSetupState = {
    step: "intent",
    intent: null,
    groupId: null,
    groupMembers: [],
    mode: "CLASSIC_TRUTH_OR_DARE",
    profileId: "PROFILE_FRIENDS",
    adultContentConfirmed: false,
    maximumIntensity: 3,
    randomQuestionRatio: 0.6,
    letsTalkMetaInterval: 5,
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
