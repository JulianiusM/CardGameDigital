import { MigrationInterface, QueryRunner } from "typeorm";

const RUNTIME_TABLES = ["game_sessions", "couch_game_sessions"] as const;
const CLEANUP_BATCH_SIZE = 250;

function containsValidJson(raw: unknown): boolean {
    if (typeof raw !== "string" || raw.trim().length === 0) return false;
    try {
        JSON.parse(raw);
        return true;
    } catch {
        return false;
    }
}

async function removeCorruptSessions(
    queryRunner: QueryRunner,
    table: (typeof RUNTIME_TABLES)[number],
): Promise<void> {
    const rows = (await queryRunner.query(`SELECT id, runtime_state_json FROM ${table}`)) as Array<{
        id: string;
        runtime_state_json: unknown;
    }>;
    const corruptIds = rows
        .filter(({ runtime_state_json }) => !containsValidJson(runtime_state_json))
        .map(({ id }) => id);
    for (let index = 0; index < corruptIds.length; index += CLEANUP_BATCH_SIZE) {
        const ids = corruptIds.slice(index, index + CLEANUP_BATCH_SIZE);
        const placeholders = ids.map(() => "?").join(", ");
        if (table === "game_sessions") {
            await queryRunner.query(
                `UPDATE rooms SET current_session_id = NULL WHERE current_session_id IN (${placeholders})`,
                ids,
            );
        }
        await queryRunner.query(`DELETE FROM ${table} WHERE id IN (${placeholders})`, ids);
    }
}

/**
 * Production Card-policy snapshots are larger than MariaDB TEXT's 65,535-byte limit.
 * Widen persisted Room and Session JSON before another snapshot can be truncated, then
 * discard only the already-unreadable Session rows that cannot be recovered.
 */
export class ExpandSessionRuntimeStorage1787354000000 implements MigrationInterface {
    name = "ExpandSessionRuntimeStorage1787354000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        const databaseType = queryRunner.connection.options.type;
        if (databaseType === "mariadb" || databaseType === "mysql") {
            await queryRunner.query(
                "ALTER TABLE rooms MODIFY COLUMN game_settings_json LONGTEXT NOT NULL",
            );
            for (const table of RUNTIME_TABLES) {
                await queryRunner.query(
                    `ALTER TABLE ${table} MODIFY COLUMN runtime_state_json LONGTEXT NOT NULL`,
                );
            }
        }
        for (const table of RUNTIME_TABLES) await removeCorruptSessions(queryRunner, table);
    }

    async down(): Promise<void> {
        // Narrowing these columns would either fail or truncate valid production snapshots.
    }
}
