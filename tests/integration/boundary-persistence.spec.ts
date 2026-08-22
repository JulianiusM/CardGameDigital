import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppDataSource, initDataSource } from "../../src/modules/database/dataSource";
import settings from "../../src/modules/settings";
import { TypeOrmRealtimeRoomRepository } from "../../src/packages/persistence";
import { DARE_TYPES, OPERATIONAL_FLAGS, QUESTION_CATEGORIES } from "../../src/packages/game-core";

let directory: string;
let repository: TypeOrmRealtimeRoomRepository;
let roomId: string;
let participantId: string;

beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "boundaries-"));
    Object.assign(process.env, {
        SETTINGS_FILE: "/dev/null",
        DEPLOYMENT_MODE: "local",
        AUTH_MODE: "none",
        DB_TYPE: "sqlite",
        DB_FILE: path.join(directory, "boundaries.sqlite"),
        SESSION_SECRET: "boundary_persistence_test_secret",
    });
    await settings.read("/dev/null");
    await initDataSource();
    repository = new TypeOrmRealtimeRoomRepository(AppDataSource);
    roomId = randomUUID();
    participantId = randomUUID();
    await repository.createRoom({
        roomId,
        code: "SAFE23",
        dataSpaceId: null,
        expiresAt: new Date(Date.now() + 60_000),
        participant: {
            id: participantId,
            roomId,
            role: "HOST",
            displayName: "Host",
            credentialHash: "a".repeat(64),
        },
    });
});

afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("private boundary persistence", () => {
    it("round-trips independent question, dare, and operational restrictions", async () => {
        await repository.saveBoundaries(participantId, {
            disabledQuestionCategoryIds: new Set([QUESTION_CATEGORIES.SEX_EXPERIENCE]),
            disabledDareTypeIds: new Set([DARE_TYPES.THIRD_PARTY, DARE_TYPES.NUDITY]),
            blockedOperationalFlags: new Set([OPERATIONAL_FLAGS.INVOLVES_THIRD_PARTY]),
        });

        const restored = (await repository.listBoundaries(roomId)).get(participantId)!;
        expect([...restored.disabledQuestionCategoryIds]).toEqual([
            QUESTION_CATEGORIES.SEX_EXPERIENCE,
        ]);
        expect(restored.disabledDareTypeIds.has(DARE_TYPES.THIRD_PARTY)).toBe(true);
        expect(restored.blockedOperationalFlags.has(OPERATIONAL_FLAGS.INVOLVES_THIRD_PARTY)).toBe(
            true,
        );
    });
});
