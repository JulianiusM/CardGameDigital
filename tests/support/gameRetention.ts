import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { describe, it, expect } from "vitest";
import { RoomService } from "../../packages/application/roomService";
import { CryptoRandomSource } from "../../packages/application/cryptoRandomSource";
import { CouchSessionService } from "../../packages/application/couchSessionService";
import { defaultRoomGameSettings } from "../../packages/application/roomGameSettings";
import {
    ENDED_EPHEMERAL_TTL_MS,
    SESSION_IDLE_TTL_MS,
} from "../../packages/application/sessionCache";
import { SequenceRandomSource, type DataSpaceId } from "../../packages/game-core";
import {
    TypeOrmGameRetention,
    GAME_RETENTION_BATCH_SIZE,
} from "../../packages/persistence/TypeOrmGameRetention";
import { TypeOrmRealtimeRoomRepository } from "../../packages/persistence/TypeOrmRealtimeRoomRepository";
import { TypeOrmCouchSessionRepository } from "../../packages/persistence/TypeOrmCouchSessionRepository";
import { TypeOrmCardRepository } from "../../packages/persistence/TypeOrmCardRepository";
import { DataSpace } from "../../packages/persistence/entities/user/DataSpace";
import { CardEntity } from "../../packages/persistence/entities/card/CardEntity";
import { RoomEntity } from "../../packages/persistence/entities/game/RoomEntity";
import { RoomParticipantEntity } from "../../packages/persistence/entities/game/RoomParticipantEntity";
import { CouchGameSessionEntity } from "../../packages/persistence/entities/game/CouchGameSessionEntity";
import { CouchCardAppearanceEntity } from "../../packages/persistence/entities/game/CouchCardAppearanceEntity";
import { SessionImmutablePayloadEntity } from "../../packages/persistence/entities/game/SessionImmutablePayloadEntity";
import { GroupEntity } from "../../packages/persistence/entities/game/GroupEntity";
import { GameSessionEntity } from "../../packages/persistence/entities/game/GameSessionEntity";
import { DEFAULT_GAME_RESOURCE_LIMITS } from "../../packages/application/gameResourceLimits";
import {
    configurePersistenceWorkLimits,
    persistenceWorkLimits,
} from "../../packages/persistence/persistenceWorkLimits";

