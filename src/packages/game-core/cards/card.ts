import type { CardId } from "../index";
import type { CardType, DareTypeId, OperationalFlag, QuestionCategoryId } from "./taxonomy";

export type Card = {
    id: CardId;
    cardType: CardType;
    yesNoAnswerPossible: boolean;
    questionCategoryId: QuestionCategoryId | null;
    dareTypeId: DareTypeId | null;
    dareAffinityCategoryId: QuestionCategoryId | null;
    intensity: 1 | 2 | 3 | 4 | 5;
    alwaysEligible: boolean;
    repeatableInSession: boolean;
    repeatCooldown: number;
    weight: number;
    active: boolean;
    operationalFlags: readonly OperationalFlag[];
};

/** A locale-specific rendering selected by a repository for a game session. */
export type PlayableCard = Card & {
    cardText: string;
    locale: string;
};
