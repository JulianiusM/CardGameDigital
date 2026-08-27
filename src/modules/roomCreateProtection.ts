import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { RoomCreateIdempotencyProtection } from "../packages/application/roomCreateIdempotency";
import type { DataSource } from "typeorm";
import { RoomCreateIdempotencyEntity } from "./database/entities/game/RoomCreateIdempotencyEntity";
import { installationServerId } from "./installationIdentity";
import settings from "./settings";
import { logEvent } from "./structuredLogger";

type ProtectionState = {
    protection: RoomCreateIdempotencyProtection | null;
    reason: string | null;
};

let state: ProtectionState | undefined;

function decodeSecret(value: string): Buffer {
    const trimmed = value.trim();
    if (/^[A-Za-z0-9_-]{43,}$/u.test(trimmed)) {
        const decoded = Buffer.from(trimmed, "base64url");
        if (decoded.byteLength >= 32) return decoded;
    }
    const utf8 = Buffer.from(trimmed, "utf8");
    if (utf8.byteLength < 32) {
        throw new Error("Room-create protection secret must contain at least 32 bytes");
    }
    return utf8;
}

function hasMinimumSecretBytes(value: string): boolean {
    const trimmed = value.trim();
    if (/^[A-Za-z0-9_-]{43,}$/u.test(trimmed)) {
        return Buffer.from(trimmed, "base64url").byteLength >= 32;
    }
    return Buffer.byteLength(trimmed, "utf8") >= 32;
}

function localSecretFile(file: string): Buffer {
    const resolved = path.resolve(file);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    if (!fs.existsSync(resolved)) {
        const generated = randomBytes(32).toString("base64url");
        try {
            fs.writeFileSync(resolved, `${generated}\n`, {
                encoding: "utf8",
                flag: "wx",
                mode: 0o600,
            });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
    }
    return decodeSecret(fs.readFileSync(resolved, "utf8"));
}

export function initializeRoomCreateProtection(): ProtectionState {
    if (state) return state;
    try {
        const serverId = installationServerId();
        let secret: Buffer;
        if (settings.value.roomCreateSecret.trim()) {
            secret = decodeSecret(settings.value.roomCreateSecret);
        } else if (
            !settings.value.sessionSecret.startsWith("local-") &&
            hasMinimumSecretBytes(settings.value.sessionSecret)
        ) {
            secret = decodeSecret(settings.value.sessionSecret);
        } else if (settings.value.deploymentMode === "local") {
            secret = localSecretFile(settings.value.roomCreateSecretFile);
        } else {
            throw new Error("no stable Room-create protection secret is configured");
        }
        state = {
            protection: new RoomCreateIdempotencyProtection(secret, serverId),
            reason: null,
        };
    } catch (error) {
        state = {
            protection: null,
            reason: "INITIALIZATION_FAILED",
        };
        logEvent(
            "error",
            "room.create_replay_protection_unavailable",
            {
                reason: state.reason,
                errorType: error instanceof Error ? error.name : "UnknownError",
            },
            settings.value.logLevel,
        );
    }
    return state;
}

export function roomDisplayBootstrapCapability(): boolean {
    return (
        settings.value.roomDisplayBootstrapEnabled &&
        initializeRoomCreateProtection().protection !== null
    );
}

export async function validateRetainedRoomCreateProtection(source: DataSource): Promise<void> {
    const repository = source.getRepository(RoomCreateIdempotencyEntity);
    const retained = await repository
        .createQueryBuilder("replay")
        .select("replay.state", "state")
        .addSelect("replay.lookupKeyId", "lookupKeyId")
        .addSelect("replay.responseKeyId", "responseKeyId")
        .distinct(true)
        .getRawMany<{
            state: "REPLAYABLE" | "RESOURCE_GONE";
            lookupKeyId: string | null;
            responseKeyId: string | null;
        }>();
    if (!settings.value.roomDisplayBootstrapEnabled && retained.length === 0) return;
    const initialized = initializeRoomCreateProtection();
    if (!initialized.protection) return;
    if (
        retained.some(
            ({ state: retainedState, lookupKeyId }) =>
                (retainedState === "REPLAYABLE" && lookupKeyId === null) ||
                (lookupKeyId !== null && lookupKeyId !== initialized.protection!.lookupKeyId),
        ) ||
        retained.some(
            ({ state: retainedState, responseKeyId }) =>
                (retainedState === "REPLAYABLE" && responseKeyId === null) ||
                (responseKeyId !== null && responseKeyId !== initialized.protection!.responseKeyId),
        )
    ) {
        state = { protection: null, reason: "RETAINED_KEY_MISMATCH" };
        logEvent(
            "error",
            "room.create_replay_protection_unavailable",
            { reason: state.reason, errorType: "RetainedKeyMismatch" },
            settings.value.logLevel,
        );
    }
}

export function resetRoomCreateProtectionForTests(): void {
    state = undefined;
}
