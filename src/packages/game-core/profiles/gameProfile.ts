import type { DareTypeId, OperationalFlag, QuestionCategoryId } from "../cards/taxonomy";

export type GameProfile = {
    id: string;
    name: string;
    enabledQuestionCategoryIds: ReadonlySet<QuestionCategoryId>;
    enabledDareTypeIds: ReadonlySet<DareTypeId>;
    blockedOperationalFlags: ReadonlySet<OperationalFlag>;
    maximumIntensity: 1 | 2 | 3 | 4 | 5;
    randomQuestionRatio: number;
    maximumTypeStreak: number;
    letsTalkMetaInterval: number;
};

export function validateGameProfile(profile: GameProfile): GameProfile {
    if (!profile.id || !profile.name) throw new Error("GameProfile id and name are required");
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
