import { MigrationInterface, QueryRunner, Table, TableColumn, TableForeignKey } from "typeorm";

export class AddAccountGroupsAndSettings1787335000000 implements MigrationInterface {
    name = "AddAccountGroupsAndSettings1787335000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: "game_groups",
                columns: [
                    { name: "id", type: "varchar", length: "36", isPrimary: true },
                    { name: "data_space_id", type: "varchar", length: "36" },
                    { name: "name", type: "varchar", length: "80" },
                    { name: "members_json", type: "text" },
                    { name: "created_at", type: "datetime" },
                    { name: "updated_at", type: "datetime" },
                ],
                uniques: [{ columnNames: ["data_space_id", "name"] }],
                foreignKeys: [
                    {
                        columnNames: ["data_space_id"],
                        referencedTableName: "data_spaces",
                        referencedColumnNames: ["id"],
                        onDelete: "CASCADE",
                    },
                ],
            }),
        );
        await queryRunner.createTable(
            new Table({
                name: "data_space_game_settings",
                columns: [
                    { name: "data_space_id", type: "varchar", length: "36", isPrimary: true },
                    { name: "preferred_profile_id", type: "varchar", length: "80" },
                    { name: "maximum_intensity", type: "integer" },
                    { name: "random_question_ratio", type: "float" },
                    { name: "lets_talk_meta_interval", type: "integer" },
                    { name: "default_group_id", type: "varchar", length: "36", isNullable: true },
                    { name: "updated_at", type: "datetime" },
                ],
                foreignKeys: [
                    {
                        columnNames: ["data_space_id"],
                        referencedTableName: "data_spaces",
                        referencedColumnNames: ["id"],
                        onDelete: "CASCADE",
                    },
                    {
                        columnNames: ["default_group_id"],
                        referencedTableName: "game_groups",
                        referencedColumnNames: ["id"],
                        onDelete: "SET NULL",
                    },
                ],
            }),
        );
        await queryRunner.addColumn(
            "rooms",
            new TableColumn({ name: "group_id", type: "varchar", length: "36", isNullable: true }),
        );
        await queryRunner.createForeignKey(
            "rooms",
            new TableForeignKey({
                columnNames: ["group_id"],
                referencedTableName: "game_groups",
                referencedColumnNames: ["id"],
                onDelete: "SET NULL",
            }),
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("rooms", "group_id");
        await queryRunner.dropTable("data_space_game_settings");
        await queryRunner.dropTable("game_groups");
    }
}
