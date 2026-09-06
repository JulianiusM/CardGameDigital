import { readStoredJson, writeStoredJson } from "./storedJson";
import { In, type EntityManager } from "typeorm";
import type { GameSessionRuntimeState } from "../game-core";
import { MESSAGE_KEYS } from "../localization/keys";
import { GameSessionEntity } from "./entities/game/GameSessionEntity";
import { RoomEntity } from "./entities/game/RoomEntity";
import { RoomParticipantEntity } from "./entities/game/RoomParticipantEntity";
import { RoomParticipantBoundaryEntity } from "./entities/game/RoomParticipantBoundaryEntity";

export function retainedRuntimeBoundaries(
    runtime: GameSessionRuntimeState,
    allowedPlayerIds?: ReadonlySet<string>,
): GameSessionRuntimeState["boundariesByPlayer"] {
    if (runtime.state === "ENDED") return [];
    const roster = new Set(runtime.players.map(({ id }) => id));
    return runtime.boundariesByPlayer.filter(
        ([id]) => roster.has(id) && (!allowedPlayerIds || allowedPlayerIds.has(id)),
    );
}

export function participantBoundariesAreNeeded(
    room: RoomEntity,
    participant: RoomParticipantEntity,
    at: number,
): boolean {
    if (
        room.closedAt ||
        room.expiresAt.getTime() <= at ||
        participant.role === "DISPLAY" ||
        participant.connectionStatus === "LEFT" ||
        participant.leftAt ||
        participant.revokedAt
    )
        return false;
    if (!participant.firstConnectedAt) {
        return (
            participant.activationExpiresAt !== null &&
            participant.activationExpiresAt.getTime() > at
        );
    }
    if (participant.connectionStatus === "TEMPORARILY_DISCONNECTED") {
        return (
            participant.reconnectDeadline !== null && participant.reconnectDeadline.getTime() > at
        );
    }
    return true;
}

export function retainedRoomBoundaryPlayerIds(
    room: RoomEntity,
    participants: readonly RoomParticipantEntity[],
    at: number,
): ReadonlySet<string> {
    return new Set(
        participants
            .filter((participant) => participantBoundariesAreNeeded(room, participant, at))
            .flatMap((participant) => [
                participant.id,
                ...(JSON.parse(participant.devicePlayersJson) as { id: string }[]).map(
                    ({ id }) => id,
                ),
            ]),
    );
}

/** Run inside the terminal lifecycle transaction, before any later Session commit. */
export async function scrubRoomPrivateBoundaries(
    manager: EntityManager,
    room: RoomEntity,
    participants: readonly RoomParticipantEntity[],
    at: number,
): Promise<void> {
    const discarded = participants
        .filter((participant) => !participantBoundariesAreNeeded(room, participant, at))
        .map(({ id }) => id);
    if (discarded.length) {
        await manager
            .getRepository(RoomParticipantBoundaryEntity)
            .delete({ participantId: In(discarded) });
    }
    if (!room.currentSessionId) return;
    const sessions = manager.getRepository(GameSessionEntity);
    const session = await sessions.findOneBy({ id: room.currentSessionId, roomId: room.id });
    if (!session) return;
    const runtime = await readStoredJson<GameSessionRuntimeState>(session.runtimeStateJson);
    runtime.boundariesByPlayer = retainedRuntimeBoundaries(
        runtime,
        retainedRoomBoundaryPlayerIds(room, participants, at),
    );
    const runtimeStateJson = await writeStoredJson(runtime);
    if (runtimeStateJson !== session.runtimeStateJson) {
        const updated = await sessions.update(
            { id: session.id, revision: session.revision },
            { runtimeStateJson },
        );
        if (updated.affected !== 1) {
            throw Object.assign(new Error(MESSAGE_KEYS.GAME_STALE_REVISION), {
                code: "STALE_SESSION_REVISION",
            });
        }
    }
}
