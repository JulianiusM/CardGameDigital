import type { DareTypeId, OperationalFlag, QuestionCategoryId } from "../cards/taxonomy";
import {
    INTENSITY_LEVELS,
    INTENSITY_PROGRESSION_INCREMENT_MAXIMUM,
    INTENSITY_PROGRESSION_INCREMENT_MINIMUM,
    INTENSITY_PROGRESSION_UNITS,
    type Intensity,
    type IntensityProgressionUnit,
} from "../cards/intensity";

export type GameProfile = {
    id: string;
    name: string;
    enabledQuestionCategoryIds: ReadonlySet<QuestionCategoryId>;
    enabledDareTypeIds: ReadonlySet<DareTypeId>;
    blockedOperationalFlags: ReadonlySet<OperationalFlag>;
    startingIntensity: Intensity;
    maximumIntensity: Intensity;
    intensityProgressionUnit: IntensityProgressionUnit;
    intensityProgressionInterval: number;
    intensityProgressionIncrement: number;
    randomQuestionRatio: number;
    maximumTypeStreak: number;
    letsTalkMetaInterval: number;
};

export function validateGameProfile(profile: GameProfile): GameProfile {
    if (!profile.id || !profile.name) throw new Error("GameProfile id and name are required");
    if (!INTENSITY_LEVELS.includes(profile.maximumIntensity))
        throw new Error("maximumIntensity must be an integer in [1, 5]");
    if (!INTENSITY_LEVELS.includes(profile.startingIntensity))
        throw new Error("startingIntensity must be an integer in [1, 5]");
    if (profile.startingIntensity > profile.maximumIntensity)
        throw new Error("startingIntensity cannot exceed maximumIntensity");
    if (!Object.values(INTENSITY_PROGRESSION_UNITS).includes(profile.intensityProgressionUnit))
        throw new Error("intensityProgressionUnit must be ROUNDS or CARDS");
    if (
        !Number.isInteger(profile.intensityProgressionInterval) ||
        profile.intensityProgressionInterval < 1
    )
        throw new Error("intensityProgressionInterval must be positive");
    if (
        !Number.isInteger(profile.intensityProgressionIncrement * 2) ||
        profile.intensityProgressionIncrement < INTENSITY_PROGRESSION_INCREMENT_MINIMUM ||
        profile.intensityProgressionIncrement > INTENSITY_PROGRESSION_INCREMENT_MAXIMUM
    )
        throw new Error("intensityProgressionIncrement must be a half-step in [0.5, 4]");
    if (profile.randomQuestionRatio < 0 || profile.randomQuestionRatio > 1)
        throw new Error("randomQuestionRatio must be in [0, 1]");
    if (!Number.isInteger(profile.maximumTypeStreak) || profile.maximumTypeStreak < 1)
        throw new Error("maximumTypeStreak must be positive");
    if (!Number.isInteger(profile.letsTalkMetaInterval) || profile.letsTalkMetaInterval < 1)
        throw new Error("letsTalkMetaInterval must be positive");
    return profile;
}

export type PlayerBoundaries = {
    disabledQuestionCategoryIds: ReadonlySet<QuestionCategoryId>;
    disabledDareTypeIds: ReadonlySet<DareTypeId>;
    blockedOperationalFlags: ReadonlySet<OperationalFlag>;
};
