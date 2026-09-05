import { describe, expect, it } from "vitest";
import {
    decideRoomHost,
    derivePersistedRoomHostStatus,
    deriveRoomHostStatus,
} from "../../packages/application/roomHostSelection";
import type { RoomParticipant, RoomState } from "../../packages/application/realtimeRooms";

const NOW = 10_000;

function room(overrides: Partial<RoomState> = {}): RoomState {
    return {
        id: "room",
        code: "ABC234",
        bootstrapMode: "DISPLAY_WAITING_FOR_HOST",
        firstHostAssignedAt: null,
        activationDeadline: NOW + 5_000,
        activatedAt: NOW,
        createdAt: NOW - 1_000,
        expiresAt: NOW + 50_000,
        closedAt: null,
        creatorParticipantId: "display",
        ...overrides,
    };
}

function participant(
    id: string,
    role: RoomParticipant["role"],
    overrides: Partial<RoomParticipant> = {},
): RoomParticipant {
    return {
        id,
        roomId: "room",
        role,
        displayName: id,
        devicePlayers: [],
        connectionStatus: "CONNECTED",
        joinedAt: NOW,
        firstConnectedAt: NOW,
        lastConnectedAt: NOW,
        reconnectDeadline: null,
        activationExpiresAt: NOW + 5_000,
        leftAt: null,
        revokedAt: null,
        ...overrides,
    };
}

describe("authoritative Room Host selection", () => {
    it("never assigns Host authority to a display", () => {
        const display = participant("display", "DISPLAY");
        const decision = decideRoomHost({
            room: room(),
            participants: [display],
            trigger: { type: "ACTIVATE", participantId: display.id },
            now: NOW,
        });

        expect(decision.promoteParticipantId).toBeNull();
        expect(decision.hostStatus.state).toBe("AWAITING_FIRST_HOST");
    });

    it("promotes the first authenticated Player and reports the initial-assignment reason", () => {
        const player = participant("player", "PLAYER");
        const decision = decideRoomHost({
            room: room(),
            participants: [participant("display", "DISPLAY"), player],
            trigger: { type: "ACTIVATE", participantId: player.id },
            now: NOW,
        });

        expect(decision).toMatchObject({
            promoteParticipantId: "player",
            reason: "INITIAL_HOST_ASSIGNED",
            hostStatus: { state: "CONNECTED", participantId: "player" },
        });
    });

    it("reserves a disconnected Host throughout reconnect grace", () => {
        const host = participant("host", "HOST", {
            connectionStatus: "TEMPORARILY_DISCONNECTED",
            reconnectDeadline: NOW + 1_000,
        });
        const decision = decideRoomHost({
            room: room({ firstHostAssignedAt: NOW - 500 }),
            participants: [host, participant("candidate", "PLAYER")],
            trigger: { type: "RECONCILE" },
            now: NOW,
        });

        expect(decision.promoteParticipantId).toBeNull();
        expect(decision.hostStatus).toMatchObject({
            state: "RECONNECTING",
            participantId: "host",
            deadline: NOW + 1_000,
        });
    });

    it("replaces an expired Host with a connected Player but never a display", () => {
        const expiredHost = participant("old-host", "HOST", {
            connectionStatus: "TEMPORARILY_DISCONNECTED",
            reconnectDeadline: NOW,
        });
        const replacement = participant("replacement", "PLAYER", { joinedAt: NOW + 1 });
        const decision = decideRoomHost({
            room: room({ firstHostAssignedAt: NOW - 500 }),
            participants: [expiredHost, participant("display", "DISPLAY"), replacement],
            trigger: { type: "HOST_LOST", reason: "HOST_DISCONNECT_EXPIRED" },
            now: NOW,
        });

        expect(decision).toMatchObject({
            demoteParticipantIds: ["old-host"],
            promoteParticipantId: "replacement",
            reason: "HOST_DISCONNECT_EXPIRED",
        });
    });

    it("derives connecting status for an ordinary creator before first activation", () => {
        const creator = participant("creator", "HOST", {
            connectionStatus: "TEMPORARILY_DISCONNECTED",
            firstConnectedAt: null,
            lastConnectedAt: null,
            activationExpiresAt: NOW + 3_000,
        });
        expect(
            deriveRoomHostStatus(
                room({ bootstrapMode: "CREATOR_HOST", firstHostAssignedAt: NOW - 100 }),
                [creator],
                NOW,
            ),
        ).toEqual({
            state: "CONNECTING",
            participantId: "creator",
            displayName: "creator",
            deadline: NOW + 3_000,
        });
    });
});

