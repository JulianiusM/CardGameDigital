import type {
    AtmospherePresentation,
    PresentationEffect,
    PresentationScene,
    VisualFamily,
} from "./presentation";
import {
    DARE_VISUAL_FAMILY_BY_TYPE_ID,
    QUESTION_VISUAL_FAMILY_BY_CATEGORY_ID,
} from "../../../packages/design-tokens";
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

function mappedVisualFamily(
    mapping: Readonly<Record<string, VisualFamily>>,
    taxonomyId: string,
): VisualFamily | undefined {
    return mapping[taxonomyId];
}

export function visualFamilyFor(card: PresentedCard): VisualFamily {
    if (card.cardType === "CONVERSATION_META") return "CONVERSATION";
    if (card.cardType === "QUESTION" && card.questionCategoryId)
        return (
            mappedVisualFamily(QUESTION_VISUAL_FAMILY_BY_CATEGORY_ID, card.questionCategoryId) ??
            "CURIOSITY"
        );
    if (card.cardType === "DARE" && card.dareTypeId)
        return mappedVisualFamily(DARE_VISUAL_FAMILY_BY_TYPE_ID, card.dareTypeId) ?? "GENERIC_DARE";
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
