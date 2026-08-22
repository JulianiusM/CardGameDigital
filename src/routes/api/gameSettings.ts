import express from "express";
import { z } from "zod";
import { AppDataSource } from "../../modules/database/dataSource";
import { DataSpaceGameSettingsEntity } from "../../modules/database/entities/game/DataSpaceGameSettingsEntity";
import { GroupEntity } from "../../modules/database/entities/game/GroupEntity";
import { BUILT_IN_PROFILE_IDS, builtInGameProfile } from "../../packages/game-core";
import { requireCurrentDataSpace } from "./dataSpaceAccess";

const router = express.Router();
const schema = z.object({
    preferredProfileId: z.string().min(1),
    maximumIntensity: z.number().int().min(1).max(5),
    randomQuestionRatio: z.number().min(0).max(1),
    letsTalkMetaInterval: z.number().int().min(1).max(100),
    defaultGroupId: z.string().uuid().nullable(),
});
const defaults = {
    preferredProfileId: BUILT_IN_PROFILE_IDS.FRIENDS,
    maximumIntensity: 3,
    randomQuestionRatio: 0.6,
    letsTalkMetaInterval: 5,
    defaultGroupId: null,
};

router.get("/", async (request, response, next) => {
    try {
        const space = await requireCurrentDataSpace(request);
        const stored = await AppDataSource.getRepository(DataSpaceGameSettingsEntity).findOneBy({
            dataSpaceId: space.id,
        });
        response.json({ settings: stored ? schema.parse(stored) : defaults });
    } catch (error) {
        next(error);
    }
});

router.put("/", async (request, response, next) => {
    try {
        const [space, input] = await Promise.all([
            requireCurrentDataSpace(request),
            schema.parseAsync(request.body),
        ]);
        if (!builtInGameProfile(input.preferredProfileId)) {
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
        const repository = AppDataSource.getRepository(DataSpaceGameSettingsEntity);
        await repository.save(
            repository.create({ dataSpaceId: space.id, ...input, updatedAt: new Date() }),
        );
        response.json({ settings: input });
    } catch (error) {
        next(error);
    }
});

export default router;
