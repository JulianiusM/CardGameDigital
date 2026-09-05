import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from "typeorm";

export class IntroduceDataSpaces1787330000000 implements MigrationInterface {
    name = "IntroduceDataSpaces1787330000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        const generatedInteger =
            queryRunner.connection.options.type === "better-sqlite3" ? "integer" : "int";
        if (!(await queryRunner.hasTable("users"))) {
            await queryRunner.createTable(
                new Table({
                    name: "users",
                    columns: [
                        {
                            name: "id",
                            type: generatedInteger,
                            isPrimary: true,
                            isGenerated: true,
                            generationStrategy: "increment",
                        },
                        { name: "username", type: "varchar", length: "50", isUnique: true },
                        { name: "name", type: "varchar", length: "50" },
                        { name: "email", type: "varchar", length: "100", isUnique: true },
                        { name: "PASSWORD", type: "varchar", length: "255", isNullable: true },
                        { name: "is_active", type: "boolean", default: false, isNullable: true },
                        { name: "activation_token_expiration", type: "datetime", isNullable: true },
                        { name: "reset_token_expiration", type: "datetime", isNullable: true },
                        { name: "oidc_sub", type: "varchar", length: "255", isNullable: true },
                        { name: "oidc_issuer", type: "varchar", length: "255", isNullable: true },
                        { name: "created_at", type: "datetime", default: "CURRENT_TIMESTAMP" },
                        { name: "updated_at", type: "datetime", default: "CURRENT_TIMESTAMP" },
                    ],
                }),
            );
        }
        if (!(await queryRunner.hasTable("data_spaces"))) {
            await queryRunner.createTable(
                new Table({
                    name: "data_spaces",
                    columns: [
                        { name: "id", type: "varchar", length: "36", isPrimary: true },
                        { name: "name", type: "varchar", length: "50" },
                        { name: "default_for_owner", type: "boolean", default: false },
                        { name: "user_id", type: "int", isNullable: true },
                        { name: "created_at", type: "datetime", default: "CURRENT_TIMESTAMP" },
                        { name: "updated_at", type: "datetime", default: "CURRENT_TIMESTAMP" },
                    ],
                }),
            );
        }
        const dataSpaces = await queryRunner.getTable("data_spaces");
        if (
            dataSpaces &&
            !dataSpaces.foreignKeys.some((key) => key.columnNames.includes("user_id"))
        ) {
            await queryRunner.createForeignKey(
                "data_spaces",
                new TableForeignKey({
                    columnNames: ["user_id"],
                    referencedTableName: "users",
                    referencedColumnNames: ["id"],
                    onDelete: "SET NULL",
                    onUpdate: "CASCADE",
                }),
            );
        }
        if (!(await queryRunner.hasTable("session"))) {
            await queryRunner.createTable(
                new Table({
                    name: "session",
                    columns: [
                        { name: "id", type: "varchar", length: "255", isPrimary: true },
                        { name: "expiredAt", type: "bigint" },
                        { name: "json", type: "text" },
                        { name: "destroyedAt", type: "datetime", isNullable: true },
                    ],
                }),
            );
            await queryRunner.createIndex(
                "session",
                new TableIndex({ name: "IDX_account_session_expiry", columnNames: ["expiredAt"] }),
            );
        }
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable("session")) await queryRunner.dropTable("session");
        if (await queryRunner.hasTable("data_spaces")) await queryRunner.dropTable("data_spaces");
        if (await queryRunner.hasTable("users")) await queryRunner.dropTable("users");
    }
}
