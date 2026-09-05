import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddRoomClosure1787341000000 implements MigrationInterface {
    name = "AddRoomClosure1787341000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn(
            "rooms",
            new TableColumn({ name: "closed_at", type: "datetime", isNullable: true }),
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("rooms", "closed_at");
    }
}
