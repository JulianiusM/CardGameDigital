import { v5 as uuidv5 } from "uuid";
import { IsNull, LessThan, MoreThan, Not, type DataSource } from "typeorm";
import type { CardId, GameSessionRuntimeState, PlayerBoundaries } from "../game-core";
import type {
    DevicePlayer,
    RealtimeRoomRepository,
    RoomParticipant,
} from "../application/realtimeRooms";
import { RoomEntity } from "../../modules/database/entities/game/RoomEntity";
import { RoomParticipantEntity } from "../../modules/database/entities/game/RoomParticipantEntity";
import { GameSessionEntity } from "../../modules/database/entities/game/GameSessionEntity";
import { CardAppearanceEntity } from "../../modules/database/entities/game/CardAppearanceEntity";
import { RoomParticipantBoundaryEntity } from "../../modules/database/entities/game/RoomParticipantBoundaryEntity";
import { GroupEntity } from "../../modules/database/entities/game/GroupEntity";
import { CouchCardAppearanceEntity } from "../../modules/database/entities/game/CouchCardAppearanceEntity";

const APPEARANCE_NAMESPACE = "d2dad6a5-b25c-570d-a102-9e8b9106a77b";

export class TypeOrmRealtimeRoomRepository implements RealtimeRoomRepository {
    constructor(private readonly source: DataSource) {}
    async roomCodeExists(code: string): Promise<boolean> {
        return this.source.getRepository(RoomEntity).existsBy({ code });
    }
    async createRoom(input: {
        roomId: string;
        code: string;
        dataSpaceId: string | null;
        expiresAt: Date;
        participant: RoomParticipant & { credentialHash: string };
    }): Promise<void> {
        await this.source.transaction(async (manager) => {
            // Ephemeral runtime exists only for reconnect during the Room lifetime. It is
            // cascade-deleted opportunistically and never becomes account history.
            await manager.getRepository(RoomEntity).delete({
                dataSpaceId: IsNull(),
                expiresAt: LessThan(new Date()),
            });
            await manager.getRepository(RoomEntity).insert({
                id: input.roomId,
                code: input.code,
                dataSpaceId: input.dataSpaceId,
                createdAt: new Date(),
                expiresAt: input.expiresAt,
            });
            await manager.getRepository(RoomParticipantEntity).insert({
                ...input.participant,
                devicePlayersJson: JSON.stringify(input.participant.devicePlayers),
                createdAt: new Date(),
                lastSeenAt: new Date(),
                leftAt: null,
            });
        });
    }
    async joinRoom(
        input: Omit<RoomParticipant, "roomId"> & { roomCode: string; credentialHash: string },
    ): Promise<void> {
        const room = await this.source
            .getRepository(RoomEntity)
            .findOneBy({ code: input.roomCode });
        if (!room || room.expiresAt <= new Date())
            throw Object.assign(new Error("Room not found"), { code: "ROOM_NOT_FOUND" });
        await this.source.getRepository(RoomParticipantEntity).insert({
            id: input.id,
            roomId: room.id,
            role: input.role,
            displayName: input.displayName,
            credentialHash: input.credentialHash,
            devicePlayersJson: JSON.stringify(input.devicePlayers),
            createdAt: new Date(),
            lastSeenAt: new Date(),
            leftAt: null,
        });
    }
    async authenticate(roomCode: string, credentialHash: string): Promise<RoomParticipant | null> {
        const participant = await this.source
            .getRepository(RoomParticipantEntity)
            .createQueryBuilder("participant")
            .innerJoin(RoomEntity, "room", "room.id = participant.roomId")
            .where("room.code = :roomCode", { roomCode })
            .andWhere("room.expiresAt > :now", { now: new Date() })
            .andWhere("participant.credentialHash = :credentialHash", { credentialHash })
            .andWhere("participant.connectionStatus != :left", { left: "LEFT" })
            .getOne();
        return participant ? this.projectParticipant(participant) : null;
    }
    async getParticipant(roomId: string, participantId: string): Promise<RoomParticipant | null> {
        const participant = await this.source.getRepository(RoomParticipantEntity).findOneBy({
            id: participantId,
            roomId,
            connectionStatus: Not("LEFT"),
        });
        return participant ? this.projectParticipant(participant) : null;
    }
    async listParticipants(roomId: string): Promise<readonly RoomParticipant[]> {
        return (
            await this.source.getRepository(RoomParticipantEntity).find({
                where: { roomId, connectionStatus: Not("LEFT") },
                order: { createdAt: "ASC" },
            })
        ).map((participant) => this.projectParticipant(participant));
    }
    async setConnectionStatus(
        participantId: string,
        connectionStatus: RoomParticipant["connectionStatus"],
    ): Promise<void> {
        const now = new Date();
        await this.source.getRepository(RoomParticipantEntity).update(
            { id: participantId },
            {
                connectionStatus,
                lastSeenAt: now,
                leftAt: connectionStatus === "LEFT" ? now : null,
            },
        );
    }
    async resetConnectedParticipants(): Promise<readonly RoomParticipant[]> {
        const repository = this.source.getRepository(RoomParticipantEntity);
        const connected = await repository.findBy({ connectionStatus: "CONNECTED" });
        await this.source
            .getRepository(RoomParticipantEntity)
            .update(
                { connectionStatus: "CONNECTED" },
                { connectionStatus: "TEMPORARILY_DISCONNECTED" },
            );
        return connected.map((participant) => ({
            ...this.projectParticipant(participant),
            connectionStatus: "TEMPORARILY_DISCONNECTED",
        }));
    }
    async saveDevicePlayers(
        participantId: string,
        players: readonly DevicePlayer[],
    ): Promise<void> {
        const result = await this.source
            .getRepository(RoomParticipantEntity)
            .update({ id: participantId }, { devicePlayersJson: JSON.stringify(players) });
        if (result.affected !== 1) throw new Error("Room participant not found");
    }
    async transferHost(roomId: string, currentHostId: string, nextHostId: string): Promise<void> {
        await this.source.transaction(async (manager) => {
            const repository = manager.getRepository(RoomParticipantEntity);
            const [current, next] = await Promise.all([
                repository.findOneBy({ id: currentHostId, roomId, role: "HOST" }),
                repository.findOneBy({ id: nextHostId, roomId, role: "PLAYER" }),
            ]);
            if (!current || !next) {
                throw Object.assign(new Error("Host transfer participants are invalid"), {
                    code: "NOT_AUTHORIZED",
                });
            }
            current.role = "PLAYER";
            next.role = "HOST";
            await repository.save([current, next]);
        });
    }
    async saveBoundaries(participantId: string, boundaries: PlayerBoundaries): Promise<void> {
        const repository = this.source.getRepository(RoomParticipantBoundaryEntity);
        await repository.save(
            repository.create({
                participantId,
                disabledQuestionCategoryIdsJson: JSON.stringify([
                    ...boundaries.disabledQuestionCategoryIds,
                ]),
                disabledDareTypeIdsJson: JSON.stringify([...boundaries.disabledDareTypeIds]),
                blockedOperationalFlagsJson: JSON.stringify([
                    ...boundaries.blockedOperationalFlags,
                ]),
                updatedAt: new Date(),
            }),
        );
    }

