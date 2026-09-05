import type {
    RoomHostStatus,
    RoomParticipant,
    RoomRoleChangeReason,
    RoomState,
} from "./realtimeRooms";

export type HostSelectionTrigger =
    | { type: "ACTIVATE"; participantId: string }
    | { type: "TRANSFER"; participantId: string; targetParticipantId: string }
    | { type: "HOST_LOST"; reason: RoomRoleChangeReason }
    | { type: "CLOSE"; participantId: string }
    | { type: "RECONCILE" };

export type HostSelectionDecision = {
    demoteParticipantIds: readonly string[];
    promoteParticipantId: string | null;
    reason: RoomRoleChangeReason | null;
    closeRoom: boolean;
    hostStatus: RoomHostStatus;
    invariantRepair: boolean;
};

function isCurrent(participant: RoomParticipant): boolean {
    return (
        participant.connectionStatus !== "LEFT" &&
        participant.leftAt === null &&
        participant.revokedAt === null
    );
}

function isConnectedPlayer(participant: RoomParticipant): boolean {
    return (
        isCurrent(participant) &&
        participant.role === "PLAYER" &&
        participant.connectionStatus === "CONNECTED" &&
        participant.firstConnectedAt !== null
    );
}

function isReconnectable(participant: RoomParticipant, now: number): boolean {
    return (
        isCurrent(participant) &&
        participant.firstConnectedAt !== null &&
        participant.connectionStatus === "TEMPORARILY_DISCONNECTED" &&
        participant.reconnectDeadline !== null &&
        participant.reconnectDeadline > now
    );
}

function participantStatus(
    state: RoomHostStatus["state"],
    participant: RoomParticipant,
    deadline: number | null,
): RoomHostStatus {
    return {
        state,
        participantId: participant.id,
        displayName: participant.displayName,
        deadline,
    };
}

function emptyStatus(room: RoomState): RoomHostStatus {
    return {
        state:
            room.firstHostAssignedAt === null ? "AWAITING_FIRST_HOST" : "AWAITING_REPLACEMENT_HOST",
        participantId: null,
        displayName: null,
        deadline: null,
    };
}

function noChange(
    hostStatus: RoomHostStatus,
    demoteParticipantIds: readonly string[] = [],
    reason: RoomRoleChangeReason | null = null,
    invariantRepair = false,
): HostSelectionDecision {
    return {
        demoteParticipantIds,
        promoteParticipantId: null,
        reason,
        closeRoom: false,
        hostStatus,
        invariantRepair,
    };
}

function orderedByJoin(participants: readonly RoomParticipant[]): RoomParticipant[] {
    return [...participants].sort((left, right) => {
        const joined = left.joinedAt - right.joinedAt;
        return joined || left.id.localeCompare(right.id);
    });
}

function orderedCandidates(participants: readonly RoomParticipant[]): RoomParticipant[] {
    return orderedByJoin(participants.filter(isConnectedPlayer));
}

function hostAuthorityRank(participant: RoomParticipant, now: number): number {
    if (participant.connectionStatus === "CONNECTED") return 0;
    if (participant.firstConnectedAt === null && participant.activationExpiresAt > now) return 1;
    if (isReconnectable(participant, now)) return 2;
    return 3;
}

function orderedHosts(participants: readonly RoomParticipant[], now: number): RoomParticipant[] {
    return orderedByJoin(
        participants.filter((participant) => participant.role === "HOST" && isCurrent(participant)),
    ).sort((left, right) => hostAuthorityRank(left, now) - hostAuthorityRank(right, now));
}

function inferredHostLossReason(participant: RoomParticipant): RoomRoleChangeReason {
    return participant.firstConnectedAt === null
        ? "HOST_ACTIVATION_EXPIRED"
        : "HOST_DISCONNECT_EXPIRED";
}

function replacementReason(
    room: RoomState,
    trigger: HostSelectionTrigger,
    currentHost: RoomParticipant | undefined,
): RoomRoleChangeReason {
    if (room.firstHostAssignedAt === null) return "INITIAL_HOST_ASSIGNED";
    if (trigger.type === "HOST_LOST") return trigger.reason;
    if (currentHost) return inferredHostLossReason(currentHost);
    return "HOST_DISCONNECT_EXPIRED";
}

function hostDemotionReason(
    trigger: HostSelectionTrigger,
    currentHost: RoomParticipant | undefined,
    invariantRepair: boolean,
): RoomRoleChangeReason | null {
    if (currentHost) {
        if (trigger.type === "HOST_LOST") return trigger.reason;
        return inferredHostLossReason(currentHost);
    }
    return invariantRepair ? "HOST_REVOKED" : null;
}

/**
 * The single Room Host-selection decision. Adapters may persist this result, but must not
 * implement a second election rule for activation, transfer, expiry, leave, or recovery.
 */
