import { type MigrationInterface, type QueryRunner, TableColumn } from "typeorm";

export class AddCardPolicyScopeRevisions1787360000000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasColumn("card_policy_scope_defaults", "scope_revision")))
            await queryRunner.addColumn(
                "card_policy_scope_defaults",
                new TableColumn({
                    name: "scope_revision",
                    type: "int",
                    default: 0,
                }),
            );
        const now = new Date().toISOString().slice(0, 23).replace("T", " ");
        // Backfill in SQL: migration memory does not grow with the number of policies.
        for (const table of ["card_policy_conditional_rules", "card_policy_exact_cards"]) {
            await queryRunner.query(
                `INSERT INTO card_policy_scope_defaults
                (owner_key, data_space_id, group_id, directives_json, revision, scope_revision, created_at, updated_at)
                SELECT DISTINCT entry.owner_key, entry.data_space_id, entry.group_id, '{}', 0, 0, ?, ?
                FROM ${table} entry LEFT JOIN card_policy_scope_defaults scope ON scope.owner_key = entry.owner_key
                WHERE scope.owner_key IS NULL`,
                [now, now],
            );
        }
        await queryRunner.query(
            "UPDATE card_policy_scope_defaults SET scope_revision = revision WHERE scope_revision < revision",
        );
        for (const table of ["card_policy_conditional_rules", "card_policy_exact_cards"]) {
            const maximum = `(SELECT MAX(entry.revision) FROM ${table} entry WHERE entry.owner_key = card_policy_scope_defaults.owner_key)`;
            await queryRunner.query(
                `UPDATE card_policy_scope_defaults SET scope_revision = ${maximum} WHERE ${maximum} > scope_revision`,
            );
        }
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("card_policy_scope_defaults", "scope_revision");
    }
}
