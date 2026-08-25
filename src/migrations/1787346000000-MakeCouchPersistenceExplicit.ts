import { MigrationInterface, QueryRunner } from "typeorm";

export class MakeCouchPersistenceExplicit1787346000000 implements MigrationInterface {
    name = "MakeCouchPersistenceExplicit1787346000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        // Earlier builds wrote quick Couch rounds with a null owner. They were never
        // account data and must not survive once EPHEMERAL becomes an explicit contract.
        await queryRunner.query("DELETE FROM couch_game_sessions WHERE data_space_id IS NULL");
    }

    async down(): Promise<void> {
        // Deleted anonymous quick-round state cannot and should not be reconstructed.
    }
}
