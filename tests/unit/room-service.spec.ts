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
import {
    defaultRoomGameSettings,
    type VersionedRoomGameSettings,
} from "../../src/packages/application/roomGameSettings";

class MemoryRooms implements RealtimeRoomRepository {
    rooms = new Map<string, { id: string; code: string }>();
    participants: Array<RoomParticipant & { credentialHash: string }> = [];
    runtimes = new Map<string, GameSessionRuntimeState>();
    boundaries = new Map<string, PlayerBoundaries>();
    settings = new Map<string, VersionedRoomGameSettings>();
    commits = 0;
    async roomCodeExists(code: string) {
        return [...this.rooms.values()].some((room) => room.code === code);
    }
    async createRoom(input: Parameters<RealtimeRoomRepository["createRoom"]>[0]) {
        this.rooms.set(input.roomId, { id: input.roomId, code: input.code });
        this.participants.push(input.participant);
        this.settings.set(input.roomId, {
            ...input.settings,
            revision: 0,
            updatedByParticipantId: input.participant.id,
        });
    }
    async joinRoom(
        input: Parameters<RealtimeRoomRepository["joinRoom"]>[0],
        capacity: Parameters<RealtimeRoomRepository["joinRoom"]>[1],
    ) {
        const room = [...this.rooms.values()].find(
            (candidate) => candidate.code === input.roomCode,
        );
        if (!room) throw Object.assign(new Error("not found"), { code: "ROOM_NOT_FOUND" });
        const active = this.participants.filter(
            (participant) =>
                participant.roomId === room.id && participant.connectionStatus !== "LEFT",
        );
        const playerCount = active.reduce(
            (total, participant) =>
                total + (participant.role === "DISPLAY" ? 0 : 1 + participant.devicePlayers.length),
            0,
        );
        if (
            active.length >= capacity.maximumParticipants ||
            playerCount + (input.role === "PLAYER" ? 1 : 0) > capacity.maximumPlayers
        ) {
            throw Object.assign(new Error("full"), { code: "ROOM_FULL" });
        }
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
    async loadSettings(roomId: string) {
        return this.settings.get(roomId)!;
    }
    async saveSettings(
        roomId: string,
        participantId: string,
        expectedRevision: number,
        settings: ReturnType<typeof defaultRoomGameSettings>,
    ) {
        const current = this.settings.get(roomId)!;
        if (current.revision !== expectedRevision)
            throw Object.assign(new Error("stale"), { code: "STALE_SESSION_REVISION" });
        const saved = {
            ...settings,
            revision: expectedRevision + 1,
            updatedByParticipantId: participantId,
        };
        this.settings.set(roomId, saved);
        return saved;
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
    async clearEndedRuntime(roomId: string, sessionId: string, revision: number) {
        const current = this.runtimes.get(roomId);
        if (current?.id !== sessionId || current.revision !== revision || current.state !== "ENDED")
            throw Object.assign(new Error("invalid reset"), { code: "INVALID_GAME_STATE" });
        this.runtimes.delete(roomId);
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
    it("projects relative and global Card intensity separately", async () => {
        const repository = new MemoryRooms();
        const intensityCards: CardRepository = {
            ...cards,
            async listActive() {
                return [card({ id: "intensity-question" as never, intensity: 3 })];
            },
        };
        const service = new RoomService(repository, intensityCards, new SequenceRandomSource([0]));
        const joined = await service.createRoom("Host");
        const player = await service.joinRoom(joined.roomCode, "Player", "PLAYER");
        const host = (await service.authenticate(joined.roomCode, joined.participantCredential))!;
        await service.authenticate(joined.roomCode, player.participantCredential);
        await service.execute(joined.roomId, host, {
            type: "command.startSession",
            revision: null,
            payload: {},
        });
        const shown = await service.execute(joined.roomId, host, {
            type: "command.chooseCardType",
            revision: 0,
            payload: { cardType: "QUESTION" },
        });

        expect(shown.session?.currentCard).toMatchObject({
            cardIntensity: 3,
            intensity: 1,
        });
    });

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
                payload: {},
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

    it("caps represented Room players across every connected device", async () => {
        const repository = new MemoryRooms();
        const service = new RoomService(
            repository,
            cards,
            new SequenceRandomSource([0]),
            undefined,
            { maximumParticipants: 20, maximumPlayers: 20 },
        );
        const joined = await service.createRoom("Host");
        await expect(service.snapshot(joined.roomId)).resolves.toMatchObject({
            capacity: { maximumParticipants: 20, maximumPlayers: 20 },
        });
        const playerJoin = await service.joinRoom(joined.roomCode, "Player", "PLAYER");
        const host = (await service.authenticate(joined.roomCode, joined.participantCredential))!;
        const player = (await service.authenticate(
            joined.roomCode,
            playerJoin.participantCredential,
        ))!;
        await service.execute(joined.roomId, host, {
            type: "command.setDevicePlayers",
            revision: null,
            payload: { names: Array.from({ length: 17 }, (_, index) => `Host ${index}`) },
        });
        await service.execute(joined.roomId, player, {
            type: "command.setDevicePlayers",
            revision: null,
            payload: { names: ["Guest"] },
        });

        await expect(
            service.execute(joined.roomId, player, {
                type: "command.setDevicePlayers",
                revision: null,
                payload: { names: ["Guest", "One too many"] },
            }),
        ).rejects.toMatchObject({ code: "ROOM_FULL" });
        expect(
            repository.participants.find(({ id }) => id === player.id)?.devicePlayers,
        ).toHaveLength(1);
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

    it("keeps an empty-player Room available while its display is connected", async () => {
        const repository = new MemoryRooms();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const hostJoin = await service.createRoom("Host");
        const displayJoin = await service.joinRoom(hostJoin.roomCode, "Screen", "DISPLAY");
        const host = (await service.authenticate(
            hostJoin.roomCode,
            hostJoin.participantCredential,
        ))!;
        await service.authenticate(displayJoin.roomCode, displayJoin.participantCredential);

        await service.markTemporarilyDisconnected(host);
        expect(await service.expireDisconnectedParticipant(host.roomId, host.id)).toBe(true);
        expect(await service.snapshot(host.roomId)).toMatchObject({
            participants: [
                expect.objectContaining({ role: "DISPLAY", connectionStatus: "CONNECTED" }),
            ],
        });

        const display = (await service.authenticate(
            displayJoin.roomCode,
            displayJoin.participantCredential,
        ))!;
        await service.markTemporarilyDisconnected(display);
        expect(await service.expireDisconnectedParticipant(display.roomId, display.id)).toBe(true);
        expect(await service.snapshot(host.roomId)).toMatchObject({ participants: [] });
    });

    it("makes concurrent duplicate EndSession commands idempotent", async () => {
        const repository = new MemoryRooms();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const joined = await service.createRoom("Host");
        const playerJoin = await service.joinRoom(joined.roomCode, "Player", "PLAYER");
        const host = (await service.authenticate(joined.roomCode, joined.participantCredential))!;
        await service.authenticate(joined.roomCode, playerJoin.participantCredential);
        const started = await service.execute(joined.roomId, host, {
            type: "command.startSession",
            revision: null,
            payload: {},
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
        expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
        expect(repository.commits).toBe(2);
    });

    it("resets only an ended Session and starts another Session in the same Room", async () => {
        const repository = new MemoryRooms();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const joined = await service.createRoom("Host");
        const playerJoin = await service.joinRoom(joined.roomCode, "Player", "PLAYER");
        const host = (await service.authenticate(joined.roomCode, joined.participantCredential))!;
        await service.authenticate(joined.roomCode, playerJoin.participantCredential);
        const first = await service.execute(joined.roomId, host, {
            type: "command.startSession",
            revision: null,
            payload: {},
        });
        await service.execute(joined.roomId, host, {
            type: "command.endSession",
            revision: first.session!.revision,
            payload: {},
        });
        const lobby = await service.execute(joined.roomId, host, {
            type: "command.resetSession",
            revision: first.session!.revision + 1,
            payload: {},
        });
        expect(lobby.session).toBeNull();
        expect(lobby.participants).toHaveLength(2);
        const second = await service.execute(joined.roomId, host, {
            type: "command.startSession",
            revision: null,
            payload: {},
        });
        expect(second.session?.id).not.toBe(first.session?.id);
        expect(second.participants.map(({ id }) => id)).toEqual(
            expect.arrayContaining([joined.participantId, playerJoin.participantId]),
        );
    });

    it("ends an active Session and invalidates every participant when the Host closes the Room", async () => {
        const repository = new MemoryRooms();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const joined = await service.createRoom("Host");
        const playerJoin = await service.joinRoom(joined.roomCode, "Player", "PLAYER");
        const host = (await service.authenticate(joined.roomCode, joined.participantCredential))!;
        await service.authenticate(joined.roomCode, playerJoin.participantCredential);
        const started = await service.execute(joined.roomId, host, {
            type: "command.startSession",
            revision: null,
            payload: {},
        });

        const closed = await service.execute(joined.roomId, host, {
            type: "command.closeRoom",
            revision: started.session!.revision,
            payload: {},
        });

        expect(closed.session?.state).toBe("ENDED");
        expect(closed.participants).toEqual([]);
        expect(repository.runtimes.get(joined.roomId)?.state).toBe("ENDED");
        expect(
            await service.authenticate(joined.roomCode, joined.participantCredential),
        ).toBeNull();
        expect(
            await service.authenticate(joined.roomCode, playerJoin.participantCredential),
        ).toBeNull();
    });

    it.each(["command.endSession", "command.closeRoom", "command.leaveRoom"] as const)(
        "allows the last Host to execute %s after every other player leaves",
        async (type) => {
            const repository = new MemoryRooms();
            const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
            const joined = await service.createRoom("Host");
            const playerJoin = await service.joinRoom(joined.roomCode, "Player", "PLAYER");
            const host = (await service.authenticate(
                joined.roomCode,
                joined.participantCredential,
            ))!;
            const player = (await service.authenticate(
                joined.roomCode,
                playerJoin.participantCredential,
            ))!;
            const started = await service.execute(joined.roomId, host, {
                type: "command.startSession",
                revision: null,
                payload: {},
            });
            const onePlayer = await service.execute(joined.roomId, player, {
                type: "command.leaveRoom",
                revision: started.session!.revision,
                payload: {},
            });
            expect(onePlayer.session?.players.map(({ id }) => id)).toEqual([host.id]);

            const result = await service.execute(joined.roomId, host, {
                type,
                revision: onePlayer.session!.revision,
                payload: {},
            });
            if (type === "command.leaveRoom") expect(result.participants).toEqual([]);
            else expect(result.session?.state).toBe("ENDED");
        },
    );

    it("adds a newly connected participant to an active Session exactly once", async () => {
        const repository = new MemoryRooms();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const joined = await service.createRoom("Host");
        const firstJoin = await service.joinRoom(joined.roomCode, "First", "PLAYER");
        const host = (await service.authenticate(joined.roomCode, joined.participantCredential))!;
        const first = (await service.authenticate(
            joined.roomCode,
            firstJoin.participantCredential,
        ))!;
        const started = await service.execute(joined.roomId, host, {
            type: "command.startSession",
            revision: null,
            payload: {},
        });
        await service.execute(joined.roomId, first, {
            type: "command.leaveRoom",
            revision: started.session!.revision,
            payload: {},
        });
        const lateJoin = await service.joinRoom(joined.roomCode, "Late", "PLAYER");
        await service.authenticate(joined.roomCode, lateJoin.participantCredential);
        await service.authenticate(joined.roomCode, lateJoin.participantCredential);

        const synchronized = await service.snapshot(joined.roomId, host);
        expect(synchronized.session?.players.map(({ name }) => name)).toEqual(["Host", "Late"]);
        expect(repository.runtimes.get(joined.roomId)?.players).toHaveLength(2);
    });

    it("does not project Skip after Never Have I Ever voting has completed", async () => {
        const repository = new MemoryRooms();
        const yesNoCards: CardRepository = {
            ...cards,
            listActive: async () => [
                card({ id: "never-question" as never, yesNoAnswerPossible: true }),
            ],
        };
        const service = new RoomService(repository, yesNoCards, new SequenceRandomSource([0]));
        const joined = await service.createRoom("Host", null, {
            ...defaultRoomGameSettings(),
            mode: "NEVER_HAVE_I_EVER",
        });
        const playerJoin = await service.joinRoom(joined.roomCode, "Player", "PLAYER");
        const host = (await service.authenticate(joined.roomCode, joined.participantCredential))!;
        const player = (await service.authenticate(
            joined.roomCode,
            playerJoin.participantCredential,
        ))!;
        await service.execute(joined.roomId, host, {
            type: "command.startSession",
            revision: null,
            payload: {},
        });
        await service.execute(joined.roomId, host, {
            type: "command.startTurn",
            revision: 0,
            payload: {},
        });
        await service.execute(joined.roomId, host, {
            type: "command.submitVote",
            revision: 1,
            payload: { playerId: host.id, vote: "YES" },
        });
        const results = await service.execute(joined.roomId, player, {
            type: "command.submitVote",
            revision: 2,
            payload: { playerId: player.id, vote: "NO" },
        });

        expect(results.session?.state).toBe("SHOWING_RESULTS");
        expect((await service.snapshot(joined.roomId, host)).session?.availableActions).toContain(
            "ADVANCE_SESSION",
        );
        expect(
            (await service.snapshot(joined.roomId, host)).session?.availableActions,
        ).not.toContain("SKIP_CARD");
        await expect(
            service.execute(joined.roomId, host, {
                type: "command.skipCard",
                revision: results.session!.revision,
                payload: {},
            }),
        ).rejects.toMatchObject({
            code: "INVALID_GAME_STATE",
            message: "game.invalidState",
        });
    });

    it("freezes mid-card voters and reveals named results to every Room viewer only at completion", async () => {
        const repository = new MemoryRooms();
        const yesNoCards: CardRepository = {
            ...cards,
            listActive: async () => [
                card({ id: "named-never-question" as never, yesNoAnswerPossible: true }),
            ],
        };
        const service = new RoomService(repository, yesNoCards, new SequenceRandomSource([0]));
        const joined = await service.createRoom("Host", null, {
            ...defaultRoomGameSettings(),
            mode: "NEVER_HAVE_I_EVER",
            neverHaveIEverRevealMode: "NAMED_ANSWERS",
        });
        const playerJoin = await service.joinRoom(joined.roomCode, "Player", "PLAYER");
        const host = (await service.authenticate(joined.roomCode, joined.participantCredential))!;
        const player = (await service.authenticate(
            joined.roomCode,
            playerJoin.participantCredential,
        ))!;
        await service.execute(joined.roomId, host, {
            type: "command.startSession",
            revision: null,
            payload: {},
        });
        await service.execute(joined.roomId, host, {
            type: "command.startTurn",
            revision: 0,
            payload: {},
        });
        const lateJoin = await service.joinRoom(joined.roomCode, "Late", "PLAYER");
        const late = (await service.authenticate(joined.roomCode, lateJoin.participantCredential))!;

        const duringVoting = await service.execute(joined.roomId, host, {
            type: "command.submitVote",
            revision: 2,
            payload: { playerId: host.id, vote: "YES" },
        });
        expect(duringVoting.session?.neverHaveIEverVoting).toMatchObject({
            revealMode: "NAMED_ANSWERS",
            result: null,
            progress: [
                { playerId: host.id, status: "VOTED" },
                { playerId: player.id, status: "PENDING" },
            ],
        });
        expect(
            (await service.snapshot(joined.roomId, late)).session?.availableActions,
        ).not.toContain("SUBMIT_VOTE");
        expect(JSON.stringify(duringVoting.session?.neverHaveIEverVoting)).not.toContain('"YES"');

        await service.markTemporarilyDisconnected(player);
        expect(
            (await service.snapshot(joined.roomId, host)).session?.neverHaveIEverVoting?.progress,
        ).toContainEqual({
            playerId: player.id,
            displayName: "Player",
            status: "PENDING",
        });
        const reconnectedPlayer = (await service.authenticate(
            joined.roomCode,
            playerJoin.participantCredential,
        ))!;

        const result = await service.execute(joined.roomId, reconnectedPlayer, {
            type: "command.submitVote",
            revision: 3,
            payload: { playerId: player.id, vote: "NO" },
        });
        expect(result.session?.neverHaveIEverVoting?.result?.namedAnswers).toEqual([
            { playerId: host.id, displayName: "Host", vote: "YES" },
            { playerId: player.id, displayName: "Player", vote: "NO" },
        ]);
        expect(
            (await service.snapshot(joined.roomId, late)).session?.neverHaveIEverVoting?.result
                ?.namedAnswers,
        ).toEqual(result.session?.neverHaveIEverVoting?.result?.namedAnswers);
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
            payload: {},
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
            payload: {},
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

    it("persists public Room settings authoritatively and rejects player or stale updates", async () => {
        const repository = new MemoryRooms();
        const service = new RoomService(repository, cards, new SequenceRandomSource([0]));
        const joined = await service.createRoom("Host");
        const playerJoin = await service.joinRoom(joined.roomCode, "Player", "PLAYER");
        const host = (await service.authenticate(joined.roomCode, joined.participantCredential))!;
        const player = (await service.authenticate(
            joined.roomCode,
            playerJoin.participantCredential,
        ))!;
        const settings = {
            ...defaultRoomGameSettings(),
            profileId: "PROFILE_CUSTOM",
            configuration: {
                ...defaultRoomGameSettings().configuration,
                startingIntensity: 2 as const,
                maximumIntensity: 2 as const,
                intensityProgressionUnit: "CARDS" as const,
                intensityProgressionInterval: 4,
                enabledDareTypeIds: [],
            },
        };
        const command = {
            type: "command.updateRoomSettings" as const,
            revision: null,
            payload: { expectedRevision: 0, settings },
        };

        await expect(service.execute(joined.roomId, player, command)).rejects.toMatchObject({
            code: "NOT_AUTHORIZED",
        });
        const updated = await service.execute(joined.roomId, host, command);
        expect(updated.settings).toMatchObject({
            revision: 1,
            profileId: "PROFILE_CUSTOM",
            updatedByParticipantId: host.id,
            configuration: {
                startingIntensity: 2,
                maximumIntensity: 2,
                intensityProgressionUnit: "CARDS",
                intensityProgressionInterval: 4,
                enabledDareTypeIds: [],
            },
        });
        expect((await service.snapshot(joined.roomId, player)).settings).toEqual(updated.settings);
        expect(JSON.stringify(updated.settings)).not.toContain("disabledDareTypeIds");
        await expect(service.execute(joined.roomId, host, command)).rejects.toMatchObject({
            code: "STALE_SESSION_REVISION",
        });
    });

    it("uses only the server-validated ordered Card fallback policy", async () => {
        const repository = new MemoryRooms();
        let localization: Parameters<CardRepository["listActive"]>[0] | undefined;
        const observingCards: CardRepository = {
            ...cards,
            listActive: async (policy) => {
                localization = policy;
                return [card({ id: "localized-room-question" as never })];
            },
        };
        const service = new RoomService(repository, observingCards, new SequenceRandomSource([0]));
        const joined = await service.createRoom("Host");
        const playerJoin = await service.joinRoom(joined.roomCode, "Player", "PLAYER");
        const host = (await service.authenticate(joined.roomCode, joined.participantCredential))!;
        await service.authenticate(joined.roomCode, playerJoin.participantCredential);
        const settings = {
            ...defaultRoomGameSettings(),
            cardLocale: "en-GB",
            cardFallbackEnabled: true,
            cardFallbackLocales: ["fr-FR", "de-DE"],
        };
        await service.execute(joined.roomId, host, {
            type: "command.updateRoomSettings",
            revision: null,
            payload: { expectedRevision: 0, settings },
        });
        await service.execute(joined.roomId, host, {
            type: "command.startSession",
            revision: null,
            payload: {},
        });
        expect(localization).toEqual({
            locale: "en-GB",
            missingTranslation: "FALLBACK",
            fallbackLocales: ["fr-FR", "de-DE"],
        });
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
            payload: {},
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
