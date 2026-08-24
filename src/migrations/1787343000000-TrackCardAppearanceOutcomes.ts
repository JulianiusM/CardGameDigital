import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

type StoredAppearance = {
    sequence: number;
    skipped?: boolean;
    completed?: boolean;
    vetoed?: boolean;
};

type StoredRuntime = {
    version: number;
    state: string;
    currentCard: unknown | null;
    sessionHistory: StoredAppearance[];
};

type RuntimeRow = { id: string; runtime_state_json: string };

function upgradeOutcomes(runtime: StoredRuntime): StoredRuntime {
    const lastSequence = runtime.sessionHistory.at(-1)?.sequence ?? null;
    // Version 2 cleared currentCard when ending, so its final appearance is ambiguous.
    // Preserve that final row as incomplete instead of inventing a completion.
    const unresolvedSequence =
        runtime.currentCard || runtime.state === "ENDED" ? lastSequence : null;
    runtime.sessionHistory = runtime.sessionHistory.map((appearance) => {
        const skipped = Boolean(appearance.skipped);
        const vetoed = Boolean(appearance.vetoed);
        return {
            ...appearance,
            skipped,
            completed:
                Boolean(appearance.completed) ||
                (!skipped && !vetoed && appearance.sequence !== unresolvedSequence),
            vetoed,
        };
    });
    runtime.version = 3;
    return runtime;
}

function downgradeOutcomes(runtime: StoredRuntime): StoredRuntime {
    runtime.sessionHistory = runtime.sessionHistory.map((appearance) => {
        const downgraded = {
            ...appearance,
            skipped: Boolean(appearance.skipped) || Boolean(appearance.vetoed),
        };
        delete downgraded.completed;
        delete downgraded.vetoed;
        return downgraded;
    });
    runtime.version = 2;
    return runtime;
}

async function rewriteRuntimeTable(
    queryRunner: QueryRunner,
    runtimeTable: "game_sessions" | "couch_game_sessions",
    appearanceTable: "card_appearances" | "couch_card_appearances",
    transform: (runtime: StoredRuntime) => StoredRuntime,
): Promise<void> {
    const rows = (await queryRunner.query(
        `SELECT id, runtime_state_json FROM \`${runtimeTable}\``,
    )) as RuntimeRow[];
    for (const row of rows) {
        const runtime = transform(JSON.parse(row.runtime_state_json) as StoredRuntime);
        await queryRunner.query(
            `UPDATE \`${runtimeTable}\`
             SET runtime_state_version = ?, runtime_state_json = ?
             WHERE id = ?`,
            [runtime.version, JSON.stringify(runtime), row.id],
        );
        for (const appearance of runtime.sessionHistory) {
            await queryRunner.query(
                `UPDATE \`${appearanceTable}\`
                 SET skipped = ?, completed = ?, vetoed = ?
                 WHERE session_id = ? AND sequence = ?`,
                [
                    Boolean(appearance.skipped),
                    Boolean(appearance.completed),
                    Boolean(appearance.vetoed),
                    row.id,
                    appearance.sequence,
                ],
            );
        }
    }
}

export class TrackCardAppearanceOutcomes1787343000000 implements MigrationInterface {
    name = "TrackCardAppearanceOutcomes1787343000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumns("couch_card_appearances", [
            new TableColumn({ name: "completed", type: "boolean", default: false }),
            new TableColumn({ name: "vetoed", type: "boolean", default: false }),
        ]);
        await rewriteRuntimeTable(
            queryRunner,
            "game_sessions",
            "card_appearances",
            upgradeOutcomes,
        );
        await rewriteRuntimeTable(
            queryRunner,
            "couch_game_sessions",
            "couch_card_appearances",
            upgradeOutcomes,
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await rewriteRuntimeTable(
            queryRunner,
            "game_sessions",
            "card_appearances",
            downgradeOutcomes,
        );
        await rewriteRuntimeTable(
            queryRunner,
            "couch_game_sessions",
            "couch_card_appearances",
            downgradeOutcomes,
        );
        await queryRunner.dropColumn("couch_card_appearances", "vetoed");
        await queryRunner.dropColumn("couch_card_appearances", "completed");
    }
}