export function gameRetentionTests(getSource: () => DataSource) {
    describe("operational retention", () => {
        it("shares the configured scan budget across repositories and releases it when a stream closes", async () => {
            const source = getSource();
            const previous = persistenceWorkLimits();
            configurePersistenceWorkLimits({ ...previous, cardConcurrentScans: 1 });
            const repository = () => new TypeOrmCardRepository(source.getRepository(CardEntity));
            const policy = {
                locale: "en-GB",
                missingTranslation: "EXCLUDE" as const,
                fallbackLocales: [],
            };
            const first = repository().scan(policy)[Symbol.asyncIterator]();
            try {
                expect((await first.next()).done).toBe(false);
                await expect(
                    repository().scan(policy)[Symbol.asyncIterator]().next(),
                ).rejects.toMatchObject({
                    code: "SESSION_CAPACITY_EXCEEDED",
                });
                await first.return?.();
                const next = repository().scan(policy)[Symbol.asyncIterator]();
                try {
                    expect((await next.next()).done).toBe(false);
                } finally {
                    await next.return?.();
                }
            } finally {
                await first.return?.();
                configurePersistenceWorkLimits(previous);
            }
        });
        it("purges detached temporary Sessions while a reused Room keeps its current game and participants", async () => {
            const source = getSource();
            const service = new RoomService(
                new TypeOrmRealtimeRoomRepository(source),
                new TypeOrmCardRepository(source.getRepository(CardEntity)),
                new CryptoRandomSource(),
            );
            const room = await service.createRoom("Host");
            try {
                const joined = await service.joinRoom(room.roomCode, "Player", "PLAYER");
                const host = (await service.authenticate(
                    room.roomCode,
                    room.participantCredential,
                ))!;
                await service.authenticate(room.roomCode, joined.participantCredential);
                const endedIds: string[] = [];
                for (let i = 0; i < 3; i++) {
                    const started = await service.execute(room.roomId, host, {
                        type: "command.startSession",
                        revision: null,
                        payload: {},
                    });
                    endedIds.push(started.session!.id);
                    const ended = await service.execute(room.roomId, host, {
                        type: "command.endSession",
                        revision: started.session!.revision,
                        payload: {},
                    });
                    await service.execute(room.roomId, host, {
                        type: "command.resetSession",
                        revision: ended.session!.revision,
                        payload: {},
                    });
                }
                const current = await service.execute(room.roomId, host, {
                    type: "command.startSession",
                    revision: null,
                    payload: {},
                });
                await source.getRepository(GameSessionEntity).update(endedIds, {
                    endedAt: new Date(Date.now() - ENDED_EPHEMERAL_TTL_MS - 1),
                });
                for (let i = 0; i < 8; i++) await new TypeOrmGameRetention(source).sweep();
                for (const id of endedIds)
                    expect(await source.getRepository(GameSessionEntity).existsBy({ id })).toBe(
                        false,
                    );
                expect(await service.snapshot(room.roomId, host)).toEqual(current);
            } finally {
                await source
                    .getRepository(RoomEntity)
                    .update({ id: room.roomId }, { currentSessionId: null });
                await source.getRepository(RoomEntity).delete(room.roomId);
            }
        });
        it("admits one winner for the configured final Room slot across independent repositories", async () => {
            const source = getSource();
            const cards = new TypeOrmCardRepository(source.getRepository(CardEntity));
            let limits = DEFAULT_GAME_RESOURCE_LIMITS;
            const service = () =>
                new RoomService(
                    new TypeOrmRealtimeRoomRepository(source, undefined, limits),
                    cards,
                    new CryptoRandomSource(),
                );
            const initial = await service().createRoom("Capacity");
            const rooms = source.getRepository(RoomEntity);
            const [{ total }] = await source.query(
                "SELECT COUNT(*) AS total FROM rooms WHERE data_space_id IS NULL OR closed_at IS NULL",
            );
            const ids = [initial.roomId];
            limits = { ...limits, retainedRoomCapacity: Number(total) + 1 };
            try {
                const results = await Promise.allSettled([
                    service().createRoom("First"),
                    service().createRoom("Second"),
                ]);
                for (const result of results)
                    if (result.status === "fulfilled") ids.push(result.value.roomId);
                expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
                expect(results.find((result) => result.status === "rejected")).toMatchObject({
                    reason: { code: "SESSION_CAPACITY_EXCEEDED" },
                });
            } finally {
                await rooms.delete(ids);
            }
        }, 60_000);
        it("converges through create/expire/restart cycles in bounded batches, preserving a live Room", async () => {
            const source = getSource();
            const repository = new TypeOrmRealtimeRoomRepository(source);
            const cards = new TypeOrmCardRepository(source.getRepository(CardEntity));
            const service = new RoomService(repository, cards, new CryptoRandomSource());
            const live = await service.createRoom("Live");
            const createdIds: string[] = [live.roomId];
            try {
                for (let cycle = 0; cycle < 3; cycle++) {
                    const batch: string[] = [];
                    for (let index = 0; index < 20; index++) {
                        const game = await service.createRoom("Temporary");
                        batch.push(game.roomId);
                        createdIds.push(game.roomId);
                        await repository.applyLifecycleTransition({
                            type: "RECONCILE",
                            roomId: game.roomId,
                            at: Date.now() + SESSION_IDLE_TTL_MS + 1,
                        });
                        await source
                            .getRepository(RoomEntity)
                            .update(
                                { id: game.roomId },
                                { closedAt: new Date(Date.now() - ENDED_EPHEMERAL_TTL_MS - 1) },
                            );
                    }
                    // A fresh worker models restart; no in-memory timestamp is required.
                    const first = await new TypeOrmGameRetention(source).sweep();
                    expect(first.deletedRooms).toBeLessThanOrEqual(GAME_RETENTION_BATCH_SIZE);
                    expect(first.deletedRooms).toBeGreaterThan(0);
                    for (let pass = 0; pass < 8; pass++)
                        await new TypeOrmGameRetention(source).sweep();
                    for (const id of batch) {
                        expect(await source.getRepository(RoomEntity).existsBy({ id })).toBe(false);
                        expect(
                            await source
                                .getRepository(RoomParticipantEntity)
                                .existsBy({ roomId: id }),
                        ).toBe(false);
                    }
                    expect(
                        await source.getRepository(RoomEntity).existsBy({ id: live.roomId }),
                    ).toBe(true);
                }
            } finally {
                await source.getRepository(RoomEntity).delete(createdIds);
            }
        }, 60_000);

        it("uses configured Couch inactivity while retaining Group appearances and shared live policy", async () => {
            const source = getSource();
            const owner = await source
                .getRepository(DataSpace)
                .save({ name: "Retention history", defaultForOwner: false });
            const groupId = randomUUID();
            await source.getRepository(GroupEntity).insert({
                id: groupId,
                dataSpaceId: owner.id,
                name: "History",
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            try {
                const cards = new TypeOrmCardRepository(source.getRepository(CardEntity));
                const [{ total }] = await source.query(
                    "SELECT COUNT(*) AS total FROM couch_game_sessions WHERE ended_at IS NULL",
                );
                const repository = new TypeOrmCouchSessionRepository(source, {
                    ...DEFAULT_GAME_RESOURCE_LIMITS,
                    savedCouchCapacity: Number(total) + 2,
                });
                const createService = () =>
                    new CouchSessionService(
                        cards,
                        new SequenceRandomSource([0.4]),
                        undefined,
                        repository,
                    );
                const input = {
                    ...defaultRoomGameSettings(),
                    persistence: "DATASPACE" as const,
                    dataSpaceId: owner.id as DataSpaceId,
                    groupId,
                    adultContentConfirmed: true,
                    cardPolicy: {
                        scopeDefault: { weight: { mode: "SET" as const, value: 0.12345678 } },
                        conditionalRules: [],
                        exactCards: [],
                    },
                    players: [{ name: "First" }, { name: "Second" }],
                };
                const previousBudget = persistenceWorkLimits();
                configurePersistenceWorkLimits({ ...previousBudget, policyInputMaximumBytes: 1 });
                try {
                    await expect(createService().create(input)).rejects.toMatchObject({
                        code: "SESSION_CAPACITY_EXCEEDED",
                        status: 429,
                    });
                    expect(
                        await source
                            .getRepository(CouchGameSessionEntity)
                            .countBy({ dataSpaceId: owner.id }),
                    ).toBe(0);
                } finally {
                    configurePersistenceWorkLimits(previousBudget);
                }
                const expired = await createService().create(input);
                const active = await createService().create(input);
                await expect(createService().create(input)).rejects.toMatchObject({
                    code: "SESSION_CAPACITY_EXCEEDED",
                });
                const shown = await createService().chooseCardType(
                    expired.id,
                    expired.revision,
                    "QUESTION",
                );
                const rows = source.getRepository(CouchGameSessionEntity);
                const digest = (await rows.findOneByOrFail({ id: active.id })).policyInputDigest!;
                await rows.update({ id: expired.id }, { lastActiveAt: new Date(99_000) });
                const result = await new TypeOrmGameRetention(source, {
                    ...DEFAULT_GAME_RESOURCE_LIMITS,
                    sessionIdleTtlSeconds: 2,
                }).sweep(102_000);
                expect(result.expiredCouchGames).toBeGreaterThan(0);
                const ended = await createService().get(expired.id);
                expect(ended.state).toBe("ENDED");
                expect(ended.revision).toBe(shown.revision + 1);
                expect(
                    (await rows.findOneByOrFail({ id: expired.id })).policyInputDigest,
                ).toBeNull();
                expect(
                    await source
                        .getRepository(CouchCardAppearanceEntity)
                        .countBy({ sessionId: expired.id, groupId }),
                ).toBe(1);
                expect(
                    await source.getRepository(SessionImmutablePayloadEntity).existsBy({ digest }),
                ).toBe(true);
                expect((await createService().get(active.id)).revision).toBe(active.revision);
                await createService().end(active.id, active.revision);
                await new TypeOrmGameRetention(source).sweep();
                expect(
                    await source.getRepository(SessionImmutablePayloadEntity).existsBy({ digest }),
                ).toBe(false);
            } finally {
                await source.getRepository(DataSpace).delete(owner.id);
            }
        });
    });
}
