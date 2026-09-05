import { MigrationInterface, QueryRunner } from "typeorm";

const RUNTIME_TABLES = ["game_sessions", "couch_game_sessions"] as const;
const SOCIAL_SENSITIVITIES = [
    "GENERAL",
    "PERSONAL",
    "CLOSE_PERSONAL",
    "DEEP_PERSONAL",
    "INTIMATE",
    "EXPLICIT",
] as const;

type LegacyCompiledCard = {
    policyAvailable: boolean;
    alwaysEligible: boolean;
    repeatableInSession: boolean;
    repeatCooldown: number;
    intensity: number;
    weight: number;
    socialSensitivity: (typeof SOCIAL_SENSITIVITIES)[number];
    minimumPlayerCount: number;
    maximumPlayerCount: number | null;
};

type LegacyCompiledSnapshot = {
    catalog: unknown;
    policyRevisions: unknown;
    cards: Record<string, LegacyCompiledCard>;
};

type RuntimeV4 = {
    version: number;
    compiledCardPolicy?: LegacyCompiledSnapshot | Record<string, unknown> | null;
    [key: string]: unknown;
};

function compactSnapshot(snapshot: LegacyCompiledSnapshot): Record<string, unknown> {
    return {
        catalog: snapshot.catalog,
        policyRevisions: snapshot.policyRevisions,
        cards: Object.entries(snapshot.cards).map(([cardId, card]) => {
            let flags = card.policyAvailable ? 1 : 0;
            if (card.alwaysEligible) flags |= 2;
            if (card.repeatableInSession) flags |= 4;
            const sensitivityIndex = SOCIAL_SENSITIVITIES.indexOf(card.socialSensitivity);
            if (sensitivityIndex < 0) {
                throw new Error(
                    `Cannot compact unsupported social sensitivity ${card.socialSensitivity}`,
                );
            }
            return [
                cardId,
                flags,
                card.repeatCooldown,
                card.intensity,
                card.weight,
                sensitivityIndex,
                card.minimumPlayerCount,
                card.maximumPlayerCount,
            ];
        }),
    };
}

async function compactRuntimeTable(
    queryRunner: QueryRunner,
    table: (typeof RUNTIME_TABLES)[number],
): Promise<void> {
    const rows = (await queryRunner.query(
        `SELECT id, runtime_state_json FROM ${table} WHERE runtime_state_version = 4`,
    )) as Array<{ id: string; runtime_state_json: string }>;
    for (const row of rows) {
        const runtime = JSON.parse(row.runtime_state_json) as RuntimeV4;
        runtime.version = 5;
        if (runtime.compiledCardPolicy) {
            runtime.compiledCardPolicy = compactSnapshot(
                runtime.compiledCardPolicy as LegacyCompiledSnapshot,
            );
        }
        await queryRunner.query(
            `UPDATE ${table} SET runtime_state_version = 5, runtime_state_json = ? WHERE id = ?`,
            [JSON.stringify(runtime), row.id],
        );
    }
}

/**
 * Runtime v5 stores one positional tuple per Card. It retains immutable effective
 * selection values while removing repeated JSON keys and per-property provenance that
 * made production-catalog Session inserts exceed MariaDB's max_allowed_packet.
 */
export class CompactSessionCardPolicy1787356000000 implements MigrationInterface {
    name = "CompactSessionCardPolicy1787356000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        for (const table of RUNTIME_TABLES) await compactRuntimeTable(queryRunner, table);
    }

    async down(): Promise<void> {
        // Per-Card provenance was deliberately discarded and cannot be reconstructed.
    }
}
