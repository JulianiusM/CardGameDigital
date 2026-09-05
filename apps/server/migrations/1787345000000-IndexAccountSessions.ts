import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey, TableIndex } from "typeorm";

export class IndexAccountSessions1787345000000 implements MigrationInterface {
    name = "IndexAccountSessions1787345000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn(
            "session",
            new TableColumn({ name: "account_user_id", type: "int", isNullable: true }),
        );
        // The preceding session shape embedded full entities and had no portable,
        // indexed ownership field. Log existing browsers out instead of leaving
        // sessions that password reset and account revocation cannot identify.
        await queryRunner.query("DELETE FROM session");
        await queryRunner.createForeignKey(
            "session",
            new TableForeignKey({
                name: "FK_session_account_user",
                columnNames: ["account_user_id"],
                referencedTableName: "users",
                referencedColumnNames: ["id"],
                onDelete: "CASCADE",
            }),
        );
        await queryRunner.createIndex(
            "session",
            new TableIndex({
                name: "IDX_session_account_user",
                columnNames: ["account_user_id"],
            }),
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropIndex("session", "IDX_session_account_user");
        const table = await queryRunner.getTable("session");
        const foreignKey = table?.foreignKeys.find(
            ({ name }) => name === "FK_session_account_user",
        );
        if (foreignKey) await queryRunner.dropForeignKey("session", foreignKey);
        await queryRunner.dropColumn("session", "account_user_id");
    }
}
