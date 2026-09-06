import { testCatalogAccess, testCardById } from "../support/game";
import http from "node:http";
import { probeKodiCapacity } from "../support/kodiCapacity";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { attachWebSocketServer } from "../../apps/server/src/modules/websocket";
import settings from "../../apps/server/src/modules/settings";
import { RoomService } from "../../packages/application/roomService";
import {
    SequenceRandomSource,
    GameSession,
    reconcileSessionMembership,
    type GameSessionRuntimeState,
    type PlayerBoundaries,
} from "../../packages/game-core";
import type {
    RealtimeRoomRepository,
    RoomRuntimeCommit,
    RoomParticipant,
    RoomState,
} from "../../packages/application/realtimeRooms";
import type { TestCardRepository as CardRepository } from "../support/game";
import { card, profile } from "../support/game";
import { capacityId, maximumRoomSettings } from "../support/transportCapacity";
import {
    defaultRoomGameSettings,
    type RoomGameSettings,
    type VersionedRoomGameSettings,
} from "../../packages/application/roomGameSettings";
import {
    PROTOCOL_VERSION,
    MAX_WEBSOCKET_MESSAGE_BYTES,
    roomSnapshotEnvelopeSchema,
} from "../../packages/protocol";
import { applyMemoryLifecycleTransition } from "../support/realtimeLifecycle";
import { expectHiddenVotingAnswers } from "../support/votingPrivacy";

class Repo implements RealtimeRoomRepository {
    room!: RoomState;
    participants: Array<RoomParticipant & { credentialHash: string }> = [];
    runtime: GameSessionRuntimeState | null = null;
    boundaries = new Map<string, PlayerBoundaries>();
    settings!: VersionedRoomGameSettings;
    async roomCodeExists() {
        return false;
    }
    async createRoom(i: Parameters<RealtimeRoomRepository["createRoom"]>[0]) {
        this.room = {
            id: i.roomId,
            code: i.code,
            bootstrapMode: i.bootstrapMode,
            firstHostAssignedAt: i.firstHostAssignedAt,
            activationDeadline: i.activationDeadline,
            activatedAt: null,
            createdAt: i.createdAt,
            expiresAt: i.expiresAt.getTime(),
            closedAt: null,
            creatorParticipantId: i.participant.id,
        };
        this.participants.push(i.participant);
        this.settings = {
            ...i.settings,
            revision: 0,
            updatedByParticipantId: i.participant.id,
        };
        return { created: true as const };
    }
    async findRoomCreateIdempotency() {
        return null;
    }
    async joinRoom(i: Parameters<RealtimeRoomRepository["joinRoom"]>[0]) {
        this.participants.push({ ...i, roomId: this.room.id });
    }
    async authenticate(code: string, hash: string) {
        const p = this.participants.find(
            (x) => code === this.room.code && x.credentialHash === hash,
        );
        return p && p.connectionStatus !== "LEFT" ? { ...p } : null;
    }
    async listParticipants(roomId: string) {
        return this.participants
            .filter(({ connectionStatus }) => connectionStatus !== "LEFT")
            .map((participant) => ({ ...participant, roomId }));
    }
    async getParticipant(roomId: string, participantId: string) {
        return (await this.listParticipants(roomId)).find(({ id }) => id === participantId) ?? null;
    }
    async setConnectionStatus(
        participantId: string,
        connectionStatus: RoomParticipant["connectionStatus"],
    ) {
        const participant = this.participants.find(({ id }) => id === participantId)!;
        participant.connectionStatus = connectionStatus;
        if (connectionStatus === "CONNECTED") {
            participant.firstConnectedAt ??= Date.now();
            participant.lastConnectedAt = Date.now();
            participant.reconnectDeadline = null;
        }
    }
    async loadRoomState() {
        return { ...this.room };
    }
    async applyLifecycleTransition(
        transition: Parameters<RealtimeRoomRepository["applyLifecycleTransition"]>[0],
    ) {
        const current = this.runtime;
        if (
            transition.type === "CLOSE" &&
            transition.expectedSessionRevision != null &&
            current?.revision !== transition.expectedSessionRevision
        ) {
            throw Object.assign(new Error("stale"), { code: "STALE_SESSION_REVISION" });
        }
        const result = applyMemoryLifecycleTransition(this.room, this.participants, transition);
        if (this.runtime) {
            const ids = new Set(
                this.participants
                    .filter((p) => p.connectionStatus !== "LEFT" && p.role !== "DISPLAY")
                    .flatMap((p) => [p.id, ...p.devicePlayers.map(({ id }) => id)]),
            );
            this.runtime = reconcileSessionMembership(this.runtime, ids, result.roomClosed);
        }
        return result;
    }
    async resetConnectedParticipants(at: number, reconnectDeadline: number) {
        const reset: RoomParticipant[] = [];
        for (const participant of this.participants)
            if (participant.connectionStatus === "CONNECTED") {
                participant.connectionStatus = "TEMPORARILY_DISCONNECTED";
                participant.lastConnectedAt = at;
                participant.reconnectDeadline = reconnectDeadline;
                reset.push({ ...participant });
            }
        return reset;
    }
    async findDueRoomIds() {
        return [];
    }
    async deleteExpiredRoomCreateTombstones() {
        return 0;
    }
    async saveDevicePlayers(participantId: string, players: RoomParticipant["devicePlayers"]) {
        this.participants.find(({ id }) => id === participantId)!.devicePlayers = players;
    }
    async transferHost(roomId: string, currentHostId: string, nextHostId: string) {
        const current = this.participants.find(
            ({ id, roomId: participantRoomId }) =>
                id === currentHostId && participantRoomId === roomId,
        )!;
        const next = this.participants.find(
            ({ id, roomId: participantRoomId }) =>
                id === nextHostId && participantRoomId === roomId,
        )!;
        if (current.role !== "HOST" || next.role !== "PLAYER")
            throw Object.assign(new Error("invalid transfer"), { code: "NOT_AUTHORIZED" });
        current.role = "PLAYER";
        next.role = "HOST";
    }
    async closeRoom(roomId: string, hostParticipantId: string) {
        const host = this.participants.find(
            (participant) =>
                participant.id === hostParticipantId &&
                participant.roomId === roomId &&
                participant.role === "HOST" &&
                participant.connectionStatus !== "LEFT",
        );
        if (!host) throw Object.assign(new Error("not authorized"), { code: "NOT_AUTHORIZED" });
        this.room.closedAt = Date.now();
        for (const participant of this.participants)
            if (participant.roomId === roomId) participant.connectionStatus = "LEFT";
    }
    async closeRoomIfNoPlayers(roomId: string) {
        const active = this.participants.filter(
            (participant) =>
                participant.roomId === roomId && participant.connectionStatus !== "LEFT",
        );
        if (
            active.some(
                ({ role, connectionStatus }) =>
                    role !== "DISPLAY" || connectionStatus === "CONNECTED",
            )
        )
            return false;
        for (const participant of active) participant.connectionStatus = "LEFT";
        return true;
    }
    async loadSettings() {
        return this.settings;
    }
    async saveSettings(
        _roomId: string,
        participantId: string,
        expectedRevision: number,
        settings: RoomGameSettings,
    ) {
        if (this.settings.revision !== expectedRevision)
            throw Object.assign(new Error("stale"), { code: "STALE_SESSION_REVISION" });
        this.settings = {
            ...settings,
            revision: expectedRevision + 1,
            updatedByParticipantId: participantId,
        };
        return this.settings;
    }
    async saveBoundaries(participantId: string, boundaries: PlayerBoundaries) {
        this.boundaries.set(participantId, boundaries);
    }
    async listBoundaries() {
        return this.boundaries;
    }
    async selectGroup() {}
    async groupHistory() {
        return new Set<never>();
    }
    async runtimeRevision() {
        return this.runtime ? { id: this.runtime.id, revision: this.runtime.revision } : null;
    }
    async loadRuntime() {
        return this.runtime;
    }
    async commitRuntime(
        _id: string,
        previous: number | null,
        runtime: GameSessionRuntimeState,
        options: RoomRuntimeCommit = {},
    ) {
        if ((this.runtime?.revision ?? null) !== previous)
            throw Object.assign(new Error("stale"), { code: "STALE_SESSION_REVISION" });
        this.runtime = runtime;
        const enrollment = options.enrollment;
        if (enrollment) this.boundaries.set(enrollment.participantId, enrollment.boundaries);
    }
    async clearEndedRuntime(_roomId: string, sessionId: string, revision: number) {
        if (
            this.runtime?.id !== sessionId ||
            this.runtime.revision !== revision ||
            this.runtime.state !== "ENDED"
        )
            throw Object.assign(new Error("invalid reset"), { code: "INVALID_GAME_STATE" });
        this.runtime = null;
    }
}
const cards: CardRepository = {
    async isLocaleActive() {
        return true;
    },
    async defaultLocale() {
        return "en-GB";
    },
    ...testCatalogAccess,
    async listActive() {
        return [card({ id: "ws-question" as never })];
    },
    getById: testCardById,
    async findEligibleCandidates() {
        return [];
    },
};
let server: http.Server | undefined;
afterEach(() => new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve()));

