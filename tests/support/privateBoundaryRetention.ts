import { TypeOrmCardRepository } from "../../packages/persistence/TypeOrmCardRepository";
import { testCatalogAccess } from "./game";
import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { describe, expect, it } from "vitest";
import { RoomService } from "../../packages/application/roomService";
import { defaultRoomGameSettings } from "../../packages/application/roomGameSettings";
import {
    GameSession,
    SequenceRandomSource,
    QUESTION_CATEGORIES,
    type CardId,
    type GameSessionRuntimeState,
    type DataSpaceId,
} from "../../packages/game-core";
import { TypeOrmRealtimeRoomRepository } from "../../packages/persistence/TypeOrmRealtimeRoomRepository";
import { TypeOrmCouchSessionRepository } from "../../packages/persistence/TypeOrmCouchSessionRepository";
import { CardEntity } from "../../packages/persistence/entities/card/CardEntity";
import { GameSessionEntity } from "../../packages/persistence/entities/game/GameSessionEntity";
import { CouchGameSessionEntity } from "../../packages/persistence/entities/game/CouchGameSessionEntity";
import { CardAppearanceEntity } from "../../packages/persistence/entities/game/CardAppearanceEntity";
import { RoomEntity } from "../../packages/persistence/entities/game/RoomEntity";
import { RoomParticipantEntity } from "../../packages/persistence/entities/game/RoomParticipantEntity";
import { RoomParticipantBoundaryEntity } from "../../packages/persistence/entities/game/RoomParticipantBoundaryEntity";
import { DataSpace } from "../../packages/persistence/entities/user/DataSpace";
import { User } from "../../packages/persistence/entities/user/User";
import {
    deleteDataSpace,
    deleteUser,
} from "../../apps/server/src/modules/database/services/UserService";
import { ScrubExpiredPrivateBoundaries1787359000000 } from "../../apps/server/migrations/1787359000000-ScrubExpiredPrivateBoundaries";
import { card } from "./game";

