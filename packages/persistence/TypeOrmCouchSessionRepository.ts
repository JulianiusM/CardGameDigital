import { v5 as uuidv5 } from "uuid";
import { MoreThan, type DataSource } from "typeorm";
import type { CardId, DataSpaceId, GameSessionRuntimeState } from "../game-core";
import type { CouchSessionRepository } from "../application/repositories";
import { CouchGameSessionEntity } from "./entities/game/CouchGameSessionEntity";
import { CouchCardAppearanceEntity } from "./entities/game/CouchCardAppearanceEntity";
import { GroupEntity } from "./entities/game/GroupEntity";
import { CardAppearanceEntity } from "./entities/game/CardAppearanceEntity";
import {
    externalizeSessionImmutableState,
    hydrateSessionImmutableState,
} from "./sessionImmutablePayloadStore";

const COUCH_APPEARANCE_NAMESPACE = "d7e5b926-7f9c-5ab8-a07c-cfe764d0ef72";

export class TypeOrmCouchSessionRepository implements CouchSessionRepository {
    constructor(private readonly source: DataSource) {}

    async load(id: string): Promise<GameSessionRuntimeState | null> {
        const record = await this.source.getRepository(CouchGameSessionEntity).findOneBy({ id });
        if (!record) return null;
        const appearances = await this.source.getRepository(CouchCardAppearanceEntity).find({
            where: { sessionId: id },
            order: { sequence: "ASC" },
        });
        const runtime = await hydrateSessionImmutableState(
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

    async groupHistory(dataSpaceId: DataSpaceId, groupId: string): Promise<ReadonlySet<CardId>> {
        const group = await this.source.getRepository(GroupEntity).findOneBy({
            id: groupId,
            dataSpaceId,
        });
        if (!group)
            throw Object.assign(new Error("Group is outside the active DataSpace"), {
                code: "NOT_AUTHORIZED",
            });
        const after = group.historyResetAt ? MoreThan(group.historyResetAt) : undefined;
        const where = { groupId, ...(after ? { shownAt: after } : {}) };
        const [roomAppearances, couchAppearances] = await Promise.all([
            this.source.getRepository(CardAppearanceEntity).find({
                where,
                select: { cardId: true },
            }),
            this.source.getRepository(CouchCardAppearanceEntity).find({
                where,
                select: { cardId: true },
            }),
        ]);
        return new Set(
            [...roomAppearances, ...couchAppearances].map(({ cardId }) => cardId as CardId),
        );
    }

    async save(
        runtime: GameSessionRuntimeState,
        ownership?: { dataSpaceId: DataSpaceId; groupId: string | null },
    ): Promise<void> {
        await this.source.transaction(async (manager) => {
            const sessions = manager.getRepository(CouchGameSessionEntity);
            const existing = await sessions.findOneBy({ id: runtime.id });
            const persisted = await externalizeSessionImmutableState(manager, runtime, {
                compiledCardPolicyDigest: existing?.compiledCardPolicyDigest ?? null,
                groupHistoryDigest: existing?.groupHistoryDigest ?? null,
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
                    compiledCardPolicyDigest: persisted.compiledCardPolicyDigest,
                    groupHistoryDigest: persisted.groupHistoryDigest,
                    startedAt: new Date(runtime.startedAt),
                    endedAt: runtime.state === "ENDED" ? new Date() : null,
                });
            } else {
                const updated = await sessions.update(
                    { id: runtime.id, revision: existing.revision },
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
                    throw Object.assign(new Error("Stale persisted Couch Session revision"), {
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
        });
    }
}
