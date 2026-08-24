import { MigrationInterface, QueryRunner, TableIndex } from "typeorm";

export class HardenOidcIdentity1787344000000 implements MigrationInterface {
    name = "HardenOidcIdentity1787344000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createIndex(
            "users",
            new TableIndex({
                name: "UQ_users_oidc_identity",
                columnNames: ["oidc_issuer", "oidc_sub"],
                isUnique: true,
            }),
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropIndex("users", "UQ_users_oidc_identity");
    }
}
