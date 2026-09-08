import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";
import { defaultRoomGameSettings } from "../../../packages/application/roomGameSettings";

export class AddAuthoritativeRoomSettings1787338000000 implements MigrationInterface {
    name = "AddAuthoritativeRoomSettings1787338000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumns("rooms", [
            new TableColumn({
                name: "settings_revision",
                type: "integer",
                default: 0,
            }),
            new TableColumn({
                name: "game_settings_json",
                type: "text",
                isNullable: true,
            }),
            new TableColumn({
                name: "settings_updated_by",
                type: "varchar",
                length: "36",
                isNullable: true,
            }),
        ]);
        // TEXT defaults are not portable to MySQL. Populate existing Rooms before
        // enforcing NOT NULL; new Rooms receive their settings from the application.
        await queryRunner.query("UPDATE rooms SET game_settings_json = ?", [
            JSON.stringify(defaultRoomGameSettings()),
        ]);
        await queryRunner.changeColumn(
            "rooms",
            "game_settings_json",
            new TableColumn({ name: "game_settings_json", type: "text" }),
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("rooms", "settings_updated_by");
        await queryRunner.dropColumn("rooms", "game_settings_json");
        await queryRunner.dropColumn("rooms", "settings_revision");
    }
}
