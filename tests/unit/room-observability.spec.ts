import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomLifecycleTransitionResult } from "../../packages/application/realtimeRooms";
import {
    recordRoomCreateBoundaryIdempotency,
    resetRoomLifecycleMetricsForTests,
    roomLifecycleMetrics,
    roomLifecycleObservability,
} from "../../apps/server/src/modules/roomObservability";

function transitionResult(
    overrides: Partial<RoomLifecycleTransitionResult> = {},
): RoomLifecycleTransitionResult {
    return {
        participant: null,
        expiredParticipants: [],
        roleChanges: [],
        roomClosed: false,
        hostStatusBefore: {
            state: "AWAITING_FIRST_HOST",
            participantId: null,
            displayName: null,
            deadline: null,
        },
        hostStatusAfter: {
            state: "AWAITING_FIRST_HOST",
            participantId: null,
            displayName: null,
            deadline: null,
        },
        participantFirstActivated: false,
        replayResultsErased: 0,
        closeReason: null,
        invariantRepair: false,
        ...overrides,
    };
}

describe("Room lifecycle observability", () => {
    beforeEach(() => {
        resetRoomLifecycleMetricsForTests();
        vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    });

    afterEach(() => vi.restoreAllMocks());

    it("records fixed-label create, assignment, transition, and hostless metrics", () => {
        roomLifecycleObservability.roomCreate({
            roomId: "private-room-id",
            bootstrapMode: "DISPLAY_WAITING_FOR_HOST",
            creatorRole: "DISPLAY",
            hostStatus: {
                state: "AWAITING_FIRST_HOST",
                participantId: null,
                displayName: null,
                deadline: null,
            },
            at: 1_000,
            result: "CREATED",
        });
        roomLifecycleObservability.roomCreateIdempotency("CREATED", "private-room-id");
        roomLifecycleObservability.lifecycleTransition({
            roomId: "private-room-id",
            participantId: "private-participant-id",
            trigger: "ACTIVATE",
            at: 4_000,
            result: transitionResult({
                participant: {
                    id: "private-participant-id",
                    roomId: "private-room-id",
                    role: "HOST",
                    displayName: "Private name",
                    devicePlayers: [],
                    connectionStatus: "CONNECTED",
                    joinedAt: 2_000,
                    firstConnectedAt: 4_000,
                    lastConnectedAt: 4_000,
                    reconnectDeadline: null,
                    activationExpiresAt: 8_000,
                    leftAt: null,
                    revokedAt: null,
                },
                participantFirstActivated: true,
                roleChanges: [
                    {
                        participantId: "private-participant-id",
                        previousRole: "PLAYER",
                        role: "HOST",
                        reason: "INITIAL_HOST_ASSIGNED",
                    },
                ],
                hostStatusAfter: {
                    state: "CONNECTED",
                    participantId: "private-participant-id",
                    displayName: "Private name",
                    deadline: null,
                },
            }),
        });

        const metrics = roomLifecycleMetrics();
        expect(
            metrics.roomCreateTotal["bootstrap_mode=DISPLAY_WAITING_FOR_HOST,result=CREATED"],
        ).toBe(1);
        expect(metrics.roomCreateIdempotencyTotal["outcome=CREATED"]).toBe(1);
        expect(metrics.roomInitialHostAssignmentTotal["result=ASSIGNED"]).toBe(1);
        expect(
            metrics.roomHostStateTransitionTotal[
                "from=AWAITING_FIRST_HOST,to=CONNECTED,reason=INITIAL_HOST_ASSIGNED"
            ],
        ).toBe(1);
        expect(metrics.roomHostlessDurationSeconds.AWAITING_FIRST_HOST).toEqual({
            count: 1,
            sum: 3,
            maximum: 3,
        });
        expect(JSON.stringify(metrics)).not.toMatch(
            /private-room-id|private-participant-id|Private name/u,
        );
    });

    it("records bounded reconciliation, expiry, and boundary idempotency outcomes", () => {
        recordRoomCreateBoundaryIdempotency("INVALID");
        roomLifecycleObservability.lifecycleTransition({
            roomId: "room",
            participantId: null,
            trigger: "RECONCILE",
            at: 10_000,
            result: transitionResult({
                expiredParticipants: [
                    {
                        id: "player",
                        roomId: "room",
                        role: "PLAYER",
                        displayName: "Player",
                        devicePlayers: [],
                        connectionStatus: "LEFT",
                        joinedAt: 1_000,
                        firstConnectedAt: null,
                        lastConnectedAt: null,
                        reconnectDeadline: null,
                        activationExpiresAt: 9_000,
                        leftAt: 10_000,
                        revokedAt: null,
                    },
                ],
            }),
        });

        const metrics = roomLifecycleMetrics();
        expect(metrics.roomCreateIdempotencyTotal["outcome=INVALID"]).toBe(1);
        expect(metrics.unactivatedParticipantExpiryTotal["role=PLAYER"]).toBe(1);
        expect(
            metrics.roomReconciliationTotal[
                "reason=UNACTIVATED_PARTICIPANT_EXPIRY,result=PARTICIPANT_EXPIRED"
            ],
        ).toBe(1);
    });

    it("measures replacement-host waiting from entry until reassignment", () => {
        roomLifecycleObservability.lifecycleTransition({
            roomId: "room",
            participantId: "old-host",
            trigger: "EXPIRE",
            at: 5_000,
            result: transitionResult({
                hostStatusBefore: {
                    state: "RECONNECTING",
                    participantId: "old-host",
                    displayName: "Old host",
                    deadline: 5_000,
                },
                hostStatusAfter: {
                    state: "AWAITING_REPLACEMENT_HOST",
                    participantId: null,
                    displayName: null,
                    deadline: null,
                },
            }),
        });
        roomLifecycleObservability.lifecycleTransition({
            roomId: "room",
            participantId: "new-host",
            trigger: "ACTIVATE",
            at: 8_000,
            result: transitionResult({
                hostStatusBefore: {
                    state: "AWAITING_REPLACEMENT_HOST",
                    participantId: null,
                    displayName: null,
                    deadline: null,
                },
                hostStatusAfter: {
                    state: "CONNECTED",
                    participantId: "new-host",
                    displayName: "New host",
                    deadline: null,
                },
            }),
        });
        expect(
            roomLifecycleMetrics().roomHostlessDurationSeconds.AWAITING_REPLACEMENT_HOST,
        ).toEqual({ count: 1, sum: 3, maximum: 3 });
    });
});