export function decideRoomHost(input: {
    room: RoomState;
    participants: readonly RoomParticipant[];
    trigger: HostSelectionTrigger;
    now: number;
}): HostSelectionDecision {
    const { room, participants, trigger, now } = input;
    if (room.closedAt !== null) return noChange(emptyStatus(room));

    const currentHosts = orderedHosts(participants, now);
    const currentHost = currentHosts[0];
    const invariantRepair = currentHosts.length > 1;
    const repairDemotions = currentHosts.slice(1).map(({ id }) => id);

    if (trigger.type === "CLOSE") {
        if (!currentHosts.some(({ id }) => id === trigger.participantId)) {
            throw Object.assign(new Error("Only the current Host can close the Room"), {
                code: "NOT_AUTHORIZED",
            });
        }
        return {
            demoteParticipantIds: [],
            promoteParticipantId: null,
            reason: null,
            closeRoom: true,
            hostStatus: emptyStatus(room),
            invariantRepair,
        };
    }

    if (room.expiresAt <= now) {
        return {
            demoteParticipantIds: currentHosts.map(({ id }) => id),
            promoteParticipantId: null,
            reason: currentHost ? inferredHostLossReason(currentHost) : null,
            closeRoom: true,
            hostStatus: emptyStatus(room),
            invariantRepair,
        };
    }

    if (trigger.type === "TRANSFER") {
        const target = participants.find(({ id }) => id === trigger.targetParticipantId);
        if (
            !currentHost ||
            currentHost.id !== trigger.participantId ||
            !target ||
            !isConnectedPlayer(target)
        ) {
            throw Object.assign(new Error("Host transfer participants are invalid"), {
                code: "NOT_AUTHORIZED",
            });
        }
        return {
            demoteParticipantIds: currentHosts.map(({ id }) => id),
            promoteParticipantId: target.id,
            reason: "HOST_TRANSFERRED",
            closeRoom: false,
            hostStatus: participantStatus("CONNECTED", target, null),
            invariantRepair,
        };
    }

    if (currentHost) {
        if (currentHost.connectionStatus === "CONNECTED") {
            return noChange(
                participantStatus("CONNECTED", currentHost, null),
                repairDemotions,
                invariantRepair ? "HOST_REVOKED" : null,
                invariantRepair,
            );
        }
        if (currentHost.firstConnectedAt === null && currentHost.activationExpiresAt > now) {
            return noChange(
                participantStatus("CONNECTING", currentHost, currentHost.activationExpiresAt),
                repairDemotions,
                invariantRepair ? "HOST_REVOKED" : null,
                invariantRepair,
            );
        }
        if (isReconnectable(currentHost, now)) {
            return noChange(
                participantStatus("RECONNECTING", currentHost, currentHost.reconnectDeadline),
                repairDemotions,
                invariantRepair ? "HOST_REVOKED" : null,
                invariantRepair,
            );
        }
    }

    const candidates = orderedCandidates(participants);
    let selected: RoomParticipant | undefined;
    if (trigger.type === "ACTIVATE") {
        selected = candidates.find(({ id }) => id === trigger.participantId);
    }
    selected ??= candidates[0];
    if (selected) {
        const reason = replacementReason(room, trigger, currentHost);
        return {
            demoteParticipantIds: currentHosts.map(({ id }) => id),
            promoteParticipantId: selected.id,
            reason,
            closeRoom: false,
            hostStatus: participantStatus("CONNECTED", selected, null),
            invariantRepair,
        };
    }

    const demotionReason = hostDemotionReason(trigger, currentHost, invariantRepair);

    const reconnectablePlayer = participants.some(
        (participant) => participant.role === "PLAYER" && isReconnectable(participant, now),
    );
    if (reconnectablePlayer) {
        return noChange(
            emptyStatus(room),
            currentHosts.map(({ id }) => id),
            demotionReason,
            invariantRepair,
        );
    }
    const liveDisplay = participants.some(
        (participant) =>
            participant.role === "DISPLAY" &&
            isCurrent(participant) &&
            (participant.connectionStatus === "CONNECTED" || isReconnectable(participant, now)),
    );
    if (liveDisplay)
        return noChange(
            emptyStatus(room),
            currentHosts.map(({ id }) => id),
            demotionReason,
            invariantRepair,
        );
    if (room.activatedAt === null && room.activationDeadline > now) {
        return noChange(
            emptyStatus(room),
            currentHosts.map(({ id }) => id),
            demotionReason,
            invariantRepair,
        );
    }
    return {
        demoteParticipantIds: currentHosts.map(({ id }) => id),
        promoteParticipantId: null,
        reason: demotionReason,
        closeRoom: true,
        hostStatus: emptyStatus(room),
        invariantRepair,
    };
}

/** Host state as it was persisted immediately before a lifecycle decision is applied. */
export function derivePersistedRoomHostStatus(
    room: RoomState,
    participants: readonly RoomParticipant[],
    now = Date.now(),
): RoomHostStatus {
    const host = orderedHosts(participants, now)[0];
    if (!host) return emptyStatus(room);
    if (host.connectionStatus === "CONNECTED") {
        return participantStatus("CONNECTED", host, null);
    }
    if (host.firstConnectedAt === null) {
        return participantStatus("CONNECTING", host, host.activationExpiresAt);
    }
    return participantStatus("RECONNECTING", host, host.reconnectDeadline);
}

export function deriveRoomHostStatus(
    room: RoomState,
    participants: readonly RoomParticipant[],
    now = Date.now(),
): RoomHostStatus {
    return decideRoomHost({ room, participants, trigger: { type: "RECONCILE" }, now }).hostStatus;
}
