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
}
const cards: CardRepository = {
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
        expect(repository.participants.filter(({ role }) => role === "HOST")).toHaveLength(1);
        expect(repository.participants.find(({ id }) => id === player.participantId)?.role).toBe(
            "HOST",
        );

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
                maximumIntensity: 2,
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
                        message.payload.settings.configuration.maximumIntensity === 2,
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
            repository.participants.find(({ id }) => id === player.participantId)?.connectionStatus,
        ).toBe("LEFT");
        expect(
            await service.authenticate(player.roomCode, player.participantCredential),
        ).toBeNull();
        hostClient.socket.terminate();
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
