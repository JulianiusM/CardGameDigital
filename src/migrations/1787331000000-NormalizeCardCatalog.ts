import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class NormalizeCardCatalog1787331000000 implements MigrationInterface {
    name = "NormalizeCardCatalog1787331000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: "locales",
                columns: [
                    { name: "id", type: "varchar", length: "35", isPrimary: true },
                    { name: "display_name", type: "varchar", length: "80" },
                    { name: "active", type: "boolean", default: true },
                    { name: "is_default", type: "boolean", default: false },
                ],
            }),
            true,
        );
        await queryRunner.manager
            .createQueryBuilder()
            .insert()
            .into("locales")
            .values([
                { id: "de-DE", displayName: "Deutsch (Deutschland)", active: true },
                { id: "en-GB", displayName: "English (United Kingdom)", active: true },
            ])
            .orIgnore()
            .execute();

        await queryRunner.createTable(
            new Table({
                name: "question_categories",
                columns: [{ name: "id", type: "varchar", length: "40", isPrimary: true }],
            }),
            true,
        );
        await queryRunner.createTable(
            new Table({
                name: "dare_types",
                columns: [{ name: "id", type: "varchar", length: "40", isPrimary: true }],
            }),
            true,
        );
        await queryRunner.createTable(
            new Table({
                name: "question_category_translations",
                columns: [
                    { name: "category_id", type: "varchar", length: "40", isPrimary: true },
                    { name: "locale", type: "varchar", length: "35", isPrimary: true },
                    { name: "label", type: "varchar", length: "80" },
                    { name: "description", type: "text", isNullable: true },
                ],
                foreignKeys: [
                    {
                        columnNames: ["category_id"],
                        referencedTableName: "question_categories",
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
        await queryRunner.createTable(
            new Table({
                name: "dare_type_translations",
                columns: [
                    { name: "dare_type_id", type: "varchar", length: "40", isPrimary: true },
                    { name: "locale", type: "varchar", length: "35", isPrimary: true },
                    { name: "label", type: "varchar", length: "80" },
                    { name: "description", type: "text", isNullable: true },
                ],
                foreignKeys: [
                    {
                        columnNames: ["dare_type_id"],
                        referencedTableName: "dare_types",
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
        await queryRunner.createTable(
            new Table({
                name: "cards",
                columns: [
                    { name: "id", type: "varchar", length: "36", isPrimary: true },
                    { name: "card_type", type: "varchar", length: "20" },
                    { name: "yes_no_answer_possible", type: "boolean", default: false },
                    {
                        name: "question_category_id",
                        type: "varchar",
                        length: "40",
                        isNullable: true,
                    },
                    { name: "dare_type_id", type: "varchar", length: "40", isNullable: true },
                    {
                        name: "dare_affinity_category_id",
                        type: "varchar",
                        length: "40",
                        isNullable: true,
                    },
                    { name: "intensity", type: "int", default: 1 },
                    { name: "always_eligible", type: "boolean", default: false },
                    { name: "repeatable_in_session", type: "boolean", default: false },
                    { name: "repeat_cooldown", type: "int", default: 0 },
                    { name: "weight", type: "float", default: 1 },
                    { name: "active", type: "boolean", default: true },
                ],
                foreignKeys: [
                    {
                        columnNames: ["question_category_id"],
                        referencedTableName: "question_categories",
                        referencedColumnNames: ["id"],
                        onDelete: "RESTRICT",
                    },
                    {
                        columnNames: ["dare_type_id"],
                        referencedTableName: "dare_types",
                        referencedColumnNames: ["id"],
                        onDelete: "RESTRICT",
                    },
                    {
                        columnNames: ["dare_affinity_category_id"],
                        referencedTableName: "question_categories",
                        referencedColumnNames: ["id"],
                        onDelete: "RESTRICT",
                    },
                ],
            }),
            true,
        );
        await queryRunner.createIndex(
            "cards",
            new TableIndex({ name: "IDX_cards_type_active", columnNames: ["card_type", "active"] }),
        );
        await queryRunner.createTable(
            new Table({
                name: "card_sources",
                columns: [
                    { name: "source_namespace", type: "varchar", length: "100", isPrimary: true },
                    { name: "source_id", type: "varchar", length: "255", isPrimary: true },
                    { name: "card_id", type: "varchar", length: "36" },
                    { name: "origin", type: "varchar", length: "255" },
                    { name: "origin_category", type: "varchar", length: "255", isNullable: true },
                ],
                foreignKeys: [
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
            "card_sources",
            new TableIndex({ name: "IDX_card_sources_card", columnNames: ["card_id"] }),
        );
        await queryRunner.createTable(
            new Table({
                name: "card_translations",
                columns: [
                    { name: "card_id", type: "varchar", length: "36", isPrimary: true },
                    { name: "locale", type: "varchar", length: "35", isPrimary: true },
                    { name: "text", type: "text" },
                    { name: "status", type: "varchar", length: "12" },
                    { name: "revision", type: "int" },
                    { name: "source_revision", type: "int" },
                    { name: "content_hash", type: "varchar", length: "64" },
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
            "card_translations",
            new TableIndex({
                name: "IDX_card_translations_locale_status",
                columnNames: ["locale", "status"],
            }),
        );
        await queryRunner.createTable(
            new Table({
                name: "card_operational_flags",
                columns: [
                    { name: "card_id", type: "varchar", length: "36", isPrimary: true },
                    { name: "flag", type: "varchar", length: "60", isPrimary: true },
                ],
                foreignKeys: [
                    {
                        columnNames: ["card_id"],
                        referencedTableName: "cards",
                        referencedColumnNames: ["id"],
                        onDelete: "CASCADE",
                    },
                ],
            }),
            true,
        );
        await queryRunner.createTable(
            new Table({
                name: "card_catalog_versions",
                columns: [
                    { name: "catalog_version", type: "varchar", length: "80", isPrimary: true },
                    { name: "schema_version", type: "int" },
                    { name: "source_name", type: "varchar", length: "100" },
                    { name: "source_digest", type: "varchar", length: "64" },
                    { name: "generated_at", type: "datetime" },
                    { name: "applied_at", type: "datetime" },
                ],
            }),
            true,
        );
        await queryRunner.createTable(
            new Table({
                name: "raw_card_imports",
                columns: [
                    { name: "id", type: "varchar", length: "36", isPrimary: true },
                    { name: "catalog_version", type: "varchar", length: "80" },
                    { name: "source_name", type: "varchar", length: "100" },
                    { name: "source_identifier", type: "varchar", length: "255" },
                    { name: "raw_payload_json", type: "text" },
                    { name: "validation_status", type: "varchar", length: "10" },
                    { name: "issues_json", type: "text" },
                ],
                foreignKeys: [
                    {
                        columnNames: ["catalog_version"],
                        referencedTableName: "card_catalog_versions",
                        referencedColumnNames: ["catalog_version"],
                        onDelete: "CASCADE",
                    },
                ],
            }),
            true,
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of [
            "raw_card_imports",
            "card_catalog_versions",
            "card_operational_flags",
            "card_translations",
            "card_sources",
            "cards",
            "dare_type_translations",
            "question_category_translations",
            "dare_types",
            "question_categories",
            "locales",
        ]) {
            if (await queryRunner.hasTable(table)) await queryRunner.dropTable(table, true);
        }
    }
}
