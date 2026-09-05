import type {
    RoomCreateIdempotencyOutcome,
    RoomLifecycleObservability,
    RoomLifecycleObservation,
} from "../../../../packages/application/roomLifecycleObservability";
import type { RoomHostState } from "../../../../packages/application/realtimeRooms";
import settings from "./settings";
import { logEvent } from "./structuredLogger";

type HostlessPhase = Extract<RoomHostState, "AWAITING_FIRST_HOST" | "AWAITING_REPLACEMENT_HOST">;
type DurationSummary = { count: number; sum: number; maximum: number };

const roomCreateTotal = new Map<string, number>();
const roomCreateIdempotencyTotal = new Map<string, number>();
const roomHostStateTransitionTotal = new Map<string, number>();
const roomInitialHostAssignmentTotal = new Map<string, number>();
const unactivatedParticipantExpiryTotal = new Map<string, number>();
const roomReconciliationTotal = new Map<string, number>();
const hostlessDurations = new Map<HostlessPhase, DurationSummary>();
const hostlessStarted = new Map<string, { phase: HostlessPhase; at: number }>();

function increment(target: Map<string, number>, labels: string): void {
    target.set(labels, (target.get(labels) ?? 0) + 1);
}

function isHostless(state: RoomHostState): state is HostlessPhase {
    return state === "AWAITING_FIRST_HOST" || state === "AWAITING_REPLACEMENT_HOST";
}

function observeHostlessDuration(roomId: string, phase: HostlessPhase, seconds: number): void {
    const current = hostlessDurations.get(phase) ?? { count: 0, sum: 0, maximum: 0 };
    current.count += 1;
    current.sum += Math.max(0, seconds);
    current.maximum = Math.max(current.maximum, seconds);
    hostlessDurations.set(phase, current);
    hostlessStarted.delete(roomId);
}

function reconcileHostless(event: RoomLifecycleObservation): void {
    const before = event.result.hostStatusBefore?.state;
    const after = event.result.hostStatusAfter?.state;
    const active = hostlessStarted.get(event.roomId);
    if (before && isHostless(before) && !active) {
        hostlessStarted.set(event.roomId, { phase: before, at: event.at });
    }
    const started = hostlessStarted.get(event.roomId);
    if (!started) {
        if (!event.result.roomClosed && after && isHostless(after)) {
            hostlessStarted.set(event.roomId, { phase: after, at: event.at });
        }
        return;
    }
    if (event.result.roomClosed || !after || !isHostless(after)) {
        observeHostlessDuration(event.roomId, started.phase, (event.at - started.at) / 1_000);
        return;
    }
    if (after !== started.phase) {
        observeHostlessDuration(event.roomId, started.phase, (event.at - started.at) / 1_000);
        hostlessStarted.set(event.roomId, { phase: after, at: event.at });
    }
}

function transitionReason(event: RoomLifecycleObservation): string {
    return event.result.roleChanges[0]?.reason ?? event.result.closeReason ?? event.trigger;
}

function reconciliationLabels(event: RoomLifecycleObservation): { reason: string; result: string } {
    if (event.result.closeReason) {
        return { reason: event.result.closeReason, result: "ROOM_CLOSED" };
    }
    const unactivatedExpired = event.result.expiredParticipants.some(
        ({ firstConnectedAt }) => firstConnectedAt === null,
    );
    if (unactivatedExpired) {
        return { reason: "UNACTIVATED_PARTICIPANT_EXPIRY", result: "PARTICIPANT_EXPIRED" };
    }
    if (event.result.expiredParticipants.length) {
        return { reason: "RECONNECT_EXPIRY", result: "PARTICIPANT_EXPIRED" };
    }
    if (event.result.roleChanges.length) {
        return { reason: transitionReason(event), result: "HOST_CHANGED" };
    }
    return { reason: "DUE_SCAN", result: "NO_CHANGE" };
}

