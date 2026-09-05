import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddDevicePlayers1787336000000 implements MigrationInterface {
    name = "AddDevicePlayers1787336000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn(
            "room_participants",
            new TableColumn({
                name: "device_players_json",
                type: "varchar",
                length: "4096",
                default: "'[]'",
            }),
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("room_participants", "device_players_json");
    }
}
