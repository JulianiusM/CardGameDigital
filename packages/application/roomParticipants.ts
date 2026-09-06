import type { PlayerBoundaries } from "../game-core";
import type { RoomParticipant } from "./realtimeRooms";

/** Shared topology rules used by Personal, Party Screen, and hybrid device play. */
export function sessionPlayers(participants: readonly RoomParticipant[]) {
    return participants
        .filter(
            ({ role, connectionStatus }) => role !== "DISPLAY" && connectionStatus === "CONNECTED",
        )
        .flatMap((participant) => [
            { id: participant.id, name: participant.displayName },
            ...participant.devicePlayers,
        ]);
}

export function boundariesForSessionPlayers(
    participants: readonly RoomParticipant[],
    stored: ReadonlyMap<string, PlayerBoundaries>,
): ReadonlyMap<string, PlayerBoundaries> {
    const expanded = new Map(stored);
    for (const participant of participants) {
        const boundary = stored.get(participant.id);
        if (boundary)
            for (const devicePlayer of participant.devicePlayers)
                expanded.set(devicePlayer.id, boundary);
    }
    return expanded;
}

export function controlledPlayerIds(
    viewer: RoomParticipant,
    participants: readonly RoomParticipant[],
): ReadonlySet<string> {
    if (viewer.role === "DISPLAY") return new Set();
    // Expiry may already have removed the participant from the live Room list.
    const controller = participants.find(({ id }) => id === viewer.id) ?? viewer;
    return new Set([viewer.id, ...controller.devicePlayers.map(({ id }) => id)]);
}

export function fallbackHost(
    participants: readonly RoomParticipant[],
    connectedParticipantIds: ReadonlySet<string>,
): RoomParticipant | undefined {
    return participants.find(
        ({ id, role }) => role === "PLAYER" && connectedParticipantIds.has(id),
    );
}
