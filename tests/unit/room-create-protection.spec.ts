import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "typeorm";

vi.mock("../../src/modules/settings", () => ({
    default: {
        value: {
            roomDisplayBootstrapEnabled: true,
            roomCreateSecret: "stable-room-create-secret-value-1234567890",
            sessionSecret: "unused-session-secret-value-1234567890",
            deploymentMode: "local",
            roomCreateSecretFile: "unused",
            logLevel: "silent",
        },
    },
}));
vi.mock("../../src/modules/installationIdentity", () => ({
    installationServerId: () => "0b95a99b-321c-4dc7-af52-51cae21d2f31",
}));

import { RoomCreateIdempotencyEntity } from "../../src/modules/database/entities/game/RoomCreateIdempotencyEntity";
import {
    initializeRoomCreateProtection,
    resetRoomCreateProtectionForTests,
    roomDisplayBootstrapCapability,
    validateRetainedRoomCreateProtection,
} from "../../src/modules/roomCreateProtection";

let source: DataSource;

beforeEach(async () => {
    resetRoomCreateProtectionForTests();
    source = new DataSource({
        type: "better-sqlite3",
        database: ":memory:",
        entities: [RoomCreateIdempotencyEntity],
        synchronize: true,
    });
    await source.initialize();
});

afterEach(async () => {
    if (source.isInitialized) await source.destroy();
    resetRoomCreateProtectionForTests();
});

async function insertTombstone(lookupKeyId: string | null): Promise<void> {
    await source.getRepository(RoomCreateIdempotencyEntity).insert({
        id: randomUUID(),
        principalScopeDigest: "a".repeat(64),
        routeKey: "/api/v1/rooms",
        keyDigest: "b".repeat(64),
        lookupKeyId,
        requestFingerprint: "c".repeat(64),
        state: "RESOURCE_GONE",
        statusCode: null,
        responseSchemaVersion: null,
        responseKeyId: null,
        responseCiphertext: null,
        resourceType: "ROOM",
        resourceId: randomUUID(),
        creatorParticipantId: randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        tombstoneExpiresAt: new Date(Date.now() + 60_000),
    });
}

describe("retained Room-create purpose keys", () => {
    it("disables creation when a tombstone references another lookup key", async () => {
        await insertTombstone("room-create-lookup-v1:rotated-without-migration");
        await validateRetainedRoomCreateProtection(source);
        expect(roomDisplayBootstrapCapability()).toBe(false);
    });

    it("allows intentionally invalidated identity-reset tombstones", async () => {
        await insertTombstone(null);
        await validateRetainedRoomCreateProtection(source);
        expect(roomDisplayBootstrapCapability()).toBe(true);
        expect(initializeRoomCreateProtection().protection).not.toBeNull();
    });
});
