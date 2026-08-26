import {
    MigrationInterface,
    QueryRunner,
    Table,
    TableColumn,
    TableForeignKey,
    TableIndex,
} from "typeorm";

export class AddScopedCardManagement1787351000000 implements MigrationInterface {
    name = "AddScopedCardManagement1787351000000";

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumns("question_categories", [
            new TableColumn({
                name: "default_social_sensitivity",
                type: "varchar",
                length: "24",
                default: "'GENERAL'",
            }),
            new TableColumn({
                name: "default_minimum_player_count",
                type: "int",
                default: 2,
            }),
            new TableColumn({
                name: "default_maximum_player_count",
                type: "int",
                isNullable: true,
            }),
        ]);
        await queryRunner.addColumns("dare_types", [
            new TableColumn({
                name: "default_social_sensitivity",
                type: "varchar",
                length: "24",
                default: "'GENERAL'",
            }),
            new TableColumn({
                name: "default_minimum_player_count",
                type: "int",
                default: 2,
            }),
            new TableColumn({
                name: "default_maximum_player_count",
                type: "int",
                isNullable: true,
            }),
        ]);
        await queryRunner.addColumns("cards", [
            new TableColumn({
                name: "social_sensitivity",
                type: "varchar",
                length: "24",
                default: "'GENERAL'",
            }),
            new TableColumn({ name: "minimum_player_count", type: "int", default: 2 }),
            new TableColumn({ name: "maximum_player_count", type: "int", isNullable: true }),
        ]);
        await queryRunner.createIndices("cards", [
            new TableIndex({
                name: "IDX_cards_management_sensitivity",
                columnNames: ["social_sensitivity", "active", "id"],
            }),
            new TableIndex({
                name: "IDX_cards_management_question",
                columnNames: ["question_category_id", "active", "id"],
            }),
            new TableIndex({
                name: "IDX_cards_management_dare",
                columnNames: ["dare_type_id", "active", "id"],
            }),
            new TableIndex({
                name: "IDX_cards_management_players",
                columnNames: ["minimum_player_count", "maximum_player_count", "id"],
            }),
        ]);
        await queryRunner.createIndex(
            "card_operational_flags",
            new TableIndex({
                name: "IDX_card_operational_flags_flag_card",
                columnNames: ["flag", "card_id"],
            }),
        );
        await queryRunner.addColumn(
            "card_catalog_versions",
            new TableColumn({
                name: "contract",
                type: "varchar",
                length: "40",
                default: "'game-card-catalog/v1'",
            }),
        );
        await this.createScopeDefaultTable(queryRunner);
        await this.createRuleTable(queryRunner);
        await this.createExactCardTable(queryRunner);
        await this.migrateSessionRuntime(queryRunner, 3, 4);
    }

    private async createScopeDefaultTable(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: "card_policy_scope_defaults",
                columns: [
                    { name: "owner_key", type: "varchar", length: "80", isPrimary: true },
                    { name: "data_space_id", type: "varchar", length: "36" },
                    { name: "group_id", type: "varchar", length: "36", isNullable: true },
                    { name: "directives_json", type: "text" },
                    { name: "revision", type: "int", default: 1 },
                    { name: "created_at", type: "datetime" },
                    { name: "updated_at", type: "datetime" },
                ],
                foreignKeys: this.ownerForeignKeys(),
            }),
            true,
        );
        await queryRunner.createIndex(
            "card_policy_scope_defaults",
            new TableIndex({
                name: "IDX_card_policy_default_space",
                columnNames: ["data_space_id"],
            }),
        );
    }

    private async createRuleTable(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: "card_policy_conditional_rules",
                columns: [
                    { name: "id", type: "varchar", length: "36", isPrimary: true },
                    { name: "owner_key", type: "varchar", length: "80" },
                    { name: "data_space_id", type: "varchar", length: "36" },
                    { name: "group_id", type: "varchar", length: "36", isNullable: true },
                    { name: "name", type: "varchar", length: "100" },
                    { name: "rule_order", type: "int" },
                    { name: "enabled", type: "boolean", default: true },
                    { name: "predicate_json", type: "text" },
                    { name: "directives_json", type: "text" },
                    { name: "revision", type: "int", default: 1 },
                    { name: "created_at", type: "datetime" },
                    { name: "updated_at", type: "datetime" },
                ],
                foreignKeys: this.ownerForeignKeys(),
            }),
            true,
        );
        await queryRunner.createIndices("card_policy_conditional_rules", [
            new TableIndex({
                name: "IDX_card_policy_rules_owner_order",
                columnNames: ["owner_key", "rule_order"],
                isUnique: true,
            }),
            new TableIndex({ name: "IDX_card_policy_rules_space", columnNames: ["data_space_id"] }),
        ]);
    }

    private async createExactCardTable(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: "card_policy_exact_cards",
                columns: [
                    { name: "id", type: "varchar", length: "36", isPrimary: true },
                    { name: "owner_key", type: "varchar", length: "80" },
                    { name: "data_space_id", type: "varchar", length: "36" },
                    { name: "group_id", type: "varchar", length: "36", isNullable: true },
                    { name: "card_id", type: "varchar", length: "36" },
                    { name: "directives_json", type: "text" },
                    { name: "revision", type: "int", default: 1 },
                    { name: "created_at", type: "datetime" },
                    { name: "updated_at", type: "datetime" },
                ],
                foreignKeys: [
                    ...this.ownerForeignKeys(),
                    new TableForeignKey({
                        columnNames: ["card_id"],
                        referencedTableName: "cards",
                        referencedColumnNames: ["id"],
                        onDelete: "RESTRICT",
                        onUpdate: "CASCADE",
                    }),
                ],
            }),
            true,
        );
        await queryRunner.createIndices("card_policy_exact_cards", [
            new TableIndex({
                name: "UQ_card_policy_exact_owner_card",
                columnNames: ["owner_key", "card_id"],
                isUnique: true,
            }),
            new TableIndex({ name: "IDX_card_policy_exact_space", columnNames: ["data_space_id"] }),
        ]);
    }

    private ownerForeignKeys(): TableForeignKey[] {
        return [
            new TableForeignKey({
                columnNames: ["data_space_id"],
                referencedTableName: "data_spaces",
                referencedColumnNames: ["id"],
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            }),
            new TableForeignKey({
                columnNames: ["group_id"],
                referencedTableName: "game_groups",
                referencedColumnNames: ["id"],
                onDelete: "CASCADE",
                onUpdate: "CASCADE",
            }),
        ];
    }

    private async migrateSessionRuntime(
        queryRunner: QueryRunner,
        fromVersion: number,
        toVersion: number,
    ): Promise<void> {
        for (const table of ["game_sessions", "couch_game_sessions"]) {
            const rows = (await queryRunner.query(
                `SELECT id, runtime_state_json FROM ${table} WHERE runtime_state_version = ?`,
                [fromVersion],
            )) as { id: string; runtime_state_json: string }[];
            for (const row of rows) {
                const runtime = JSON.parse(row.runtime_state_json) as Record<string, unknown> & {
                    profile?: Record<string, unknown>;
                };
                runtime.version = toVersion;
                if (toVersion === 4) {
                    runtime.compiledCardPolicy = null;
                    runtime.sessionCardPolicy = {
                        scopeDefault: {},
                        conditionalRules: [],
                        exactCards: [],
                    };
                } else {
                    delete runtime.compiledCardPolicy;
                    delete runtime.sessionCardPolicy;
                }
                await queryRunner.query(
                    `UPDATE ${table} SET runtime_state_version = ?, runtime_state_json = ? WHERE id = ?`,
                    [toVersion, JSON.stringify(runtime), row.id],
                );
            }
        }
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await this.migrateSessionRuntime(queryRunner, 4, 3);
        for (const table of [
            "card_policy_exact_cards",
            "card_policy_conditional_rules",
            "card_policy_scope_defaults",
        ]) {
            await queryRunner.dropTable(table, true);
        }
        await queryRunner.dropColumn("card_catalog_versions", "contract");
        await queryRunner.dropIndex(
            "card_operational_flags",
            "IDX_card_operational_flags_flag_card",
        );
        for (const index of [
            "IDX_cards_management_players",
            "IDX_cards_management_dare",
            "IDX_cards_management_question",
            "IDX_cards_management_sensitivity",
        ]) {
            await queryRunner.dropIndex("cards", index);
        }
        await queryRunner.dropColumns("cards", [
            "maximum_player_count",
            "minimum_player_count",
            "social_sensitivity",
        ]);
        await queryRunner.dropColumns("dare_types", [
            "default_maximum_player_count",
            "default_minimum_player_count",
            "default_social_sensitivity",
        ]);
        await queryRunner.dropColumns("question_categories", [
            "default_maximum_player_count",
            "default_minimum_player_count",
            "default_social_sensitivity",
        ]);
    }
}
