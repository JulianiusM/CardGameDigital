import type {
    AtmospherePresentation,
    PresentationEffect,
    PresentationScene,
    VisualFamily,
} from "./presentation";
import { motifSymbolsForFamily } from "./motifFamilies";

export type PresentedCard = {
    id: string;
    cardText: string;
    cardType: string;
    cardIntensity: number;
    intensity: number;
    questionCategoryId: string | null;
    dareTypeId: string | null;
};

/** Maps domain state to presentation without coupling rendering to protocol details. */
export function sceneFor(
    state: string | undefined,
    card: PresentedCard | null | undefined,
    connected: boolean,
): PresentationScene {
    if (state === "ENDED") return "END";
    if (card?.cardType === "DARE") return "DARE";
    if (card?.cardType === "CONVERSATION_META") return "CONVERSATION";
    if (card?.cardType === "QUESTION") return "QUESTION";
    return connected ? "LOBBY" : "MENU";
}

const questionFamilies: Record<string, VisualFamily> = {
    CAT_EVERYDAY: "CURIOSITY",
    CAT_CHILDHOOD: "CURIOSITY",
    CAT_SCENARIO: "CURIOSITY",
    CAT_PERSONALITY: "INNER_SELF",
    CAT_BODY: "INNER_SELF",
    CAT_FRIENDSHIP: "CONNECTION",
    CAT_RELATIONSHIP: "CONNECTION",
    CAT_INTOXICATION: "UNFILTERED",
    CAT_SEXUALITY: "INTIMATE_TALK",
    CAT_SEX_OPENNESS: "INTIMATE_TALK",
    CAT_SEX_TENSION: "DESIRE_STORIES",
    CAT_SEX_EXPERIENCE: "DESIRE_STORIES",
};

const dareFamilies: Record<string, VisualFamily> = {
    DARE_SILLY: "MISCHIEF",
    DARE_THIRD_PARTY: "SOCIAL_CHAOS",
    DARE_KISS: "AFFECTION",
    DARE_TOUCH: "AFFECTION",
    DARE_KISS_SPICY: "FLIRT",
    DARE_TOUCH_SPICY: "FLIRT",
    DARE_SEXUAL_TENSION: "FLIRT",
    DARE_CLOTHING: "REVEAL",
    DARE_NUDITY: "REVEAL",
    DARE_TOUCH_SEXY: "HEAT",
    DARE_BORDERLINE_SEX: "HEAT",
    DARE_SEX: "HEAT",
    DARE_OTHER: "GENERIC_DARE",
};

export function visualFamilyFor(card: PresentedCard): VisualFamily {
    if (card.cardType === "CONVERSATION_META") return "CONVERSATION";
    if (card.cardType === "QUESTION" && card.questionCategoryId)
        return questionFamilies[card.questionCategoryId] ?? "CURIOSITY";
    if (card.cardType === "DARE" && card.dareTypeId)
        return dareFamilies[card.dareTypeId] ?? "GENERIC_DARE";
    return "GENERAL";
}

/** Stable pseudo-random choice: varied across Cards, unchanged across reactive rerenders. */
export function motifSymbolFor(card: PresentedCard): string {
    const symbols = motifSymbolsForFamily(visualFamilyFor(card));
    let hash = 2_166_136_261;
    for (const character of card.id) {
        hash ^= character.codePointAt(0) ?? 0;
        hash = Math.imul(hash, 16_777_619);
    }
    return symbols[(hash >>> 0) % symbols.length];
}

function presentationIntensity(value: number): 1 | 2 | 3 | 4 | 5 {
    if (value <= 1) return 1;
    if (value >= 5) return 5;
    return Math.round(value) as 2 | 3 | 4;
}

export function atmosphereFor(
    card: PresentedCard | null | undefined,
): AtmospherePresentation | null {
    if (!card) return null;
    return {
        family: visualFamilyFor(card),
        intensity: presentationIntensity(card.intensity),
    };
}

export function effectForCommand(command: string): PresentationEffect {
    switch (command) {
        case "vote":
        case "command.submitVote":
            return "vote";
        case "end":
        case "command.endSession":
            return "end";
        case "start":
        case "advance":
        case "command.startTurn":
        case "command.advanceSession":
            return "turn";
        default:
            return "action";
    }
}
