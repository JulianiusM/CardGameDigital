import { afterEach, describe, expect, it, vi } from "vitest";
import packageMetadata from "../../package.json";
import { PROTOCOL_VERSION } from "../../packages/protocol/version";

const ROOM_ID = "00000000-0000-4000-8000-000000000010";

function canonicalJoin(role: "HOST" | "PLAYER" = "PLAYER") {
    return {
        roomId: ROOM_ID,
        roomCode: "ABC234",
        participantId: "00000000-0000-4000-8000-000000000011",
        participantCredential: "credential".repeat(5),
        role,
        bootstrapMode: "CREATOR_HOST" as const,
        hostStatus: {
            state: "CONNECTED" as const,
            participantId: "00000000-0000-4000-8000-000000000011",
            displayName: "Anna",
            deadline: null,
        },
    };
}

function canonicalRoomSnapshot(input: Record<string, any>): Record<string, unknown> {
    const settings = input.settings ?? {};
    const session = input.session;
    return {
        roomId: ROOM_ID,
        capacity: { maximumParticipants: 20, maximumPlayers: 20 },
        participants: (input.participants ?? []).map((participant: Record<string, unknown>) => ({
            roomId: ROOM_ID,
            devicePlayers: [],
            connectionStatus: "CONNECTED",
            ...participant,
        })),
        bootstrapMode: "CREATOR_HOST",
        hostStatus: {
            state: "CONNECTED",
            participantId: "00000000-0000-4000-8000-000000000011",
            displayName: "Anna",
            deadline: null,
        },
        boundaryConfigured: input.boundaryConfigured ?? true,
        settings: {
            mode: "NEVER_HAVE_I_EVER",
            profileId: "PROFILE_FRIENDS",
            groupId: null,
            adultContentConfirmed: false,
            cardLocale: "de-DE",
            cardFallbackEnabled: false,
            cardFallbackLocales: [],
            neverHaveIEverRevealMode: "NAMED_ANSWERS",
            cardPolicy: { scopeDefault: {}, conditionalRules: [], exactCards: [] },
            configuration: {
                enabledQuestionCategoryIds: [],
                enabledDareTypeIds: [],
                blockedOperationalFlags: [],
                maximumSocialSensitivity: "EXPLICIT",
                startingIntensity: 1,
                maximumIntensity: 3,
                intensityProgressionUnit: "ROUNDS",
                intensityProgressionInterval: 2,
                intensityProgressionIncrement: 1,
                randomQuestionRatio: 0.5,
                maximumTypeStreak: 3,
                letsTalkMetaInterval: 3,
            },
            revision: 0,
            updatedByParticipantId: null,
            ...settings,
        },
        session:
            session === null || session === undefined
                ? null
                : {
                      id: "00000000-0000-4000-8000-000000000020",
                      startedAt: 1,
                      mode: "NEVER_HAVE_I_EVER",
                      revision: 0,
                      state: "WAITING_FOR_PLAYER",
                      roundNumber: 1,
                      activePlayer: null,
                      players: [],
                      currentCard: null,
                      cardsShown: 0,
                      remainingCardCount: 10,
                      voteResult: { yes: 0, no: 0, total: 0 },
                      neverHaveIEverVoting: null,
                      hasVoted: false,
                      viewer: null,
                      availableActions: ["START_SESSION"],
                      controllablePlayers: [],
                      ...session,
                  },
    };
}

function canonicalServerPayload(type: string, payload: unknown): unknown {
    if (type === "room.snapshot") {
        return canonicalRoomSnapshot(payload as Record<string, unknown>);
    }
    if (type === "server.hello") {
        return { protocolVersion: PROTOCOL_VERSION, ...(payload as Record<string, unknown>) };
    }
    return payload;
}

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
        this.onmessage?.({
            data: JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type,
                requestId: type === "server.pong" ? "test-ping" : null,
                revision: null,
                payload: canonicalServerPayload(type, payload),
            }),
        });
    }
}