describe("Room WebSocket protocol", () => {
    it("rejects connections above the configured process capacity", async () => {
        const previous = settings.value.webSocketMaximumConnections;
        settings.value.webSocketMaximumConnections = 1;
        const service = new RoomService(new Repo(), cards, new SequenceRandomSource([0]));
        server = http.createServer();
        const wss = attachWebSocketServer(server, service);
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as { port: number }).port;
        const first = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        let second: WebSocket | undefined;
        try {
            await new Promise<void>((resolve) => first.once("open", resolve));
            second = new WebSocket(`ws://127.0.0.1:${port}/ws`);
            await expect(
                new Promise<number>((resolve) => second!.once("close", resolve)),
            ).resolves.toBe(1013);
            expect(first.readyState).toBe(WebSocket.OPEN);
        } finally {
            first.terminate();
            second?.terminate();
            await new Promise<void>((resolve) => wss.close(() => resolve()));
            settings.value.webSocketMaximumConnections = previous;
        }
    });
    it("saves maximum settings and resynchronizes maximum roster, text and voting through fragmented Kodi transport", async () => {
        const repository = new Repo();
        const maximumCard = card({
            id: capacityId(2001) as never,
            yesNoAnswerPossible: true,
            cardText: "界".repeat(2096) + "a".repeat(1904),
        });
        const catalog = {
            ...cards,
            async listActive() {
                return [maximumCard];
            },
        };
        const service = new RoomService(
            repository,
            catalog,
            new SequenceRandomSource([0]),
            undefined,
            { maximumParticipants: 1000, maximumPlayers: 1000 },
        );
        const host = await service.createRoom("界".repeat(40));
        const display = await service.joinRoom(host.roomCode, "屏".repeat(40), "DISPLAY");
        const extra = { id: capacityId(3000), name: "同".repeat(40) };
        repository.participants[0].devicePlayers = [extra];
        const template = repository.participants[0];
        repository.participants.push(
            ...Array.from({ length: 998 }, (_, i) => ({
                ...template,
                id: capacityId(i + 1),
                displayName: "名".repeat(40),
                role: "PLAYER" as const,
                devicePlayers: [],
                connectionStatus: "CONNECTED" as const,
            })),
        );
        server = http.createServer();
        const wss = attachWebSocketServer(server, service);
        // Fragment the real adapter's UTF-8 output, including within a CJK code point.
        wss.on("connection", (socket) => {
            const send = socket.send.bind(socket);
            socket.send = ((data: string, callback: (error?: Error) => void) => {
                if (typeof data !== "string" || !data.includes('"type":"room.snapshot"'))
                    return send(data, callback);
                const bytes = Buffer.from(data);
                for (let offset = 0; offset < bytes.length; offset += 65537) {
                    const final = offset + 65537 >= bytes.length;
                    send(
                        bytes.subarray(offset, offset + 65537),
                        { binary: false, fin: final },
                        final ? callback : undefined,
                    );
                }
            }) as typeof socket.send;
        });
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as { port: number }).port;
        const client = await hello(port, host.roomCode, host.participantCredential, "HOST");
        try {
            const settings = maximumRoomSettings();
            client.socket.send(
                JSON.stringify({
                    protocol: PROTOCOL_VERSION,
                    type: "command.updateRoomSettings",
                    requestId: "maximum-settings",
                    revision: null,
                    payload: { expectedRevision: 0, settings },
                }),
            );
            await waitFor(
                () =>
                    client.messages.some(
                        (message) =>
                            message.type === "room.snapshot" &&
                            message.payload.settings.revision === 1,
                    ),
                () => JSON.stringify(client.messages.filter((message) => message.type === "error")),
            );
            const saved = client.messages.find(
                (message) =>
                    message.type === "room.snapshot" && message.payload.settings.revision === 1,
            );
            roomSnapshotEnvelopeSchema.parse(saved);
            expect(saved.payload.settings.cardPolicy).toEqual(settings.cardPolicy);
            const players = repository.participants
                .filter((p) => p.role !== "DISPLAY")
                .flatMap((p) => [{ id: p.id, name: p.displayName }, ...p.devicePlayers]);
            const session = new GameSession(
                {
                    id: capacityId(2002),
                    mode: "NEVER_HAVE_I_EVER",
                    players,
                    profile: profile(),
                    cardLocale: "en-GB",
                    neverHaveIEverRevealMode: "NAMED_ANSWERS",
                    catalog: await catalog.catalogProvenance(),
                },
                new SequenceRandomSource([0]),
            );
            await session.startTurn(0, [maximumCard]);
            session.submitVote(session.revision, players[0].id, "YES");
            for (const revealed of [false, true]) {
                if (revealed)
                    for (const player of players.slice(1))
                        session.submitVote(session.revision, player.id, "NO");
                repository.runtime = session.toRuntimeState();
                const observed = await probeKodiCapacity({
                    origin: `http://127.0.0.1:${port}`,
                    roomCode: display.roomCode,
                    credential: display.participantCredential,
                });
                expect(observed).toMatchObject({
                    participants: 1000,
                    players: 1000,
                    rules: 250,
                    exactCards: 1000,
                    cardBytes: 8192,
                    result: revealed ? { total: 1000, namedAnswers: 1000 } : null,
                });
                expect(observed.bytes).toBeGreaterThan(65536);
                expect(observed.bytes).toBeLessThan(MAX_WEBSOCKET_MESSAGE_BYTES);
            }
        } finally {
            client.socket.terminate();
            for (const socket of wss.clients) socket.terminate();
            await new Promise<void>((resolve) => wss.close(() => resolve()));
        }
    }, 30_000);
    it("honors configured queued frames while an earlier message is blocked", async () => {
        const previousMaximum = settings.value.webSocketQueuedMessages;
        settings.value.webSocketQueuedMessages = 2;
        const service = new RoomService(new Repo(), cards, new SequenceRandomSource([0]));
        let release!: () => void;
        const blocked = new Promise<null>((resolve) => {
            release = () => resolve(null);
        });
        service.authenticate = () => blocked;
        server = http.createServer();
        const wss = attachWebSocketServer(server, service);
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as { port: number }).port;
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        await new Promise<void>((resolve) => socket.once("open", resolve));
        const closed = new Promise<number>((resolve) => socket.once("close", resolve));
        const message = JSON.stringify({
            protocol: PROTOCOL_VERSION,
            type: "client.hello",
            requestId: "blocked",
            revision: null,
            payload: {
                supportedProtocolVersions: [PROTOCOL_VERSION],
                applicationVersion: "test",
                role: "HOST",
                capabilities: [],
                roomCode: "ABCDEF",
                participantCredential: "a".repeat(64),
            },
        });
        try {
            for (let index = 0; index < 3; index++) socket.send(message);
            await expect(closed).resolves.toBe(1013);
        } finally {
            release();
            socket.terminate();
            await new Promise<void>((resolve) => wss.close(() => resolve()));
            settings.value.webSocketQueuedMessages = previousMaximum;
        }
    });

    it("does not send an older broadcast after a newer direct snapshot", async () => {
        const repository = new Repo();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const host = await service.createRoom("Host");
        const guest = await service.joinRoom(host.roomCode, "Guest", "PLAYER");
        server = http.createServer();
        const wss = attachWebSocketServer(server, service);
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as { port: number }).port;
        const hostClient = await hello(port, host.roomCode, host.participantCredential, host.role);
        let release!: () => void;
        let captured!: () => void;
        const blocked = new Promise<void>((resolve) => {
            release = resolve;
        });
        const ready = new Promise<void>((resolve) => {
            captured = resolve;
        });
        const projection = service.snapshotProjection.bind(service);
        let holdNext = true;
        service.snapshotProjection = async (...args) => {
            const project = await projection(...args);
            if (holdNext) {
                holdNext = false;
                captured();
                await blocked;
            }
            return project;
        };
        const joining = hello(port, guest.roomCode, guest.participantCredential, guest.role);
        try {
            await ready;
            repository.settings = { ...repository.settings, revision: 1 };
            hostClient.socket.send(
                JSON.stringify({
                    protocol: PROTOCOL_VERSION,
                    type: "room.snapshot.request",
                    requestId: "newer",
                    revision: null,
                    payload: {},
                }),
            );
            await waitFor(() =>
                hostClient.messages.some(
                    (message) =>
                        message.type === "room.snapshot" && message.payload.settings.revision === 1,
                ),
            );
            release();
            const guestClient = await joining;
            const revisions = hostClient.messages
                .filter((message) => message.type === "room.snapshot")
                .map((message) => message.payload.settings.revision);
            expect(revisions.at(-1)).toBe(1);
            expect(revisions.slice(revisions.indexOf(1))).not.toContain(0);
            guestClient.socket.terminate();
        } finally {
            release();
            hostClient.socket.terminate();
            (await joining).socket.terminate();
            await new Promise<void>((resolve) => wss.close(() => resolve()));
        }
    });

    it("answers heartbeats while an authenticated gameplay command is waiting", async () => {
        const service = new RoomService(new Repo(), cards, new SequenceRandomSource([0]));
        const host = await service.createRoom("Host");
        server = http.createServer();
        const wss = attachWebSocketServer(server, service);
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as { port: number }).port;
        const client = await hello(port, host.roomCode, host.participantCredential, host.role);
        let release!: () => void;
        let entered!: () => void;
        let completed = false;
        const blocked = new Promise<void>((resolve) => {
            release = resolve;
        });
        const ready = new Promise<void>((resolve) => {
            entered = resolve;
        });
        service.execute = async (roomId, participant) => {
            entered();
            await blocked;
            completed = true;
            return service.snapshot(roomId, participant);
        };
        try {
            client.socket.send(
                JSON.stringify({
                    protocol: PROTOCOL_VERSION,
                    type: "command.startSession",
                    requestId: "slow",
                    revision: null,
                    payload: {},
                }),
            );
            await ready;
            client.socket.send(
                JSON.stringify({
                    protocol: PROTOCOL_VERSION,
                    type: "client.ping",
                    requestId: "heartbeat",
                    revision: null,
                    payload: {},
                }),
            );
            await waitFor(() =>
                client.messages.some(
                    (message) =>
                        message.type === "server.pong" && message.requestId === "heartbeat",
                ),
            );
            expect(completed).toBe(false);
        } finally {
            release();
            await waitFor(() => completed);
            client.socket.terminate();
            await new Promise<void>((resolve) => wss.close(() => resolve()));
        }
    });

    it("rejects binary protocol messages", async () => {
        const service = new RoomService(new Repo(), cards, new SequenceRandomSource([0]));
        server = http.createServer();
        const wss = attachWebSocketServer(server, service);
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as { port: number }).port;
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        const messages: Array<{ type: string; payload: { code?: string } }> = [];
        socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
        await new Promise<void>((resolve, reject) => {
            socket.once("open", resolve);
            socket.once("error", reject);
        });
        socket.send(Buffer.from("{}"));

        await waitFor(() =>
            messages.some(
                (message) =>
                    message.type === "error" && message.payload.code === "VALIDATION_ERROR",
            ),
        );
        expect(messages).toContainEqual(
            expect.objectContaining({
                protocol: PROTOCOL_VERSION,
                type: "error",
                payload: expect.objectContaining({ code: "VALIDATION_ERROR" }),
            }),
        );
        socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    });

    it.each([1, 2, 3])(
        "rejects retired protocol %s with the stable negotiation error",
        async (protocol) => {
            const service = new RoomService(new Repo(), cards, new SequenceRandomSource([0]));
            server = http.createServer();
            const wss = attachWebSocketServer(server, service);
            await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
            const port = (server.address() as { port: number }).port;
            const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
            const messages: any[] = [];
            socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
            await new Promise<void>((resolve, reject) => {
                socket.once("open", resolve);
                socket.once("error", reject);
            });
            socket.send(
                JSON.stringify({
                    protocol,
                    type: "client.hello",
                    requestId: "retired",
                    revision: null,
                    payload: {},
                }),
            );
            await waitFor(() =>
                messages.some(
                    (message) =>
                        message.type === "error" &&
                        message.payload.code === "PROTOCOL_VERSION_UNSUPPORTED",
                ),
            );
            expect(messages).toContainEqual(
                expect.objectContaining({
                    protocol: PROTOCOL_VERSION,
                    type: "error",
                    payload: expect.objectContaining({ code: "PROTOCOL_VERSION_UNSUPPORTED" }),
                }),
            );
            socket.terminate();
            await new Promise<void>((resolve) => wss.close(() => resolve()));
        },
    );

    it("authenticates host, two players, and display and resynchronizes snapshots", async () => {
        const service = new RoomService(new Repo(), cards, new SequenceRandomSource([0]));
        const host = await service.createRoom("Host"),
            a = await service.joinRoom(host.roomCode, "A", "PLAYER"),
            b = await service.joinRoom(host.roomCode, "B", "PLAYER"),
            display = await service.joinRoom(host.roomCode, "TV", "DISPLAY");
        server = http.createServer();
        const wss = attachWebSocketServer(server, service);
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as { port: number }).port;
        const clients = await Promise.all(
            [host, a, b, display].map((participant) =>
                hello(
                    port,
                    participant.roomCode,
                    participant.participantCredential,
                    participant.role,
                ),
            ),
        );
        expect(clients.map((client) => client.messages[0].payload.role)).toEqual([
            "HOST",
            "PLAYER",
            "PLAYER",
            "DISPLAY",
        ]);
        clients[0].socket.send(
            JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type: "command.startSession",
                requestId: "start",
                revision: null,
                payload: {},
            }),
        );
        await waitFor(
            () =>
                clients.every((client) =>
                    client.messages.some(
                        (message) =>
                            message.type === "room.snapshot" &&
                            message.payload.session?.revision === 0,
                    ),
                ),
            () => JSON.stringify(clients.map((client) => client.messages)),
        );
        const hostView = clients[0].messages.findLast((message) => message.type === "room.snapshot")
            .payload.session;
        const displayView = clients[3].messages.findLast(
            (message) => message.type === "room.snapshot",
        ).payload.session;
        expect(hostView.availableActions).toContain("CHOOSE_CARD_TYPE");
        expect(displayView.availableActions).toEqual([]);
        expect(displayView).not.toHaveProperty("votedPlayerIds");
        clients[1].socket.send(
            JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type: "client.ping",
                requestId: "heartbeat",
                revision: null,
                payload: {},
            }),
        );
        await waitFor(() =>
            clients[1].messages.some(
                (message) => message.requestId === "heartbeat" && message.type === "server.pong",
            ),
        );
        expect(
            clients[1].messages.find((message) => message.requestId === "heartbeat").payload
                .serverTime,
        ).toEqual(expect.any(Number));
        clients[3].socket.send(
            JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type: "room.snapshot.request",
                requestId: "sync",
                revision: null,
                payload: {},
            }),
        );
        await waitFor(
            () =>
                clients[3].messages.some(
                    (message) => message.requestId === "sync" && message.type === "room.snapshot",
                ),
            () => JSON.stringify(clients[3].messages),
        );
        clients[3].socket.terminate();
        const reconnected = await hello(
            port,
            display.roomCode,
            display.participantCredential,
            display.role,
        );
        await waitFor(() =>
            reconnected.messages.some(
                (message) =>
                    message.type === "room.snapshot" && message.payload.session?.revision === 0,
            ),
        );
        for (const client of [...clients.slice(0, 3), reconnected]) client.socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    });

    it("atomically assigns exactly one first phone as Host for a display-bootstrap Room", async () => {
        const repository = new Repo();
        const service = new RoomService(
            repository,
            cards,
            new SequenceRandomSource([0]),
            undefined,
            undefined,
            undefined,
            { displayBootstrapEnabled: true },
        );
        const display = await service.createRoom("Party Screen", null, undefined, {
            bootstrapMode: "DISPLAY_WAITING_FOR_HOST",
        });
        const first = await service.joinRoom(display.roomCode, "First phone", "PLAYER");
        const second = await service.joinRoom(display.roomCode, "Second phone", "PLAYER");
        expect(display.role).toBe("DISPLAY");
        expect(repository.participants.some(({ role }) => role === "HOST")).toBe(false);

        server = http.createServer();
        const wss = attachWebSocketServer(server, service);
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as { port: number }).port;
        const displayClient = await hello(
            port,
            display.roomCode,
            display.participantCredential,
            display.role,
        );
        expect(
            displayClient.messages.findLast((message) => message.type === "room.snapshot").payload
                .hostStatus.state,
        ).toBe("AWAITING_FIRST_HOST");

        const phoneClients = await Promise.all(
            [first, second].map((participant, index) =>
                hello(
                    port,
                    participant.roomCode,
                    participant.participantCredential,
                    index === 0 ? "HOST" : "DISPLAY",
                ),
            ),
        );
        const helloRoles = phoneClients.map(
            ({ messages }) =>
                messages.find((message) => message.type === "server.hello").payload.role,
        );
        expect(helloRoles.filter((role) => role === "HOST")).toHaveLength(1);
        const promoted = phoneClients.find(({ messages }) =>
            messages.some(
                (message) =>
                    message.type === "room.roleChanged" &&
                    message.payload.role === "HOST" &&
                    message.payload.previousRole === "PLAYER" &&
                    message.payload.reason === "INITIAL_HOST_ASSIGNED",
            ),
        );
        expect(promoted).toBeDefined();
        expect(
            repository.participants.filter(
                ({ role, connectionStatus }) => role === "HOST" && connectionStatus !== "LEFT",
            ),
        ).toHaveLength(1);

        for (const client of [displayClient, ...phoneClients]) client.socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    });

    it("ends idempotently and starts a new Session without replacing Room participants", async () => {
        const repository = new Repo();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const host = await service.createRoom("Host");
        const player = await service.joinRoom(host.roomCode, "Player", "PLAYER");
        const display = await service.joinRoom(host.roomCode, "Display", "DISPLAY");
        server = http.createServer();
        const wss = attachWebSocketServer(server, service);
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as { port: number }).port;
        const hostClient = await hello(port, host.roomCode, host.participantCredential, host.role);
        const staleHostTab = await hello(
            port,
            host.roomCode,
            host.participantCredential,
            host.role,
        );
        const playerClient = await hello(
            port,
            player.roomCode,
            player.participantCredential,
            player.role,
        );
        const displayClient = await hello(
            port,
            display.roomCode,
            display.participantCredential,
            display.role,
        );
        const clients = [staleHostTab, playerClient, displayClient];
        const send = (
            client: (typeof clients)[number],
            type: string,
            requestId: string,
            revision: number | null,
        ) =>
            client.socket.send(
                JSON.stringify({
                    protocol: PROTOCOL_VERSION,
                    type,
                    requestId,
                    revision,
                    payload: {},
                }),
            );

        send(staleHostTab, "command.startSession", "start-first", null);
        await waitFor(() =>
            clients.every((client) =>
                client.messages.some(
                    (message) =>
                        message.type === "room.snapshot" && message.payload.session?.revision === 0,
                ),
            ),
        );
        const firstSessionId = repository.runtime!.id;
        send(staleHostTab, "command.endSession", "end-first", 0);
        await waitFor(() =>
            clients.every(
                (client) =>
                    client.messages.findLast((message) => message.type === "room.snapshot").payload
                        .session?.state === "ENDED",
            ),
        );
        expect(repository.room.closedAt).toBeNull();
        expect(clients.every(({ socket }) => socket.readyState === WebSocket.OPEN)).toBe(true);
        send(staleHostTab, "command.endSession", "stale-end", 0);
        await waitFor(() =>
            staleHostTab.messages.some(
                (message) => message.requestId === "stale-end" && message.type === "room.snapshot",
            ),
        );
        expect(
            staleHostTab.messages.some(
                (message) => message.requestId === "stale-end" && message.type === "error",
            ),
        ).toBe(false);

        send(staleHostTab, "command.resetSession", "new-game", 1);
        await waitFor(() =>
            clients.every(
                (client) =>
                    client.messages.findLast((message) => message.type === "room.snapshot").payload
                        .session === null,
            ),
        );
        expect(repository.room.closedAt).toBeNull();
        expect(clients.every(({ socket }) => socket.readyState === WebSocket.OPEN)).toBe(true);
        expect(repository.participants).toHaveLength(3);
        send(staleHostTab, "command.startSession", "start-second", null);
        await waitFor(
            () => repository.runtime !== null && repository.runtime.id !== firstSessionId,
        );
        expect(repository.participants).toHaveLength(3);

        for (const client of [hostClient, ...clients]) client.socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    });

    it("promotes a connected player when the host does not reconnect", async () => {
        const repository = new Repo();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const host = await service.createRoom("Host");
        const player = await service.joinRoom(host.roomCode, "Fallback", "PLAYER");
        server = http.createServer();
        const wss = attachWebSocketServer(server, service, { hostDisconnectGraceMs: 20 });
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as { port: number }).port;
        const hostClient = await hello(port, host.roomCode, host.participantCredential, host.role);
        const playerClient = await hello(
            port,
            player.roomCode,
            player.participantCredential,
            player.role,
        );

        hostClient.socket.terminate();
        await waitFor(
            () =>
                playerClient.messages.some(
                    (message) =>
                        message.type === "room.roleChanged" && message.payload.role === "HOST",
                ),
            () => JSON.stringify(playerClient.messages),
        );
        expect(
            playerClient.messages.find((message) => message.type === "room.participantLeft")
                ?.payload,
        ).toEqual({
            participantId: host.participantId,
            displayName: "Host",
            reason: "DISCONNECT_EXPIRED",
        });
        expect(
            repository.participants.filter(
                ({ role, connectionStatus }) => role === "HOST" && connectionStatus !== "LEFT",
            ),
        ).toHaveLength(1);
        expect(repository.participants.find(({ id }) => id === player.participantId)?.role).toBe(
            "HOST",
        );

        playerClient.socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    });

    it("keeps a connected display open and promotes the next joining player", async () => {
        const repository = new Repo();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const host = await service.createRoom("Host");
        const display = await service.joinRoom(host.roomCode, "Screen", "DISPLAY");
        server = http.createServer();
        const wss = attachWebSocketServer(server, service, { hostDisconnectGraceMs: 20 });
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as { port: number }).port;
        const hostClient = await hello(port, host.roomCode, host.participantCredential, host.role);
        const displayClient = await hello(
            port,
            display.roomCode,
            display.participantCredential,
            display.role,
        );

        hostClient.socket.terminate();
        await waitFor(() =>
            displayClient.messages.some(
                (message) =>
                    message.type === "room.participantLeft" &&
                    message.payload.participantId === host.participantId,
            ),
        );
        expect(displayClient.socket.readyState).toBe(WebSocket.OPEN);

        const joiningPlayer = await service.joinRoom(host.roomCode, "New host", "PLAYER");
        const playerClient = await hello(
            port,
            joiningPlayer.roomCode,
            joiningPlayer.participantCredential,
            joiningPlayer.role,
        );
        await waitFor(() =>
            playerClient.messages.some(
                (message) => message.type === "server.hello" && message.payload.role === "HOST",
            ),
        );

        displayClient.socket.terminate();
        playerClient.socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    });

    it("expires participants left connected by a server restart", async () => {
        const repository = new Repo();
        const creatingService = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const host = await creatingService.createRoom("Host");
        await repository.setConnectionStatus(host.participantId, "CONNECTED");

        const restartedService = new RoomService(repository, cards, new SequenceRandomSource([0]));
        server = http.createServer();
        const wss = attachWebSocketServer(server, restartedService, {
            hostDisconnectGraceMs: 20,
        });
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        await wss.roomLifecycleReady;

        await waitFor(
            () =>
                repository.participants.find(({ id }) => id === host.participantId)
                    ?.connectionStatus === "LEFT",
        );
        await expect(
            restartedService.authenticate(host.roomCode, host.participantCredential),
        ).resolves.toBeNull();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    });

    it("transfers real host authorization between two connected clients", async () => {
        const repository = new Repo();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const host = await service.createRoom("Old host");
        const player = await service.joinRoom(host.roomCode, "New host", "PLAYER");
        server = http.createServer();
        const wss = attachWebSocketServer(server, service);
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as { port: number }).port;
        const oldHost = await hello(port, host.roomCode, host.participantCredential, host.role);
        const newHost = await hello(
            port,
            player.roomCode,
            player.participantCredential,
            player.role,
        );
        oldHost.socket.send(
            JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type: "command.transferHost",
                requestId: "transfer",
                revision: null,
                payload: { participantId: player.participantId },
            }),
        );
        await waitFor(
            () =>
                oldHost.messages.some(
                    (message) =>
                        message.type === "room.roleChanged" && message.payload.role === "PLAYER",
                ) &&
                newHost.messages.some(
                    (message) =>
                        message.type === "room.roleChanged" && message.payload.role === "HOST",
                ),
        );
        const start = (requestId: string) =>
            JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type: "command.startSession",
                requestId,
                revision: null,
                payload: {},
            });
        oldHost.socket.send(start("old-host-start"));
        await waitFor(() =>
            oldHost.messages.some(
                (message) =>
                    message.requestId === "old-host-start" &&
                    message.type === "error" &&
                    message.payload.code === "NOT_AUTHORIZED",
            ),
        );
        newHost.socket.send(start("new-host-start"));
        await waitFor(() =>
            newHost.messages.some(
                (message) =>
                    message.type === "room.snapshot" && message.payload.session?.revision === 0,
            ),
        );
        expect(
            newHost.messages.filter((message) => message.type === "room.snapshot").at(-1)?.payload
                .hostStatus.participantId,
        ).toBe(player.participantId);
        oldHost.socket.terminate();
        newHost.socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    });

    it("broadcasts authoritative settings and preserves transferred Host identity on reload", async () => {
        const repository = new Repo();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const host = await service.createRoom("Original host");
        const player = await service.joinRoom(host.roomCode, "Transferred host", "PLAYER");
        server = http.createServer();
        const wss = attachWebSocketServer(server, service, { hostDisconnectGraceMs: 500 });
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as { port: number }).port;
        const oldHost = await hello(port, host.roomCode, host.participantCredential, host.role);
        const futureHost = await hello(
            port,
            player.roomCode,
            player.participantCredential,
            player.role,
        );
        const settings = {
            ...defaultRoomGameSettings(),
            profileId: "PROFILE_CUSTOM",
            configuration: {
                ...defaultRoomGameSettings().configuration,
                startingIntensity: 2,
                maximumIntensity: 2,
                intensityProgressionUnit: "CARDS",
                intensityProgressionInterval: 3,
                enabledDareTypeIds: [],
            },
        };
        oldHost.socket.send(
            JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type: "command.updateRoomSettings",
                requestId: "settings",
                revision: null,
                payload: { expectedRevision: 0, settings },
            }),
        );
        await waitFor(() =>
            [oldHost, futureHost].every((client) =>
                client.messages.some(
                    (message) =>
                        message.type === "room.snapshot" &&
                        message.payload.settings.revision === 1 &&
                        message.payload.settings.configuration.maximumIntensity === 2 &&
                        message.payload.settings.configuration.intensityProgressionUnit === "CARDS",
                ),
            ),
        );
        expect(
            JSON.stringify(
                futureHost.messages.findLast((message) => message.type === "room.snapshot").payload
                    .settings,
            ),
        ).not.toContain("disabledDareTypeIds");

        oldHost.socket.send(
            JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type: "command.transferHost",
                requestId: "transfer-settings-host",
                revision: null,
                payload: { participantId: player.participantId },
            }),
        );
        await waitFor(() =>
            futureHost.messages.some(
                (message) => message.type === "room.roleChanged" && message.payload.role === "HOST",
            ),
        );
        futureHost.socket.terminate();
        const reloadedHost = await hello(
            port,
            player.roomCode,
            player.participantCredential,
            "PLAYER",
        );
        expect(reloadedHost.messages[0].payload).toMatchObject({
            participantId: player.participantId,
            role: "HOST",
        });
        expect(repository.participants).toHaveLength(2);

        const changedAgain = {
            ...settings,
            configuration: { ...settings.configuration, maximumIntensity: 4 },
        };
        oldHost.socket.send(
            JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type: "command.updateRoomSettings",
                requestId: "old-host-settings",
                revision: null,
                payload: { expectedRevision: 1, settings: changedAgain },
            }),
        );
        await waitFor(() =>
            oldHost.messages.some(
                (message) =>
                    message.requestId === "old-host-settings" &&
                    message.type === "error" &&
                    message.payload.code === "NOT_AUTHORIZED",
            ),
        );
        reloadedHost.socket.send(
            JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type: "command.updateRoomSettings",
                requestId: "new-host-settings",
                revision: null,
                payload: { expectedRevision: 1, settings: changedAgain },
            }),
        );
        await waitFor(() =>
            oldHost.messages.some(
                (message) =>
                    message.type === "room.snapshot" && message.payload.settings.revision === 2,
            ),
        );
        oldHost.socket.terminate();
        reloadedHost.socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    });

    it("does not grant Host to a joiner while the Host is inside reconnect grace", async () => {
        const repository = new Repo();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const host = await service.createRoom("Host");
        server = http.createServer();
        const wss = attachWebSocketServer(server, service, { hostDisconnectGraceMs: 500 });
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as { port: number }).port;
        const hostClient = await hello(port, host.roomCode, host.participantCredential, host.role);
        hostClient.socket.terminate();
        await waitFor(
            () =>
                repository.participants.find(({ id }) => id === host.participantId)
                    ?.connectionStatus === "TEMPORARILY_DISCONNECTED",
        );
        const joiner = await service.joinRoom(host.roomCode, "Joiner", "PLAYER");
        const joinerClient = await hello(
            port,
            joiner.roomCode,
            joiner.participantCredential,
            joiner.role,
        );
        expect(joinerClient.messages[0].payload.role).toBe("PLAYER");
        expect(repository.participants.find(({ id }) => id === host.participantId)?.role).toBe(
            "HOST",
        );
        const reloadedHost = await hello(
            port,
            host.roomCode,
            host.participantCredential,
            host.role,
        );
        expect(reloadedHost.messages[0].payload).toMatchObject({
            participantId: host.participantId,
            role: "HOST",
        });
        expect(repository.participants).toHaveLength(2);
        joinerClient.socket.terminate();
        reloadedHost.socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    });

    it("removes an intentional leaver and rejects the cleared reconnect identity", async () => {
        const repository = new Repo();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const host = await service.createRoom("Host");
        const player = await service.joinRoom(host.roomCode, "Leaving player", "PLAYER");
        server = http.createServer();
        const wss = attachWebSocketServer(server, service);
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as { port: number }).port;
        const hostClient = await hello(port, host.roomCode, host.participantCredential, host.role);
        const playerClient = await hello(
            port,
            player.roomCode,
            player.participantCredential,
            player.role,
        );
        playerClient.socket.send(
            JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type: "command.leaveRoom",
                requestId: "leave",
                revision: null,
                payload: {},
            }),
        );
        await waitFor(() =>
            hostClient.messages.some(
                (message) =>
                    message.type === "room.snapshot" &&
                    !message.payload.participants.some(
                        ({ id }: { id: string }) => id === player.participantId,
                    ),
            ),
        );
        expect(
            hostClient.messages.find((message) => message.type === "room.participantLeft")?.payload,
        ).toEqual({
            participantId: player.participantId,
            displayName: "Leaving player",
            reason: "LEFT",
        });
        expect(
            repository.participants.find(({ id }) => id === player.participantId)?.connectionStatus,
        ).toBe("LEFT");
        expect(
            await service.authenticate(player.roomCode, player.participantCredential),
        ).toBeNull();
        hostClient.socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    });

    it("redraws for the next player instead of transferring a departed player's Card", async () => {
        const repository = new Repo();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const host = await service.createRoom("Host");
        const player = await service.joinRoom(host.roomCode, "Next player", "PLAYER");
        server = http.createServer();
        const wss = attachWebSocketServer(server, service);
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as { port: number }).port;
        const hostClient = await hello(port, host.roomCode, host.participantCredential, host.role);
        const playerClient = await hello(
            port,
            player.roomCode,
            player.participantCredential,
            player.role,
        );
        hostClient.socket.send(
            JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type: "command.startSession",
                requestId: "start-before-active-leave",
                revision: null,
                payload: {},
            }),
        );
        await waitFor(() => repository.runtime?.state === "CHOOSING_CARD_TYPE");
        hostClient.socket.send(
            JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type: "command.chooseCardType",
                requestId: "show-before-active-leave",
                revision: repository.runtime!.revision,
                payload: { cardType: "QUESTION" },
            }),
        );
        await waitFor(() => repository.runtime?.currentCard !== null);
        hostClient.socket.send(
            JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type: "command.leaveRoom",
                requestId: "active-player-leaves",
                revision: repository.runtime!.revision,
                payload: {},
            }),
        );
        await waitFor(
            () =>
                repository.runtime?.activePlayerIndex === 0 &&
                repository.runtime.currentCard === null &&
                repository.runtime.state === "CHOOSING_CARD_TYPE",
        );
        await waitFor(() =>
            playerClient.messages.some(
                (message) =>
                    message.type === "room.snapshot" &&
                    message.payload.session?.activePlayer?.id === player.participantId &&
                    message.payload.session.currentCard === null &&
                    message.payload.session.state === "CHOOSING_CARD_TYPE",
            ),
        );
        expect(repository.runtime).toMatchObject({
            currentCard: null,
            state: "CHOOSING_CARD_TYPE",
        });
        playerClient.socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    });

    it("adds a participant who connects mid-game to the authoritative Session", async () => {
        const repository = new Repo();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const host = await service.createRoom("Host");
        const first = await service.joinRoom(host.roomCode, "First", "PLAYER");
        server = http.createServer();
        const wss = attachWebSocketServer(server, service);
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as { port: number }).port;
        const hostClient = await hello(port, host.roomCode, host.participantCredential, host.role);
        const firstClient = await hello(
            port,
            first.roomCode,
            first.participantCredential,
            first.role,
        );
        hostClient.socket.send(
            JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type: "command.startSession",
                requestId: "start-mid-join",
                revision: null,
                payload: {},
            }),
        );
        await waitFor(() => repository.runtime?.players.length === 2);
        firstClient.socket.send(
            JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type: "command.leaveRoom",
                requestId: "leave-before-replacement",
                revision: repository.runtime!.revision,
                payload: {},
            }),
        );
        await waitFor(() => repository.runtime?.players.length === 1);

        const late = await service.joinRoom(host.roomCode, "Late", "PLAYER");
        const lateClient = await hello(port, late.roomCode, late.participantCredential, late.role);
        expect(repository.runtime?.players).toHaveLength(1);
        lateClient.socket.send(
            JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type: "command.setBoundaries",
                requestId: "enroll-late",
                revision: null,
                payload: {
                    disabledQuestionCategoryIds: [],
                    disabledDareTypeIds: ["DARE_NUDITY"],
                    blockedOperationalFlags: [],
                },
            }),
        );
        await waitFor(() =>
            [hostClient, lateClient].every((client) =>
                client.messages.some(
                    (message) =>
                        message.type === "room.snapshot" &&
                        message.payload.session?.players.length === 2 &&
                        message.payload.session.players.some(
                            ({ id }: { id: string }) => id === late.participantId,
                        ),
                ),
            ),
        );
        expect(repository.runtime?.players.map(({ name }) => name)).toEqual(["Host", "Late"]);
        expect(repository.runtime?.startedAt).toEqual(expect.any(Number));
        hostClient.socket.terminate();
        lateClient.socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    });

    it.each([
        ["command.skipCard", "SKIPPED", "HOST", false],
        ["command.vetoCard", "VETOED", "PLAYER", false],
        ["command.skipCard", "SKIPPED", "HOST", true],
        ["command.vetoCard", "VETOED", "PLAYER", true],
    ] as const)(
        "broadcasts the committed %s Card replacement before its fresh snapshot",
        async (commandType, reason, actorRole, exhausted) => {
            const repository = new Repo();
            const neverCards: CardRepository = {
                ...cards,
                ...testCatalogAccess,
                listActive: async () =>
                    [
                        card({
                            id: "replacement-a" as never,
                            yesNoAnswerPossible: true,
                        }),
                        card({
                            id: "replacement-b" as never,
                            yesNoAnswerPossible: true,
                        }),
                    ].slice(0, exhausted ? 1 : 2),
            };
            const service = new RoomService(
                repository,
                neverCards,
                new SequenceRandomSource([0, 0]),
            );
            const host = await service.createRoom("Host", null, {
                ...defaultRoomGameSettings(),
                mode: "NEVER_HAVE_I_EVER",
            });
            const player = await service.joinRoom(host.roomCode, "Player", "PLAYER");
            const display = await service.joinRoom(host.roomCode, "Display", "DISPLAY");
            server = http.createServer();
            const wss = attachWebSocketServer(server, service);
            await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
            const port = (server.address() as { port: number }).port;
            const clients = await Promise.all(
                [host, player, display].map((participant) =>
                    hello(
                        port,
                        participant.roomCode,
                        participant.participantCredential,
                        participant.role,
                    ),
                ),
            );
            const send = (
                client: (typeof clients)[number],
                type: string,
                revision: number | null,
            ) =>
                client.socket.send(
                    JSON.stringify({
                        protocol: PROTOCOL_VERSION,
                        type,
                        requestId: type,
                        revision,
                        payload: {},
                    }),
                );

            send(clients[0], "command.startSession", null);
            await waitFor(() => repository.runtime?.revision === 0);
            send(clients[0], "command.startTurn", 0);
            await waitFor(() => repository.runtime?.revision === 1);
            const firstCardId = repository.runtime?.currentCard?.id;
            clients[0].socket.send(
                JSON.stringify({
                    protocol: PROTOCOL_VERSION,
                    type: "command.submitVote",
                    requestId: "partial-before-refusal",
                    revision: 1,
                    payload: { vote: "YES" },
                }),
            );
            await waitFor(() => repository.runtime?.revision === 2);
            const actor = actorRole === "HOST" ? clients[0] : clients[1];
            send(actor, commandType, 2);
            await waitFor(() => repository.runtime?.currentCard?.id !== firstCardId);
            expect(repository.runtime?.sessionHistory[0]).toMatchObject({
                skipped: commandType === "command.skipCard",
                completed: false,
                vetoed: commandType === "command.vetoCard",
            });
            if (exhausted) {
                await waitFor(() =>
                    clients.every((client) =>
                        client.messages.some(
                            (message) =>
                                message.type === "room.snapshot" &&
                                message.payload.session?.revision === 3,
                        ),
                    ),
                );
                for (const client of clients) {
                    const final = client.messages.find(
                        (message) =>
                            message.type === "room.snapshot" &&
                            message.payload.session?.revision === 3,
                    );
                    expect(final.payload.session.currentCard).toBeNull();
                    expect(final.payload.session.state).toBe("WAITING_FOR_PLAYER");
                    expectHiddenVotingAnswers(final);
                    expect(
                        client.messages.some((message) => message.type === "session.cardReplaced"),
                    ).toBe(false);
                }
                for (const client of clients) client.socket.terminate();
                await new Promise<void>((resolve) => wss.close(() => resolve()));
                return;
            }
            await waitFor(() =>
                clients.every((client) =>
                    client.messages.some(
                        (message) =>
                            message.type === "session.cardReplaced" &&
                            message.payload.reason === reason,
                    ),
                ),
            );
            // Broadcasts yield to I/O between recipients. Receiving the replacement
            // event does not imply that each following snapshot has arrived yet.
            await waitFor(() =>
                clients.every((client) =>
                    client.messages.some(
                        (message) =>
                            message.type === "room.snapshot" &&
                            message.payload.session?.revision === 3,
                    ),
                ),
            );
            for (const client of clients) {
                const eventIndex = client.messages.findIndex(
                    (message) => message.type === "session.cardReplaced",
                );
                const changedSnapshotIndex = client.messages.findIndex(
                    (message, index) =>
                        index > eventIndex &&
                        message.type === "room.snapshot" &&
                        message.payload.session?.currentCard?.id !== firstCardId,
                );
                expect(eventIndex).toBeGreaterThanOrEqual(0);
                expect(changedSnapshotIndex).toBeGreaterThan(eventIndex);
            }
            for (const client of clients) client.socket.terminate();
            await new Promise<void>((resolve) => wss.close(() => resolve()));
        },
    );

    it.each(["ANONYMOUS_AGGREGATE", "NAMED_ANSWERS"] as const)(
        "protects full HOST/PLAYER/DISPLAY envelopes in %s",
        async (revealMode) => {
            const repository = new Repo();
            const neverCards: CardRepository = {
                ...cards,
                ...testCatalogAccess,
                listActive: async () => [
                    card({
                        id: "e58090b4-2868-4bc8-8337-8d12c1c33ae4" as never,
                        yesNoAnswerPossible: true,
                    }),
                ],
            };
            const service = new RoomService(repository, neverCards, new SequenceRandomSource([0]));
            const host = await service.createRoom("Host", null, {
                ...defaultRoomGameSettings(),
                mode: "NEVER_HAVE_I_EVER",
                neverHaveIEverRevealMode: revealMode,
            });
            const player = await service.joinRoom(host.roomCode, "Player", "PLAYER");
            const otherPlayer = await service.joinRoom(host.roomCode, "Other", "PLAYER");
            const display = await service.joinRoom(host.roomCode, "Display", "DISPLAY");
            server = http.createServer();
            const wss = attachWebSocketServer(server, service);
            await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
            const port = (server.address() as { port: number }).port;
            const hostClient = await hello(
                port,
                host.roomCode,
                host.participantCredential,
                host.role,
            );
            const playerClient = await hello(
                port,
                player.roomCode,
                player.participantCredential,
                player.role,
            );
            const displayClient = await hello(
                port,
                display.roomCode,
                display.participantCredential,
                display.role,
            );
            const otherClient = await hello(
                port,
                otherPlayer.roomCode,
                otherPlayer.participantCredential,
                otherPlayer.role,
            );
            const clients = [hostClient, playerClient, otherClient, displayClient];
            const send = sendRoomCommand;
            hostClient.socket.send(
                JSON.stringify({
                    protocol: PROTOCOL_VERSION,
                    type: "command.startSession",
                    requestId: "named-start",
                    revision: null,
                    payload: {},
                }),
            );
            await waitFor(() => repository.runtime?.revision === 0);
            send(hostClient, "command.startTurn", 0);
            await waitFor(() => repository.runtime?.revision === 1);
            await waitFor(() =>
                clients.every(
                    (client) =>
                        client.messages.findLast((message) => message.type === "room.snapshot")
                            ?.payload.session?.revision === 1,
                ),
            );
            for (const client of clients) {
                expectHiddenVotingAnswers(
                    client.messages.findLast((message) => message.type === "room.snapshot"),
                );
            }
            send(hostClient, "command.submitVote", 1, {
                playerId: host.participantId,
                vote: "YES",
            });
            await waitFor(() => repository.runtime?.revision === 2);
            await waitFor(() =>
                clients.every((client) => {
                    const snapshot = client.messages.findLast(
                        (message) => message.type === "room.snapshot",
                    );
                    return (
                        snapshot?.payload.session?.neverHaveIEverVoting?.progress?.[0]?.status ===
                        "VOTED"
                    );
                }),
            );
            for (const client of clients) {
                const snapshot = client.messages.findLast(
                    (message) => message.type === "room.snapshot",
                );
                expect(snapshot.payload.session.neverHaveIEverVoting.result).toBeNull();
                expectHiddenVotingAnswers(snapshot);
            }

            send(playerClient, "command.submitVote", 2, {
                playerId: player.participantId,
                vote: "NO",
            });
            await waitFor(() =>
                clients.every(
                    (client) =>
                        client.messages.findLast((message) => message.type === "room.snapshot")
                            ?.payload.session?.revision === 3,
                ),
            );
            for (const client of clients) {
                expectHiddenVotingAnswers(
                    client.messages.findLast((message) => message.type === "room.snapshot"),
                );
            }
            send(otherClient, "command.submitVote", 3, {
                playerId: otherPlayer.participantId,
                vote: "YES",
            });
            await waitFor(() =>
                clients.every((client) => {
                    const snapshot = client.messages.findLast(
                        (message) => message.type === "room.snapshot",
                    );
                    return snapshot?.payload.session?.state === "SHOWING_RESULTS";
                }),
            );
            for (const client of clients) {
                const snapshot = client.messages.findLast(
                    (message) => message.type === "room.snapshot",
                );
                expect(snapshot.payload.session.voteResult).toEqual({ yes: 2, no: 1, total: 3 });
                if (revealMode === "NAMED_ANSWERS") {
                    expect(
                        snapshot.payload.session.neverHaveIEverVoting.result.namedAnswers,
                    ).toEqual([
                        { playerId: host.participantId, displayName: "Host", vote: "YES" },
                        { playerId: player.participantId, displayName: "Player", vote: "NO" },
                        { playerId: otherPlayer.participantId, displayName: "Other", vote: "YES" },
                    ]);
                } else {
                    expect(JSON.stringify(snapshot)).not.toMatch(
                        /"(?:YES|NO)"|"(?:vote|votes|namedAnswers)"\s*:/,
                    );
                }
            }
            for (const [index, action] of [
                "command.advanceSession",
                "command.endSession",
            ].entries()) {
                send(hostClient, action, 4 + index);
                await waitFor(() =>
                    clients.every(
                        (client) =>
                            client.messages.findLast((message) => message.type === "room.snapshot")
                                ?.payload.session?.revision ===
                            5 + index,
                    ),
                );
                for (const client of clients)
                    expectHiddenVotingAnswers(
                        client.messages.findLast((message) => message.type === "room.snapshot"),
                    );
            }
            for (const client of clients) client.socket.terminate();
            await new Promise<void>((resolve) => wss.close(() => resolve()));
        },
    );

    it("rejects a stale Never Have I Ever result Skip without an internal-server message", async () => {
        const repository = new Repo();
        const neverCards: CardRepository = {
            ...cards,
            ...testCatalogAccess,
            listActive: async () => [card({ id: "never-ws" as never, yesNoAnswerPossible: true })],
        };
        const service = new RoomService(repository, neverCards, new SequenceRandomSource([0]));
        const host = await service.createRoom("Host", null, {
            ...defaultRoomGameSettings(),
            mode: "NEVER_HAVE_I_EVER",
        });
        const player = await service.joinRoom(host.roomCode, "Player", "PLAYER");
        server = http.createServer();
        const wss = attachWebSocketServer(server, service);
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as { port: number }).port;
        const hostClient = await hello(port, host.roomCode, host.participantCredential, host.role);
        const playerClient = await hello(
            port,
            player.roomCode,
            player.participantCredential,
            player.role,
        );
        const send = sendRoomCommand;
        hostClient.socket.send(
            JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type: "command.startSession",
                requestId: "never-start",
                revision: null,
                payload: {},
            }),
        );
        await waitFor(() => repository.runtime?.revision === 0);
        send(hostClient, "command.startTurn", 0);
        await waitFor(() => repository.runtime?.revision === 1);
        send(hostClient, "command.submitVote", 1, {
            playerId: host.participantId,
            vote: "YES",
        });
        await waitFor(() => repository.runtime?.revision === 2);
        send(playerClient, "command.submitVote", 2, {
            playerId: player.participantId,
            vote: "NO",
        });
        await waitFor(() => repository.runtime?.state === "SHOWING_RESULTS");
        await waitFor(() =>
            hostClient.messages.some(
                (message) =>
                    message.type === "room.snapshot" &&
                    message.payload.session?.state === "SHOWING_RESULTS",
            ),
        );
        const hostResult = hostClient.messages.findLast(
            (message) =>
                message.type === "room.snapshot" &&
                message.payload.session?.state === "SHOWING_RESULTS",
        ).payload.session;
        expect(hostResult.availableActions).not.toContain("SKIP_CARD");
        send(hostClient, "command.skipCard", repository.runtime!.revision);
        await waitFor(() =>
            hostClient.messages.some(
                (message) => message.requestId === "command.skipCard" && message.type === "error",
            ),
        );
        const rejected = hostClient.messages.find(
            (message) => message.requestId === "command.skipCard" && message.type === "error",
        );
        expect(rejected.payload).toMatchObject({ code: "INVALID_GAME_STATE" });
        expect(rejected.payload.message.toLowerCase()).not.toContain("internal server");
        hostClient.socket.terminate();
        playerClient.socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    });

    it("closes every socket and invalidates every reconnect identity when the Host closes the Room", async () => {
        const repository = new Repo();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const host = await service.createRoom("Host");
        const player = await service.joinRoom(host.roomCode, "Player", "PLAYER");
        const display = await service.joinRoom(host.roomCode, "Display", "DISPLAY");
        server = http.createServer();
        const wss = attachWebSocketServer(server, service);
        await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
        const port = (server.address() as { port: number }).port;
        const clients = await Promise.all(
            [host, player, display].map((participant) =>
                hello(
                    port,
                    participant.roomCode,
                    participant.participantCredential,
                    participant.role,
                ),
            ),
        );
        clients[0].socket.send(
            JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type: "command.startSession",
                requestId: "start-before-close",
                revision: null,
                payload: {},
            }),
        );
        await waitFor(() => repository.runtime?.state === "CHOOSING_CARD_TYPE");
        const closed = clients.map(
            ({ socket }) =>
                new Promise<number>((resolve) => socket.once("close", (code) => resolve(code))),
        );
        clients[0].socket.send(
            JSON.stringify({
                protocol: PROTOCOL_VERSION,
                type: "command.closeRoom",
                requestId: "close-room",
                revision: repository.runtime!.revision,
                payload: {},
            }),
        );

        await expect(Promise.all(closed)).resolves.toEqual([4001, 4001, 4001]);
        expect(repository.runtime?.state).toBe("ENDED");
        expect(repository.room.closedAt).toEqual(expect.any(Number));
        expect(
            repository.participants.every(({ connectionStatus }) => connectionStatus === "LEFT"),
        ).toBe(true);
        expect(await service.authenticate(host.roomCode, host.participantCredential)).toBeNull();
        expect(
            await service.authenticate(player.roomCode, player.participantCredential),
        ).toBeNull();
        expect(
            await service.authenticate(display.roomCode, display.participantCredential),
        ).toBeNull();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    });
});
async function hello(port: number, roomCode: string, credential: string, role: string) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: any[] = [];
    socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
    });
    socket.send(
        JSON.stringify({
            protocol: PROTOCOL_VERSION,
            type: "client.hello",
            requestId: "hello",
            revision: null,
            payload: {
                supportedProtocolVersions: [PROTOCOL_VERSION],
                applicationVersion: "test",
                role,
                capabilities: [],
                roomCode,
                participantCredential: credential,
            },
        }),
    );
    await waitFor(() => messages.some((message) => message.type === "server.hello"));
    return { socket, messages };
}
async function waitFor(predicate: () => boolean, details: () => string = () => "") {
    const limit = Date.now() + 3000;
    while (!predicate()) {
        if (Date.now() > limit) throw new Error(`timed out ${details()}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

function sendRoomCommand(
    client: { socket: WebSocket },
    type: string,
    revision: number,
    payload = {},
): void {
    client.socket.send(
        JSON.stringify({
            protocol: PROTOCOL_VERSION,
            type,
            requestId: type,
            revision,
            payload,
        }),
    );
}
