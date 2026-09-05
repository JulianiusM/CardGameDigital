import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
    ROOM_CREATE_RESPONSE_SCHEMA_VERSION,
    ROOM_CREATE_ROUTE_KEY,
    RoomCreateIdempotencyProtection,
} from "../../packages/application/roomCreateIdempotency";
import type { RoomJoinResult } from "../../packages/application/realtimeRooms";

describe("Room-create replay protection", () => {
    const rootSecret = randomBytes(32);
    const serverId = randomUUID();
    const protection = new RoomCreateIdempotencyProtection(rootSecret, serverId);

    it("canonicalizes object-key order while preserving caller-supplied structure", () => {
        expect(protection.requestFingerprint({ b: 2, a: [true, null] })).toBe(
            protection.requestFingerprint({ a: [true, null], b: 2 }),
        );
        expect(protection.requestFingerprint({ displayName: "Screen" })).not.toBe(
            protection.requestFingerprint({
                displayName: "Screen",
                bootstrapMode: "DISPLAY_WAITING_FOR_HOST",
            }),
        );
    });

    it("uses purpose-separated digests and authenticated response encryption", () => {
        const key = randomUUID();
        const principalScopeDigest = protection.principalScopeDigest("installation:local");
        const keyDigest = protection.keyDigest(key);
        const requestFingerprint = protection.requestFingerprint({ displayName: "Screen" });
        expect(principalScopeDigest).not.toBe(keyDigest);
        expect(keyDigest).not.toContain(key);
        expect(protection.responseKeyId).toMatch(/^room-create-replay-v1:[a-f0-9]{32}$/);
        expect(protection.lookupKeyId).toMatch(/^room-create-lookup-v1:[a-f0-9]{32}$/);

        const response: RoomJoinResult = {
            roomId: randomUUID(),
            roomCode: "ABC234",
            participantId: randomUUID(),
            participantCredential: randomBytes(32).toString("base64url"),
            role: "DISPLAY",
            bootstrapMode: "DISPLAY_WAITING_FOR_HOST",
            hostStatus: {
                state: "AWAITING_FIRST_HOST",
                participantId: null,
                displayName: null,
                deadline: null,
            },
        };
        const binding = {
            routeKey: ROOM_CREATE_ROUTE_KEY,
            principalScopeDigest,
            keyDigest,
            requestFingerprint,
            resourceId: response.roomId,
            responseSchemaVersion: ROOM_CREATE_RESPONSE_SCHEMA_VERSION,
        };
        const encrypted = protection.encryptResponse(binding, response);
        expect(encrypted).not.toContain(response.participantCredential);
        expect(protection.decryptResponse(binding, encrypted)).toEqual(response);

        const parts = encrypted.split(".");
        const changed = parts[1][0] === "A" ? "B" : "A";
        const tampered = [parts[0], `${changed}${parts[1].slice(1)}`, parts[2]].join(".");
        expect(() => protection.decryptResponse(binding, tampered)).toThrow();
        expect(() =>
            protection.decryptResponse({ ...binding, resourceId: randomUUID() }, encrypted),
        ).toThrow();
    });

    it("exposes a stable non-secret key identifier that detects secret or identity rotation", () => {
        expect(new RoomCreateIdempotencyProtection(rootSecret, serverId).responseKeyId).toBe(
            protection.responseKeyId,
        );
        expect(new RoomCreateIdempotencyProtection(rootSecret, serverId).lookupKeyId).toBe(
            protection.lookupKeyId,
        );
        expect(
            new RoomCreateIdempotencyProtection(randomBytes(32), serverId).responseKeyId,
        ).not.toBe(protection.responseKeyId);
        expect(new RoomCreateIdempotencyProtection(randomBytes(32), serverId).lookupKeyId).not.toBe(
            protection.lookupKeyId,
        );
        expect(
            new RoomCreateIdempotencyProtection(rootSecret, randomUUID()).responseKeyId,
        ).not.toBe(protection.responseKeyId);
    });
});
