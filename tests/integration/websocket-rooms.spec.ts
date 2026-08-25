import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { attachWebSocketServer } from "../../src/modules/websocket";
import { RoomService } from "../../src/packages/application/roomService";
import {
    SequenceRandomSource,
    type GameSessionRuntimeState,
    type PlayerBoundaries,
} from "../../src/packages/game-core";
import type {
    RealtimeRoomRepository,
    RoomParticipant,
} from "../../src/packages/application/realtimeRooms";
import type { CardRepository } from "../../src/packages/application/repositories";
import { card } from "../support/game";
import {
    defaultRoomGameSettings,
    type RoomGameSettings,
    type VersionedRoomGameSettings,
} from "../../src/packages/application/roomGameSettings";
import { PROTOCOL_VERSION } from "../../src/packages/protocol";

class Repo implements RealtimeRoomRepository {
    room!: { id: string; code: string };
    participants: Array<RoomParticipant & { credentialHash: string }> = [];
    runtime: GameSessionRuntimeState | null = null;
    boundaries = new Map<string, PlayerBoundaries>();
    settings!: VersionedRoomGameSettings;
    async roomCodeExists() {
        return false;
    }
    async createRoom(i: Parameters<RealtimeRoomRepository["createRoom"]>[0]) {
        this.room = { id: i.roomId, code: i.code };
        this.participants.push(i.participant);
        this.settings = {
            ...i.settings,
            revision: 0,
            updatedByParticipantId: i.participant.id,
        };
    }
    async joinRoom(i: Parameters<RealtimeRoomRepository["joinRoom"]>[0]) {
        this.participants.push({ ...i, roomId: this.room.id });
    }
    async authenticate(code: string, hash: string) {
        const p = this.participants.find(
            (x) => code === this.room.code && x.credentialHash === hash,
        );
        return p && p.connectionStatus !== "LEFT"
            ? {
                  id: p.id,
                  roomId: p.roomId,
                  role: p.role,
                  displayName: p.displayName,
                  devicePlayers: p.devicePlayers,
                  connectionStatus: p.connectionStatus,
              }
            : null;
    }
    async listParticipants(roomId: string) {
        return this.participants
            .filter(({ connectionStatus }) => connectionStatus !== "LEFT")
            .map(({ id, role, displayName, devicePlayers, connectionStatus }) => ({
                id,
                roomId,
                role,
                displayName,
                devicePlayers,
                connectionStatus,
            }));
    }
    async getParticipant(roomId: string, participantId: string) {
        return (await this.listParticipants(roomId)).find(({ id }) => id === participantId) ?? null;
    }
    async setConnectionStatus(
        participantId: string,
        connectionStatus: RoomParticipant["connectionStatus"],
    ) {
        this.participants.find(({ id }) => id === participantId)!.connectionStatus =
            connectionStatus;
    }
    async resetConnectedParticipants() {
        const reset: RoomParticipant[] = [];
        for (const participant of this.participants)
            if (participant.connectionStatus === "CONNECTED") {
                participant.connectionStatus = "TEMPORARILY_DISCONNECTED";
                reset.push({ ...participant });
            }
        return reset;
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
    async selectGroup() {
        return new Set<never>();
    }
    async loadRuntime() {
        return this.runtime;
    }
    async commitRuntime(_id: string, previous: number | null, runtime: GameSessionRuntimeState) {
        if ((this.runtime?.revision ?? null) !== previous)
            throw Object.assign(new Error("stale"), { code: "STALE_SESSION_REVISION" });
        this.runtime = runtime;
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
    async listActive() {
        return [card({ id: "ws-question" as never })];
    },
    async getById() {
        return null;
    },
    async findEligibleCandidates() {
        return [];
    },
};
let server: http.Server | undefined;
afterEach(() => new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve()));

describe("Room WebSocket protocol", () => {
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
        socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    });

    it("rejects retired protocol versions with the stable negotiation error", async () => {
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
                protocol: 1,
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
        socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    });

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
        const clients = [hostClient, staleHostTab, playerClient, displayClient];
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

        send(hostClient, "command.startSession", "start-first", null);
        await waitFor(() =>
            clients.every((client) =>
                client.messages.some(
                    (message) =>
                        message.type === "room.snapshot" && message.payload.session?.revision === 0,
                ),
            ),
        );
        const firstSessionId = repository.runtime!.id;
        send(hostClient, "command.endSession", "end-first", 0);
        await waitFor(() =>
            clients.every(
                (client) =>
                    client.messages.findLast((message) => message.type === "room.snapshot").payload
                        .session?.state === "ENDED",
            ),
        );
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

