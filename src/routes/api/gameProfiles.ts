import express from "express";
import { BUILT_IN_GAME_PROFILES } from "../../packages/game-core";
import { detectLocale, translate } from "../../packages/localization/messages";

const router = express.Router();

router.get("/", (request, response) => {
    const locale = detectLocale(request.get("accept-language"));
    response.json({
        profiles: BUILT_IN_GAME_PROFILES.map((profile) => ({
            id: profile.id,
            name: translate(locale, profile.nameKey),
            description: translate(locale, profile.descriptionKey),
            editorialStatus: profile.editorialStatus,
            requiresAdultConfirmation: profile.requiresAdultConfirmation,
            enabledQuestionCategoryIds: [...profile.enabledQuestionCategoryIds],
            enabledDareTypeIds: [...profile.enabledDareTypeIds],
            blockedOperationalFlags: [...profile.blockedOperationalFlags],
            maximumIntensity: profile.maximumIntensity,
            randomQuestionRatio: profile.randomQuestionRatio,
            maximumTypeStreak: profile.maximumTypeStreak,
            letsTalkMetaInterval: profile.letsTalkMetaInterval,
            immutable: true,
        })),
    });
});

export default router;
