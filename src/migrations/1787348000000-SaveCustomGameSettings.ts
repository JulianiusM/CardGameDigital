import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class SaveCustomGameSettings1787348000000 implements MigrationInterface {
    name = "SaveCustomGameSettings1787348000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn(
            "data_space_game_settings",
            new TableColumn({
                name: "custom_configuration_json",
                type: "text",
                isNullable: true,
            }),
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("data_space_game_settings", "custom_configuration_json");
    }
}
