import { afterEach, describe, expect, it, vi } from "vitest";

class FakeWebSocket {
    static readonly OPEN = 1;
    static instances: FakeWebSocket[] = [];
    readyState = FakeWebSocket.OPEN;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
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

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    FakeWebSocket.instances = [];
});

describe("authoritative multiplayer client events", () => {
    it("maps lifecycle notices and animates the snapshot following a Card replacement", async () => {
        vi.stubGlobal("WebSocket", FakeWebSocket);
        vi.stubGlobal("location", { protocol: "http:", host: "example.test" });
        vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
        vi.stubGlobal("navigator", { languages: ["de-DE"] });
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
                    maximumIntensity: 3,
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
});
