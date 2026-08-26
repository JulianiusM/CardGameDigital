import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddMaximumSocialSensitivity1787352000000 implements MigrationInterface {
    name = "AddMaximumSocialSensitivity1787352000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn(
            "data_space_game_settings",
            new TableColumn({
                name: "maximum_social_sensitivity",
                type: "varchar",
                length: "24",
                default: "'EXPLICIT'",
            }),
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("data_space_game_settings", "maximum_social_sensitivity");
    }
}
