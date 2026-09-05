import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class HardenAccountSecrets1787334000000 implements MigrationInterface {
    name = "HardenAccountSecrets1787334000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable("users"))) return;
        const table = await queryRunner.getTable("users");
        const columns = [
            new TableColumn({
                name: "activation_token_hash",
                type: "varchar",
                length: "64",
                isNullable: true,
            }),
            new TableColumn({
                name: "reset_token_hash",
                type: "varchar",
                length: "64",
                isNullable: true,
            }),
        ];
        for (const column of columns) {
            if (!table?.findColumnByName(column.name)) await queryRunner.addColumn("users", column);
        }
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable("users"))) return;
        for (const name of ["reset_token_hash", "activation_token_hash"]) {
            if ((await queryRunner.getTable("users"))?.findColumnByName(name)) {
                await queryRunner.dropColumn("users", name);
            }
        }
    }
}
