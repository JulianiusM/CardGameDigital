import { describe, expect, it } from "vitest";
import { RoomService } from "../../src/packages/application/roomService";
import type {
    RealtimeRoomRepository,
    RoomParticipant,
} from "../../src/packages/application/realtimeRooms";
import type { GameSessionRuntimeState, PlayerBoundaries } from "../../src/packages/game-core";
import type { CardRepository } from "../../src/packages/application/repositories";
import { SequenceRandomSource } from "../../src/packages/game-core";
import { card } from "../support/game";

class MemoryRooms implements RealtimeRoomRepository {
    rooms = new Map<string, { id: string; code: string }>();
    participants: Array<RoomParticipant & { credentialHash: string }> = [];
    runtimes = new Map<string, GameSessionRuntimeState>();
    boundaries = new Map<string, PlayerBoundaries>();
    commits = 0;
    async roomCodeExists(code: string) {
        return [...this.rooms.values()].some((room) => room.code === code);
    }
    async createRoom(input: Parameters<RealtimeRoomRepository["createRoom"]>[0]) {
        this.rooms.set(input.roomId, { id: input.roomId, code: input.code });
        this.participants.push(input.participant);
    }
    async joinRoom(input: Parameters<RealtimeRoomRepository["joinRoom"]>[0]) {
        const room = [...this.rooms.values()].find(
            (candidate) => candidate.code === input.roomCode,
        )!;
        this.participants.push({ ...input, roomId: room.id });
    }
    async authenticate(code: string, hash: string) {
        const room = [...this.rooms.values()].find((candidate) => candidate.code === code);
        const found = this.participants.find(
            (p) =>
                p.roomId === room?.id && p.credentialHash === hash && p.connectionStatus !== "LEFT",
        );
        return found
            ? {
                  id: found.id,
                  roomId: found.roomId,
                  role: found.role,
                  displayName: found.displayName,
                  devicePlayers: found.devicePlayers,
                  connectionStatus: found.connectionStatus,
              }
            : null;
    }
    async listParticipants(roomId: string) {
        return this.participants
            .filter((p) => p.roomId === roomId && p.connectionStatus !== "LEFT")
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
    async saveBoundaries(participantId: string, boundaries: PlayerBoundaries) {
        this.boundaries.set(participantId, boundaries);
    }
    async listBoundaries(roomId: string) {
        const participantIds = new Set(
            this.participants
                .filter((participant) => participant.roomId === roomId)
                .map(({ id }) => id),
        );
        return new Map([...this.boundaries].filter(([id]) => participantIds.has(id)));
    }
    async selectGroup() {
        return new Set<never>();
    }
    async loadRuntime(roomId: string) {
        return this.runtimes.get(roomId) ?? null;
    }
    async commitRuntime(roomId: string, previous: number | null, runtime: GameSessionRuntimeState) {
        const stored = this.runtimes.get(roomId);
        if ((stored?.revision ?? null) !== previous)
            throw Object.assign(new Error("stale"), { code: "STALE_SESSION_REVISION" });
        this.commits++;
        this.runtimes.set(roomId, runtime);
    }
}
const cards: CardRepository = {
    async listActive() {
        return [card({ id: "room-question" as never })];
    },
    async getById() {
        return null;
    },
    async findEligibleCandidates() {
        return [];
    },
};

describe("RoomService", () => {
    it("rejects Session start when every configured pool is empty", async () => {
        const repository = new MemoryRooms();
        const emptyCards: CardRepository = { ...cards, listActive: async () => [] };
        const service = new RoomService(repository, emptyCards, new SequenceRandomSource([0]));
        const joined = await service.createRoom("Host");
        const playerJoin = await service.joinRoom(joined.roomCode, "Player", "PLAYER");
        const host = (await service.authenticate(joined.roomCode, joined.participantCredential))!;
        await service.authenticate(joined.roomCode, playerJoin.participantCredential);
        await expect(
            service.execute(joined.roomId, host, {
                type: "command.startSession",
                revision: null,
                payload: {
                    mode: "CLASSIC_TRUTH_OR_DARE",
                    maximumIntensity: 3,
                    randomQuestionRatio: 0.5,
                    letsTalkMetaInterval: 3,
                    cardLocale: "en-GB",
                },
            }),
        ).rejects.toMatchObject({ code: "CARD_POOL_EXHAUSTED" });
        expect(repository.runtimes.size).toBe(0);
    });

    it("returns a raw credential once while persisting only its hash", async () => {
        const repository = new MemoryRooms();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const host = await service.createRoom("Host");
        const player = await service.joinRoom(host.roomCode, "Player", "PLAYER");
        expect(host.participantCredential).toHaveLength(43);
        expect(repository.participants.map((p) => p.credentialHash)).not.toContain(
            host.participantCredential,
        );
        expect(
            await service.authenticate(host.roomCode, player.participantCredential),
        ).toMatchObject({ role: "PLAYER", displayName: "Player" });
    });

    it("restores a temporarily disconnected participant and expires only stale disconnects", async () => {
        const repository = new MemoryRooms();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const hostJoin = await service.createRoom("Host");
        const playerJoin = await service.joinRoom(hostJoin.roomCode, "Player", "PLAYER");
        const player = (await service.authenticate(
            playerJoin.roomCode,
            playerJoin.participantCredential,
        ))!;
        await service.markTemporarilyDisconnected(player);
        expect(repository.participants.find(({ id }) => id === player.id)?.connectionStatus).toBe(
            "TEMPORARILY_DISCONNECTED",
        );
        await service.authenticate(playerJoin.roomCode, playerJoin.participantCredential);
        expect(await service.expireDisconnectedParticipant(player.roomId, player.id)).toBe(false);
        await service.markTemporarilyDisconnected(player);
        expect(await service.expireDisconnectedParticipant(player.roomId, player.id)).toBe(true);
        expect(
            await service.authenticate(playerJoin.roomCode, playerJoin.participantCredential),
        ).toBeNull();
    });

    it("serializes same-Room commands and rejects the stale second command", async () => {
        const repository = new MemoryRooms();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const joined = await service.createRoom("Host");
        const playerJoin = await service.joinRoom(joined.roomCode, "Player", "PLAYER");
        const host = (await service.authenticate(joined.roomCode, joined.participantCredential))!;
        await service.authenticate(joined.roomCode, playerJoin.participantCredential);
        const started = await service.execute(joined.roomId, host, {
            type: "command.startSession",
            revision: null,
            payload: {
                mode: "CLASSIC_TRUTH_OR_DARE",
                maximumIntensity: 3,
                randomQuestionRatio: 0.5,
                letsTalkMetaInterval: 3,
                cardLocale: "en-GB",
            },
        });
        const revision = started.session!.revision;
        const results = await Promise.allSettled([
            service.execute(joined.roomId, host, {
                type: "command.endSession",
                revision,
                payload: {},
            }),
            service.execute(joined.roomId, host, {
                type: "command.endSession",
                revision,
                payload: {},
            }),
        ]);
        expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
        expect(repository.commits).toBe(2);
    });

    it("does not expose an active player's private choice to another participant", async () => {
        const repository = new MemoryRooms();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const joined = await service.createRoom("Host");
        const playerJoin = await service.joinRoom(joined.roomCode, "Player", "PLAYER");
        const host = (await service.authenticate(joined.roomCode, joined.participantCredential))!;
        const player = (await service.authenticate(
            joined.roomCode,
            playerJoin.participantCredential,
        ))!;
        await service.execute(joined.roomId, host, {
            type: "command.startSession",
            revision: null,
            payload: {
                mode: "CLASSIC_TRUTH_OR_DARE",
                maximumIntensity: 3,
                randomQuestionRatio: 0.5,
                letsTalkMetaInterval: 3,
                cardLocale: "en-GB",
            },
        });
        expect((await service.snapshot(joined.roomId, host)).session?.availableActions).toContain(
            "CHOOSE_CARD_TYPE",
        );
        expect(
            (await service.snapshot(joined.roomId, player)).session?.availableActions,
        ).not.toContain("CHOOSE_CARD_TYPE");
        await expect(
            service.execute(joined.roomId, player, {
                type: "command.chooseCardType",
                revision: 0,
                payload: { cardType: "QUESTION" },
            }),
        ).rejects.toMatchObject({ code: "NOT_ACTIVE_PLAYER" });
    });

    it("keeps Room settings host-only while allowing host-controlled local players", async () => {
        const repository = new MemoryRooms();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const joined = await service.createRoom("Host");
        const playerJoin = await service.joinRoom(joined.roomCode, "Player", "PLAYER");
        const host = (await service.authenticate(joined.roomCode, joined.participantCredential))!;
        const player = (await service.authenticate(
            joined.roomCode,
            playerJoin.participantCredential,
        ))!;
        await service.execute(joined.roomId, host, {
            type: "command.setDevicePlayers",
            revision: null,
            payload: { names: ["Shared-device guest"] },
        });
        await service.execute(joined.roomId, player, {
            type: "command.setDevicePlayers",
            revision: null,
            payload: { names: ["Player's sibling"] },
        });
        const start = {
            type: "command.startSession" as const,
            revision: null,
            payload: {
                mode: "CLASSIC_TRUTH_OR_DARE" as const,
                maximumIntensity: 3 as const,
                randomQuestionRatio: 0.5,
                letsTalkMetaInterval: 3,
                cardLocale: "en-GB",
            },
        };
        await expect(service.execute(joined.roomId, player, start)).rejects.toMatchObject({
            code: "NOT_AUTHORIZED",
        });
        const snapshot = await service.execute(joined.roomId, host, start);
        expect(snapshot.session?.controllablePlayers.map(({ name }) => name)).toEqual([
            "Host",
            "Shared-device guest",
        ]);
        expect(
            (await service.snapshot(joined.roomId, player)).session?.controllablePlayers.map(
                ({ name }) => name,
            ),
        ).toEqual(["Player", "Player's sibling"]);
    });

    it("stores private boundaries without including their values in snapshots", async () => {
        const repository = new MemoryRooms();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const joined = await service.createRoom("Host");
        const host = (await service.authenticate(joined.roomCode, joined.participantCredential))!;

        const snapshot = await service.execute(joined.roomId, host, {
            type: "command.setBoundaries",
            revision: null,
            payload: {
                disabledQuestionCategoryIds: ["CAT_SEX_EXPERIENCE"],
                disabledDareTypeIds: ["DARE_THIRD_PARTY", "DARE_NUDITY"],
                blockedOperationalFlags: ["INVOLVES_THIRD_PARTY"],
            },
        });

        expect(snapshot.boundaryConfigured).toBe(true);
        expect(snapshot).not.toHaveProperty("boundaries");
        expect(JSON.stringify(snapshot)).not.toContain("DARE_NUDITY");
        expect(repository.boundaries.get(host.id)?.disabledDareTypeIds.has("DARE_NUDITY")).toBe(
            true,
        );
        await service.execute(joined.roomId, host, {
            type: "command.setBoundaries",
            revision: null,
            payload: {
                disabledQuestionCategoryIds: [],
                disabledDareTypeIds: ["DARE_KISS"],
                blockedOperationalFlags: [],
            },
        });
        expect(repository.boundaries.get(host.id)?.disabledDareTypeIds).toEqual(
            new Set(["DARE_KISS"]),
        );
    });

    it("supports explicit host delegation and disconnected-host fallback", async () => {
        const repository = new MemoryRooms();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const joined = await service.createRoom("Host");
        const playerJoin = await service.joinRoom(joined.roomCode, "Player", "PLAYER");
        const host = (await service.authenticate(joined.roomCode, joined.participantCredential))!;
        const player = (await service.authenticate(
            joined.roomCode,
            playerJoin.participantCredential,
        ))!;

        await service.execute(joined.roomId, host, {
            type: "command.transferHost",
            revision: null,
            payload: { participantId: player.id },
        });
        expect((await service.snapshot(joined.roomId)).participants).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: host.id, role: "PLAYER" }),
                expect.objectContaining({ id: player.id, role: "HOST" }),
            ]),
        );

        const start = {
            type: "command.startSession" as const,
            revision: null,
            payload: {
                mode: "CLASSIC_TRUTH_OR_DARE" as const,
                maximumIntensity: 3 as const,
                randomQuestionRatio: 0.5,
                letsTalkMetaInterval: 3,
                cardLocale: "en-GB",
            },
        };
        await expect(service.execute(joined.roomId, host, start)).rejects.toMatchObject({
            code: "NOT_AUTHORIZED",
        });
        await expect(service.execute(joined.roomId, player, start)).resolves.toMatchObject({
            session: { revision: 0 },
        });

        expect(
            await service.reassignDisconnectedHost(joined.roomId, player.id, new Set([host.id])),
        ).toBe(true);
        expect((await service.snapshot(joined.roomId)).participants).toContainEqual(
            expect.objectContaining({ id: host.id, role: "HOST" }),
        );
    });
});
