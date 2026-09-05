import { MigrationInterface, QueryRunner, Table } from "typeorm";

export class AddParticipantBoundaries1787333000000 implements MigrationInterface {
    name = "AddParticipantBoundaries1787333000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: "room_participant_boundaries",
                columns: [
                    { name: "participant_id", type: "varchar", length: "36", isPrimary: true },
                    { name: "disabled_question_category_ids", type: "text" },
                    { name: "disabled_dare_type_ids", type: "text" },
                    { name: "blocked_operational_flags", type: "text" },
                    { name: "updated_at", type: "datetime" },
                ],
                foreignKeys: [
                    {
                        columnNames: ["participant_id"],
                        referencedTableName: "room_participants",
                        referencedColumnNames: ["id"],
                        onDelete: "CASCADE",
                    },
                ],
            }),
            true,
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable("room_participant_boundaries")) {
            await queryRunner.dropTable("room_participant_boundaries", true);
        }
    }
}
