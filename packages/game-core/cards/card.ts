import type { CardId } from "../index";
import type { Intensity } from "./intensity";
import type { CardType, DareTypeId, OperationalFlag, QuestionCategoryId } from "./taxonomy";
import type { SocialSensitivity } from "./socialSensitivity";

export type Card = {
    id: CardId;
    cardType: CardType;
    yesNoAnswerPossible: boolean;
    questionCategoryId: QuestionCategoryId | null;
    dareTypeId: DareTypeId | null;
    dareAffinityCategoryId: QuestionCategoryId | null;
    intensity: Intensity;
    alwaysEligible: boolean;
    repeatableInSession: boolean;
    repeatCooldown: number;
    weight: number;
    socialSensitivity: SocialSensitivity;
    minimumPlayerCount: number;
    maximumPlayerCount: number | null;
    policyAvailable?: boolean;
    active: boolean;
    operationalFlags: readonly OperationalFlag[];
};

/** A locale-specific rendering selected by a repository for a game session. */
export type PlayableCard = Card & {
    cardText: string;
    locale: string;
};
