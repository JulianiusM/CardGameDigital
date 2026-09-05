import {
    createCipheriv,
    createDecipheriv,
    createHmac,
    createHash,
    hkdfSync,
    randomBytes,
    timingSafeEqual,
} from "node:crypto";
import type { RoomJoinResult } from "./realtimeRooms";

export const ROOM_CREATE_ROUTE_KEY = "/api/v1/rooms";
export const ROOM_CREATE_RESPONSE_SCHEMA_VERSION = 1;
export const ROOM_CREATE_RESPONSE_KEY_ID_PREFIX = "room-create-replay-v1";
export const ROOM_CREATE_LOOKUP_KEY_ID_PREFIX = "room-create-lookup-v1";

export type RoomCreateReplayBinding = {
    routeKey: string;
    principalScopeDigest: string;
    keyDigest: string;
    requestFingerprint: string;
    resourceId: string;
    responseSchemaVersion: number;
};

function canonicalJson(value: unknown): string {
    if (value === null) return "null";
    if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            throw new Error("Canonical JSON does not support non-finite numbers");
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        const entries = Object.keys(record)
            .sort(compareCanonicalKeys)
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
        return `{${entries.join(",")}}`;
    }
    throw new Error("Canonical JSON input contains an unsupported value");
}

function digestEqual(left: string, right: string): boolean {
    if (left.length !== right.length) return false;
    return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export class RoomCreateIdempotencyProtection {
    private readonly lookupKey: Buffer;
    private readonly encryptionKey: Buffer;
    readonly lookupKeyId: string;
    readonly responseKeyId: string;

    constructor(rootSecret: Buffer, serverId: string) {
        if (rootSecret.byteLength < 32) {
            throw new Error("Room-create replay protection requires at least 32 bytes of entropy");
        }
        const salt = Buffer.from(serverId, "utf8");
        this.lookupKey = Buffer.from(
            hkdfSync("sha256", rootSecret, salt, "party-game-room-create-lookup-v1", 32),
        );
        this.encryptionKey = Buffer.from(
            hkdfSync("sha256", rootSecret, salt, "party-game-room-create-replay-v1", 32),
        );
        this.lookupKeyId = `${ROOM_CREATE_LOOKUP_KEY_ID_PREFIX}:${createHash("sha256")
            .update("room-create-lookup-key-id-v1\0")
            .update(this.lookupKey)
            .digest("hex")
            .slice(0, 32)}`;
        this.responseKeyId = `${ROOM_CREATE_RESPONSE_KEY_ID_PREFIX}:${createHash("sha256")
            .update("room-create-response-key-id-v1\0")
            .update(this.encryptionKey)
            .digest("hex")
            .slice(0, 32)}`;
    }

    principalScopeDigest(principalScope: string): string {
        return createHmac("sha256", this.lookupKey)
            .update("room-create-scope-v1\0")
            .update(principalScope)
            .digest("hex");
    }

    keyDigest(canonicalKey: string): string {
        return createHmac("sha256", this.lookupKey)
            .update("room-create-key-v1\0")
            .update(canonicalKey)
            .digest("hex");
    }

    requestFingerprint(requestBody: unknown): string {
        return createHash("sha256")
            .update("room-create-fingerprint-v1\n")
            .update(canonicalJson(requestBody))
            .digest("hex");
    }

    matchesFingerprint(left: string, right: string): boolean {
        return digestEqual(left, right);
    }

    encryptResponse(binding: RoomCreateReplayBinding, response: RoomJoinResult): string {
        const nonce = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, nonce);
        cipher.setAAD(Buffer.from(canonicalJson(binding), "utf8"));
        const ciphertext = Buffer.concat([
            cipher.update(JSON.stringify(response), "utf8"),
            cipher.final(),
        ]);
        const tag = cipher.getAuthTag();
        return [nonce, ciphertext, tag].map((value) => value.toString("base64url")).join(".");
    }

    decryptResponse(binding: RoomCreateReplayBinding, protectedResponse: string): RoomJoinResult {
        const parts = protectedResponse.split(".");
        if (parts.length !== 3) throw new Error("Stored Room-create replay payload is malformed");
        const [nonce, ciphertext, tag] = parts.map((part) => Buffer.from(part, "base64url"));
        if (nonce.byteLength !== 12 || tag.byteLength !== 16) {
            throw new Error("Stored Room-create replay payload has invalid framing");
        }
        const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, nonce);
        decipher.setAAD(Buffer.from(canonicalJson(binding), "utf8"));
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return JSON.parse(plaintext.toString("utf8")) as RoomJoinResult;
    }
}

// Preserve the code-unit ordering used by persisted request fingerprints.
function compareCanonicalKeys(left: string, right: string): number {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
}
