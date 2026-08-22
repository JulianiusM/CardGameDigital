import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from "typeorm";

export class BundledCardCatalog1787339000000 implements MigrationInterface {
    name = "BundledCardCatalog1787339000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        for (const table of [
            "raw_card_imports",
            "card_sources",
            "card_translations",
            "card_catalog_versions",
        ]) {
            if (await queryRunner.hasTable(table)) await queryRunner.dropTable(table, true);
        }
        if (!(await queryRunner.hasColumn("locales", "is_default"))) {
            await queryRunner.addColumn(
                "locales",
                new TableColumn({ name: "is_default", type: "boolean", default: false }),
            );
        }
        await queryRunner.query("DELETE FROM question_category_translations");
        await queryRunner.query("DELETE FROM dare_type_translations");
        await queryRunner.createTable(
            new Table({
                name: "card_localizations",
                columns: [
                    { name: "card_id", type: "varchar", length: "36", isPrimary: true },
                    { name: "locale", type: "varchar", length: "35", isPrimary: true },
                    { name: "text", type: "text" },
                    { name: "active", type: "boolean", default: true },
                    { name: "updated_at", type: "datetime" },
                ],
                foreignKeys: [
                    {
                        columnNames: ["card_id"],
                        referencedTableName: "cards",
                        referencedColumnNames: ["id"],
                        onDelete: "RESTRICT",
                    },
                    {
                        columnNames: ["locale"],
                        referencedTableName: "locales",
                        referencedColumnNames: ["id"],
                        onDelete: "RESTRICT",
                    },
                ],
            }),
            true,
        );
        await queryRunner.createIndex(
            "card_localizations",
            new TableIndex({
                name: "IDX_card_localizations_locale_active",
                columnNames: ["locale", "active"],
            }),
        );
        await queryRunner.createTable(
            new Table({
                name: "card_catalog_versions",
                columns: [
                    { name: "catalog_id", type: "varchar", length: "40", isPrimary: true },
                    { name: "sequence", type: "int", isPrimary: true },
                    { name: "catalog_version", type: "varchar", length: "80" },
                    { name: "artifact_digest", type: "varchar", length: "64" },
                    { name: "generated_at", type: "datetime" },
                    { name: "applied_at", type: "datetime" },
                    { name: "default_locale", type: "varchar", length: "35" },
                    { name: "card_count", type: "int" },
                    { name: "locale_count", type: "int" },
                ],
                uniques: [
                    {
                        name: "UQ_card_catalog_version",
                        columnNames: ["catalog_id", "catalog_version"],
                    },
                ],
            }),
            true,
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable("card_catalog_versions", true);
        await queryRunner.dropTable("card_localizations", true);
    }
}
