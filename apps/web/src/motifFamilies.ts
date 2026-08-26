import type { VisualFamily } from "./presentation";

export const MOTIF_SYMBOLS_BY_FAMILY: Readonly<Record<VisualFamily, readonly string[]>> = {
    GENERAL: ["spark", "wave", "linked", "star", "heart"],
    LOBBY: ["door", "people", "phone", "speech-pair", "spark"],
    CURIOSITY: ["question", "bulb", "thought", "cloud", "star", "dice"],
    INNER_SELF: ["mirror", "fingerprint", "eye", "silhouette", "contour", "spark"],
    CONNECTION: ["linked", "speech-pair", "hands", "paired-stars", "heart"],
    UNFILTERED: ["wobble", "bubbles", "spiral", "warped-star", "tilted-shape"],
    INTIMATE_TALK: ["open-heart", "lips", "speech", "keyhole", "spark"],
    DESIRE_STORIES: ["spark", "kiss", "magnet", "heart", "trail", "frame"],
    MISCHIEF: ["zigzag", "burst", "star", "blob", "exclamation"],
    SOCIAL_CHAOS: ["arrows-out", "satellite", "speech", "rings", "people"],
    AFFECTION: ["heart", "hands", "linked", "kiss", "ripple"],
    FLIRT: ["lips", "spark", "magnet", "heart", "squiggle"],
    REVEAL: ["fold", "hanger", "curtains", "silhouette", "sunrise"],
    HEAT: ["flame", "intertwined", "pulse", "crescent", "dense-spark"],
    GENERIC_DARE: ["arrow", "burst", "exclamation", "motion", "zigzag"],
    CONVERSATION: ["speech", "speech-pair", "dots", "thought", "ripple"],
    END: ["confetti", "star", "ribbon", "spark", "burst"],
};

export function motifSymbolsForFamily(family: VisualFamily): readonly string[] {
    return MOTIF_SYMBOLS_BY_FAMILY[family];
}
