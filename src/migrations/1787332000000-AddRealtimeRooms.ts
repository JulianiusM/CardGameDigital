import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class AddRealtimeRooms1787332000000 implements MigrationInterface {
    name = "AddRealtimeRooms1787332000000";
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: "rooms",
                columns: [
                    { name: "id", type: "varchar", length: "36", isPrimary: true },
                    { name: "code", type: "varchar", length: "8", isUnique: true },
                    { name: "data_space_id", type: "varchar", length: "36", isNullable: true },
                    { name: "created_at", type: "datetime" },
                    { name: "expires_at", type: "datetime" },
                ],
            }),
            true,
        );
        await queryRunner.createTable(
            new Table({
                name: "room_participants",
                columns: [
                    { name: "id", type: "varchar", length: "36", isPrimary: true },
                    { name: "room_id", type: "varchar", length: "36" },
                    { name: "role", type: "varchar", length: "16" },
                    { name: "display_name", type: "varchar", length: "40" },
                    { name: "credential_hash", type: "varchar", length: "64" },
                    { name: "created_at", type: "datetime" },
                ],
                foreignKeys: [
                    {
                        columnNames: ["room_id"],
                        referencedTableName: "rooms",
                        referencedColumnNames: ["id"],
                        onDelete: "CASCADE",
                    },
                ],
            }),
            true,
        );
        await queryRunner.createIndex(
            "room_participants",
            new TableIndex({ name: "IDX_room_participant_room", columnNames: ["room_id"] }),
        );
        await queryRunner.createTable(
            new Table({
                name: "game_sessions",
                columns: [
                    { name: "id", type: "varchar", length: "36", isPrimary: true },
                    { name: "room_id", type: "varchar", length: "36", isUnique: true },
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
                        columnNames: ["room_id"],
                        referencedTableName: "rooms",
                        referencedColumnNames: ["id"],
                        onDelete: "CASCADE",
                    },
                ],
            }),
            true,
        );
        await queryRunner.createTable(
            new Table({
                name: "card_appearances",
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
                    { name: "completed", type: "boolean", default: false },
                    { name: "vetoed", type: "boolean", default: false },
                ],
                foreignKeys: [
                    {
                        columnNames: ["session_id"],
                        referencedTableName: "game_sessions",
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
            true,
        );
        await queryRunner.createIndex(
            "card_appearances",
            new TableIndex({
                name: "IDX_card_appearance_session",
                columnNames: ["session_id", "sequence"],
                isUnique: true,
            }),
        );
    }
    async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of ["card_appearances", "game_sessions", "room_participants", "rooms"])
            if (await queryRunner.hasTable(table)) await queryRunner.dropTable(table, true);
    }
}
