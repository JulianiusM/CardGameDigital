import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from "typeorm";

export class AddParticipantLifecycleAndGroupHistoryReset1787337000000 implements MigrationInterface {
    name = "AddParticipantLifecycleAndGroupHistoryReset1787337000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumns("room_participants", [
            new TableColumn({
                name: "connection_status",
                type: "varchar",
                length: "32",
                default: "'CONNECTED'",
            }),
            new TableColumn({
                name: "last_seen_at",
                type: "datetime",
                default: "CURRENT_TIMESTAMP",
            }),
            new TableColumn({ name: "left_at", type: "datetime", isNullable: true }),
        ]);
        await queryRunner.addColumn(
            "game_groups",
            new TableColumn({ name: "history_reset_at", type: "datetime", isNullable: true }),
        );
        await queryRunner.createTable(
            new Table({
                name: "couch_game_sessions",
                columns: [
                    { name: "id", type: "varchar", length: "36", isPrimary: true },
                    { name: "data_space_id", type: "varchar", length: "36", isNullable: true },
                    { name: "group_id", type: "varchar", length: "36", isNullable: true },
                    { name: "mode", type: "varchar", length: "40" },
                    { name: "revision", type: "int" },
                    { name: "runtime_state_version", type: "int" },
                    { name: "runtime_state_json", type: "text" },
                    { name: "started_at", type: "datetime" },
                    { name: "ended_at", type: "datetime", isNullable: true },
                ],
                foreignKeys: [
                    {
                        columnNames: ["data_space_id"],
                        referencedTableName: "data_spaces",
                        referencedColumnNames: ["id"],
                        onDelete: "CASCADE",
                    },
                    {
                        columnNames: ["group_id"],
                        referencedTableName: "game_groups",
                        referencedColumnNames: ["id"],
                        onDelete: "SET NULL",
                    },
                ],
            }),
        );
        await queryRunner.createTable(
            new Table({
                name: "couch_card_appearances",
                columns: [
                    { name: "id", type: "varchar", length: "36", isPrimary: true },
                    { name: "session_id", type: "varchar", length: "36" },
                    { name: "group_id", type: "varchar", length: "36", isNullable: true },
                    { name: "card_id", type: "varchar", length: "36" },
                    { name: "player_id", type: "varchar", length: "36", isNullable: true },
                    { name: "shown_at", type: "datetime" },
                    { name: "round_number", type: "int" },
                    { name: "sequence", type: "int" },
                    { name: "skipped", type: "boolean", default: false },
                ],
                foreignKeys: [
                    {
                        columnNames: ["session_id"],
                        referencedTableName: "couch_game_sessions",
                        referencedColumnNames: ["id"],
                        onDelete: "CASCADE",
                    },
                    {
                        columnNames: ["card_id"],
                        referencedTableName: "cards",
                        referencedColumnNames: ["id"],
                        onDelete: "RESTRICT",
                    },
                ],
            }),
        );
        await queryRunner.createIndex(
            "couch_card_appearances",
            new TableIndex({
                name: "IDX_couch_card_appearance_session",
                columnNames: ["session_id", "sequence"],
                isUnique: true,
            }),
        );
        await queryRunner.addColumn(
            "game_groups",
            new TableColumn({
                name: "preferred_profile_id",
                type: "varchar",
                length: "80",
                isNullable: true,
            }),
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable("couch_card_appearances");
        await queryRunner.dropTable("couch_game_sessions");
        await queryRunner.dropColumn("game_groups", "preferred_profile_id");
        await queryRunner.dropColumn("game_groups", "history_reset_at");
        await queryRunner.dropColumn("room_participants", "left_at");
        await queryRunner.dropColumn("room_participants", "last_seen_at");
        await queryRunner.dropColumn("room_participants", "connection_status");
    }
}
