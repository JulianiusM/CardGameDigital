import { readStoredJson } from "./storedJson";
import type { EntityManager } from "typeorm";
import { GameSession, type GameSessionRuntimeState } from "../game-core";
import {
    collectUnusedSessionInputs,
    externalizeSessionImmutableState,
} from "./sessionImmutablePayloadStore";

/** Runs atomically with FULL catalog application. Group history never pins a release. */
export async function endSessionsFromOtherCatalogs(
    manager: EntityManager,
    digest: string,
): Promise<void> {
    for (const table of ["game_sessions", "couch_game_sessions"]) {
        let after = "";
        while (true) {
            const [row] = await manager.query(
                `SELECT id, runtime_state_json FROM ${table} WHERE ended_at IS NULL AND id > ? ORDER BY id LIMIT 1`,
                [after],
            );
            if (!row) break;
            after = row.id;
            const runtime = await readStoredJson<GameSessionRuntimeState>(row.runtime_state_json);
            if (runtime.catalog?.artifactDigest === digest) continue;
            const noRandom = (): never => {
                throw new Error("Ending a Session cannot draw");
            };
            const session = GameSession.restore(runtime, {
                nextFloat: noRandom,
                nextInt: noRandom,
            });
            if (session.state !== "ENDED") session.end(session.revision);
            const stored = await externalizeSessionImmutableState(
                manager,
                session.toRuntimeState(),
            );
            if (table === "game_sessions")
                await manager.query(
                    `DELETE FROM card_appearances WHERE session_id = ? AND EXISTS (SELECT 1 FROM game_sessions s JOIN rooms r ON r.id = s.room_id WHERE s.id = ? AND r.data_space_id IS NULL)`,
                    [row.id, row.id],
                );
            await manager.query(
                `UPDATE ${table} SET runtime_state_json = ?, revision = ?, ended_at = CURRENT_TIMESTAMP, policy_input_digest = NULL WHERE id = ?`,
                [stored.runtimeStateJson, session.revision, row.id],
            );
        }
    }
    await collectUnusedSessionInputs(manager);
}
