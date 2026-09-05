import { v5 as uuidv5 } from "uuid";
import {
    In,
    IsNull,
    LessThanOrEqual,
    MoreThan,
    Not,
    type DataSource,
    type EntityManager,
} from "typeorm";
import type { CardId, GameSessionRuntimeState, PlayerBoundaries } from "../game-core";
import type {
    DevicePlayer,
    RealtimeRoomRepository,
    RoomCapacity,
    RoomCreateIdempotencyRecord,
    RoomLifecycleTransition,
    RoomLifecycleTransitionResult,
    RoomParticipant,
    RoomRoleChange,
    RoomState,
} from "../application/realtimeRooms";
import {
    decideRoomHost,
    derivePersistedRoomHostStatus,
    type HostSelectionTrigger,
} from "../application/roomHostSelection";
import {
    normalizeRoomGameSettings,
    type RoomGameSettings,
    type VersionedRoomGameSettings,
} from "../application/roomGameSettings";
import { RoomEntity } from "./entities/game/RoomEntity";
import { RoomParticipantEntity } from "./entities/game/RoomParticipantEntity";
import { GameSessionEntity } from "./entities/game/GameSessionEntity";
import { CardAppearanceEntity } from "./entities/game/CardAppearanceEntity";
import { RoomParticipantBoundaryEntity } from "./entities/game/RoomParticipantBoundaryEntity";
import { RoomCreateIdempotencyEntity } from "./entities/game/RoomCreateIdempotencyEntity";
import { GroupEntity } from "./entities/game/GroupEntity";
import { CouchCardAppearanceEntity } from "./entities/game/CouchCardAppearanceEntity";
import {
    externalizeSessionImmutableState,
    hydrateSessionImmutableState,
} from "./sessionImmutablePayloadStore";

const APPEARANCE_NAMESPACE = "d2dad6a5-b25c-570d-a102-9e8b9106a77b";

export class TypeOrmRealtimeRoomRepository implements RealtimeRoomRepository {
    constructor(
        private readonly source: DataSource,
        private readonly idempotencyTombstoneSeconds = 86_400,
    ) {}
    async roomCodeExists(code: string): Promise<boolean> {
        return this.source.getRepository(RoomEntity).existsBy({ code });
    }
    async createRoom(input: {
        roomId: string;
        code: string;
        dataSpaceId: string | null;
        createdAt: number;
        expiresAt: Date;
        bootstrapMode: "CREATOR_HOST" | "DISPLAY_WAITING_FOR_HOST";
        firstHostAssignedAt: number | null;
        activationDeadline: number;
        settings: RoomGameSettings;
        participant: RoomParticipant & { credentialHash: string };
        idempotency?: import("../application/realtimeRooms").RoomCreateIdempotencyInput;
    }): Promise<{ created: true } | { created: false; record: RoomCreateIdempotencyRecord }> {
        let contentionAttempts = 0;
        while (true) {
            try {
                return await this.createRoomTransaction(input);
            } catch (error) {
                if (!input.idempotency) throw error;
                const existing = await this.findRoomCreateIdempotency(
                    input.idempotency.principalScopeDigest,
                    input.idempotency.routeKey,
                    input.idempotency.keyDigest,
                );
                if (existing) {
                    return this.resolveCreateIdempotency(existing, input.idempotency);
                }
                if (canRetryRoomCreation(error, contentionAttempts)) {
                    contentionAttempts += 1;
                    continue;
                }
                if (isDatabaseContention(error)) {
                    throw Object.assign(new Error("Idempotent Room create is still committing"), {
                        code: "IDEMPOTENCY_REQUEST_IN_PROGRESS",
                    });
                }

                throw error;
            }
        }
    }
    private async createRoomTransaction(
        input: Parameters<RealtimeRoomRepository["createRoom"]>[0],
    ): ReturnType<RealtimeRoomRepository["createRoom"]> {
        return await this.source.transaction(async (manager) => {
            if (input.idempotency) {
                const existing = await manager
                    .getRepository(RoomCreateIdempotencyEntity)
                    .findOneBy({
                        principalScopeDigest: input.idempotency.principalScopeDigest,
                        routeKey: input.idempotency.routeKey,
                        keyDigest: input.idempotency.keyDigest,
                    });
                if (existing) return this.resolveCreateIdempotency(existing, input.idempotency);
            }
            await validateCreateGroupOwnership();
            await manager.getRepository(RoomEntity).insert({
                id: input.roomId,
                code: input.code,
                dataSpaceId: input.dataSpaceId,
                groupId: input.settings.groupId,
                settingsRevision: 0,
                gameSettingsJson: JSON.stringify(input.settings),
                settingsUpdatedByParticipantId: input.participant.id,
                currentSessionId: null,
                createdAt: new Date(input.createdAt),
                expiresAt: input.expiresAt,
                closedAt: null,
                bootstrapMode: input.bootstrapMode,
                firstHostAssignedAt:
                    input.firstHostAssignedAt === null ? null : new Date(input.firstHostAssignedAt),
                activationDeadline: new Date(input.activationDeadline),
                activatedAt: null,
                creatorParticipantId: input.participant.id,
            });
            await manager.getRepository(RoomParticipantEntity).insert({
                id: input.participant.id,
                roomId: input.participant.roomId,
                role: input.participant.role,
                displayName: input.participant.displayName,
                credentialHash: input.participant.credentialHash,
                devicePlayersJson: JSON.stringify(input.participant.devicePlayers),
                connectionStatus: input.participant.connectionStatus,
                activeHostRoomId:
                    input.participant.role === "HOST" ? input.participant.roomId : null,
                createdAt: new Date(input.participant.joinedAt),
                lastSeenAt: new Date(input.participant.joinedAt),
                firstConnectedAt: null,
                lastConnectedAt: null,
                reconnectDeadline: null,
                activationExpiresAt: new Date(input.participant.activationExpiresAt),
                leftAt: null,
                revokedAt: null,
            });
            if (input.idempotency) {
                await manager.getRepository(RoomCreateIdempotencyEntity).insert({
                    ...input.idempotency,
                    resourceType: "ROOM",
                    createdAt: new Date(input.idempotency.createdAt),
                    updatedAt: new Date(input.idempotency.createdAt),
                    tombstoneExpiresAt: null,
                });
            }
            return { created: true } as const;

            async function validateCreateGroupOwnership() {
                if (input.settings.groupId) {
                    const ownsGroup = input.dataSpaceId
                        ? await manager.getRepository(GroupEntity).existsBy({
                              id: input.settings.groupId,
                              dataSpaceId: input.dataSpaceId,
                          })
                        : false;
                    if (!ownsGroup) {
                        throw Object.assign(new Error("Room Group is outside the DataSpace"), {
                            code: "NOT_AUTHORIZED",
                        });
                    }
                }
            }
        });
    }

