import type { PresentationEffect, PresentationScene } from "./presentation";

export type PresentedCard = {
    id: string;
    cardText: string;
    cardType: string;
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
    if (card?.cardType === "CONVERSATION") return "CONVERSATION";
    if (card?.cardType === "QUESTION") return "QUESTION";
    return connected ? "LOBBY" : "MENU";
}

export function atmosphereFor(card: PresentedCard | null | undefined): string {
    return card?.questionCategoryId ?? card?.dareTypeId ?? "general";
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
