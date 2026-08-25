import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddGroupSetupDefaults1787350000000 implements MigrationInterface {
    name = "AddGroupSetupDefaults1787350000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumns("game_groups", [
            new TableColumn({
                name: "custom_configuration_json",
                type: "text",
                isNullable: true,
            }),
            new TableColumn({
                name: "card_language_settings_json",
                type: "text",
                isNullable: true,
            }),
        ]);
        await queryRunner.addColumn(
            "data_space_game_settings",
            new TableColumn({
                name: "card_language_settings_json",
                type: "text",
                isNullable: true,
            }),
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("data_space_game_settings", "card_language_settings_json");
        await queryRunner.dropColumns("game_groups", [
            "card_language_settings_json",
            "custom_configuration_json",
        ]);
    }
}
