import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddAccountLanguagePreferences1787349000000 implements MigrationInterface {
    name = "AddAccountLanguagePreferences1787349000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumns("users", [
            new TableColumn({ name: "use_system_language", type: "boolean", isNullable: true }),
            new TableColumn({
                name: "interface_locale",
                type: "varchar",
                length: "35",
                isNullable: true,
            }),
            new TableColumn({
                name: "card_locale",
                type: "varchar",
                length: "35",
                isNullable: true,
            }),
            new TableColumn({ name: "language_fallbacks_json", type: "text", isNullable: true }),
        ]);
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumns("users", [
            "language_fallbacks_json",
            "card_locale",
            "interface_locale",
            "use_system_language",
        ]);
    }
}
