import { largeRuntime } from "./largeRuntime";
import { randomUUID } from "node:crypto";
import { RoomEntity } from "../../packages/persistence/entities/game/RoomEntity";
import { describe, expect, it } from "vitest";
import type { DataSource } from "typeorm";
import { CouchSessionService } from "../../packages/application/couchSessionService";
import { RoomService } from "../../packages/application/roomService";
import { CardPolicyService } from "../../packages/application/cardPolicyService";
import { defaultRoomGameSettings } from "../../packages/application/roomGameSettings";
import { SequenceRandomSource, type DataSpaceId } from "../../packages/game-core";
import {
    TypeOrmCardRepository,
    TypeOrmCardPolicyRepository,
    TypeOrmCouchSessionRepository,
    TypeOrmRealtimeRoomRepository,
} from "../../packages/persistence";
import { CardEntity } from "../../packages/persistence/entities/card/CardEntity";
import { CouchGameSessionEntity } from "../../packages/persistence/entities/game/CouchGameSessionEntity";
import { SessionImmutablePayloadEntity } from "../../packages/persistence/entities/game/SessionImmutablePayloadEntity";
import { DataSpace } from "../../packages/persistence/entities/user/DataSpace";
import { persistenceTransaction } from "../../packages/persistence/transaction";

export function catalogSessionLifetimeTests(getSource: () => DataSource): void {
    describe("live catalog and captured policy lifetime", () => {
        it("shares sparse policy only, recovers on the installed catalog, and collects ended inputs", async () => {
            const source = getSource();
            const owner = await source
                .getRepository(DataSpace)
                .save({ name: "Live catalog games", defaultForOwner: false });
            const cards = new TypeOrmCardRepository(source.getRepository(CardEntity));
            const policies = new TypeOrmCardPolicyRepository(source);
            const scope = {
                dataSpaceId: owner.id,
                groupId: null,
                ownerKey: `DATASPACE:${owner.id}`,
                name: "DataSpace" as const,
            };
            await policies.putDefault(
                scope,
                {
                    repeatableInSession: "ENABLE",
                    repeatCooldown: { mode: "SET", value: 0 },
                    weight: { mode: "SET", value: 2 },
                },
                0,
            );
            const createService = () =>
                new CouchSessionService(
                    cards,
                    new SequenceRandomSource([0]),
                    undefined,
                    new TypeOrmCouchSessionRepository(source),
                    new CardPolicyService(policies),
                );
            const settings = defaultRoomGameSettings();
            const input = {
                ...settings,
                adultContentConfirmed: true,
                configuration: {
                    ...settings.configuration,
                    startingIntensity: 5 as const,
                    maximumIntensity: 5 as const,
                },
                persistence: "DATASPACE" as const,
                dataSpaceId: owner.id as DataSpaceId,
                players: [{ name: "First" }, { name: "Second" }],
            };
            const [first, second] = await Promise.all([
                createService().create(input),
                createService().create(input),
            ]);
            const rows = source.getRepository(CouchGameSessionEntity);
            const stored = await rows.findOneByOrFail({ id: first.id });
            const other = await rows.findOneByOrFail({ id: second.id });
            expect(stored.policyInputDigest).toBeTruthy();
            expect(other.policyInputDigest).toBe(stored.policyInputDigest);
            expect(stored.runtimeStateJson).not.toContain("cardText");
            expect(stored.runtimeStateJson).not.toContain("frozenCatalog");
            expect(JSON.parse(stored.runtimeStateJson).groupHistoryCardIds).toEqual([]);
            const payload = await source
                .getRepository(SessionImmutablePayloadEntity)
                .findOneByOrFail({ digest: stored.policyInputDigest! });
            expect(payload.payloadKind).toBe("POLICY_INPUT");
            expect(payload.uncompressedByteLength).toBeLessThan(2048);
            const shown = await createService().chooseCardType(
                first.id,
                first.revision,
                "QUESTION",
            );
            expect(shown.currentCard?.cardText).toBeTruthy();
            await policies.putDefault(scope, { availability: "EXCLUDE" }, 1);
            await expect(createService().create(input)).rejects.toMatchObject({
                code: "CARD_POOL_EXHAUSTED",
            });
            const advanced = await createService().advance(first.id, shown.revision);
            expect(
                (await createService().chooseCardType(first.id, advanced.revision, "QUESTION"))
                    .currentCard?.id,
            ).toBe(shown.currentCard?.id);
            const current = await createService().get(first.id);
            await createService().end(first.id, current.revision);
            expect((await rows.findOneByOrFail({ id: first.id })).policyInputDigest).toBeNull();
            expect(
                await source
                    .getRepository(SessionImmutablePayloadEntity)
                    .existsBy({ digest: stored.policyInputDigest! }),
            ).toBe(true);
            await createService().end(second.id, second.revision);
            expect(
                await source
                    .getRepository(SessionImmutablePayloadEntity)
                    .existsBy({ digest: stored.policyInputDigest! }),
            ).toBe(false);
        });

        it("stores a maximum roster and large settings within a 1 MiB SQL packet", async () => {
            const source = getSource();
            const owner = await source
                .getRepository(DataSpace)
                .save({ name: "Bounded hot JSON", defaultForOwner: false });
            const runtime = largeRuntime();
            runtime.id = randomUUID();
            const couch = new TypeOrmCouchSessionRepository(source);
            await couch.save(runtime, null, { dataSpaceId: owner.id as never, groupId: null });
            const stored = await source
                .getRepository(CouchGameSessionEntity)
                .findOneByOrFail({ id: runtime.id });
            expect(Buffer.byteLength(stored.runtimeStateJson)).toBeLessThan(512 * 1024);
            expect(JSON.parse(stored.runtimeStateJson).$encoding).toBe("brotli-json/v1");
            expect((await couch.load(runtime.id))?.boundariesByPlayer).toEqual(
                runtime.boundariesByPlayer,
            );
            const rooms = new TypeOrmRealtimeRoomRepository(source);
            const service = new RoomService(
                rooms,
                new TypeOrmCardRepository(source.getRepository(CardEntity)),
                new SequenceRandomSource([0]),
            );
            const settings = {
                ...defaultRoomGameSettings(),
                cardPolicy: {
                    scopeDefault: {},
                    conditionalRules: [],
                    exactCards: Array.from({ length: 1000 }, () => ({
                        cardId: randomUUID(),
                        directives: {
                            availability: "INCLUDE" as const,
                            weight: { mode: "SET" as const, value: 1.7976931348623157e308 },
                        },
                    })),
                },
            };
            const room = await service.createRoom("Host", owner.id, settings);
            const row = await source.getRepository(RoomEntity).findOneByOrFail({ id: room.roomId });
            expect(JSON.parse(row.gameSettingsJson).$encoding).toBe("brotli-json/v1");
            expect((await rooms.loadSettings(room.roomId)).cardPolicy).toEqual(settings.cardPolicy);
        });

        it("rejects an initial roster changed by an independent lifecycle writer", async () => {
            const source = getSource();
            const repository = new TypeOrmRealtimeRoomRepository(source);
            const other = new TypeOrmRealtimeRoomRepository(source);
            const service = new RoomService(
                repository,
                new TypeOrmCardRepository(source.getRepository(CardEntity)),
                new SequenceRandomSource([0]),
            );
            const settings = defaultRoomGameSettings();
            const created = await service.createRoom("Host", null, {
                ...settings,
                adultContentConfirmed: true,
                configuration: {
                    ...settings.configuration,
                    startingIntensity: 5,
                    maximumIntensity: 5,
                },
            });
            const joined = await service.joinRoom(created.roomCode, "Guest", "PLAYER");
            const host = (await service.authenticate(
                created.roomCode,
                created.participantCredential,
            ))!;
            const guest = (await service.authenticate(
                created.roomCode,
                joined.participantCredential,
            ))!;
            const commit = repository.commitRuntime.bind(repository);
            repository.commitRuntime = async (...args) => {
                await other.applyLifecycleTransition({
                    type: "LEAVE",
                    roomId: created.roomId,
                    participantId: guest.id,
                    at: Date.now(),
                });
                return commit(...args);
            };
            await expect(
                service.execute(created.roomId, host, {
                    type: "command.startSession",
                    revision: null,
                    payload: {},
                }),
            ).rejects.toMatchObject({ code: "STALE_SESSION_REVISION" });
            expect(await repository.loadRuntime(created.roomId)).toBeNull();
        });

        it("coordinates direct SQLite reads and transactions with repository work", async () => {
            const source = getSource();
            if (source.options.type !== "better-sqlite3") return;
            let release!: () => void;
            let started!: () => void;
            const ready = new Promise<void>((resolve) => {
                started = resolve;
            });
            const blocked = new Promise<void>((resolve) => {
                release = resolve;
            });
            const failed = persistenceTransaction(source, async (manager) => {
                await manager
                    .getRepository(DataSpace)
                    .save({ name: "rolled back", defaultForOwner: false });
                started();
                await blocked;
                throw new Error("rollback probe");
            });
            const rejected = expect(failed).rejects.toThrow("rollback probe");
            await ready;
            let readCompleted = false;
            const read = source
                .getRepository(DataSpace)
                .countBy({ name: "rolled back" })
                .then((count) => {
                    readCompleted = true;
                    return count;
                });
            const committed = source.transaction((manager) =>
                manager
                    .getRepository(DataSpace)
                    .save({ name: "independent success", defaultForOwner: false }),
            );
            await new Promise((resolve) => setImmediate(resolve));
            expect(readCompleted).toBe(false);
            release();
            await rejected;
            expect(await read).toBe(0);
            const saved = await committed;
            expect(await source.getRepository(DataSpace).existsBy({ id: saved.id })).toBe(true);
        });
    });
}
