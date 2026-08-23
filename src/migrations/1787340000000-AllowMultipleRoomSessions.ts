import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey, TableIndex } from "typeorm";

export class AllowMultipleRoomSessions1787340000000 implements MigrationInterface {
    name = "AllowMultipleRoomSessions1787340000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn(
            "rooms",
            new TableColumn({
                name: "current_session_id",
                type: "varchar",
                length: "36",
                isNullable: true,
            }),
        );
        await queryRunner.query(
            "UPDATE rooms SET current_session_id = (SELECT id FROM game_sessions WHERE game_sessions.room_id = rooms.id)",
        );
        await queryRunner.createForeignKey(
            "rooms",
            new TableForeignKey({
                name: "FK_room_current_session",
                columnNames: ["current_session_id"],
                referencedTableName: "game_sessions",
                referencedColumnNames: ["id"],
                onDelete: "SET NULL",
            }),
        );

        const sessions = await queryRunner.getTable("game_sessions");
        const uniqueRoom = sessions?.uniques.find(
            ({ columnNames }) => columnNames.length === 1 && columnNames[0] === "room_id",
        );
        if (uniqueRoom) await queryRunner.dropUniqueConstraint("game_sessions", uniqueRoom);
        const uniqueIndex = sessions?.indices.find(
            ({ columnNames, isUnique }) =>
                isUnique && columnNames.length === 1 && columnNames[0] === "room_id",
        );
        if (uniqueIndex) await queryRunner.dropIndex("game_sessions", uniqueIndex);
        await queryRunner.createIndex(
            "game_sessions",
            new TableIndex({ name: "IDX_game_session_room", columnNames: ["room_id"] }),
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropIndex("game_sessions", "IDX_game_session_room");
        const rooms = await queryRunner.getTable("rooms");
        const currentSessionForeignKey = rooms?.foreignKeys.find(({ columnNames }) =>
            columnNames.includes("current_session_id"),
        );
        if (currentSessionForeignKey)
            await queryRunner.dropForeignKey("rooms", currentSessionForeignKey);
        await queryRunner.dropColumn("rooms", "current_session_id");
        await queryRunner.createIndex(
            "game_sessions",
            new TableIndex({
                name: "UQ_game_session_room_active",
                columnNames: ["room_id"],
                isUnique: true,
            }),
        );
    }
}