    async listBoundaries(roomId: string): Promise<ReadonlyMap<string, PlayerBoundaries>> {
        const records = await this.source
            .getRepository(RoomParticipantBoundaryEntity)
            .createQueryBuilder("boundary")
            .innerJoin(
                RoomParticipantEntity,
                "participant",
                "participant.id = boundary.participantId",
            )
            .where("participant.roomId = :roomId", { roomId })
            .getMany();
        return new Map(
            records.map((record) => [
                record.participantId,
                {
                    disabledQuestionCategoryIds: new Set(
                        JSON.parse(record.disabledQuestionCategoryIdsJson),
                    ),
                    disabledDareTypeIds: new Set(JSON.parse(record.disabledDareTypeIdsJson)),
                    blockedOperationalFlags: new Set(
                        JSON.parse(record.blockedOperationalFlagsJson),
                    ),
                } as PlayerBoundaries,
            ]),
        );
    }
    async selectGroup(roomId: string, groupId: string | null): Promise<ReadonlySet<CardId>> {
        return this.source.transaction(async (manager) => {
            const rooms = manager.getRepository(RoomEntity);
            const room = await rooms.findOneByOrFail({ id: roomId });
            if (groupId) {
                if (!room.dataSpaceId) {
                    throw Object.assign(new Error("Unowned Room cannot use a persistent Group"), {
                        code: "NOT_AUTHORIZED",
                    });
                }
                const owned = await manager.getRepository(GroupEntity).existsBy({
                    id: groupId,
                    dataSpaceId: room.dataSpaceId,
                });
                if (!owned) {
                    throw Object.assign(new Error("Group is outside the Room DataSpace"), {
                        code: "NOT_AUTHORIZED",
                    });
                }
            }
            await rooms.update({ id: roomId }, { groupId });
            if (!groupId) return new Set<CardId>();
            const group = await manager.getRepository(GroupEntity).findOneByOrFail({ id: groupId });
            const shownAt = group.historyResetAt ? MoreThan(group.historyResetAt) : undefined;
            const where = { groupId, ...(shownAt ? { shownAt } : {}) };
            const [roomHistory, couchHistory] = await Promise.all([
                manager.getRepository(CardAppearanceEntity).find({
                    where,
                    select: { cardId: true },
                }),
                manager.getRepository(CouchCardAppearanceEntity).find({
                    where,
                    select: { cardId: true },
                }),
            ]);
            return new Set([...roomHistory, ...couchHistory].map(({ cardId }) => cardId as CardId));
        });
    }
    async loadRuntime(roomId: string): Promise<GameSessionRuntimeState | null> {
        const record = await this.source.getRepository(GameSessionEntity).findOneBy({ roomId });
        if (!record) return null;
        const parsed = JSON.parse(record.runtimeStateJson) as GameSessionRuntimeState;
        if (
            parsed.version !== record.runtimeStateVersion ||
            parsed.revision !== record.revision ||
            parsed.id !== record.id
        )
            throw new Error("Stored GameSession runtime is inconsistent");
        return parsed;
    }
    async commitRuntime(
        roomId: string,
        previousRevision: number | null,
        runtime: GameSessionRuntimeState,
    ): Promise<void> {
        await this.source.transaction(async (manager) => {
            const room = await manager.getRepository(RoomEntity).findOneByOrFail({ id: roomId });
            const sessions = manager.getRepository(GameSessionEntity);
            if (previousRevision === null) {
                await sessions.insert({
                    id: runtime.id,
                    roomId,
                    groupId: room.groupId,
                    mode: runtime.mode,
                    revision: runtime.revision,
                    runtimeStateVersion: runtime.version,
                    runtimeStateJson: JSON.stringify(runtime),
                    startedAt: new Date(),
                    endedAt: runtime.state === "ENDED" ? new Date() : null,
                });
            } else {
                const updated = await sessions.update(
                    { roomId, revision: previousRevision },
                    {
                        revision: runtime.revision,
                        runtimeStateVersion: runtime.version,
                        runtimeStateJson: JSON.stringify(runtime),
                        endedAt: runtime.state === "ENDED" ? new Date() : null,
                    },
                );
                if (updated.affected !== 1)
                    throw Object.assign(new Error("Stale persisted Session revision"), {
                        code: "STALE_SESSION_REVISION",
                    });
            }
            const appearances = manager.getRepository(CardAppearanceEntity);
            for (const appearance of runtime.sessionHistory) {
                const id = uuidv5(`${runtime.id}:${appearance.sequence}`, APPEARANCE_NAMESPACE);
                const existing = await appearances.findOneBy({ id });
                await appearances.save(
                    appearances.create({
                        id,
                        sessionId: runtime.id,
                        groupId: room.groupId,
                        cardId: appearance.cardId,
                        playerId: appearance.playerId,
                        shownAt: existing?.shownAt ?? new Date(),
                        roundNumber: appearance.roundNumber,
                        sequence: appearance.sequence,
                        skipped: appearance.skipped,
                        completed: false,
                        vetoed: false,
                    }),
                );
            }
        });
    }

    private projectParticipant(participant: RoomParticipantEntity): RoomParticipant {
        return {
            id: participant.id,
            roomId: participant.roomId,
            role: participant.role,
            displayName: participant.displayName,
            devicePlayers: JSON.parse(participant.devicePlayersJson) as DevicePlayer[],
            connectionStatus: participant.connectionStatus,
        };
    }
}