describe("authoritative Room Host decision matrix", () => {
    it("derives connected status after the ordinary creator authenticates", () => {
        const creator = participant("creator", "HOST");
        expect(
            deriveRoomHostStatus(
                room({ bootstrapMode: "CREATOR_HOST", firstHostAssignedAt: NOW - 100 }),
                [creator],
                NOW,
            ),
        ).toMatchObject({ state: "CONNECTED", participantId: "creator", deadline: null });
    });

    it("keeps an HTTP-only Player ineligible", () => {
        const player = participant("player", "PLAYER", {
            connectionStatus: "TEMPORARILY_DISCONNECTED",
            firstConnectedAt: null,
            lastConnectedAt: null,
            reconnectDeadline: null,
        });
        const decision = decideRoomHost({
            room: room({ activatedAt: null }),
            participants: [player],
            trigger: { type: "RECONCILE" },
            now: NOW,
        });
        expect(decision).toMatchObject({
            promoteParticipantId: null,
            closeRoom: false,
            hostStatus: { state: "AWAITING_FIRST_HOST" },
        });
    });

    it("leaves the second authenticated Player unchanged while a Host is connected", () => {
        const host = participant("host", "HOST", { joinedAt: NOW - 10 });
        const second = participant("second", "PLAYER");
        const decision = decideRoomHost({
            room: room({ firstHostAssignedAt: NOW - 100 }),
            participants: [host, second],
            trigger: { type: "ACTIVATE", participantId: second.id },
            now: NOW,
        });
        expect(decision).toMatchObject({
            promoteParticipantId: null,
            hostStatus: { state: "CONNECTED", participantId: "host" },
        });
    });

    it("keeps the same Host authoritative when it reconnects inside grace", () => {
        const host = participant("host", "HOST");
        const decision = decideRoomHost({
            room: room({ firstHostAssignedAt: NOW - 100 }),
            participants: [host, participant("player", "PLAYER")],
            trigger: { type: "ACTIVATE", participantId: host.id },
            now: NOW,
        });
        expect(decision).toMatchObject({
            demoteParticipantIds: [],
            promoteParticipantId: null,
            hostStatus: { state: "CONNECTED", participantId: "host" },
        });
    });

    it("chooses the oldest connected fallback with participant ID as a tie-breaker", () => {
        const host = participant("old-host", "HOST", {
            connectionStatus: "TEMPORARILY_DISCONNECTED",
            reconnectDeadline: NOW,
        });
        const later = participant("z-player", "PLAYER", { joinedAt: NOW + 1 });
        const tiedSecond = participant("b-player", "PLAYER", { joinedAt: NOW - 1 });
        const tiedFirst = participant("a-player", "PLAYER", { joinedAt: NOW - 1 });
        const decision = decideRoomHost({
            room: room({ firstHostAssignedAt: NOW - 100 }),
            participants: [host, later, tiedSecond, tiedFirst],
            trigger: { type: "HOST_LOST", reason: "HOST_DISCONNECT_EXPIRED" },
            now: NOW,
        });
        expect(decision.promoteParticipantId).toBe("a-player");
    });

    it("keeps a hostless Room waiting for a reconnectable activated Player", () => {
        const reconnectable = participant("player", "PLAYER", {
            connectionStatus: "TEMPORARILY_DISCONNECTED",
            reconnectDeadline: NOW + 1_000,
        });
        const decision = decideRoomHost({
            room: room({ firstHostAssignedAt: NOW - 100 }),
            participants: [reconnectable],
            trigger: { type: "RECONCILE" },
            now: NOW,
        });
        expect(decision).toMatchObject({
            closeRoom: false,
            hostStatus: { state: "AWAITING_REPLACEMENT_HOST" },
        });
    });

    it("keeps a hostless activated Room live for a connected Display", () => {
        const decision = decideRoomHost({
            room: room({ firstHostAssignedAt: NOW - 100 }),
            participants: [participant("display", "DISPLAY")],
            trigger: { type: "RECONCILE" },
            now: NOW,
        });
        expect(decision).toMatchObject({
            closeRoom: false,
            hostStatus: { state: "AWAITING_REPLACEMENT_HOST" },
        });
    });

    it("does not let only unactivated joins keep an activated Room alive", () => {
        const decision = decideRoomHost({
            room: room(),
            participants: [
                participant("waiting", "PLAYER", {
                    connectionStatus: "TEMPORARILY_DISCONNECTED",
                    firstConnectedAt: null,
                    lastConnectedAt: null,
                }),
            ],
            trigger: { type: "RECONCILE" },
            now: NOW,
        });
        expect(decision.closeRoom).toBe(true);
    });

    it("retains a never-activated Room until its initial lease expires", () => {
        const pending = room({ activatedAt: null, activationDeadline: NOW + 1 });
        expect(
            decideRoomHost({
                room: pending,
                participants: [],
                trigger: { type: "RECONCILE" },
                now: NOW,
            }).closeRoom,
        ).toBe(false);
        expect(
            decideRoomHost({
                room: { ...pending, activationDeadline: NOW },
                participants: [],
                trigger: { type: "RECONCILE" },
                now: NOW,
            }).closeRoom,
        ).toBe(true);
    });

    it("uses Host activation expiry for ordinary creator fallback", () => {
        const creator = participant("creator", "HOST", {
            connectionStatus: "TEMPORARILY_DISCONNECTED",
            firstConnectedAt: null,
            lastConnectedAt: null,
            activationExpiresAt: NOW,
        });
        const decision = decideRoomHost({
            room: room({ bootstrapMode: "CREATOR_HOST", firstHostAssignedAt: NOW - 100 }),
            participants: [creator, participant("player", "PLAYER")],
            trigger: { type: "HOST_LOST", reason: "HOST_ACTIVATION_EXPIRED" },
            now: NOW,
        });
        expect(decision).toMatchObject({
            demoteParticipantIds: ["creator"],
            promoteParticipantId: "player",
            reason: "HOST_ACTIVATION_EXPIRED",
        });
    });

    it("closes after ordinary Host activation expiry when nothing remains live", () => {
        const creator = participant("creator", "HOST", {
            connectionStatus: "TEMPORARILY_DISCONNECTED",
            firstConnectedAt: null,
            lastConnectedAt: null,
            activationExpiresAt: NOW,
        });
        const decision = decideRoomHost({
            room: room({
                bootstrapMode: "CREATOR_HOST",
                firstHostAssignedAt: NOW - 100,
                activatedAt: null,
                activationDeadline: NOW,
            }),
            participants: [creator],
            trigger: { type: "HOST_LOST", reason: "HOST_ACTIVATION_EXPIRED" },
            now: NOW,
        });
        expect(decision).toMatchObject({
            demoteParticipantIds: ["creator"],
            promoteParticipantId: null,
            closeRoom: true,
        });
    });

    it("distinguishes first-Host and replacement waiting from provenance", () => {
        expect(deriveRoomHostStatus(room(), [], NOW).state).toBe("AWAITING_FIRST_HOST");
        expect(deriveRoomHostStatus(room({ firstHostAssignedAt: NOW - 100 }), [], NOW).state).toBe(
            "AWAITING_REPLACEMENT_HOST",
        );
    });

    it("transfers authority to one connected Player and demotes the old Host", () => {
        const decision = decideRoomHost({
            room: room({ firstHostAssignedAt: NOW - 100 }),
            participants: [participant("host", "HOST"), participant("target", "PLAYER")],
            trigger: { type: "TRANSFER", participantId: "host", targetParticipantId: "target" },
            now: NOW,
        });
        expect(decision).toMatchObject({
            demoteParticipantIds: ["host"],
            promoteParticipantId: "target",
            reason: "HOST_TRANSFERRED",
            closeRoom: false,
        });
    });

    it("produces the same deterministic decision during restart reconciliation", () => {
        const input = {
            room: room({ firstHostAssignedAt: NOW - 100 }),
            participants: [
                participant("old-host", "HOST", {
                    connectionStatus: "TEMPORARILY_DISCONNECTED" as const,
                    reconnectDeadline: NOW,
                }),
                participant("player", "PLAYER"),
            ],
            trigger: { type: "RECONCILE" as const },
            now: NOW,
        };
        expect(decideRoomHost(input)).toEqual(decideRoomHost(input));
        expect(decideRoomHost(input).promoteParticipantId).toBe("player");
    });

    it("never promotes in a closed Room", () => {
        const decision = decideRoomHost({
            room: room({ closedAt: NOW - 1 }),
            participants: [participant("player", "PLAYER")],
            trigger: { type: "ACTIVATE", participantId: "player" },
            now: NOW,
        });
        expect(decision).toMatchObject({ promoteParticipantId: null, closeRoom: false });
    });

    it("repairs multiple current Hosts deterministically", () => {
        const first = participant("first", "HOST", { joinedAt: NOW - 2 });
        const second = participant("second", "HOST", { joinedAt: NOW - 1 });
        const decision = decideRoomHost({
            room: room({ firstHostAssignedAt: NOW - 100 }),
            participants: [second, first],
            trigger: { type: "RECONCILE" },
            now: NOW,
        });
        expect(decision).toMatchObject({
            demoteParticipantIds: ["second"],
            promoteParticipantId: null,
            reason: "HOST_REVOKED",
            invariantRepair: true,
            hostStatus: { state: "CONNECTED", participantId: "first" },
        });
    });

    it("routes an explicit close through the same authoritative decision", () => {
        const decision = decideRoomHost({
            room: room({ firstHostAssignedAt: NOW - 100 }),
            participants: [participant("host", "HOST"), participant("display", "DISPLAY")],
            trigger: { type: "CLOSE", participantId: "host" },
            now: NOW,
        });
        expect(decision).toMatchObject({ closeRoom: true, promoteParticipantId: null });
    });

    it("never projects an uncommitted deadline-edge replacement", () => {
        const expiredHost = participant("old-host", "HOST", {
            connectionStatus: "TEMPORARILY_DISCONNECTED",
            reconnectDeadline: NOW,
        });
        const candidate = participant("candidate", "PLAYER");
        expect(
            derivePersistedRoomHostStatus(
                room({ firstHostAssignedAt: NOW - 100 }),
                [expiredHost, candidate],
                NOW,
            ),
        ).toMatchObject({ state: "RECONNECTING", participantId: "old-host" });
        expect(
            deriveRoomHostStatus(
                room({ firstHostAssignedAt: NOW - 100 }),
                [expiredHost, candidate],
                NOW,
            ),
        ).toMatchObject({ state: "CONNECTED", participantId: "candidate" });
    });
});