export function privateBoundaryRetentionTests(getSource: () => DataSource): void {
    async function fixture(dataSpaceId: string | null = null) {
        const source = getSource();
        const repository = new TypeOrmRealtimeRoomRepository(source);
        const storedCard = await source
            .getRepository(CardEntity)
            .findOneOrFail({ where: {}, select: { id: true } });
        const playable = card({ id: storedCard.id as CardId });
        const cards = {
            ...testCatalogAccess,
            catalogProvenance: () =>
                new TypeOrmCardRepository(source.getRepository(CardEntity)).catalogProvenance(),
            async *scan(
                localization: import("../../packages/application/repositories").CardLocalizationPolicy,
                history?: import("../../packages/game-core").CardHistoryContext | null,
            ) {
                const selected = new Map((await this.listActive()).map((card) => [card.id, card]));
                const stored = new TypeOrmCardRepository(source.getRepository(CardEntity));
                for await (const candidate of stored.scan(
                    { locale: await stored.defaultLocale(), missingTranslation: "EXCLUDE" },
                    history,
                )) {
                    const card = selected.get(candidate.id);
                    if (card)
                        yield {
                            ...card,
                            lastShownSequence: candidate.lastShownSequence,
                            seenInGroup: candidate.seenInGroup,
                        };
                }
            },
            listActive: async () => [playable],
            getById: async () => playable,
            defaultLocale: async () => "de-DE",
            isLocaleActive: async () => true,
            findEligibleCandidates: async () => [playable],
        };
        const createService = () =>
            new RoomService(repository, cards, new SequenceRandomSource([0]));
        const service = createService();
        const room = await service.createRoom("Host", dataSpaceId, defaultRoomGameSettings());
        const joined = await service.joinRoom(room.roomCode, "Player", "PLAYER");
        const devicePlayerId = randomUUID();
        await repository.saveDevicePlayers(joined.participantId, [
            { id: devicePlayerId, name: "Local player" },
        ]);
        const host = (await service.authenticate(room.roomCode, room.participantCredential))!;
        const player = (await service.authenticate(room.roomCode, joined.participantCredential))!;
        for (const participant of [host, player]) {
            await service.execute(room.roomId, participant, {
                type: "command.setBoundaries",
                revision: null,
                payload: {
                    disabledQuestionCategoryIds: [QUESTION_CATEGORIES.SEX_EXPERIENCE],
                    disabledDareTypeIds: [],
                    blockedOperationalFlags: [],
                },
            });
        }
        const started = await service.execute(room.roomId, host, {
            type: "command.startSession",
            revision: null,
            payload: {},
        });
        const chooser = started.session!.activePlayer!.id === host.id ? host : player;
        const shown = await service.execute(room.roomId, chooser, {
            type: "command.chooseCardType",
            revision: 0,
            payload: { cardType: "QUESTION" },
        });
        const sessionId = shown.session!.id;
        const runtime = async () =>
            JSON.parse(
                (await source.getRepository(GameSessionEntity).findOneByOrFail({ id: sessionId }))
                    .runtimeStateJson,
            ) as GameSessionRuntimeState;
        const boundaryIds = async () =>
            (await runtime()).boundariesByPlayer.map(([id]) => id).sort();
        expect(await boundaryIds()).toEqual([host.id, player.id, devicePlayerId].sort());
        return {
            source,
            repository,
            service,
            createService,
            room,
            host,
            player,
            joined,
            devicePlayerId,
            sessionId,
            runtime,
            boundaryIds,
        };
    }

    describe("private boundary lifecycle in persisted records", () => {
        it("scrubs ended runtimes, removes unsaved Room history, and retains a continuing lobby", async () => {
            const f = await fixture();
            const activeRuntime = (await f.repository.loadRuntime(f.room.roomId))!;
            await f.service.execute(f.room.roomId, f.host, {
                type: "command.endSession",
                revision: 1,
                payload: {},
            });
            expect(await f.boundaryIds()).toEqual([]);
            expect((await f.repository.listBoundaries(f.room.roomId)).size).toBe(2);
            expect(
                await f.source
                    .getRepository(CardAppearanceEntity)
                    .countBy({ sessionId: f.sessionId }),
            ).toBe(0);
            await f.service.execute(f.room.roomId, f.host, {
                type: "command.resetSession",
                revision: 2,
                payload: {},
            });
            expect(await f.boundaryIds()).toEqual([]);
            await f.service.execute(f.room.roomId, f.host, {
                type: "command.startSession",
                revision: null,
                payload: {},
            });
            expect(
                (await f.repository.loadRuntime(f.room.roomId))!.boundariesByPlayer,
            ).toHaveLength(3);

            const space = await f.source
                .getRepository(DataSpace)
                .save({ name: "Couch retention", defaultForOwner: false });
            const couch = new TypeOrmCouchSessionRepository(f.source);
            const ended = { ...activeRuntime, id: randomUUID(), state: "ENDED" as const };
            await couch.save(ended, null, { dataSpaceId: space.id as DataSpaceId, groupId: null });
            const stored = await f.source
                .getRepository(CouchGameSessionEntity)
                .findOneByOrFail({ id: ended.id });
            expect(JSON.parse(stored.runtimeStateJson).boundariesByPlayer).toEqual([]);
            expect((await couch.load(ended.id))!.sessionHistory).toHaveLength(1);
            await f.source.getRepository(DataSpace).delete({ id: space.id });
        });

        it("keeps active boundaries through disconnect, repository reload, and reconnect", async () => {
            const f = await fixture();
            await f.service.markTemporarilyDisconnected(f.player);
            const restored = GameSession.restore(
                (await new TypeOrmRealtimeRoomRepository(f.source).loadRuntime(f.room.roomId))!,
                new SequenceRandomSource([0]),
            );
            expect(restored.toRuntimeState().boundariesByPlayer).toHaveLength(3);
            const restarted = f.createService();
            await restarted.initializeConnectionLifecycle();
            expect(
                await restarted.authenticate(f.room.roomCode, f.joined.participantCredential),
            ).not.toBeNull();
            expect(await f.boundaryIds()).toHaveLength(3);
            expect((await f.repository.listBoundaries(f.room.roomId)).has(f.player.id)).toBe(true);
        });

        it.each(["leave", "expiry"])(
            "scrubs the participant and all represented players on %s",
            async (transition) => {
                const f = await fixture();
                if (transition === "leave") {
                    await f.service.execute(f.room.roomId, f.player, {
                        type: "command.leaveRoom",
                        revision: null,
                        payload: {},
                    });
                } else {
                    await f.service.markTemporarilyDisconnected(f.player);
                    await f.source
                        .getRepository(RoomParticipantEntity)
                        .update(
                            { id: f.player.id },
                            { reconnectDeadline: new Date(Date.now() - 1) },
                        );
                    await f.service.expireDisconnectedParticipant(f.room.roomId, f.player.id);
                }
                expect(await f.boundaryIds()).toEqual([f.host.id]);
                expect((await f.runtime()).players.map(({ id }) => id)).toEqual([f.host.id]);
                expect(
                    await f.source
                        .getRepository(RoomParticipantBoundaryEntity)
                        .countBy({ participantId: f.player.id }),
                ).toBe(0);
            },
        );

        it.each(["close", "room expiry"])(
            "scrubs all private boundary storage after %s and reload",
            async (transition) => {
                const f = await fixture();
                if (transition === "close") {
                    await f.service.execute(f.room.roomId, f.host, {
                        type: "command.closeRoom",
                        revision: 1,
                        payload: {},
                    });
                } else {
                    await f.source
                        .getRepository(RoomEntity)
                        .update({ id: f.room.roomId }, { expiresAt: new Date(Date.now() - 1) });
                    await f.service.reconcileDueRooms();
                }
                expect(await f.boundaryIds()).toEqual([]);
                expect((await f.repository.listBoundaries(f.room.roomId)).size).toBe(0);
                expect(
                    (await new TypeOrmRealtimeRoomRepository(f.source).loadRuntime(f.room.roomId))!
                        .boundariesByPlayer,
                ).toEqual([]);
            },
        );

        it("commits erasure with expiry even if the following roster commit is interrupted", async () => {
            const f = await fixture();
            const before = (await f.repository.loadRuntime(f.room.roomId))!;
            await f.repository.applyLifecycleTransition({
                type: "DISCONNECT",
                roomId: f.room.roomId,
                participantId: f.player.id,
                at: Date.now(),
                reconnectDeadline: Date.now() - 1,
            });
            await f.repository.applyLifecycleTransition({
                type: "EXPIRE",
                roomId: f.room.roomId,
                participantId: f.player.id,
                at: Date.now(),
            });
            expect(await f.boundaryIds()).toEqual([f.host.id]);
            expect(
                await f.source
                    .getRepository(RoomParticipantBoundaryEntity)
                    .countBy({ participantId: f.player.id }),
            ).toBe(0);
            await expect(
                f.repository.commitRuntime(f.room.roomId, before.revision, {
                    ...before,
                    revision: before.revision + 1,
                }),
            ).rejects.toMatchObject({ code: "STALE_SESSION_REVISION" });
            expect(await f.boundaryIds()).toEqual([f.host.id]);
            await expect(
                f.repository.saveBoundaries(f.player.id, {
                    disabledQuestionCategoryIds: new Set([QUESTION_CATEGORIES.SEX_EXPERIENCE]),
                    disabledDareTypeIds: new Set(),
                    blockedOperationalFlags: new Set(),
                }),
            ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
        });

        it("migrates already retained terminal values without changing live recovery or history", async () => {
            const active = await fixture();
            const ended = await fixture();
            const original = await ended.runtime();
            await ended.service.execute(ended.room.roomId, ended.host, {
                type: "command.endSession",
                revision: 1,
                payload: {},
            });
            const oldEnded = {
                ...(await ended.runtime()),
                boundariesByPlayer: original.boundariesByPlayer,
            };
            await ended.source
                .getRepository(GameSessionEntity)
                .update({ id: ended.sessionId }, { runtimeStateJson: JSON.stringify(oldEnded) });
            await ended.service.execute(ended.room.roomId, ended.host, {
                type: "command.resetSession",
                revision: 2,
                payload: {},
            });
            const closed = await fixture();
            await closed.source
                .getRepository(RoomEntity)
                .update({ id: closed.room.roomId }, { closedAt: new Date() });
            const stale = await fixture();
            await stale.source
                .getRepository(RoomParticipantEntity)
                .update({ id: stale.player.id }, { connectionStatus: "LEFT", leftAt: new Date() });
            const space = await active.source
                .getRepository(DataSpace)
                .save({ name: "Migration", defaultForOwner: false });
            const historicalCouch = active.source.getRepository(CouchGameSessionEntity);
            const historicalIds = Array.from({ length: 101 }, () => randomUUID());
            for (const id of historicalIds) {
                await historicalCouch.insert({
                    id,
                    dataSpaceId: space.id,
                    groupId: null,
                    mode: original.mode,
                    revision: original.revision,
                    runtimeStateVersion: original.version,
                    runtimeStateJson: JSON.stringify({ ...original, id }),
                    policyInputDigest: null,
                    startedAt: new Date(original.startedAt),
                    endedAt: new Date(),
                });
            }
            const runner = active.source.createQueryRunner();
            try {
                await new ScrubExpiredPrivateBoundaries1787359000000().up(runner);
            } finally {
                await runner.release();
            }
            expect(await active.boundaryIds()).toHaveLength(3);
            expect(await ended.boundaryIds()).toEqual([]);
            expect(await closed.boundaryIds()).toEqual([]);
            expect((await closed.repository.listBoundaries(closed.room.roomId)).size).toBe(0);
            expect(await stale.boundaryIds()).toEqual([stale.host.id]);
            const migratedCouch = await historicalCouch.findBy({ dataSpaceId: space.id });
            expect(migratedCouch).toHaveLength(101);
            expect(
                migratedCouch.every(
                    (row) => JSON.parse(row.runtimeStateJson).boundariesByPlayer.length === 0,
                ),
            ).toBe(true);
            await active.source.getRepository(DataSpace).delete({ id: space.id });
            expect(
                await stale.source
                    .getRepository(RoomParticipantBoundaryEntity)
                    .countBy({ participantId: stale.player.id }),
            ).toBe(0);
            expect(
                await ended.source
                    .getRepository(CardAppearanceEntity)
                    .countBy({ sessionId: ended.sessionId }),
            ).toBe(0);
        });

        it.each(["DataSpace", "account"])(
            "cascades all boundary values on owned %s deletion",
            async (kind) => {
                const source = getSource();
                const unique = randomUUID();
                const user = await source.getRepository(User).save({
                    username: unique,
                    name: "Owner",
                    email: `${unique}@example.test`,
                    isActive: true,
                });
                const space = await source
                    .getRepository(DataSpace)
                    .save({ name: "Owned", defaultForOwner: true, user });
                const f = await fixture(space.id);
                if (kind === "DataSpace") {
                    await source
                        .getRepository(DataSpace)
                        .save({ name: "Remaining", defaultForOwner: false, user });
                    expect((await deleteDataSpace(user.id, space.id)).status).toBe("deleted");
                } else await deleteUser(user.id);
                expect(
                    await source.getRepository(GameSessionEntity).countBy({ id: f.sessionId }),
                ).toBe(0);
                for (const participantId of [f.host.id, f.player.id]) {
                    expect(
                        await source
                            .getRepository(RoomParticipantBoundaryEntity)
                            .countBy({ participantId }),
                    ).toBe(0);
                }
                if (kind === "DataSpace") await deleteUser(user.id);
            },
        );
    });
}
