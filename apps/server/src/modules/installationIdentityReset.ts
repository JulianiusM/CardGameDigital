import { createHash, randomBytes, randomUUID } from "node:crypto";
import { In, IsNull, Not, type DataSource } from "typeorm";
import { RoomCreateIdempotencyEntity } from "../../../../packages/persistence/entities/game/RoomCreateIdempotencyEntity";
import { GameSessionEntity } from "../../../../packages/persistence/entities/game/GameSessionEntity";
import { RoomEntity } from "../../../../packages/persistence/entities/game/RoomEntity";
import { RoomParticipantEntity } from "../../../../packages/persistence/entities/game/RoomParticipantEntity";
import { InstallationMetadataEntity } from "../../../../packages/persistence/entities/server/InstallationMetadataEntity";
import { replaceLoadedInstallationIdentity } from "./installationIdentity";
import { logEvent } from "./structuredLogger";
import settings from "./settings";
import { scrubRoomPrivateBoundaries } from "../../../../packages/persistence/privateBoundaryRetention";

export type InstallationIdentityResetResult = {
    invalidatedRoomCount: number;
    invalidatedParticipantCount: number;
    erasedReplayCount: number;
};

export async function resetInstallationIdentity(
    source: DataSource,
    options: { invalidateRuntime: boolean; tombstoneRetentionSeconds?: number; at?: Date },
): Promise<InstallationIdentityResetResult> {
    const at = options.at ?? new Date();
    const nextServerId = randomUUID();
    const result = await source.transaction(async (manager) => {
        const rooms = manager.getRepository(RoomEntity);
        const idempotency = manager.getRepository(RoomCreateIdempotencyEntity);
        const liveRooms = await rooms.find({
            where: { closedAt: IsNull() },
            select: { id: true },
        });
        const replayableCount = await idempotency.countBy({ state: "REPLAYABLE" });
        if ((liveRooms.length || replayableCount) && !options.invalidateRuntime) {
            throw Object.assign(
                new Error(
                    `Identity reset refused: ${liveRooms.length} open Room(s) and ${replayableCount} replayable create result(s) remain`,
                ),
                { code: "INSTALLATION_IDENTITY_RESET_REQUIRES_INVALIDATION" },
            );
        }

        let invalidatedParticipantCount = 0;
        if (options.invalidateRuntime) {
            const roomIds = liveRooms.map(({ id }) => id);
            if (roomIds.length) {
                await manager
                    .getRepository(GameSessionEntity)
                    .update({ roomId: In(roomIds), endedAt: IsNull() }, { endedAt: at });
                const participants = await manager.getRepository(RoomParticipantEntity).find({
                    where: { roomId: In(roomIds), connectionStatus: Not("LEFT") },
                    select: { id: true },
                });
                for (const participant of participants) {
                    const invalidCredentialHash = createHash("sha256")
                        .update("installation-identity-reset\0")
                        .update(randomBytes(32))
                        .digest("hex");
                    await manager.getRepository(RoomParticipantEntity).update(
                        { id: participant.id },
                        {
                            credentialHash: invalidCredentialHash,
                            connectionStatus: "LEFT",
                            activeHostRoomId: null,
                            reconnectDeadline: null,
                            leftAt: at,
                            revokedAt: at,
                            lastSeenAt: at,
                        },
                    );
                }
                invalidatedParticipantCount = participants.length;
                await rooms.update({ id: In(roomIds) }, { closedAt: at });
                for (const roomId of roomIds) {
                    const room = await rooms.findOneByOrFail({ id: roomId });
                    const roomParticipants = await manager
                        .getRepository(RoomParticipantEntity)
                        .findBy({ roomId });
                    await scrubRoomPrivateBoundaries(manager, room, roomParticipants, at.getTime());
                }
            }
            await idempotency.update(
                { state: "REPLAYABLE" },
                {
                    state: "RESOURCE_GONE",
                    lookupKeyId: null,
                    statusCode: null,
                    responseSchemaVersion: null,
                    responseKeyId: null,
                    responseCiphertext: null,
                    updatedAt: at,
                    tombstoneExpiresAt: new Date(
                        at.getTime() + (options.tombstoneRetentionSeconds ?? 86_400) * 1_000,
                    ),
                },
            );
        }
        // RESOURCE_GONE rows contain no replay secret and belong to the old installation
        // namespace. Clearing their lookup-key identifier records that this explicit reset,
        // rather than an accidental secret rotation, made them unreachable.
        await idempotency.update({ state: "RESOURCE_GONE" }, { lookupKeyId: null });

        const updated = await manager
            .getRepository(InstallationMetadataEntity)
            .update({ id: 1 }, { serverId: nextServerId });
        if (updated.affected !== 1) {
            throw new Error("Installation metadata singleton is missing");
        }
        return {
            invalidatedRoomCount: options.invalidateRuntime ? liveRooms.length : 0,
            invalidatedParticipantCount,
            erasedReplayCount: options.invalidateRuntime ? replayableCount : 0,
        };
    });
    replaceLoadedInstallationIdentity(nextServerId);
    logEvent(
        "info",
        "installation.identity_reset",
        {
            runtimeInvalidated: options.invalidateRuntime,
            invalidatedRoomCount: result.invalidatedRoomCount,
            invalidatedParticipantCount: result.invalidatedParticipantCount,
            erasedReplayCount: result.erasedReplayCount,
        },
        settings.value.logLevel,
    );
    return result;
}
