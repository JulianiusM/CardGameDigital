import { type DataSource, IsNull, LessThanOrEqual } from "typeorm";
import { GameSession, type GameSessionRuntimeState } from "../game-core";
import {
    DEFAULT_GAME_RESOURCE_LIMITS,
    type GameResourceLimits,
} from "../application/gameResourceLimits";
import { persistenceTransaction } from "./transaction";
import { readStoredJson } from "./storedJson";
import {
    collectUnusedSessionInputs,
    externalizeSessionImmutableState,
} from "./sessionImmutablePayloadStore";
import { CouchGameSessionEntity } from "./entities/game/CouchGameSessionEntity";
import { RoomEntity } from "./entities/game/RoomEntity";
import { GameSessionEntity } from "./entities/game/GameSessionEntity";

export const GAME_RETENTION_BATCH_SIZE = DEFAULT_GAME_RESOURCE_LIMITS.gameRetentionBatchSize;

/** Separate from Room lifecycle: only terminal temporary records can be purged. */
export class TypeOrmGameRetention {
    constructor(
        private readonly source: DataSource,
        private readonly limits: GameResourceLimits = DEFAULT_GAME_RESOURCE_LIMITS,
    ) {}

    async sweep(at = Date.now()) {
        const result = { expiredCouchGames: 0, deletedRooms: 0, deletedSessions: 0 };
        const cutoff = new Date(at - this.limits.endedTemporaryRetentionSeconds * 1000);
        const idle = new Date(at - this.limits.sessionIdleTtlSeconds * 1000);
        const couchIds = await this.source.getRepository(CouchGameSessionEntity).find({
            where: { endedAt: IsNull(), lastActiveAt: LessThanOrEqual(idle) },
            select: { id: true },
            order: { lastActiveAt: "ASC" },
            take: this.limits.gameRetentionBatchSize,
        });
        for (const { id } of couchIds)
            await persistenceTransaction(this.source, async (manager) => {
                const sessions = manager.getRepository(CouchGameSessionEntity);
                const query = sessions
                    .createQueryBuilder("session")
                    .where("session.id = :id", { id });
                if (this.source.options.type !== "better-sqlite3")
                    query.setLock("pessimistic_write");
                const row = await query.getOne();
                if (!row || row.endedAt || row.lastActiveAt > idle) return;
                const runtime = await readStoredJson<GameSessionRuntimeState>(row.runtimeStateJson);
                const noDraw = (): never => {
                    throw new Error("Retention cannot draw a Card");
                };
                const game = GameSession.restore(runtime, { nextFloat: noDraw, nextInt: noDraw });
                if (game.state !== "ENDED") game.end(game.revision);
                const stored = await externalizeSessionImmutableState(
                    manager,
                    game.toRuntimeState(),
                );
                const updated = await sessions.update(
                    { id, revision: row.revision, lastActiveAt: row.lastActiveAt },
                    {
                        revision: game.revision,
                        endedAt: new Date(
                            row.lastActiveAt.getTime() + this.limits.sessionIdleTtlSeconds * 1000,
                        ),
                        runtimeStateJson: stored.runtimeStateJson,
                        policyInputDigest: null,
                    },
                );
                result.expiredCouchGames += updated.affected ?? 0;
            });
        await persistenceTransaction(this.source, async (manager) => {
            const sessions = manager.getRepository(GameSessionEntity);
            const detached = await sessions
                .createQueryBuilder("session")
                .select("session.id")
                .where("session.endedAt <= :cutoff", { cutoff })
                .andWhere(
                    "EXISTS (SELECT 1 FROM rooms r WHERE r.id = session.room_id AND r.data_space_id IS NULL AND (r.current_session_id IS NULL OR r.current_session_id <> session.id))",
                )
                .orderBy("session.endedAt", "ASC")
                .take(this.limits.gameRetentionBatchSize)
                .getMany();
            for (const { id } of detached) {
                // The pointer cannot be assigned to an old ended Session by any command.
                result.deletedSessions += (await sessions.delete({ id })).affected ?? 0;
            }
            const rooms = manager.getRepository(RoomEntity);
            const expired = await rooms
                .createQueryBuilder("room")
                .select("room.id")
                .where("room.dataSpaceId IS NULL AND room.closedAt <= :cutoff", { cutoff })
                .andWhere(
                    "NOT EXISTS (SELECT 1 FROM room_create_idempotency replay WHERE replay.resource_id = room.id AND replay.state = 'REPLAYABLE')",
                )
                .orderBy("room.closedAt", "ASC")
                .take(this.limits.gameRetentionBatchSize)
                .getMany();
            for (const { id } of expired) {
                await rooms.update({ id }, { currentSessionId: null });
                result.deletedRooms +=
                    (
                        await rooms.delete({
                            id,
                            dataSpaceId: IsNull(),
                            closedAt: LessThanOrEqual(cutoff),
                        })
                    ).affected ?? 0;
            }
            const anonymous = await manager.getRepository(CouchGameSessionEntity).find({
                where: { dataSpaceId: IsNull(), endedAt: LessThanOrEqual(cutoff) },
                select: { id: true },
                take: this.limits.gameRetentionBatchSize,
            });
            for (const { id } of anonymous)
                result.deletedSessions +=
                    (await manager.getRepository(CouchGameSessionEntity).delete({ id })).affected ??
                    0;
            await collectUnusedSessionInputs(manager);
        });
        return result;
    }
}
