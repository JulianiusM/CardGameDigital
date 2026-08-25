import { globalCardIntensityLevel, type Intensity, type PlayableCard } from "../game-core";

export type CardIntensityProjection = {
    cardIntensity: Intensity;
    intensity: Intensity;
};

/** Keeps the catalog-relative and derived global Card intensities distinct at client boundaries. */
export function projectCardIntensities(card: PlayableCard): CardIntensityProjection {
    return {
        cardIntensity: card.intensity,
        intensity: globalCardIntensityLevel(card),
    };
}