    async findRoomCreateIdempotency(
        principalScopeDigest: string,
        routeKey: string,
        keyDigest: string,
    ): Promise<RoomCreateIdempotencyRecord | null> {
        const record = await this.source.getRepository(RoomCreateIdempotencyEntity).findOneBy({
            principalScopeDigest,
            routeKey,
            keyDigest,
        });
        return record ? this.projectCreateIdempotency(record) : null;
    }
    async joinRoom(
        input: Omit<RoomParticipant, "roomId"> & { roomCode: string; credentialHash: string },
        capacity: RoomCapacity,
    ): Promise<void> {
        await this.source.transaction(async (manager) => {
            const roomQuery = manager
                .getRepository(RoomEntity)
                .createQueryBuilder("room")
                .where("room.code = :code", { code: input.roomCode })
                .andWhere("room.closedAt IS NULL");
            if (this.source.options.type === "mariadb" || this.source.options.type === "mysql") {
                roomQuery.setLock("pessimistic_write");
            }
            const room = await roomQuery.getOne();
            if (!room || room.expiresAt <= new Date())
                throw Object.assign(new Error("Room not found"), { code: "ROOM_NOT_FOUND" });
            const participantRepository = manager.getRepository(RoomParticipantEntity);
            const participants = await participantRepository.findBy({
                roomId: room.id,
                connectionStatus: Not("LEFT"),
            });
            const currentPlayers = participants.reduce((total, participant) => {
                if (participant.role === "DISPLAY") return total;
                const devicePlayers = JSON.parse(participant.devicePlayersJson) as DevicePlayer[];
                return total + 1 + devicePlayers.length;
            }, 0);
            const joiningPlayers = input.role === "PLAYER" ? 1 : 0;
            if (
                participants.length >= capacity.maximumParticipants ||
                currentPlayers + joiningPlayers > capacity.maximumPlayers
            ) {
                throw Object.assign(new Error("Room is full"), { code: "ROOM_FULL" });
            }
            await participantRepository.insert({
                id: input.id,
                roomId: room.id,
                role: input.role,
                displayName: input.displayName,
                credentialHash: input.credentialHash,
                devicePlayersJson: JSON.stringify(input.devicePlayers),
                connectionStatus: input.connectionStatus,
                activeHostRoomId: null,
                createdAt: new Date(input.joinedAt),
                lastSeenAt: new Date(input.joinedAt),
                firstConnectedAt: null,
                lastConnectedAt: null,
                reconnectDeadline: null,
                activationExpiresAt: new Date(input.activationExpiresAt),
                leftAt: null,
                revokedAt: null,
            });
        });
    }
    async authenticate(roomCode: string, credentialHash: string): Promise<RoomParticipant | null> {
        const participant = await this.source
            .getRepository(RoomParticipantEntity)
            .createQueryBuilder("participant")
            .innerJoin(RoomEntity, "room", "room.id = participant.roomId")
            .where("room.code = :roomCode", { roomCode })
            .andWhere("room.expiresAt > :now", { now: new Date() })
            .andWhere("room.closedAt IS NULL")
            .andWhere("participant.credentialHash = :credentialHash", { credentialHash })
            .andWhere("participant.connectionStatus != :left", { left: "LEFT" })
            .andWhere("participant.leftAt IS NULL")
            .andWhere("participant.revokedAt IS NULL")
            .getOne();
        return participant ? this.projectParticipant(participant) : null;
    }
    async loadRoomState(roomId: string): Promise<RoomState> {
        const room = await this.source.getRepository(RoomEntity).findOneByOrFail({ id: roomId });
        return this.projectRoom(room);
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
    async resetConnectedParticipants(
        at: number,
        reconnectDeadline: number,
    ): Promise<readonly RoomParticipant[]> {
        return this.source.transaction(async (manager) => {
            const repository = manager.getRepository(RoomParticipantEntity);
            const connected = await repository.findBy({ connectionStatus: "CONNECTED" });
            if (!connected.length) return [];
            await repository.update(
                { connectionStatus: "CONNECTED" },
                {
                    connectionStatus: "TEMPORARILY_DISCONNECTED",
                    lastSeenAt: new Date(at),
                    reconnectDeadline: new Date(reconnectDeadline),
                },
            );
            return connected.map((participant) =>
                this.projectParticipant({
                    ...participant,
                    connectionStatus: "TEMPORARILY_DISCONNECTED",
                    lastSeenAt: new Date(at),
                    reconnectDeadline: new Date(reconnectDeadline),
                }),
            );
        });
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
    async applyLifecycleTransition(
        transition: RoomLifecycleTransition,
    ): Promise<RoomLifecycleTransitionResult> {
        return this.applyLifecycleTransitionOnce(transition);
    }

    async findDueRoomIds(at: number, limit: number): Promise<readonly string[]> {
        const due = new Set<string>();
        const rooms = await this.source
            .getRepository(RoomEntity)
            .createQueryBuilder("room")
            .select("room.id", "id")
            .where("room.closedAt IS NULL")
            .andWhere(
                "(room.expiresAt <= :at OR (room.activatedAt IS NULL AND room.activationDeadline <= :at))",
                { at: new Date(at) },
            )
            .orderBy("room.activationDeadline", "ASC")
            .limit(limit)
            .getRawMany<{ id: string }>();
        for (const room of rooms) due.add(room.id);
        if (due.size < limit) {
            const participants = await this.source
                .getRepository(RoomParticipantEntity)
                .createQueryBuilder("participant")
                .select("participant.roomId", "roomId")
                .distinct(true)
                .where("participant.connectionStatus != :left", { left: "LEFT" })
                .andWhere(
                    `((participant.firstConnectedAt IS NULL AND participant.activationExpiresAt <= :at)
                      OR (participant.connectionStatus = :disconnected AND participant.reconnectDeadline <= :at))`,
                    { at: new Date(at), disconnected: "TEMPORARILY_DISCONNECTED" },
                )
                .limit(limit - due.size)
                .getRawMany<{ roomId: string }>();
            for (const participant of participants) due.add(participant.roomId);
        }
        return [...due].slice(0, limit);
    }

    async deleteExpiredRoomCreateTombstones(at: number, limit: number): Promise<number> {
        const repository = this.source.getRepository(RoomCreateIdempotencyEntity);
        const expired = await repository.find({
            where: {
                state: "RESOURCE_GONE",
                tombstoneExpiresAt: LessThanOrEqual(new Date(at)),
            },
            order: { tombstoneExpiresAt: "ASC" },
            take: limit,
            select: { id: true },
        });
        if (!expired.length) return 0;
        const result = await repository.delete(expired.map(({ id }) => id));
        return result.affected ?? 0;
    }
    async loadSettings(roomId: string): Promise<VersionedRoomGameSettings> {
        const room = await this.source.getRepository(RoomEntity).findOneByOrFail({ id: roomId });
        return {
            ...normalizeRoomGameSettings(JSON.parse(room.gameSettingsJson) as RoomGameSettings),
            revision: room.settingsRevision,
            updatedByParticipantId: room.settingsUpdatedByParticipantId,
        };
    }
    async saveSettings(
        roomId: string,
        participantId: string,
        expectedRevision: number,
        settings: RoomGameSettings,
    ): Promise<VersionedRoomGameSettings> {
        return this.source.transaction(async (manager) => {
            const rooms = manager.getRepository(RoomEntity);
            const room = await rooms.findOneByOrFail({ id: roomId });
            if (settings.groupId) {
                if (!room.dataSpaceId) {
                    throw Object.assign(new Error("Ephemeral Rooms cannot select a Group"), {
                        code: "NOT_AUTHORIZED",
                    });
                }
                const owned = await manager.getRepository(GroupEntity).existsBy({
                    id: settings.groupId,
                    dataSpaceId: room.dataSpaceId,
                });
                if (!owned) {
                    throw Object.assign(new Error("Group is outside the Room DataSpace"), {
                        code: "NOT_AUTHORIZED",
                    });
                }
            }
            const revision = expectedRevision + 1;
            const updated = await rooms.update(
                { id: roomId, settingsRevision: expectedRevision },
                {
                    groupId: settings.groupId,
                    settingsRevision: revision,
                    gameSettingsJson: JSON.stringify(settings),
                    settingsUpdatedByParticipantId: participantId,
                },
            );
            if (updated.affected !== 1) {
                throw Object.assign(new Error("Stale Room settings revision"), {
                    code: "STALE_SESSION_REVISION",
                });
            }
            return { ...settings, revision, updatedByParticipantId: participantId };
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
            const history = await this.loadOwnedGroupHistory(manager, room.dataSpaceId, groupId);
            await rooms.update({ id: roomId }, { groupId });
            return history;
        });
    }
    async groupHistory(roomId: string, groupId: string | null): Promise<ReadonlySet<CardId>> {
        return this.source.transaction(async (manager) => {
            const room = await manager.getRepository(RoomEntity).findOneByOrFail({ id: roomId });
            return this.loadOwnedGroupHistory(manager, room.dataSpaceId, groupId);
        });
    }
    async policyOwner(
        roomId: string,
    ): Promise<{ dataSpaceId: string; groupId: string | null } | null> {
        const room = await this.source.getRepository(RoomEntity).findOneByOrFail({ id: roomId });
        return room.dataSpaceId ? { dataSpaceId: room.dataSpaceId, groupId: room.groupId } : null;
    }
    async loadRuntime(roomId: string): Promise<GameSessionRuntimeState | null> {
        const room = await this.source.getRepository(RoomEntity).findOneByOrFail({ id: roomId });
        if (!room.currentSessionId) return null;
        const record = await this.source
            .getRepository(GameSessionEntity)
            .findOneBy({ id: room.currentSessionId, roomId });
        if (!record) return null;
        const appearances = await this.source.getRepository(CardAppearanceEntity).find({
            where: { sessionId: record.id },
            order: { sequence: "ASC" },
        });
        const parsed = await hydrateSessionImmutableState(
            this.source.manager,
            record.runtimeStateJson,
            {
                compiledCardPolicyDigest: record.compiledCardPolicyDigest,
                groupHistoryDigest: record.groupHistoryDigest,
            },
            appearances.length
                ? appearances.map((appearance) => ({
                      cardId: appearance.cardId as CardId,
                      playerId: appearance.playerId,
                      roundNumber: appearance.roundNumber,
                      sequence: appearance.sequence,
                      skipped: appearance.skipped,
                      completed: appearance.completed,
                      vetoed: appearance.vetoed,
                  }))
                : undefined,
        );
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
                if (room.currentSessionId)
                    throw Object.assign(new Error("Room already has a current Session"), {
                        code: "INVALID_GAME_STATE",
                    });
                const persisted = await externalizeSessionImmutableState(manager, runtime);
                await sessions.insert({
                    id: runtime.id,
                    roomId,
                    groupId: room.groupId,
                    mode: runtime.mode,
                    revision: runtime.revision,
                    runtimeStateVersion: runtime.version,
                    runtimeStateJson: persisted.runtimeStateJson,
                    compiledCardPolicyDigest: persisted.compiledCardPolicyDigest,
                    groupHistoryDigest: persisted.groupHistoryDigest,
                    startedAt: new Date(runtime.startedAt),
                    endedAt: runtime.state === "ENDED" ? new Date() : null,
                });
                const activated = await manager
                    .getRepository(RoomEntity)
                    .update(
                        { id: roomId, currentSessionId: IsNull() },
                        { currentSessionId: runtime.id },
                    );
                if (activated.affected !== 1)
                    throw Object.assign(new Error("Room already has a current Session"), {
                        code: "INVALID_GAME_STATE",
                    });
            } else {
                if (room.currentSessionId !== runtime.id)
                    throw Object.assign(new Error("Stale current Session"), {
                        code: "STALE_SESSION_REVISION",
                    });
                const existing = await sessions.findOneBy({ id: runtime.id, roomId });
                const persisted = await externalizeSessionImmutableState(manager, runtime, {
                    compiledCardPolicyDigest: existing?.compiledCardPolicyDigest ?? null,
                    groupHistoryDigest: existing?.groupHistoryDigest ?? null,
                });
                const updated = await sessions.update(
                    { id: runtime.id, roomId, revision: previousRevision },
                    {
                        revision: runtime.revision,
                        runtimeStateVersion: runtime.version,
                        runtimeStateJson: persisted.runtimeStateJson,
                        compiledCardPolicyDigest: persisted.compiledCardPolicyDigest,
                        groupHistoryDigest: persisted.groupHistoryDigest,
                        endedAt: runtime.state === "ENDED" ? new Date() : null,
                    },
                );
                if (updated.affected !== 1)
                    throw Object.assign(new Error("Stale persisted Session revision"), {
                        code: "STALE_SESSION_REVISION",
                    });
            }
            await this.persistChangedAppearances(manager, runtime, room);
        });
    }

    private async persistChangedAppearances(
        manager: EntityManager,
        runtime: GameSessionRuntimeState,
        room: RoomEntity,
    ) {
        const appearances = manager.getRepository(CardAppearanceEntity);
        const storedLatest = await appearances.findOne({
            where: { sessionId: runtime.id },
            order: { sequence: "DESC" },
        });
        const changedAppearances = runtime.sessionHistory.filter(
            ({ sequence }) => !storedLatest || sequence >= storedLatest.sequence,
        );
        for (const appearance of changedAppearances) {
            const id = uuidv5(`${runtime.id}:${appearance.sequence}`, APPEARANCE_NAMESPACE);
            const existing = storedLatest?.id === id ? storedLatest : null;
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
                    completed: appearance.completed,
                    vetoed: appearance.vetoed,
                }),
            );
        }
    }

    async clearEndedRuntime(roomId: string, sessionId: string, revision: number): Promise<void> {
        await this.source.transaction(async (manager) => {
            const sessions = manager.getRepository(GameSessionEntity);
            const session = await sessions.findOneBy({ id: sessionId, roomId, revision });
            if (!session?.endedAt)
                throw Object.assign(new Error("Session cannot be reset in its current state"), {
                    code: "INVALID_GAME_STATE",
                });
            const cleared = await manager
                .getRepository(RoomEntity)
                .update({ id: roomId, currentSessionId: sessionId }, { currentSessionId: null });
            if (cleared.affected !== 1)
                throw Object.assign(new Error("Stale current Session"), {
                    code: "STALE_SESSION_REVISION",
                });
        });
    }

    private async applyLifecycleTransitionOnce(
        transition: RoomLifecycleTransition,
    ): Promise<RoomLifecycleTransitionResult> {
        return this.source.transaction(async (manager) => {
            const roomQuery = manager
                .getRepository(RoomEntity)
                .createQueryBuilder("room")
                .where("room.id = :roomId", { roomId: transition.roomId });
            if (this.source.options.type === "mariadb" || this.source.options.type === "mysql") {
                roomQuery.setLock("pessimistic_write");
            }
            const storedRoom = await roomQuery.getOne();
            if (!storedRoom || storedRoom.closedAt) {
                return {
                    participant: null,
                    expiredParticipants: [],
                    roleChanges: [],
                    roomClosed: true,
                    hostStatusBefore: null,
                    hostStatusAfter: null,
                    participantFirstActivated: false,
                    replayResultsErased: 0,
                    closeReason: null,
                    invariantRepair: false,
                };
            }
            const room = storedRoom;
            const repository = manager.getRepository(RoomParticipantEntity);
            const participants = await repository.find({
                where: { roomId: room.id },
                order: { createdAt: "ASC", id: "ASC" },
            });
            const at = new Date(transition.at);
            const hostStatusBefore = derivePersistedRoomHostStatus(
                this.projectRoom(room),
                participants.map((participant) => this.projectParticipant(participant)),
                transition.at,
            );
            const transitionParticipantId =
                "participantId" in transition ? transition.participantId : null;
            const expired: RoomParticipantEntity[] = [];
            const terminalParticipantIds = new Set<string>();
            let participantFirstActivated = false;
            let hostLossReason: import("../application/realtimeRooms").RoomRoleChangeReason | null =
                null;

            const markTerminal = (participant: RoomParticipantEntity): void => {
                participant.connectionStatus = "LEFT";
                participant.activeHostRoomId = null;
                participant.reconnectDeadline = null;
                participant.leftAt = at;
                participant.lastSeenAt = at;
                terminalParticipantIds.add(participant.id);
            };

            expireParticipants();

            let transitioned = transitionParticipantId
                ? participants.find(({ id }) => id === transitionParticipantId)
                : undefined;
            let activationRejected = false;
            applyParticipantTransition();

            const roomExpired = room.expiresAt <= at;

            let trigger: HostSelectionTrigger = hostSelectionTrigger();

            const decision = decideRoomHost({
                room: this.projectRoom(room),
                participants: participants.map((participant) =>
                    this.projectParticipant(participant),
                ),
                trigger,
                now: transition.at,
            });
            const roleChanges: RoomRoleChange[] = await persistHostRoles();
            if (decision.closeRoom && !room.closedAt) {
                room.closedAt = at;
                for (const participant of participants) {
                    if (participant.connectionStatus !== "LEFT") markTerminal(participant);
                }
            }

            await manager.getRepository(RoomEntity).save(room);
            await repository.save(participants);
            const replayResultsErased = await this.markCreateResultsGone(
                manager,
                [...terminalParticipantIds],
                transition.at,
            );
            transitioned = transitionParticipantId
                ? participants.find(({ id }) => id === transitionParticipantId)
                : undefined;
            let closeReason: import("../application/realtimeRooms").RoomCloseReason | null =
                roomCloseReason();
            return {
                participant:
                    transitioned && !activationRejected
                        ? this.projectParticipant(transitioned)
                        : null,
                expiredParticipants: expired.map((participant) =>
                    this.projectParticipant(participant),
                ),
                roleChanges,
                roomClosed: room.closedAt !== null,
                hostStatusBefore,
                hostStatusAfter: decision.hostStatus,
                participantFirstActivated,
                replayResultsErased,
                closeReason,
                invariantRepair: decision.invariantRepair,
            };

            function roomCloseReason() {
                let closeReason: import("../application/realtimeRooms").RoomCloseReason | null =
                    null;
                if (decision.closeRoom) {
                    if (transition.type === "CLOSE") closeReason = "EXPLICIT_CLOSE";
                    else if (roomExpired) closeReason = "ROOM_EXPIRED";
                    else if (
                        room.activatedAt === null &&
                        (room.activationDeadline ?? room.expiresAt) <= at
                    ) {
                        closeReason = "INITIAL_ACTIVATION_EXPIRED";
                    } else closeReason = "ABANDONED";
                }
                return closeReason;
            }

            async function persistHostRoles() {
                const roleChanges: RoomRoleChange[] = [];
                for (const demoteParticipantId of decision.demoteParticipantIds) {
                    const demoted = participants.find(({ id }) => id === demoteParticipantId);
                    if (demoted?.role === "HOST") {
                        demoted.role = "PLAYER";
                        demoted.activeHostRoomId = null;
                        await repository.update(
                            { id: demoted.id, roomId: room.id },
                            { role: "PLAYER", activeHostRoomId: null },
                        );
                        if (decision.reason) {
                            roleChanges.push({
                                participantId: demoted.id,
                                previousRole: "HOST",
                                role: "PLAYER",
                                reason: decision.reason,
                            });
                        }
                    }
                }
                if (decision.promoteParticipantId) {
                    const promoted = participants.find(
                        ({ id }) => id === decision.promoteParticipantId,
                    );
                    if (promoted?.role !== "PLAYER") {
                        throw new Error("Selected Room Host is no longer an eligible Player");
                    }
                    await repository.update(
                        { roomId: room.id, activeHostRoomId: room.id },
                        { activeHostRoomId: null },
                    );
                    promoted.role = "HOST";
                    promoted.activeHostRoomId = room.id;
                    await repository.update(
                        { id: promoted.id, roomId: room.id, role: "PLAYER" },
                        { role: "HOST", activeHostRoomId: room.id },
                    );
                    room.firstHostAssignedAt ??= at;
                    roleChanges.push({
                        participantId: promoted.id,
                        previousRole: "PLAYER",
                        role: "HOST",
                        reason: decision.reason ?? "INITIAL_HOST_ASSIGNED",
                    });
                }
                return roleChanges;
            }

            function hostSelectionTrigger() {
                let trigger: HostSelectionTrigger = { type: "RECONCILE" };
                if (transition.type === "ACTIVATE" && !activationRejected) {
                    trigger = { type: "ACTIVATE", participantId: transition.participantId };
                } else if (transition.type === "TRANSFER_HOST") {
                    trigger = {
                        type: "TRANSFER",
                        participantId: transition.participantId,
                        targetParticipantId: transition.targetParticipantId,
                    };
                } else if (transition.type === "CLOSE") {
                    trigger = { type: "CLOSE", participantId: transition.participantId };
                } else if (hostLossReason) {
                    trigger = { type: "HOST_LOST", reason: hostLossReason };
                }
                return trigger;
            }

            function applyParticipantTransition() {
                if (transition.type === "ACTIVATE") {
                    if (
                        transitioned?.credentialHash !== transition.credentialHash ||
                        transitioned.connectionStatus === "LEFT" ||
                        transitioned.leftAt ||
                        transitioned.revokedAt ||
                        room.expiresAt <= at
                    ) {
                        activationRejected = true;
                        transitioned = undefined;
                    } else {
                        participantFirstActivated = transitioned.firstConnectedAt === null;
                        transitioned.firstConnectedAt ??= at;
                        transitioned.lastConnectedAt = at;
                        transitioned.lastSeenAt = at;
                        transitioned.connectionStatus = "CONNECTED";
                        transitioned.reconnectDeadline = null;
                        room.activatedAt ??= at;
                    }
                } else if (transition.type === "DISCONNECT") {
                    if (transitioned?.connectionStatus === "CONNECTED") {
                        transitioned.connectionStatus = "TEMPORARILY_DISCONNECTED";
                        transitioned.lastSeenAt = at;
                        transitioned.reconnectDeadline = new Date(transition.reconnectDeadline);
                    }
                } else if (transition.type === "LEAVE") {
                    if (transitioned && transitioned.connectionStatus !== "LEFT") {
                        if (transitioned.role === "HOST") hostLossReason = "HOST_LEFT";
                        markTerminal(transitioned);
                    }
                }
            }

            function expireParticipants() {
                for (const participant of participants) {
                    if (participant.connectionStatus === "LEFT" || participant.leftAt) continue;
                    const activationExpired =
                        participant.firstConnectedAt === null &&
                        participant.activationExpiresAt !== null &&
                        participant.activationExpiresAt <= at;
                    const reconnectExpired =
                        participant.firstConnectedAt !== null &&
                        participant.connectionStatus === "TEMPORARILY_DISCONNECTED" &&
                        participant.reconnectDeadline !== null &&
                        participant.reconnectDeadline <= at;
                    if (!activationExpired && !reconnectExpired) continue;
                    if (participant.role === "HOST") {
                        hostLossReason = activationExpired
                            ? "HOST_ACTIVATION_EXPIRED"
                            : "HOST_DISCONNECT_EXPIRED";
                    }
                    markTerminal(participant);
                    expired.push(participant);
                }
            }
        });
    }

    private async markCreateResultsGone(
        manager: EntityManager,
        participantIds: readonly string[],
        at: number,
    ): Promise<number> {
        if (!participantIds.length) return 0;
        const now = new Date(at);
        const result = await manager.getRepository(RoomCreateIdempotencyEntity).update(
            { creatorParticipantId: In([...participantIds]), state: "REPLAYABLE" },
            {
                state: "RESOURCE_GONE",
                statusCode: null,
                responseSchemaVersion: null,
                responseKeyId: null,
                responseCiphertext: null,
                updatedAt: now,
                tombstoneExpiresAt: new Date(at + this.idempotencyTombstoneSeconds * 1_000),
            },
        );
        return result.affected ?? 0;
    }

    private resolveCreateIdempotency(
        existing: RoomCreateIdempotencyEntity | RoomCreateIdempotencyRecord,
        requested: { requestFingerprint: string },
    ): { created: false; record: RoomCreateIdempotencyRecord } {
        if (existing.requestFingerprint !== requested.requestFingerprint) {
            throw Object.assign(new Error("Idempotency key was reused for another request"), {
                code: "IDEMPOTENCY_KEY_REUSED",
            });
        }
        if (existing.state === "RESOURCE_GONE") {
            throw Object.assign(new Error("Idempotent Room-create result is no longer available"), {
                code: "IDEMPOTENCY_RESULT_GONE",
            });
        }
        return { created: false, record: this.projectCreateIdempotency(existing) };
    }

    private projectCreateIdempotency(
        record: RoomCreateIdempotencyEntity | RoomCreateIdempotencyRecord,
    ): RoomCreateIdempotencyRecord {
        return {
            principalScopeDigest: record.principalScopeDigest,
            routeKey: record.routeKey,
            keyDigest: record.keyDigest,
            lookupKeyId: record.lookupKeyId,
            requestFingerprint: record.requestFingerprint,
            state: record.state,
            statusCode: record.statusCode,
            responseSchemaVersion: record.responseSchemaVersion,
            responseKeyId: record.responseKeyId,
            responseCiphertext: record.responseCiphertext,
            resourceId: record.resourceId,
            creatorParticipantId: record.creatorParticipantId,
        };
    }

    private projectRoom(room: RoomEntity): RoomState {
        return {
            id: room.id,
            code: room.code,
            bootstrapMode: room.bootstrapMode,
            firstHostAssignedAt: room.firstHostAssignedAt?.getTime() ?? null,
            activationDeadline: (room.activationDeadline ?? room.expiresAt).getTime(),
            activatedAt: room.activatedAt?.getTime() ?? null,
            createdAt: room.createdAt.getTime(),
            expiresAt: room.expiresAt.getTime(),
            closedAt: room.closedAt?.getTime() ?? null,
            creatorParticipantId: room.creatorParticipantId ?? "",
        };
    }

    private projectParticipant(participant: RoomParticipantEntity): RoomParticipant {
        return {
            id: participant.id,
            roomId: participant.roomId,
            role: participant.role,
            displayName: participant.displayName,
            devicePlayers: JSON.parse(participant.devicePlayersJson) as DevicePlayer[],
            connectionStatus: participant.connectionStatus,
            joinedAt: participant.createdAt.getTime(),
            firstConnectedAt: participant.firstConnectedAt?.getTime() ?? null,
            lastConnectedAt: participant.lastConnectedAt?.getTime() ?? null,
            reconnectDeadline: participant.reconnectDeadline?.getTime() ?? null,
            activationExpiresAt:
                participant.activationExpiresAt?.getTime() ?? participant.createdAt.getTime(),
            leftAt: participant.leftAt?.getTime() ?? null,
            revokedAt: participant.revokedAt?.getTime() ?? null,
        };
    }

    private async loadOwnedGroupHistory(
        manager: EntityManager,
        dataSpaceId: string | null,
        groupId: string | null,
    ): Promise<ReadonlySet<CardId>> {
        if (!groupId) return new Set<CardId>();
        if (!dataSpaceId) {
            throw Object.assign(new Error("Unowned Room cannot use a persistent Group"), {
                code: "NOT_AUTHORIZED",
            });
        }
        const group = await manager.getRepository(GroupEntity).findOneBy({
            id: groupId,
            dataSpaceId,
        });
        if (!group) {
            throw Object.assign(new Error("Group is outside the Room DataSpace"), {
                code: "NOT_AUTHORIZED",
            });
        }
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
    }
}

function isDatabaseContention(error: unknown): boolean {
    const details = error as { code?: unknown; errno?: unknown; sqlState?: unknown };
    const code = typeof details.code === "string" ? details.code.toUpperCase() : "";
    const sqlState = typeof details.sqlState === "string" ? details.sqlState : "";
    return (
        ["SQLITE_BUSY", "SQLITE_LOCKED", "ER_LOCK_WAIT_TIMEOUT", "ER_LOCK_DEADLOCK"].includes(
            code,
        ) ||
        details.errno === 1205 ||
        details.errno === 1213 ||
        sqlState === "40001"
    );
}

function canRetryRoomCreation(error: unknown, attempts: number): boolean {
    return attempts < 2 && isDatabaseContention(error);
}
