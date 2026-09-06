import { TypeOrmCardRepository } from "../../packages/persistence/TypeOrmCardRepository";
import { testCatalogAccess } from "./game";
import type { DataSource, EntitySubscriberInterface } from "typeorm";
import { describe, expect, it } from "vitest";
import { CouchSessionService } from "../../packages/application/couchSessionService";
import { RoomService } from "../../packages/application/roomService";
import { defaultRoomGameSettings } from "../../packages/application/roomGameSettings";
import {
    GameSession,
    SequenceRandomSource,
    type CardId,
    type DataSpaceId,
} from "../../packages/game-core";
import { TypeOrmCouchSessionRepository } from "../../packages/persistence/TypeOrmCouchSessionRepository";
import { TypeOrmRealtimeRoomRepository } from "../../packages/persistence/TypeOrmRealtimeRoomRepository";
import { RoomEntity } from "../../packages/persistence/entities/game/RoomEntity";
import { RoomParticipantEntity } from "../../packages/persistence/entities/game/RoomParticipantEntity";
import { RoomParticipantBoundaryEntity } from "../../packages/persistence/entities/game/RoomParticipantBoundaryEntity";
import { RoomCreateIdempotencyEntity } from "../../packages/persistence/entities/game/RoomCreateIdempotencyEntity";
import { GameSessionEntity } from "../../packages/persistence/entities/game/GameSessionEntity";
import { SessionImmutablePayloadEntity } from "../../packages/persistence/entities/game/SessionImmutablePayloadEntity";
import { CardAppearanceEntity } from "../../packages/persistence/entities/game/CardAppearanceEntity";
import { CouchCardAppearanceEntity } from "../../packages/persistence/entities/game/CouchCardAppearanceEntity";
import { CardEntity } from "../../packages/persistence/entities/card/CardEntity";
import { DataSpace } from "../../packages/persistence/entities/user/DataSpace";
import { card } from "./game";
export function authoritativeCommitTests(getSource: () => DataSource): void {
    async function catalogFixture() {
        const source = getSource();
        const stored = await source
            .getRepository(CardEntity)
            .findOneOrFail({ where: {}, select: { id: true } });
        const playable = card({ id: stored.id as CardId, yesNoAnswerPossible: true });
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
        return { source, cards, playable };
    }
    async function fixture() {
        const { source, cards, playable } = await catalogFixture();
        const owner = await source
            .getRepository(DataSpace)
            .save({ name: "Authoritative commits", defaultForOwner: false });
        const repository = new TypeOrmCouchSessionRepository(source);
        const createService = () =>
            new CouchSessionService(
                cards,
                new SequenceRandomSource([0]),
                undefined,
                new TypeOrmCouchSessionRepository(source),
            );
        const first = createService();
        const session = await first.create({
            ...defaultRoomGameSettings(),
            persistence: "DATASPACE",
            dataSpaceId: owner.id as DataSpaceId,
            players: [{ name: "First" }, { name: "Second" }],
        });
        return { source, repository, first, createService, session, playable };
    }
    async function roomFixture() {
        const { source, cards } = await catalogFixture();
        const repository = new TypeOrmRealtimeRoomRepository(source);
        const createService = () =>
            new RoomService(
                new TypeOrmRealtimeRoomRepository(source),
                cards,
                new SequenceRandomSource([0]),
            );
        const service = createService();
        const room = await service.createRoom("Host", null, {
            ...defaultRoomGameSettings(),
            mode: "NEVER_HAVE_I_EVER",
        });
        const joined = await service.joinRoom(room.roomCode, "Player", "PLAYER");
        const host = (await service.authenticate(room.roomCode, room.participantCredential))!;
        const player = (await service.authenticate(room.roomCode, joined.participantCredential))!;
        for (const participant of [host, player]) {
            await service.execute(room.roomId, participant, {
                type: "command.setBoundaries",
                revision: null,
                payload: {
                    disabledQuestionCategoryIds: [],
                    disabledDareTypeIds: [],
                    blockedOperationalFlags: [],
                },
            });
        }
        await service.execute(room.roomId, host, {
            type: "command.startSession",
            revision: null,
            payload: {},
        });
        await service.execute(room.roomId, host, {
            type: "command.startTurn",
            revision: 0,
            payload: {},
        });
        await service.execute(room.roomId, host, {
            type: "command.submitVote",
            revision: 1,
            payload: { vote: "YES" },
        });
        const before = (await repository.loadRuntime(room.roomId))!;
        return { source, repository, service, createService, room, host, player, before };
    }
    describe("authoritative Couch commits", () => {
        it("has one winner for independent proposals from the same base, including appearance history", async () => {
            const f = await fixture();
            const base = (await f.repository.load(f.session.id))!;
            const show = GameSession.restore(base, new SequenceRandomSource([0]));
            await show.chooseCardType(base.revision, "QUESTION", [f.playable]);
            const end = GameSession.restore(base, new SequenceRandomSource([0]));
            end.end(base.revision);
            const other = new TypeOrmCouchSessionRepository(f.source);
            const results = await Promise.allSettled([
                f.repository.save(show.toRuntimeState(), base.revision),
                other.save(end.toRuntimeState(), base.revision),
            ]);
            expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
            const rejected = results.find(
                (result) => result.status === "rejected",
            ) as PromiseRejectedResult;
            expect(rejected.reason).toMatchObject({ code: "STALE_SESSION_REVISION" });
            const stored = (await other.load(base.id))!;
            expect(stored.revision).toBe(base.revision + 1);
            const count = await f.source
                .getRepository(CouchCardAppearanceEntity)
                .countBy({ sessionId: base.id });
            expect(count).toBe(stored.state === "ENDED" ? 0 : 1);
            expect(stored.sessionHistory).toHaveLength(count);
        });
        it("refreshes a warm service cache after another writer commits and rejects the old revision", async () => {
            const f = await fixture();
            const second = f.createService();
            expect((await second.get(f.session.id)).revision).toBe(0);
            const shown = await f.first.chooseCardType(f.session.id, 0, "QUESTION");
            expect(await second.get(f.session.id)).toEqual(shown);
            await expect(second.end(f.session.id, 0)).rejects.toMatchObject({
                code: "STALE_SESSION_REVISION",
            });
            expect(await f.first.get(f.session.id)).toEqual(shown);
            const ended = await second.end(f.session.id, shown.revision);
            expect(await f.first.get(f.session.id)).toEqual(ended);
        });
    });
    describe("atomic Room lifecycle commits", () => {
        const failures = [
            ["LEAVE", RoomParticipantEntity],
            ["LEAVE", GameSessionEntity],
            ["LEAVE", RoomParticipantBoundaryEntity],
            ["LEAVE", RoomCreateIdempotencyEntity],
            ["CLOSE", RoomEntity],
            ["CLOSE", RoomParticipantEntity],
            ["CLOSE", GameSessionEntity],
            ["CLOSE", RoomParticipantBoundaryEntity],
        ] as const;
        for (const [operation, target] of failures) {
            it(`rolls back ${operation} after writing ${target.name}, then recovers on retry`, async () => {
                const f = await roomFixture();
                let injected = false;
                const fail = (written: unknown) => {
                    if (!injected && written === target) {
                        injected = true;
                        throw new Error("injected lifecycle write failure");
                    }
                };
                const subscriber: EntitySubscriberInterface = {
                    afterUpdate(event) {
                        fail(event.metadata.target);
                    },
                    afterRemove(event) {
                        fail(event.metadata.target);
                    },
                };
                f.source.subscribers.push(subscriber);
                const command = {
                    type: operation === "LEAVE" ? "command.leaveRoom" : "command.closeRoom",
                    revision: f.before.revision,
                    payload: {},
                } as const;
                try {
                    await expect(f.service.execute(f.room.roomId, f.host, command)).rejects.toThrow(
                        "injected lifecycle write failure",
                    );
                } finally {
                    f.source.subscribers.splice(f.source.subscribers.indexOf(subscriber), 1);
                }
                expect(injected).toBe(true);
                expect(await f.repository.loadRuntime(f.room.roomId)).toEqual(f.before);
                expect(
                    (await f.repository.getParticipant(f.room.roomId, f.host.id))?.connectionStatus,
                ).toBe("CONNECTED");
                expect((await f.repository.getParticipant(f.room.roomId, f.player.id))?.role).toBe(
                    "PLAYER",
                );
                expect((await f.repository.loadRoomState(f.room.roomId)).closedAt).toBeNull();
                expect((await f.repository.listBoundaries(f.room.roomId)).size).toBe(2);
                await f.createService().execute(f.room.roomId, f.host, command);
                const recovered = (await f.repository.loadRuntime(f.room.roomId))!;
                expect(recovered.revision).toBe(f.before.revision + 1);
                expect(recovered.votes).toEqual([]);
                if (operation === "CLOSE") {
                    expect(recovered.state).toBe("ENDED");
                    expect(recovered.currentCard).toBeNull();
                    expect(recovered.voterIds).toEqual([]);
                    expect((await f.repository.listBoundaries(f.room.roomId)).size).toBe(0);
                } else {
                    expect(recovered.players.map(({ id }) => id)).toEqual([f.player.id]);
                    expect(recovered.voterIds).toEqual([f.player.id]);
                    expect(recovered.state).toBe("COLLECTING_ANSWERS");
                    expect(
                        (await f.repository.getParticipant(f.room.roomId, f.player.id))?.role,
                    ).toBe("HOST");
                }
                await f.repository.applyLifecycleTransition({
                    type: operation,
                    roomId: f.room.roomId,
                    participantId: f.host.id,
                    at: Date.now(),
                });
                expect(await f.repository.loadRuntime(f.room.roomId)).toEqual(recovered);
            });
        }
        for (const operation of ["LEAVE", "CLOSE"] as const) {
            it(`recovers ${operation} after a lost result following the database commit`, async () => {
                const f = await roomFixture();
                let committed = false;
                const subscriber: EntitySubscriberInterface = {
                    afterUpdate(event) {
                        if (event.metadata.target === GameSessionEntity) committed = true;
                    },
                    afterTransactionCommit() {
                        if (committed) throw new Error("lost commit result");
                    },
                };
                f.source.subscribers.push(subscriber);
                try {
                    await expect(
                        f.service.execute(f.room.roomId, f.host, {
                            type: operation === "LEAVE" ? "command.leaveRoom" : "command.closeRoom",
                            revision: f.before.revision,
                            payload: {},
                        }),
                    ).rejects.toThrow("lost commit result");
                } finally {
                    f.source.subscribers.splice(f.source.subscribers.indexOf(subscriber), 1);
                }
                const stored = (await f.repository.loadRuntime(f.room.roomId))!;
                expect(stored.revision).toBe(f.before.revision + 1);
                expect(
                    (
                        await f.source
                            .getRepository(RoomParticipantEntity)
                            .findOneByOrFail({ roomId: f.room.roomId, id: f.host.id })
                    ).connectionStatus,
                ).toBe("LEFT");
                expect(await f.repository.getParticipant(f.room.roomId, f.host.id)).toBeNull();
                await f.repository.applyLifecycleTransition({
                    type: operation,
                    roomId: f.room.roomId,
                    participantId: f.host.id,
                    at: Date.now(),
                });
                expect(await f.repository.loadRuntime(f.room.roomId)).toEqual(stored);
                expect(stored.votes).toEqual([]);
                if (operation === "CLOSE") expect(stored.state).toBe("ENDED");
                else expect(stored.players.map(({ id }) => id)).toEqual([f.player.id]);
            });
        }
        it("does not hydrate catalog payloads or appearance history for membership changes", async () => {
            const f = await roomFixture();
            let unnecessaryLoads = 0;
            const subscriber: EntitySubscriberInterface = {
                afterLoad(entity) {
                    if (
                        entity instanceof SessionImmutablePayloadEntity ||
                        entity instanceof CardAppearanceEntity
                    )
                        unnecessaryLoads++;
                },
            };
            f.source.subscribers.push(subscriber);
            try {
                await f.repository.applyLifecycleTransition({
                    type: "LEAVE",
                    roomId: f.room.roomId,
                    participantId: f.host.id,
                    at: Date.now(),
                });
            } finally {
                f.source.subscribers.splice(f.source.subscribers.indexOf(subscriber), 1);
            }
            expect(unnecessaryLoads).toBe(0);
            expect((await f.repository.loadRuntime(f.room.roomId))!.players).toHaveLength(1);
        });
        it("rechecks the actor's role while committing after a Host transfer", async () => {
            const f = await roomFixture();
            const proposed = GameSession.restore(f.before, new SequenceRandomSource([0]));
            proposed.end(f.before.revision);
            await f.repository.applyLifecycleTransition({
                type: "TRANSFER_HOST",
                roomId: f.room.roomId,
                participantId: f.host.id,
                targetParticipantId: f.player.id,
                at: Date.now(),
            });
            await expect(
                f.repository.commitRuntime(
                    f.room.roomId,
                    f.before.revision,
                    proposed.toRuntimeState(),
                    { actor: f.host },
                ),
            ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
            expect(await f.repository.loadRuntime(f.room.roomId)).toEqual(f.before);
        });
    });
}
