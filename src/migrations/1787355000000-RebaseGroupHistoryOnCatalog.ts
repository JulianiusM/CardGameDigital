import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Gives Groups that predate the installed production catalog a fresh history epoch.
 * Their old appearances remain available for account export but no longer exclude the
 * replacement catalog's Card pool.
 */
export class RebaseGroupHistoryOnCatalog1787355000000 implements MigrationInterface {
    name = "RebaseGroupHistoryOnCatalog1787355000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        const releases = (await queryRunner.query(
            "SELECT applied_at FROM card_catalog_versions ORDER BY applied_at DESC LIMIT 1",
        )) as Array<{ applied_at: unknown }>;
        const catalogAppliedAt = releases[0]?.applied_at;
        if (!catalogAppliedAt) return;
        await queryRunner.query(
            `UPDATE game_groups
             SET history_reset_at = ?
             WHERE created_at < ?
               AND (history_reset_at IS NULL OR history_reset_at < ?)`,
            [catalogAppliedAt, catalogAppliedAt, catalogAppliedAt],
        );
    }

    async down(): Promise<void> {
        // The previous user-controlled history reset timestamp cannot be reconstructed.
    }
}