function installBrowserGlobals(): void {
    const sessionValues = new Map<string, string>();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("location", { protocol: "http:", host: "example.test" });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
    vi.stubGlobal("sessionStorage", {
        getItem: (key: string) => sessionValues.get(key) ?? null,
        setItem: (key: string, value: string) => sessionValues.set(key, value),
        removeItem: (key: string) => sessionValues.delete(key),
    });
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
    it("sends a null envelope revision for first-time boundaries during an active Session", async () => {
        installBrowserGlobals();
        const { RoomSocket } = await import("../../apps/web/src/multiplayer");
        const connection = new RoomSocket(canonicalJoin(), () => undefined);
        const socket = FakeWebSocket.instances[0];
        socket.onopen?.();
        socket.receive("server.hello", {
            participantId: canonicalJoin().participantId,
            role: "PLAYER",
        });
        socket.receive("room.snapshot", { session: { revision: 7 } });
        connection.command("command.setBoundaries", {
            disabledQuestionCategoryIds: [],
            disabledDareTypeIds: [],
            blockedOperationalFlags: [],
        });
        expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
            protocol: PROTOCOL_VERSION,
            type: "command.setBoundaries",
            revision: null,
        });
        connection.dispose();
    }, 60_000);

    it("sends client.hello when randomUUID is unavailable on a plain-HTTP origin", async () => {
        installBrowserGlobals();
        vi.stubGlobal("crypto", {
            getRandomValues(array: Uint8Array) {
                for (let index = 0; index < array.length; index += 1) array[index] = index;
                return array;
            },
        });
        const { RoomSocket } = await import("../../apps/web/src/multiplayer");
        const connection = new RoomSocket(canonicalJoin(), () => undefined);
        const socket = FakeWebSocket.instances[0];

        socket.onopen?.();

        expect(socket.sent).toHaveLength(1);
        const hello = JSON.parse(socket.sent[0]) as {
            protocol: number;
            type: string;
            requestId: string;
            payload: {
                roomCode: string;
                supportedProtocolVersions: number[];
                applicationVersion: string;
            };
        };
        expect(hello).toMatchObject({
            protocol: PROTOCOL_VERSION,
            type: "client.hello",
            payload: {
                roomCode: "ABC234",
                supportedProtocolVersions: [PROTOCOL_VERSION],
                applicationVersion: packageMetadata.version,
            },
        });
        expect(hello.requestId).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
        connection.dispose();
    }, 60_000);

    it("reuses a pending display-bootstrap idempotency key after a lost response", async () => {
        installBrowserGlobals();
        const responseBody = {
            roomId: "00000000-0000-4000-8000-000000000010",
            roomCode: "ABC234",
            participantId: "00000000-0000-4000-8000-000000000011",
            participantCredential: "credential".repeat(5),
            role: "DISPLAY",
            bootstrapMode: "DISPLAY_WAITING_FOR_HOST",
            hostStatus: {
                state: "AWAITING_FIRST_HOST",
                participantId: null,
                displayName: null,
                deadline: null,
            },
        };
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(new Error("response lost"))
            .mockResolvedValueOnce({
                ok: true,
                status: 201,
                json: async () => responseBody,
            });
        vi.stubGlobal("fetch", fetchMock);
        const { rooms } = await import("../../apps/web/src/multiplayer");
        const roomSettings = { mode: "CLASSIC_TRUTH_OR_DARE" } as never;

        await expect(
            rooms.create("Party Screen", "EPHEMERAL", roomSettings, "DISPLAY_WAITING_FOR_HOST"),
        ).rejects.toThrow("Verbindung fehlgeschlagen");
        await expect(
            rooms.create("Party Screen", "EPHEMERAL", roomSettings, "DISPLAY_WAITING_FOR_HOST"),
        ).resolves.toEqual(responseBody);

        const firstHeaders = fetchMock.mock.calls[0][1].headers as Headers;
        const secondHeaders = fetchMock.mock.calls[1][1].headers as Headers;
        expect(firstHeaders.get("Idempotency-Key")).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(secondHeaders.get("Idempotency-Key")).toBe(firstHeaders.get("Idempotency-Key"));
        expect(fetchMock.mock.calls[1][1].body).toBe(fetchMock.mock.calls[0][1].body);
        expect(sessionStorage.getItem("party-game:display-bootstrap-create")).toBeNull();
    }, 10_000);

    it("reuses the pending key in memory when session storage is unavailable", async () => {
        installBrowserGlobals();
        vi.stubGlobal("sessionStorage", {
            getItem: () => {
                throw new Error("storage blocked");
            },
            setItem: () => {
                throw new Error("storage blocked");
            },
            removeItem: () => {
                throw new Error("storage blocked");
            },
        });
        const responseBody = {
            roomId: "00000000-0000-4000-8000-000000000010",
            roomCode: "ABC234",
            participantId: "00000000-0000-4000-8000-000000000011",
            participantCredential: "credential".repeat(5),
            role: "DISPLAY",
            bootstrapMode: "DISPLAY_WAITING_FOR_HOST",
            hostStatus: {
                state: "AWAITING_FIRST_HOST",
                participantId: null,
                displayName: null,
                deadline: null,
            },
        };
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(new Error("response lost"))
            .mockResolvedValueOnce({ ok: true, status: 201, json: async () => responseBody });
        vi.stubGlobal("fetch", fetchMock);
        const { rooms } = await import("../../apps/web/src/multiplayer");
        const roomSettings = { mode: "CLASSIC_TRUTH_OR_DARE" } as never;

        await expect(
            rooms.create("Party Screen", "EPHEMERAL", roomSettings, "DISPLAY_WAITING_FOR_HOST"),
        ).rejects.toThrow();
        await expect(
            rooms.create("Party Screen", "EPHEMERAL", roomSettings, "DISPLAY_WAITING_FOR_HOST"),
        ).resolves.toEqual(responseBody);

        const firstHeaders = fetchMock.mock.calls[0][1].headers as Headers;
        const secondHeaders = fetchMock.mock.calls[1][1].headers as Headers;
        expect(secondHeaders.get("Idempotency-Key")).toBe(firstHeaders.get("Idempotency-Key"));
    }, 10_000);

    it("reports HTTP and realtime connection failures instead of silently ignoring play", async () => {
        installBrowserGlobals();
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
        const { RoomSocket, rooms } = await import("../../apps/web/src/multiplayer");

        await expect(rooms.join("ABC234", "Ben", "PLAYER")).rejects.toThrow(
            "Verbindung fehlgeschlagen",
        );
        const connection = new RoomSocket(canonicalJoin(), () => undefined);
        connection.command("command.startTurn");
        expect(connection.errorCode).toBe("CONNECTION_UNAVAILABLE");
        expect(connection.error).toBe("Verbindung fehlgeschlagen");
        connection.dispose();
    }, 10_000);

    it("accepts the current successful Room join response without create-only fields", async () => {
        installBrowserGlobals();
        const responseBody = {
            roomId: ROOM_ID,
            roomCode: "ABC234",
            participantId: "00000000-0000-4000-8000-000000000011",
            participantCredential: "credential".repeat(5),
            role: "PLAYER",
            futureJoinDetail: true,
        };
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                status: 201,
                json: async () => responseBody,
            }),
        );
        const { rooms } = await import("../../apps/web/src/multiplayer");

        await expect(rooms.join("ABC234", "Ben", "PLAYER")).resolves.toEqual(responseBody);
    }, 10_000);

    it("maps lifecycle notices and animates the snapshot following a Card replacement", async () => {
        installBrowserGlobals();
        const { RoomSocket } = await import("../../apps/web/src/multiplayer");
        let changes = 0;
        const connection = new RoomSocket(canonicalJoin(), () => changes++);
        const socket = FakeWebSocket.instances[0];
        const snapshot = (cardId: string) => ({
            participants: [],
            boundaryConfigured: true,
            session: {
                currentCard: {
                    id: cardId,
                    cardText: "Card",
                    cardType: "QUESTION",
                    cardIntensity: 2,
                    intensity: 2,
                    questionCategoryId: "CAT_EVERYDAY",
                    dareTypeId: null,
                },
            },
        });

        socket.receive("room.snapshot", snapshot("00000000-0000-4000-8000-000000000030"));
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
        socket.receive("room.snapshot", snapshot("00000000-0000-4000-8000-000000000031"));
        expect(connection.cardReplacementSequence).toBe(1);
        expect(connection.cardReplacementReason).toBe("VETOED");
        expect(changes).toBeGreaterThanOrEqual(4);
        connection.dispose();
    });

    it("announces a player added to an already active Session", async () => {
        installBrowserGlobals();
        const { RoomSocket } = await import("../../apps/web/src/multiplayer");
        const connection = new RoomSocket(canonicalJoin("HOST"), () => undefined);
        const socket = FakeWebSocket.instances[0];
        const host = {
            id: "00000000-0000-4000-8000-000000000011",
            role: "HOST",
            displayName: "Anna",
        };
        socket.receive("room.snapshot", {
            participants: [host],
            settings: { revision: 0, updatedByParticipantId: null },
            session: { state: "WAITING_FOR_PLAYER", currentCard: null },
        });
        socket.receive("room.snapshot", {
            participants: [
                host,
                {
                    id: "00000000-0000-4000-8000-000000000012",
                    role: "PLAYER",
                    displayName: "Carla",
                },
            ],
            settings: { revision: 0, updatedByParticipantId: null },
            session: { state: "WAITING_FOR_PLAYER", currentCard: null },
        });

        expect(connection.roomNotice).toBe("Carla ist dem laufenden Spiel beigetreten.");
        expect(connection.roomNoticeId).toBe(1);
        connection.dispose();
    });

    it("enters reconnecting state and opens a new socket when a heartbeat goes unanswered", async () => {
        vi.useFakeTimers();
        installBrowserGlobals();
        const { RoomSocket } = await import("../../apps/web/src/multiplayer");
        let changes = 0;
        const connection = new RoomSocket(canonicalJoin(), () => changes++);
        const socket = FakeWebSocket.instances[0];
        socket.onopen?.();
        socket.receive("server.hello", {
            participantId: "00000000-0000-4000-8000-000000000011",
            role: "PLAYER",
        });
        expect(connection.authenticated).toBe(true);

        vi.advanceTimersByTime(15_001);
        expect(connection.authenticated).toBe(false);
        expect(connection.reconnectPhase).toBe("WAITING");
        expect(connection.reconnectSeconds).toBe(1);
        expect(changes).toBeGreaterThan(1);
        vi.advanceTimersByTime(1_000);
        expect(FakeWebSocket.instances).toHaveLength(2);
        connection.dispose();
    });

    it("enters reconnecting immediately when the transport reports a connection error", async () => {
        vi.useFakeTimers();
        installBrowserGlobals();
        const { RoomSocket } = await import("../../apps/web/src/multiplayer");
        const connection = new RoomSocket(canonicalJoin(), () => undefined);
        const socket = FakeWebSocket.instances[0];
        socket.onopen?.();
        socket.receive("server.hello", {
            participantId: "00000000-0000-4000-8000-000000000011",
            role: "PLAYER",
        });

        socket.onerror?.();

        expect(connection.authenticated).toBe(false);
        expect(connection.reconnectPhase).toBe("WAITING");
        expect(connection.reconnectSeconds).toBe(1);
        vi.advanceTimersByTime(1_000);
        expect(FakeWebSocket.instances).toHaveLength(2);
        connection.dispose();
    });

    it("counts down bounded retries and supports stopping or manually restarting them", async () => {
        vi.useFakeTimers();
        installBrowserGlobals();
        const { RoomSocket } = await import("../../apps/web/src/multiplayer");
        const connection = new RoomSocket(canonicalJoin(), () => undefined);

        FakeWebSocket.instances[0].onerror?.();
        expect(connection.reconnectSeconds).toBe(1);
        vi.advanceTimersByTime(1_000);
        expect(connection.reconnectAttempt).toBe(1);
        FakeWebSocket.instances[1].onerror?.();
        expect(connection.reconnectSeconds).toBe(2);

        connection.stopReconnecting();
        vi.advanceTimersByTime(30_000);
        expect(connection.reconnectPhase).toBe("STOPPED");
        expect(FakeWebSocket.instances).toHaveLength(2);

        connection.retryNow();
        expect(connection.reconnectPhase).toBe("CONNECTING");
        expect(connection.reconnectAttempt).toBe(0);
        expect(FakeWebSocket.instances).toHaveLength(3);

        for (let attempt = 1; attempt <= connection.reconnectMaximum; attempt++) {
            FakeWebSocket.instances.at(-1)?.onerror?.();
            const delaySeconds = Math.min(attempt, 10);
            expect(connection.reconnectSeconds).toBe(delaySeconds);
            vi.advanceTimersByTime(delaySeconds * 1_000);
            expect(connection.reconnectAttempt).toBe(attempt);
        }
        FakeWebSocket.instances.at(-1)?.onerror?.();
        expect(connection.reconnectPhase).toBe("EXHAUSTED");
        connection.dispose();
    });

    it("reports an expired reconnect identity instead of silently returning home", async () => {
        installBrowserGlobals();
        const { RoomSocket } = await import("../../apps/web/src/multiplayer");
        let reason = "";
        const connection = new RoomSocket(
            canonicalJoin(),
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
