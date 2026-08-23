import express from "express";
import { BUILT_IN_GAME_PROFILES } from "../../packages/game-core";
import { detectLocale, translate } from "../../packages/localization/messages";
import { MESSAGE_KEYS } from "../../packages/localization/keys";
import {
    CUSTOM_GAME_PROFILE_ID,
    effectiveSettingsFromProfile,
} from "../../packages/application/roomGameSettings";

const router = express.Router();

router.get("/", (request, response) => {
    const locale = detectLocale(request.get("accept-language"));
    response.json({
        profiles: [
            ...BUILT_IN_GAME_PROFILES.map((profile) => ({
                id: profile.id,
                name: translate(locale, profile.nameKey),
                description: translate(locale, profile.descriptionKey),
                editorialStatus: profile.editorialStatus,
                requiresAdultConfirmation: profile.requiresAdultConfirmation,
                enabledQuestionCategoryIds: [...profile.enabledQuestionCategoryIds],
                enabledDareTypeIds: [...profile.enabledDareTypeIds],
                blockedOperationalFlags: [...profile.blockedOperationalFlags],
                startingIntensity: profile.startingIntensity,
                maximumIntensity: profile.maximumIntensity,
                intensityProgressionUnit: profile.intensityProgressionUnit,
                intensityProgressionInterval: profile.intensityProgressionInterval,
                intensityProgressionIncrement: profile.intensityProgressionIncrement,
                randomQuestionRatio: profile.randomQuestionRatio,
                maximumTypeStreak: profile.maximumTypeStreak,
                letsTalkMetaInterval: profile.letsTalkMetaInterval,
                immutable: true,
            })),
            {
                id: CUSTOM_GAME_PROFILE_ID,
                name: translate(locale, MESSAGE_KEYS.PROFILE_CUSTOM_NAME),
                description: translate(locale, MESSAGE_KEYS.PROFILE_CUSTOM_DESCRIPTION),
                editorialStatus: "PUBLISHED",
                requiresAdultConfirmation: false,
                ...effectiveSettingsFromProfile(CUSTOM_GAME_PROFILE_ID),
                immutable: false,
            },
        ],
    });
});

export default router;
