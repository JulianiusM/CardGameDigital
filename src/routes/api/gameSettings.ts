import express from "express";
import { z } from "zod";
import { AppDataSource } from "../../modules/database/dataSource";
import { DataSpaceGameSettingsEntity } from "../../modules/database/entities/game/DataSpaceGameSettingsEntity";
import { GroupEntity } from "../../modules/database/entities/game/GroupEntity";
import {
    BUILT_IN_PROFILE_IDS,
    SOCIAL_SENSITIVITIES,
    builtInGameProfile,
} from "../../packages/game-core";
import { CUSTOM_GAME_PROFILE_ID } from "../../packages/application/roomGameSettings";
import { effectiveSettingsFromProfile } from "../../packages/application/roomGameSettings";
import { effectiveGameSettingsSchema } from "../../packages/protocol";
import { requireCurrentDataSpace } from "./dataSpaceAccess";
import { cardLanguageSettingsSchema, requireActiveCardLanguages } from "./cardLanguageSettings";

const router = express.Router();
const inputSchema = z
    .object({
        preferredProfileId: z.string().min(1),
        startingIntensity: z.number().int().min(1).max(5).default(1),
        maximumIntensity: z.number().int().min(1).max(5),
        maximumSocialSensitivity: z.enum(SOCIAL_SENSITIVITIES).default("EXPLICIT"),
        intensityProgressionUnit: z.enum(["ROUNDS", "CARDS"]).default("CARDS"),
        intensityProgressionInterval: z.number().int().min(1).max(100).default(2),
        intensityProgressionIncrement: z.number().min(0.5).max(4).multipleOf(0.5).default(1),
        randomQuestionRatio: z.number().min(0).max(1),
        letsTalkMetaInterval: z.number().int().min(1).max(100),
        defaultGroupId: z.string().uuid().nullable(),
        customConfiguration: effectiveGameSettingsSchema.optional(),
        cardLanguageSettings: cardLanguageSettingsSchema.nullable().optional(),
    })
    .refine(({ startingIntensity, maximumIntensity }) => startingIntensity <= maximumIntensity, {
        message: "startingIntensity cannot exceed maximumIntensity",
        path: ["startingIntensity"],
    });
const defaults = {
    preferredProfileId: BUILT_IN_PROFILE_IDS.FRIENDS,
    startingIntensity: 1,
    maximumIntensity: 3,
    maximumSocialSensitivity: "PERSONAL" as const,
    intensityProgressionUnit: "CARDS" as const,
    intensityProgressionInterval: 2,
    intensityProgressionIncrement: 1,
    randomQuestionRatio: 0.6,
    letsTalkMetaInterval: 5,
    defaultGroupId: null,
    customConfiguration: effectiveSettingsFromProfile(CUSTOM_GAME_PROFILE_ID),
    cardLanguageSettings: null,
};

function project(stored: DataSpaceGameSettingsEntity | null) {
    if (!stored) return defaults;
    return {
        preferredProfileId: stored.preferredProfileId,
        startingIntensity: stored.startingIntensity,
        maximumIntensity: stored.maximumIntensity,
        maximumSocialSensitivity: stored.maximumSocialSensitivity,
        intensityProgressionUnit: stored.intensityProgressionUnit,
        intensityProgressionInterval: stored.intensityProgressionInterval,
        intensityProgressionIncrement: stored.intensityProgressionIncrement,
        randomQuestionRatio: stored.randomQuestionRatio,
        letsTalkMetaInterval: stored.letsTalkMetaInterval,
        defaultGroupId: stored.defaultGroupId,
        customConfiguration: stored.customConfigurationJson
            ? effectiveGameSettingsSchema.parse(JSON.parse(stored.customConfigurationJson))
            : defaults.customConfiguration,
        cardLanguageSettings: stored.cardLanguageSettingsJson
            ? cardLanguageSettingsSchema.parse(JSON.parse(stored.cardLanguageSettingsJson))
            : null,
    };
}

router.get("/", async (request, response, next) => {
    try {
        const space = await requireCurrentDataSpace(request);
        const stored = await AppDataSource.getRepository(DataSpaceGameSettingsEntity).findOneBy({
            dataSpaceId: space.id,
        });
        response.json({
            settings: project(stored),
            dataSpace: { id: space.id, name: space.name },
        });
    } catch (error) {
        next(error);
    }
});

router.put("/", async (request, response, next) => {
    try {
        const [space, input] = await Promise.all([
            requireCurrentDataSpace(request),
            inputSchema.parseAsync(request.body),
        ]);
        if (
            input.preferredProfileId !== CUSTOM_GAME_PROFILE_ID &&
            !builtInGameProfile(input.preferredProfileId)
        ) {
            return void response.status(400).json({ error: { code: "UNKNOWN_GAME_PROFILE" } });
        }
        if (
            input.defaultGroupId &&
            !(await AppDataSource.getRepository(GroupEntity).existsBy({
                id: input.defaultGroupId,
                dataSpaceId: space.id,
            }))
        ) {
            return void response.status(400).json({ error: { code: "GROUP_NOT_FOUND" } });
        }
        await requireActiveCardLanguages(input.cardLanguageSettings);
        const repository = AppDataSource.getRepository(DataSpaceGameSettingsEntity);
        const stored = await repository.findOneBy({ dataSpaceId: space.id });
        const current = project(stored);
        const customConfiguration =
            input.preferredProfileId === CUSTOM_GAME_PROFILE_ID
                ? (input.customConfiguration ?? current.customConfiguration)
                : current.customConfiguration;
        const cardLanguageSettings =
            input.cardLanguageSettings === undefined
                ? current.cardLanguageSettings
                : input.cardLanguageSettings;
        const saved = await repository.save(
            repository.create({
                dataSpaceId: space.id,
                preferredProfileId: input.preferredProfileId,
                startingIntensity: input.startingIntensity,
                maximumIntensity: input.maximumIntensity,
                maximumSocialSensitivity: input.maximumSocialSensitivity,
                intensityProgressionUnit: input.intensityProgressionUnit,
                intensityProgressionInterval: input.intensityProgressionInterval,
                intensityProgressionIncrement: input.intensityProgressionIncrement,
                randomQuestionRatio: input.randomQuestionRatio,
                letsTalkMetaInterval: input.letsTalkMetaInterval,
                defaultGroupId: input.defaultGroupId,
                customConfigurationJson: JSON.stringify(customConfiguration),
                cardLanguageSettingsJson: cardLanguageSettings
                    ? JSON.stringify(cardLanguageSettings)
                    : null,
                updatedAt: new Date(),
            }),
        );
        response.json({
            settings: project(saved),
            dataSpace: { id: space.id, name: space.name },
        });
    } catch (error) {
        next(error);
    }
});

export default router;