function eventFields(roomId: string | null): { roomId?: string } {
    return roomId ? { roomId } : {};
}

function recordIdempotency(outcome: RoomCreateIdempotencyOutcome, roomId: string | null): void {
    increment(roomCreateIdempotencyTotal, `outcome=${outcome}`);
    const eventByOutcome: Record<RoomCreateIdempotencyOutcome, string> = {
        CREATED: "room.idempotent_create_committed",
        REPLAYED: "room.idempotent_create_replayed",
        CONFLICT: "room.idempotent_create_conflict",
        GONE: "room.idempotent_create_gone",
        IN_PROGRESS: "room.idempotent_create_in_progress",
        INVALID: "room.idempotency_key_invalid",
        REQUIRED: "room.idempotency_key_required",
        PROTECTION_UNAVAILABLE: "room.create_replay_protection_unavailable",
    };
    logEvent(
        outcome === "CREATED" || outcome === "REPLAYED" ? "info" : "warn",
        eventByOutcome[outcome],
        { ...eventFields(roomId), outcome },
        settings.value.logLevel,
    );
}

function recordRoleChanges(event: RoomLifecycleObservation): void {
    for (const change of event.result.roleChanges) {
        if (change.reason === "INITIAL_HOST_ASSIGNED" && change.role === "HOST") {
            increment(roomInitialHostAssignmentTotal, "result=ASSIGNED");
        }
        logEvent(
            "info",
            change.reason === "INITIAL_HOST_ASSIGNED"
                ? "room.initial_host_assigned"
                : "room.host_role_changed",
            {
                roomId: event.roomId,
                participantId: change.participantId,
                previousRole: change.previousRole,
                role: change.role,
                reason: change.reason,
            },
            settings.value.logLevel,
        );
    }
}

function recordLifecycle(event: RoomLifecycleObservation): void {
    recordHostTransition(event);
    reconcileHostless(event);
    recordRoleChanges(event);

    if (event.result.participantFirstActivated && event.result.participant) {
        logEvent(
            "info",
            "room.participant_first_activated",
            {
                roomId: event.roomId,
                participantId: event.result.participant.id,
                role: event.result.participant.role,
            },
            settings.value.logLevel,
        );
    }
    for (const participant of event.result.expiredParticipants) {
        if (participant.firstConnectedAt !== null) continue;
        increment(unactivatedParticipantExpiryTotal, `role=${participant.role}`);
        if (participant.role === "HOST") {
            logEvent(
                "info",
                "room.host_activation_expired",
                { roomId: event.roomId, participantId: participant.id },
                settings.value.logLevel,
            );
        }
    }
    if (event.trigger === "RECONCILE") {
        const labels = reconciliationLabels(event);
        increment(roomReconciliationTotal, `reason=${labels.reason},result=${labels.result}`);
    }
    if (event.result.replayResultsErased) {
        logEvent(
            "info",
            "room.create_replay_ciphertext_erased",
            { roomId: event.roomId, resultCount: event.result.replayResultsErased },
            settings.value.logLevel,
        );
    }
    if (event.result.invariantRepair) {
        logEvent(
            "error",
            "room.host_invariant_repair_succeeded",
            { roomId: event.roomId },
            settings.value.logLevel,
        );
    }
    if (event.result.closeReason) {
        const closeEvent =
            event.result.closeReason === "INITIAL_ACTIVATION_EXPIRED"
                ? "room.initial_activation_expired"
                : "room.abandoned_or_closed";
        logEvent(
            "info",
            closeEvent,
            { roomId: event.roomId, reason: event.result.closeReason },
            settings.value.logLevel,
        );
    }
}

