import { afterEach, describe, expect, it, vi } from "vitest";

class FakeWebSocket {
    static readonly OPEN = 1;
    static instances: FakeWebSocket[] = [];
    readyState = FakeWebSocket.OPEN;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;
    sent: string[] = [];

    constructor(readonly url: string) {
        FakeWebSocket.instances.push(this);
    }

    send(value: string): void {
        this.sent.push(value);
    }

    close(): void {
        this.readyState = 3;
    }

    receive(type: string, payload: unknown): void {
        this.onmessage?.({ data: JSON.stringify({ type, payload }) });
    }
}

function installBrowserGlobals(): void {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("location", { protocol: "http:", host: "example.test" });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
    vi.stubGlobal("navigator", { languages: ["de-DE"], onLine: true });
    vi.stubGlobal("window", {
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    });
}

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
    FakeWebSocket.instances = [];
});

describe("authoritative multiplayer client events", () => {
    it("maps lifecycle notices and animates the snapshot following a Card replacement", async () => {
        installBrowserGlobals();
        const { RoomSocket } = await import("../../apps/web/src/multiplayer");
        let changes = 0;
        const connection = new RoomSocket(
            {
                roomId: "00000000-0000-4000-8000-000000000010",
                roomCode: "ABC234",
                participantId: "00000000-0000-4000-8000-000000000011",
                participantCredential: "credential".repeat(5),
                role: "PLAYER",
            },
            () => changes++,
        );
        const socket = FakeWebSocket.instances[0];
        const snapshot = (cardId: string) => ({
            roomId: "00000000-0000-4000-8000-000000000010",
            participants: [],
            boundaryConfigured: true,
            settings: {
                mode: "NEVER_HAVE_I_EVER",
                profileId: "PROFILE_FRIENDS",
                groupId: null,
                adultContentConfirmed: false,
                cardLocale: "de-DE",
                neverHaveIEverRevealMode: "NAMED_ANSWERS",
                configuration: {
                    enabledQuestionCategoryIds: [],
                    enabledDareTypeIds: [],
                    blockedOperationalFlags: [],
                    startingIntensity: 1,
                    maximumIntensity: 3,
                    intensityProgressionUnit: "ROUNDS",
                    intensityProgressionInterval: 2,
                    randomQuestionRatio: 0.5,
                    maximumTypeStreak: 3,
                    letsTalkMetaInterval: 3,
                },
                revision: 0,
                updatedByParticipantId: null,
            },
            session: {
                currentCard: { id: cardId },
            },
        });

        socket.receive("room.snapshot", snapshot("card-a"));
        socket.receive("room.participantLeft", {
            participantId: "00000000-0000-4000-8000-000000000012",
            displayName: "Ben",
            reason: "DISCONNECT_EXPIRED",
        });
        expect(connection.roomNotice).toContain("Ben");
        expect(connection.roomNotice).toContain("Verbindungsabbruch");

        socket.receive("session.cardReplaced", { reason: "VETOED" });
        expect(connection.roomNotice).toContain("neue Karte");
        expect(connection.cardReplacementSequence).toBe(0);
        socket.receive("room.snapshot", snapshot("card-b"));
        expect(connection.cardReplacementSequence).toBe(1);
        expect(connection.cardReplacementReason).toBe("VETOED");
        expect(changes).toBeGreaterThanOrEqual(4);
        connection.dispose();
    });

    it("enters reconnecting state and opens a new socket when a heartbeat goes unanswered", async () => {
        vi.useFakeTimers();
        installBrowserGlobals();
        const { RoomSocket } = await import("../../apps/web/src/multiplayer");
        let changes = 0;
        const connection = new RoomSocket(
            {
                roomId: "00000000-0000-4000-8000-000000000010",
                roomCode: "ABC234",
                participantId: "00000000-0000-4000-8000-000000000011",
                participantCredential: "credential".repeat(5),
                role: "PLAYER",
            },
            () => changes++,
        );
        const socket = FakeWebSocket.instances[0];
        socket.onopen?.();
        socket.receive("server.hello", {
            participantId: "00000000-0000-4000-8000-000000000011",
            role: "PLAYER",
        });
        expect(connection.authenticated).toBe(true);

        vi.advanceTimersByTime(15_001);
        expect(connection.authenticated).toBe(false);
        expect(connection.error).toContain("wiederhergestellt");
        expect(changes).toBeGreaterThan(1);
        vi.advanceTimersByTime(1_000);
        expect(FakeWebSocket.instances).toHaveLength(2);
        connection.dispose();
    });

    it("enters reconnecting immediately when the transport reports a connection error", async () => {
        vi.useFakeTimers();
        installBrowserGlobals();
        const { RoomSocket } = await import("../../apps/web/src/multiplayer");
        const connection = new RoomSocket(
            {
                roomId: "00000000-0000-4000-8000-000000000010",
                roomCode: "ABC234",
                participantId: "00000000-0000-4000-8000-000000000011",
                participantCredential: "credential".repeat(5),
                role: "PLAYER",
            },
            () => undefined,
        );
        const socket = FakeWebSocket.instances[0];
        socket.onopen?.();
        socket.receive("server.hello", {
            participantId: "00000000-0000-4000-8000-000000000011",
            role: "PLAYER",
        });

        socket.onerror?.();

        expect(connection.authenticated).toBe(false);
        expect(connection.error).toContain("wiederhergestellt");
        vi.advanceTimersByTime(1_000);
        expect(FakeWebSocket.instances).toHaveLength(2);
        connection.dispose();
    });

    it("reports an expired reconnect identity instead of silently returning home", async () => {
        installBrowserGlobals();
        const { RoomSocket } = await import("../../apps/web/src/multiplayer");
        let reason = "";
        const connection = new RoomSocket(
            {
                roomId: "00000000-0000-4000-8000-000000000010",
                roomCode: "ABC234",
                participantId: "00000000-0000-4000-8000-000000000011",
                participantCredential: "credential".repeat(5),
                role: "PLAYER",
            },
            () => undefined,
            (value) => (reason = value),
        );
        const socket = FakeWebSocket.instances[0];
        socket.receive("error", { code: "ROOM_NOT_FOUND", message: "expired" });
        socket.onclose?.({ code: 1000 });
        expect(reason).toBe("RECONNECT_EXPIRED");
        connection.dispose();
    });
});
