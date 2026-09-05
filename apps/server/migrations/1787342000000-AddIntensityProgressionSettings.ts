import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddIntensityProgressionSettings1787342000000 implements MigrationInterface {
    name = "AddIntensityProgressionSettings1787342000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumns("data_space_game_settings", [
            new TableColumn({ name: "starting_intensity", type: "integer", default: 1 }),
            new TableColumn({
                name: "intensity_progression_unit",
                type: "varchar",
                length: "16",
                default: "'CARDS'",
            }),
            new TableColumn({
                name: "intensity_progression_interval",
                type: "integer",
                default: 2,
            }),
            new TableColumn({
                name: "intensity_progression_increment",
                type: "float",
                default: 1,
            }),
        ]);
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumns("data_space_game_settings", [
            "intensity_progression_increment",
            "intensity_progression_interval",
            "intensity_progression_unit",
            "starting_intensity",
        ]);
    }
}
