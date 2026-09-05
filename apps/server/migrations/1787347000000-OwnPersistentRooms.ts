import { MigrationInterface, QueryRunner, TableForeignKey, TableIndex } from "typeorm";

export class OwnPersistentRooms1787347000000 implements MigrationInterface {
    name = "OwnPersistentRooms1787347000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE rooms
             SET data_space_id = NULL
             WHERE data_space_id IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1 FROM data_spaces WHERE data_spaces.id = rooms.data_space_id
               )`,
        );
        await queryRunner.createIndex(
            "rooms",
            new TableIndex({ name: "IDX_rooms_data_space", columnNames: ["data_space_id"] }),
        );
        await queryRunner.createForeignKey(
            "rooms",
            new TableForeignKey({
                name: "FK_rooms_data_space",
                columnNames: ["data_space_id"],
                referencedTableName: "data_spaces",
                referencedColumnNames: ["id"],
                onDelete: "CASCADE",
            }),
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable("rooms");
        const foreignKey = table?.foreignKeys.find(({ name }) => name === "FK_rooms_data_space");
        if (foreignKey) await queryRunner.dropForeignKey("rooms", foreignKey);
        await queryRunner.dropIndex("rooms", "IDX_rooms_data_space");
    }
}
