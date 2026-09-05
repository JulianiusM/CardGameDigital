import {
    decideRoomHost,
    derivePersistedRoomHostStatus,
    type HostSelectionTrigger,
} from "../../packages/application/roomHostSelection";
import type {
    RoomLifecycleTransition,
    RoomLifecycleTransitionResult,
    RoomParticipant,
    RoomRoleChange,
    RoomRoleChangeReason,
    RoomState,
} from "../../packages/application/realtimeRooms";

type StoredParticipant = RoomParticipant & { credentialHash: string };

export function applyMemoryLifecycleTransition(
    room: RoomState,
    participants: StoredParticipant[],
    transition: RoomLifecycleTransition,
): RoomLifecycleTransitionResult {
    if (room.closedAt !== null) return emptyResult(true);
    const roomParticipants = participants.filter(({ roomId }) => roomId === room.id);
    const hostStatusBefore = derivePersistedRoomHostStatus(room, roomParticipants, transition.at);
    const transitionedId = "participantId" in transition ? transition.participantId : null;
    let transitioned = roomParticipants.find(({ id }) => id === transitionedId);
    const expiredParticipants: RoomParticipant[] = [];
    let hostLossReason: RoomRoleChangeReason | null = null;
    let participantFirstActivated = false;

    const markTerminal = (participant: StoredParticipant): void => {
        participant.connectionStatus = "LEFT";
        participant.reconnectDeadline = null;
        participant.leftAt = transition.at;
    };

    for (const participant of roomParticipants) {
        if (participant.connectionStatus === "LEFT" || participant.leftAt !== null) continue;
        const activationExpired =
            participant.firstConnectedAt === null &&
            participant.activationExpiresAt <= transition.at;
        const reconnectExpired =
            participant.firstConnectedAt !== null &&
            participant.connectionStatus === "TEMPORARILY_DISCONNECTED" &&
            participant.reconnectDeadline !== null &&
            participant.reconnectDeadline <= transition.at;
        if (!activationExpired && !reconnectExpired) continue;
        if (participant.role === "HOST") {
            hostLossReason = activationExpired
                ? "HOST_ACTIVATION_EXPIRED"
                : "HOST_DISCONNECT_EXPIRED";
        }
        markTerminal(participant);
        expiredParticipants.push({ ...participant });
    }

    let activationRejected = false;
    if (transition.type === "ACTIVATE") {
        if (
            !transitioned ||
            transitioned.credentialHash !== transition.credentialHash ||
            transitioned.connectionStatus === "LEFT" ||
            transitioned.revokedAt !== null ||
            room.expiresAt <= transition.at
        ) {
            transitioned = undefined;
            activationRejected = true;
        } else {
            participantFirstActivated = transitioned.firstConnectedAt === null;
            transitioned.firstConnectedAt ??= transition.at;
            transitioned.lastConnectedAt = transition.at;
            transitioned.connectionStatus = "CONNECTED";
            transitioned.reconnectDeadline = null;
            room.activatedAt ??= transition.at;
        }
    } else if (transition.type === "DISCONNECT") {
        if (transitioned?.connectionStatus === "CONNECTED") {
            transitioned.connectionStatus = "TEMPORARILY_DISCONNECTED";
            transitioned.reconnectDeadline = transition.reconnectDeadline;
        }
    } else if (transition.type === "LEAVE") {
        if (transitioned && transitioned.connectionStatus !== "LEFT") {
            if (transitioned.role === "HOST") hostLossReason = "HOST_LEFT";
            markTerminal(transitioned);
        }
    }

    const roomExpired = room.expiresAt <= transition.at;

    let trigger: HostSelectionTrigger = { type: "RECONCILE" };
    if (transition.type === "ACTIVATE" && !activationRejected) {
        trigger = { type: "ACTIVATE", participantId: transition.participantId };
    } else if (transition.type === "TRANSFER_HOST") {
        trigger = {
            type: "TRANSFER",
            participantId: transition.participantId,
            targetParticipantId: transition.targetParticipantId,
        };
    } else if (transition.type === "CLOSE") {
        trigger = { type: "CLOSE", participantId: transition.participantId };
    } else if (hostLossReason) {
        trigger = { type: "HOST_LOST", reason: hostLossReason };
    }

    const decision = decideRoomHost({
        room,
        participants: roomParticipants,
        trigger,
        now: transition.at,
    });
    const roleChanges: RoomRoleChange[] = [];
    for (const demoteParticipantId of decision.demoteParticipantIds) {
        const demoted = roomParticipants.find(({ id }) => id === demoteParticipantId);
        if (demoted && demoted.role === "HOST") {
            demoted.role = "PLAYER";
            roleChanges.push({
                participantId: demoted.id,
                previousRole: "HOST",
                role: "PLAYER",
                reason: decision.reason ?? "HOST_DISCONNECT_EXPIRED",
            });
        }
    }
    if (decision.promoteParticipantId) {
        const promoted = roomParticipants.find(({ id }) => id === decision.promoteParticipantId)!;
        const previousRole = promoted.role;
        promoted.role = "HOST";
        room.firstHostAssignedAt ??= transition.at;
        roleChanges.push({
            participantId: promoted.id,
            previousRole,
            role: "HOST",
            reason: decision.reason ?? "INITIAL_HOST_ASSIGNED",
        });
    }
    if (decision.closeRoom) {
        room.closedAt = transition.at;
        for (const participant of roomParticipants) {
            if (participant.connectionStatus !== "LEFT") markTerminal(participant);
        }
    }
    const current = transitioned?.connectionStatus === "LEFT" ? null : transitioned;
    let closeReason: RoomLifecycleTransitionResult["closeReason"] = null;
    if (decision.closeRoom) {
        if (transition.type === "CLOSE") closeReason = "EXPLICIT_CLOSE";
        else if (roomExpired) closeReason = "ROOM_EXPIRED";
        else if (room.activatedAt === null && room.activationDeadline <= transition.at) {
            closeReason = "INITIAL_ACTIVATION_EXPIRED";
        } else closeReason = "ABANDONED";
    }
    return {
        participant: current ? { ...current } : null,
        expiredParticipants,
        roleChanges,
        roomClosed: decision.closeRoom,
        hostStatusBefore,
        hostStatusAfter: decision.hostStatus,
        participantFirstActivated,
        replayResultsErased: 0,
        closeReason,
        invariantRepair: decision.invariantRepair,
    };
}

function emptyResult(roomClosed: boolean): RoomLifecycleTransitionResult {
    return {
        participant: null,
        expiredParticipants: [],
        roleChanges: [],
        roomClosed,
        hostStatusBefore: null,
        hostStatusAfter: null,
        participantFirstActivated: false,
        replayResultsErased: 0,
        closeReason: null,
        invariantRepair: false,
    };
}