export const roomLifecycleObservability: RoomLifecycleObservability = {
    roomCreate(event) {
        increment(roomCreateTotal, `bootstrap_mode=${event.bootstrapMode},result=${event.result}`);
        if (event.result === "CREATED" && isHostless(event.hostStatus.state)) {
            hostlessStarted.set(event.roomId, { phase: event.hostStatus.state, at: event.at });
        }
        if (event.result === "CREATED") {
            logEvent(
                "info",
                event.bootstrapMode === "DISPLAY_WAITING_FOR_HOST"
                    ? "room.display_bootstrap_created"
                    : "room.creator_host_created",
                {
                    roomId: event.roomId,
                    bootstrapMode: event.bootstrapMode,
                    creatorRole: event.creatorRole,
                },
                settings.value.logLevel,
            );
        }
    },
    roomCreateIdempotency: recordIdempotency,
    lifecycleTransition: recordLifecycle,
};

function recordHostTransition(event: RoomLifecycleObservation) {
    const before = event.result.hostStatusBefore?.state;
    const after = event.result.hostStatusAfter?.state;
    if (before && after && before !== after) {
        increment(
            roomHostStateTransitionTotal,
            `from=${before},to=${after},reason=${transitionReason(event)}`,
        );
        if (before === "CONNECTED" && after === "RECONNECTING") {
            logEvent(
                "info",
                "room.host_reconnect_grace_entered",
                { roomId: event.roomId, participantId: event.participantId },
                settings.value.logLevel,
            );
        } else if (before === "RECONNECTING" && after === "CONNECTED") {
            logEvent(
                "info",
                "room.host_reconnect_grace_exited",
                { roomId: event.roomId, participantId: event.participantId },
                settings.value.logLevel,
            );
        }
    }
}

export function recordRoomCreateBoundaryIdempotency(
    outcome: Extract<RoomCreateIdempotencyOutcome, "INVALID" | "REQUIRED">,
): void {
    recordIdempotency(outcome, null);
}

/** Low-cardinality process metrics for the deployment's monitoring adapter. */
export function roomLifecycleMetrics(): {
    roomCreateTotal: Readonly<Record<string, number>>;
    roomCreateIdempotencyTotal: Readonly<Record<string, number>>;
    roomHostStateTransitionTotal: Readonly<Record<string, number>>;
    roomInitialHostAssignmentTotal: Readonly<Record<string, number>>;
    roomHostlessDurationSeconds: Readonly<Record<HostlessPhase, DurationSummary>>;
    unactivatedParticipantExpiryTotal: Readonly<Record<string, number>>;
    roomReconciliationTotal: Readonly<Record<string, number>>;
} {
    return {
        roomCreateTotal: Object.fromEntries(roomCreateTotal),
        roomCreateIdempotencyTotal: Object.fromEntries(roomCreateIdempotencyTotal),
        roomHostStateTransitionTotal: Object.fromEntries(roomHostStateTransitionTotal),
        roomInitialHostAssignmentTotal: Object.fromEntries(roomInitialHostAssignmentTotal),
        roomHostlessDurationSeconds: {
            AWAITING_FIRST_HOST: { ...(hostlessDurations.get("AWAITING_FIRST_HOST") ?? zero()) },
            AWAITING_REPLACEMENT_HOST: {
                ...(hostlessDurations.get("AWAITING_REPLACEMENT_HOST") ?? zero()),
            },
        },
        unactivatedParticipantExpiryTotal: Object.fromEntries(unactivatedParticipantExpiryTotal),
        roomReconciliationTotal: Object.fromEntries(roomReconciliationTotal),
    };
}

function zero(): DurationSummary {
    return { count: 0, sum: 0, maximum: 0 };
}

export function resetRoomLifecycleMetricsForTests(): void {
    for (const metric of [
        roomCreateTotal,
        roomCreateIdempotencyTotal,
        roomHostStateTransitionTotal,
        roomInitialHostAssignmentTotal,
        unactivatedParticipantExpiryTotal,
        roomReconciliationTotal,
    ]) {
        metric.clear();
    }
    hostlessDurations.clear();
    hostlessStarted.clear();
}
