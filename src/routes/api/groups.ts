import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import { AppDataSource } from "../../modules/database/dataSource";
import { GroupEntity } from "../../modules/database/entities/game/GroupEntity";
import { DataSpaceGameSettingsEntity } from "../../modules/database/entities/game/DataSpaceGameSettingsEntity";
import { RoomEntity } from "../../modules/database/entities/game/RoomEntity";
import { GameSessionEntity } from "../../modules/database/entities/game/GameSessionEntity";
import { CouchGameSessionEntity } from "../../modules/database/entities/game/CouchGameSessionEntity";
import { CardAppearanceEntity } from "../../modules/database/entities/game/CardAppearanceEntity";
import { CouchCardAppearanceEntity } from "../../modules/database/entities/game/CouchCardAppearanceEntity";
import { requireCurrentDataSpace } from "./dataSpaceAccess";
import { builtInGameProfile } from "../../packages/game-core";
import { CUSTOM_GAME_PROFILE_ID } from "../../packages/application/roomGameSettings";
import { effectiveGameSettingsSchema } from "../../packages/protocol";
import { cardLanguageSettingsSchema, requireActiveCardLanguages } from "./cardLanguageSettings";

const router = express.Router();
const inputSchema = z
    .object({
        name: z.string().trim().min(1).max(80),
        members: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
        preferredProfileId: z
            .string()
            .min(1)
            .refine((id) => id === CUSTOM_GAME_PROFILE_ID || Boolean(builtInGameProfile(id)))
            .nullable()
            .optional(),
        customConfiguration: effectiveGameSettingsSchema.nullable().optional(),
        cardLanguageSettings: cardLanguageSettingsSchema.nullable().optional(),
    })
    .strict();
const groupIdSchema = z.string().uuid();
const project = (group: GroupEntity) => ({
    id: group.id,
    name: group.name,
    members: JSON.parse(group.membersJson) as string[],
    updatedAt: group.updatedAt,
    historyResetAt: group.historyResetAt,
    preferredProfileId: group.preferredProfileId,
    customConfiguration: group.customConfigurationJson
        ? effectiveGameSettingsSchema.parse(JSON.parse(group.customConfigurationJson))
        : null,
    cardLanguageSettings: group.cardLanguageSettingsJson
        ? cardLanguageSettingsSchema.parse(JSON.parse(group.cardLanguageSettingsJson))
        : null,
});

router.get("/", async (request, response, next) => {
    try {
        const space = await requireCurrentDataSpace(request);
        const groups = await AppDataSource.getRepository(GroupEntity).find({
            where: { dataSpaceId: space.id },
            order: { name: "ASC" },
        });
        response.json({ groups: groups.map(project) });
    } catch (error) {
        next(error);
    }
});

router.post("/", async (request, response, next) => {
    try {
        const [space, input] = await Promise.all([
            requireCurrentDataSpace(request),
            inputSchema.parseAsync(request.body),
        ]);
        const repository = AppDataSource.getRepository(GroupEntity);
        await requireActiveCardLanguages(input.cardLanguageSettings);
        const now = new Date();
        const group = await repository.save(
            repository.create({
                id: randomUUID(),
                dataSpaceId: space.id,
                name: input.name,
                membersJson: JSON.stringify(input.members),
                createdAt: now,
                updatedAt: now,
                historyResetAt: null,
                preferredProfileId: input.preferredProfileId ?? null,
                customConfigurationJson: input.customConfiguration
                    ? JSON.stringify(input.customConfiguration)
                    : null,
                cardLanguageSettingsJson: input.cardLanguageSettings
                    ? JSON.stringify(input.cardLanguageSettings)
                    : null,
            }),
        );
        response.status(201).json(project(group));
    } catch (error) {
        next(error);
    }
});

router.put("/:id", async (request, response, next) => {
    try {
        const [space, input, groupId] = await Promise.all([
            requireCurrentDataSpace(request),
            inputSchema.parseAsync(request.body),
            groupIdSchema.parseAsync(request.params.id),
        ]);
        const repository = AppDataSource.getRepository(GroupEntity);
        const group = await repository.findOneBy({ id: groupId, dataSpaceId: space.id });
        if (!group) return void response.status(404).json({ error: { code: "GROUP_NOT_FOUND" } });
        await requireActiveCardLanguages(input.cardLanguageSettings);
        group.name = input.name;
        group.membersJson = JSON.stringify(input.members);
        if (input.preferredProfileId !== undefined)
            group.preferredProfileId = input.preferredProfileId;
        if (input.customConfiguration !== undefined) {
            group.customConfigurationJson = input.customConfiguration
                ? JSON.stringify(input.customConfiguration)
                : null;
        }
        if (input.cardLanguageSettings !== undefined) {
            group.cardLanguageSettingsJson = input.cardLanguageSettings
                ? JSON.stringify(input.cardLanguageSettings)
                : null;
        }
        group.updatedAt = new Date();
        response.json(project(await repository.save(group)));
    } catch (error) {
        next(error);
    }
});

router.delete("/:id", async (request, response, next) => {
    try {
        const [space, groupId] = await Promise.all([
            requireCurrentDataSpace(request),
            groupIdSchema.parseAsync(request.params.id),
        ]);
        const deleted = await AppDataSource.transaction(async (manager) => {
            const groups = manager.getRepository(GroupEntity);
            const group = await groups.findOneBy({ id: groupId, dataSpaceId: space.id });
            if (!group) return false;

            const rooms = await manager.getRepository(RoomEntity).findBy({
                dataSpaceId: space.id,
                groupId,
            });
            for (const room of rooms) {
                const roomSettings = JSON.parse(room.gameSettingsJson) as Record<string, unknown>;
                room.groupId = null;
                roomSettings.groupId = null;
                room.gameSettingsJson = JSON.stringify(roomSettings);
                room.settingsRevision += 1;
                room.settingsUpdatedByParticipantId = null;
            }
            if (rooms.length) await manager.getRepository(RoomEntity).save(rooms);

            await manager
                .getRepository(DataSpaceGameSettingsEntity)
                .update(
                    { dataSpaceId: space.id, defaultGroupId: groupId },
                    { defaultGroupId: null },
                );
            await manager.getRepository(GameSessionEntity).update({ groupId }, { groupId: null });
            await manager
                .getRepository(CouchGameSessionEntity)
                .update({ groupId }, { groupId: null });
            await manager
                .getRepository(CardAppearanceEntity)
                .update({ groupId }, { groupId: null });
            await manager
                .getRepository(CouchCardAppearanceEntity)
                .update({ groupId }, { groupId: null });
            await groups.delete({ id: groupId, dataSpaceId: space.id });
            return true;
        });
        if (!deleted) return void response.status(404).json({ error: { code: "GROUP_NOT_FOUND" } });
        response.status(204).end();
    } catch (error) {
        next(error);
    }
});

router.post("/:id/history-reset", async (request, response, next) => {
    try {
        const [space, groupId] = await Promise.all([
            requireCurrentDataSpace(request),
            groupIdSchema.parseAsync(request.params.id),
            z
                .object({ confirmed: z.literal(true) })
                .strict()
                .parseAsync(request.body),
        ]);
        const repository = AppDataSource.getRepository(GroupEntity);
        const group = await repository.findOneBy({ id: groupId, dataSpaceId: space.id });
        if (!group) return void response.status(404).json({ error: { code: "GROUP_NOT_FOUND" } });
        group.historyResetAt = new Date();
        group.updatedAt = group.historyResetAt;
        response.json(project(await repository.save(group)));
    } catch (error) {
        next(error);
    }
});

export default router;
