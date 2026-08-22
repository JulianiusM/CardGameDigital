import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import { AppDataSource } from "../../modules/database/dataSource";
import { GroupEntity } from "../../modules/database/entities/game/GroupEntity";
import { requireCurrentDataSpace } from "./dataSpaceAccess";
import { builtInGameProfile } from "../../packages/game-core";

const router = express.Router();
const inputSchema = z
    .object({
        name: z.string().trim().min(1).max(80),
        members: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
        preferredProfileId: z
            .string()
            .min(1)
            .refine((id) => Boolean(builtInGameProfile(id)))
            .nullable()
            .optional(),
    })
    .strict();
const project = (group: GroupEntity) => ({
    id: group.id,
    name: group.name,
    members: JSON.parse(group.membersJson) as string[],
    updatedAt: group.updatedAt,
    historyResetAt: group.historyResetAt,
    preferredProfileId: group.preferredProfileId,
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
            }),
        );
        response.status(201).json(project(group));
    } catch (error) {
        next(error);
    }
});

router.put("/:id", async (request, response, next) => {
    try {
        const [space, input] = await Promise.all([
            requireCurrentDataSpace(request),
            inputSchema.parseAsync(request.body),
        ]);
        const repository = AppDataSource.getRepository(GroupEntity);
        const group = await repository.findOneBy({ id: request.params.id, dataSpaceId: space.id });
        if (!group) return void response.status(404).json({ error: { code: "GROUP_NOT_FOUND" } });
        group.name = input.name;
        group.membersJson = JSON.stringify(input.members);
        if (input.preferredProfileId !== undefined)
            group.preferredProfileId = input.preferredProfileId;
        group.updatedAt = new Date();
        response.json(project(await repository.save(group)));
    } catch (error) {
        next(error);
    }
});

router.delete("/:id", async (request, response, next) => {
    try {
        const space = await requireCurrentDataSpace(request);
        const result = await AppDataSource.getRepository(GroupEntity).delete({
            id: request.params.id,
            dataSpaceId: space.id,
        });
        if (result.affected !== 1)
            return void response.status(404).json({ error: { code: "GROUP_NOT_FOUND" } });
        response.status(204).end();
    } catch (error) {
        next(error);
    }
});

router.post("/:id/history-reset", async (request, response, next) => {
    try {
        const [space] = await Promise.all([
            requireCurrentDataSpace(request),
            z
                .object({ confirmed: z.literal(true) })
                .strict()
                .parseAsync(request.body),
        ]);
        const repository = AppDataSource.getRepository(GroupEntity);
        const group = await repository.findOneBy({ id: request.params.id, dataSpaceId: space.id });
        if (!group) return void response.status(404).json({ error: { code: "GROUP_NOT_FOUND" } });
        group.historyResetAt = new Date();
        group.updatedAt = group.historyResetAt;
        response.json(project(await repository.save(group)));
    } catch (error) {
        next(error);
    }
});

export default router;
