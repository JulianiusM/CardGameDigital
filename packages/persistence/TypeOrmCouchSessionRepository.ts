import { CardCatalogVersionEntity } from "./entities/card/CardCatalogVersionEntity";
import { admitPersistentGame, lockGameCapacity } from "./gameCapacity";
import {
    DEFAULT_GAME_RESOURCE_LIMITS,
    type GameResourceLimits,
} from "../application/gameResourceLimits";
import { v5 as uuidv5 } from "uuid";
import { type DataSource, type EntityManager } from "typeorm";
import { MESSAGE_KEYS } from "../localization/keys";
import { persistenceTransaction } from "./transaction";
import type { DataSpaceId, GameSessionRuntimeState } from "../game-core";
import type { CouchSessionRepository } from "../application/repositories";
import { CouchGameSessionEntity } from "./entities/game/CouchGameSessionEntity";
import { CouchCardAppearanceEntity } from "./entities/game/CouchCardAppearanceEntity";
import {
    collectUnusedSessionInputs,
    externalizeSessionImmutableState,
    hydrateSessionImmutableState,
} from "./sessionImmutablePayloadStore";

const COUCH_APPEARANCE_NAMESPACE = "d7e5b926-7f9c-5ab8-a07c-cfe764d0ef72";

export class TypeOrmCouchSessionRepository implements CouchSessionRepository {
    constructor(
        private readonly source: DataSource,
        private readonly limits: GameResourceLimits = DEFAULT_GAME_RESOURCE_LIMITS,
    ) {}

    async revision(id: string): Promise<number | null> {
        return persistenceTransaction(this.source, async (manager) => {
            const record = await manager.getRepository(CouchGameSessionEntity).findOne({
                where: { id },
                select: { revision: true },
            });
            return record?.revision ?? null;
        });
    }

    async load(id: string): Promise<GameSessionRuntimeState | null> {
        return persistenceTransaction(this.source, (manager) => this.loadFrom(manager, id));
    }

    private async loadFrom(
        manager: EntityManager,
        id: string,
    ): Promise<GameSessionRuntimeState | null> {
        const record = await manager.getRepository(CouchGameSessionEntity).findOneBy({ id });
        if (!record) return null;
        const runtime = await hydrateSessionImmutableState(manager, record.runtimeStateJson, {
            policyInputDigest: record.policyInputDigest,
        });
        if (runtime.id !== record.id || runtime.revision !== record.revision)
            throw new Error("Stored Couch Session runtime is inconsistent");
        return runtime;
    }

    async ownerDataSpaceId(id: string): Promise<DataSpaceId | null> {
        const record = await this.source.getRepository(CouchGameSessionEntity).findOne({
            where: { id },
            select: { dataSpaceId: true },
        });
        return (record?.dataSpaceId as DataSpaceId | null | undefined) ?? null;
    }

    async save(
        runtime: GameSessionRuntimeState,
        expectedRevision: number | null,
        ownership?: { dataSpaceId: DataSpaceId; groupId: string | null },
    ): Promise<void> {
        await persistenceTransaction(this.source, async (manager) => {
            if (expectedRevision === null) {
                await lockGameCapacity(manager);
                await admitPersistentGame(manager, "COUCH", this.limits);
            }
            const sessions = manager.getRepository(CouchGameSessionEntity);
            const existing = await sessions.findOneBy({ id: runtime.id });
            if (
                (existing?.revision ?? null) !== expectedRevision ||
                (expectedRevision !== null && runtime.revision <= expectedRevision)
            ) {
                throw Object.assign(new Error(MESSAGE_KEYS.GAME_STALE_REVISION), {
                    code: "STALE_SESSION_REVISION",
                });
            }
            if (!existing && runtime.catalog) {
                const catalog = await manager
                    .getRepository(CardCatalogVersionEntity)
                    .findOne({ where: {}, order: { appliedAt: "DESC", sequence: "DESC" } });
                if (catalog?.artifactDigest !== runtime.catalog.artifactDigest)
                    throw Object.assign(new Error(MESSAGE_KEYS.GAME_STALE_REVISION), {
                        code: "STALE_SESSION_REVISION",
                    });
            }
            const persisted = await externalizeSessionImmutableState(manager, runtime, {
                policyInputDigest: existing?.policyInputDigest ?? null,
            });
            if (!existing) {
                await sessions.insert({
                    id: runtime.id,
                    dataSpaceId: ownership?.dataSpaceId ?? null,
                    groupId: ownership?.groupId ?? null,
                    mode: runtime.mode,
                    revision: runtime.revision,
                    runtimeStateVersion: runtime.version,
                    runtimeStateJson: persisted.runtimeStateJson,
                    policyInputDigest: persisted.policyInputDigest,
                    startedAt: new Date(runtime.startedAt),
                    lastActiveAt: new Date(),
                    endedAt: runtime.state === "ENDED" ? new Date() : null,
                });
            } else {
                const updated = await sessions.update(
                    { id: runtime.id, revision: expectedRevision! },
                    {
                        revision: runtime.revision,
                        lastActiveAt: new Date(),
                        runtimeStateVersion: runtime.version,
                        runtimeStateJson: persisted.runtimeStateJson,
                        policyInputDigest: persisted.policyInputDigest,
                        endedAt: runtime.state === "ENDED" ? new Date() : null,
                    },
                );
                if (updated.affected !== 1)
                    throw Object.assign(new Error(MESSAGE_KEYS.GAME_STALE_REVISION), {
                        code: "STALE_SESSION_REVISION",
                    });
            }
            const groupId = existing?.groupId ?? ownership?.groupId ?? null;
            const appearances = manager.getRepository(CouchCardAppearanceEntity);
            const storedLatest = await appearances.findOne({
                where: { sessionId: runtime.id },
                order: { sequence: "DESC" },
            });
            const changedAppearances = runtime.sessionHistory.filter(
                ({ sequence }) => !storedLatest || sequence >= storedLatest.sequence,
            );
            for (const appearance of changedAppearances) {
                const id = uuidv5(
                    `${runtime.id}:${appearance.sequence}`,
                    COUCH_APPEARANCE_NAMESPACE,
                );
                const stored = storedLatest?.id === id ? storedLatest : null;
                await appearances.save(
                    appearances.create({
                        id,
                        sessionId: runtime.id,
                        groupId,
                        cardId: appearance.cardId,
                        playerId: appearance.playerId,
                        shownAt: stored?.shownAt ?? new Date(),
                        roundNumber: appearance.roundNumber,
                        sequence: appearance.sequence,
                        skipped: appearance.skipped,
                        completed: appearance.completed,
                        vetoed: appearance.vetoed,
                    }),
                );
            }
            if (runtime.state === "ENDED") await collectUnusedSessionInputs(manager);
        });
    }
}
