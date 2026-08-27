import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppDataSource, initDataSource } from "../../src/modules/database/dataSource";
import settings from "../../src/modules/settings";
import { TypeOrmRealtimeRoomRepository } from "../../src/packages/persistence";
import { DARE_TYPES, OPERATIONAL_FLAGS, QUESTION_CATEGORIES } from "../../src/packages/game-core";
import { defaultRoomGameSettings } from "../../src/packages/application/roomGameSettings";
import { DEFAULT_ROOM_CAPACITY } from "../../src/packages/application/roomService";

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
    const createdAt = Date.now();
    await repository.createRoom({
        roomId,
        code: "SAFE23",
        dataSpaceId: null,
        createdAt,
        expiresAt: new Date(createdAt + 60_000),
        bootstrapMode: "CREATOR_HOST",
        firstHostAssignedAt: createdAt,
        activationDeadline: createdAt + 30_000,
        settings: defaultRoomGameSettings(),
        participant: {
            id: participantId,
            roomId,
            role: "HOST",
            displayName: "Host",
            devicePlayers: [],
            connectionStatus: "TEMPORARILY_DISCONNECTED",
            joinedAt: createdAt,
            firstConnectedAt: null,
            lastConnectedAt: null,
            reconnectDeadline: null,
            activationExpiresAt: createdAt + 30_000,
            leftAt: null,
            revokedAt: null,
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

    it("persists Room closure and excludes every participant and future join", async () => {
        await repository.applyLifecycleTransition({
            type: "CLOSE",
            roomId,
            participantId,
            at: Date.now(),
        });

        expect(await repository.listParticipants(roomId)).toEqual([]);
        await expect(
            repository.joinRoom(
                {
                    id: randomUUID(),
                    roomCode: "SAFE23",
                    role: "PLAYER",
                    displayName: "Late joiner",
                    devicePlayers: [],
                    connectionStatus: "CONNECTED",
                    joinedAt: Date.now(),
                    firstConnectedAt: Date.now(),
                    lastConnectedAt: Date.now(),
                    reconnectDeadline: null,
                    activationExpiresAt: Date.now() + 30_000,
                    leftAt: null,
                    revokedAt: null,
                    credentialHash: "b".repeat(64),
                },
                DEFAULT_ROOM_CAPACITY,
            ),
        ).rejects.toMatchObject({ code: "ROOM_NOT_FOUND" });
    });
});
