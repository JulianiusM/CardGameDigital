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

class Repo implements RealtimeRoomRepository {
    room!: { id: string; code: string };
    participants: Array<RoomParticipant & { credentialHash: string }> = [];
    runtime: GameSessionRuntimeState | null = null;
    boundaries = new Map<string, PlayerBoundaries>();
    async roomCodeExists() {
        return false;
    }
    async createRoom(i: Parameters<RealtimeRoomRepository["createRoom"]>[0]) {
        this.room = { id: i.roomId, code: i.code };
        this.participants.push(i.participant);
    }
    async joinRoom(i: Parameters<RealtimeRoomRepository["joinRoom"]>[0]) {
        this.participants.push({ ...i, roomId: this.room.id });
    }
    async authenticate(code: string, hash: string) {
        const p = this.participants.find(
            (x) => code === this.room.code && x.credentialHash === hash,
        );
        return p
            ? {
                  id: p.id,
                  roomId: p.roomId,
                  role: p.role,
                  displayName: p.displayName,
                  devicePlayers: p.devicePlayers,
              }
            : null;
    }
    async listParticipants(roomId: string) {
        return this.participants.map(({ id, role, displayName, devicePlayers }) => ({
            id,
            roomId,
            role,
            displayName,
            devicePlayers,
        }));
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
        return [];
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
                protocol: 1,
                type: "command.startSession",
                requestId: "start",
                revision: null,
                payload: {
                    mode: "CLASSIC_TRUTH_OR_DARE",
                    maximumIntensity: 3,
                    randomQuestionRatio: 0.5,
                    letsTalkMetaInterval: 3,
                    cardLocale: "en-GB",
                },
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
                protocol: 1,
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
            protocol: 1,
            type: "client.hello",
            requestId: "hello",
            revision: null,
            payload: {
                supportedProtocolVersions: [1],
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