        send(hostClient, "command.resetSession", "new-game", 1);
        await waitFor(() =>
            clients.every(
                (client) =>
                    client.messages.findLast((message) => message.type === "room.snapshot").payload
                        .session === null,
            ),
        );
        expect(repository.participants).toHaveLength(3);
        send(hostClient, "command.startSession", "start-second", null);
        await waitFor(
            () => repository.runtime !== null && repository.runtime.id !== firstSessionId,
        );
        expect(repository.participants).toHaveLength(3);

        for (const client of clients) client.socket.terminate();
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
        expect(repository.participants.filter(({ role }) => role === "HOST")).toHaveLength(1);
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
        ["command.skipCard", "SKIPPED", "HOST"],
        ["command.vetoCard", "VETOED", "PLAYER"],
    ] as const)(
        "broadcasts the committed %s Card replacement before its fresh snapshot",
        async (commandType, reason, actorRole) => {
            const repository = new Repo();
            const neverCards: CardRepository = {
                ...cards,
                listActive: async () => [
                    card({
                        id: "replacement-a" as never,
                        yesNoAnswerPossible: true,
                    }),
                    card({
                        id: "replacement-b" as never,
                        yesNoAnswerPossible: true,
                    }),
                ],
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
            const actor = actorRole === "HOST" ? clients[0] : clients[1];
            send(actor, commandType, 1);
            await waitFor(() => repository.runtime?.currentCard?.id !== firstCardId);
            expect(repository.runtime?.sessionHistory[0]).toMatchObject({
                skipped: commandType === "command.skipCard",
                completed: false,
                vetoed: commandType === "command.vetoCard",
            });
            await waitFor(() =>
                clients.every((client) =>
                    client.messages.some(
                        (message) =>
                            message.type === "session.cardReplaced" &&
                            message.payload.reason === reason,
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

    it("keeps named Never Have I Ever answers private until every voter completes", async () => {
        const repository = new Repo();
        const neverCards: CardRepository = {
            ...cards,
            listActive: async () => [
                card({ id: "named-never-ws" as never, yesNoAnswerPossible: true }),
            ],
        };
        const service = new RoomService(repository, neverCards, new SequenceRandomSource([0]));
        const host = await service.createRoom("Host", null, {
            ...defaultRoomGameSettings(),
            mode: "NEVER_HAVE_I_EVER",
            neverHaveIEverRevealMode: "NAMED_ANSWERS",
        });
        const player = await service.joinRoom(host.roomCode, "Player", "PLAYER");
        const display = await service.joinRoom(host.roomCode, "Display", "DISPLAY");
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
        const displayClient = await hello(
            port,
            display.roomCode,
            display.participantCredential,
            display.role,
        );
        const clients = [hostClient, playerClient, displayClient];
        const send = (client: typeof hostClient, type: string, revision: number, payload = {}) =>
            client.socket.send(
                JSON.stringify({
                    protocol: PROTOCOL_VERSION,
                    type,
                    requestId: type,
                    revision,
                    payload,
                }),
            );
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
            const voting = client.messages.findLast((message) => message.type === "room.snapshot")
                .payload.session.neverHaveIEverVoting;
            expect(voting.result).toBeNull();
            expect(JSON.stringify(voting)).not.toContain('"YES"');
        }

        send(playerClient, "command.submitVote", 2, {
            playerId: player.participantId,
            vote: "NO",
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
            expect(
                client.messages.findLast((message) => message.type === "room.snapshot").payload
                    .session.neverHaveIEverVoting.result.namedAnswers,
            ).toEqual([
                { playerId: host.participantId, displayName: "Host", vote: "YES" },
                { playerId: player.participantId, displayName: "Player", vote: "NO" },
            ]);
        }
        for (const client of clients) client.socket.terminate();
        await new Promise<void>((resolve) => wss.close(() => resolve()));
    });

    it("rejects a stale Never Have I Ever result Skip without an internal-server message", async () => {
        const repository = new Repo();
        const neverCards: CardRepository = {
            ...cards,
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
        const send = (client: typeof hostClient, type: string, revision: number, payload = {}) =>
            client.socket.send(
                JSON.stringify({
                    protocol: PROTOCOL_VERSION,
                    type,
                    requestId: type,
                    revision,
                    payload,
                }),
            );
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
