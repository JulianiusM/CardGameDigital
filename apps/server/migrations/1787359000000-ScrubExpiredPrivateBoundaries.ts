import { readStoredJson, writeStoredJson } from "../../../packages/persistence/storedJson";
import { type MigrationInterface, type QueryRunner, MoreThan } from "typeorm";
import type { GameSessionRuntimeState } from "../../../packages/game-core";
import { RoomEntity } from "../../../packages/persistence/entities/game/RoomEntity";
import { RoomParticipantEntity } from "../../../packages/persistence/entities/game/RoomParticipantEntity";
import { RoomParticipantBoundaryEntity } from "../../../packages/persistence/entities/game/RoomParticipantBoundaryEntity";
import {
    participantBoundariesAreNeeded,
    retainedRoomBoundaryPlayerIds,
    retainedRuntimeBoundaries,
} from "../../../packages/persistence/privateBoundaryRetention";

export class ScrubExpiredPrivateBoundaries1787359000000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const at = Date.now();
        const manager = queryRunner.manager;
        const boundaries = manager.getRepository(RoomParticipantBoundaryEntity);
        let after = "";
        while (true) {
            const page = await boundaries.find({
                where: { participantId: MoreThan(after) },
                order: { participantId: "ASC" },
                take: 100,
            });
            if (!page.length) break;
            for (const boundary of page) {
                const participant = await manager
                    .getRepository(RoomParticipantEntity)
                    .findOneBy({ id: boundary.participantId });
                const room = participant
                    ? await manager.getRepository(RoomEntity).findOneBy({ id: participant.roomId })
                    : null;
                if (
                    !room ||
                    !participant ||
                    !participantBoundariesAreNeeded(room, participant, at)
                ) {
                    await boundaries.delete({ participantId: boundary.participantId });
                }
            }
            after = page.at(-1)!.participantId;
        }

        for (const table of ["game_sessions", "couch_game_sessions"] as const) {
            after = "";
            while (true) {
                const query = manager
                    .createQueryBuilder()
                    .select(["id", "runtime_state_json", "ended_at"])
                    .from(table, "session")
                    .where("id > :after", { after })
                    .orderBy("id", "ASC")
                    .limit(100);
                if (table === "game_sessions") query.addSelect("room_id");
                const page = await query.getRawMany<{
                    id: string;
                    runtime_state_json: string;
                    ended_at: unknown;
                    room_id?: string | null;
                }>();
                if (!page.length) break;
                for (const row of page) {
                    const runtime = await readStoredJson<GameSessionRuntimeState>(
                        row.runtime_state_json,
                    );
                    if (!runtime.boundariesByPlayer?.length) continue;
                    let allowedPlayerIds: ReadonlySet<string> | undefined;
                    if (row.ended_at !== null || runtime.state === "ENDED") {
                        allowedPlayerIds = new Set();
                    } else if (table === "game_sessions") {
                        allowedPlayerIds = new Set();
                        const room = row.room_id
                            ? await manager.getRepository(RoomEntity).findOneBy({ id: row.room_id })
                            : null;
                        if (room?.currentSessionId === row.id) {
                            const participants = await manager
                                .getRepository(RoomParticipantEntity)
                                .findBy({ roomId: room.id });
                            allowedPlayerIds = retainedRoomBoundaryPlayerIds(
                                room,
                                participants,
                                at,
                            );
                        }
                    }
                    runtime.boundariesByPlayer = retainedRuntimeBoundaries(
                        runtime,
                        allowedPlayerIds,
                    );
                    await queryRunner.query(
                        `UPDATE ${table} SET runtime_state_json = ? WHERE id = ?`,
                        [await writeStoredJson(runtime), row.id],
                    );
                }
                after = page.at(-1)!.id;
            }
        }
    }

    async down(): Promise<void> {
        // Erased private values cannot and must not be reconstructed on rollback.
    }
}
