/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {QueryRunner} from "typeorm";

export async function columnExists(
    queryRunner: QueryRunner,
    table: string,
    column: string
): Promise<boolean> {
    const result = await queryRunner.query(
        `
            SELECT COUNT(*) as count
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND COLUMN_NAME = ?
        `,
        [table, column]
    );

    return result[0].count > 0;
}

export async function constraintExists(
    queryRunner: QueryRunner,
    table: string,
    constraint: string
): Promise<boolean> {
    const result = await queryRunner.query(
        `
            SELECT COUNT(*) as count
            FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND CONSTRAINT_NAME = ?
        `,
        [table, constraint]
    );

    return result[0].count > 0;
}

export async function tableExists(
    queryRunner: QueryRunner,
    table: string
): Promise<boolean> {
    const result = await queryRunner.query(
        `
            SELECT COUNT(*) as count
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
        `,
        [table]
    );

    return result[0].count > 0;
}

export async function indexExists(
    queryRunner: QueryRunner,
    table: string,
    index: string
): Promise<boolean> {
    const result = await queryRunner.query(
        `
            SELECT COUNT(*) as count
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND INDEX_NAME = ?
        `,
        [table, index]
    );

    return result[0].count > 0;
}

export async function addColumn(queryRunner: QueryRunner, table: string, column: string, type: string, params: string = '') {
    return await queryRunner.query(`ALTER TABLE \`${table}\`
        ADD \`${column}\` ${type} ${params}`);
}

export async function addColumnIfNotExists(queryRunner: QueryRunner, table: string, column: string, type: string, params?: string) {
    if (!await columnExists(queryRunner, table, column)) {
        return await addColumn(queryRunner, table, column, type, params);
    }
}

export async function dropColumn(queryRunner: QueryRunner, table: string, column: string) {
    return await queryRunner.query(`ALTER TABLE \`${table}\`
        DROP COLUMN \`${column}\``);
}

export async function dropColumnIfExists(queryRunner: QueryRunner, table: string, column: string) {
    if (await columnExists(queryRunner, table, column)) {
        return await dropColumn(queryRunner, table, column);
    }
}

export async function createConstraint(queryRunner: QueryRunner, table: string, constraint: string, definition: string) {
    return await queryRunner.query(`ALTER TABLE \`${table}\`
        ADD CONSTRAINT \`${constraint}\` ${definition}`);
}

export async function createConstraintIfNotExists(queryRunner: QueryRunner, table: string, constraint: string, definition: string) {
    if (!await constraintExists(queryRunner, table, constraint)) {
        return await createConstraint(queryRunner, table, constraint, definition);
    }
}

export async function dropFkConstraint(queryRunner: QueryRunner, table: string, constraint: string) {
    return await queryRunner.query(`ALTER TABLE \`${table}\`
        DROP FOREIGN KEY \`${constraint}\``);
}

export async function dropFkConstraintIfExists(queryRunner: QueryRunner, table: string, constraint: string) {
    if (await constraintExists(queryRunner, table, constraint)) {
        return await dropFkConstraint(queryRunner, table, constraint);
    }
}

export async function createIndexIfNotExists(queryRunner: QueryRunner, table: string, index: string, columns: string) {
    if (!await indexExists(queryRunner, table, index)) {
        return await queryRunner.query(`CREATE INDEX \`${index}\` ON \`${table}\` (${columns})`);
    }
}

export async function createUniqueIndexIfNotExists(queryRunner: QueryRunner, table: string, index: string, columns: string) {
    if (!await indexExists(queryRunner, table, index)) {
        return await queryRunner.query(`CREATE UNIQUE INDEX \`${index}\` ON \`${table}\` (${columns})`);
    }
}

export async function dropIndexIfExists(queryRunner: QueryRunner, table: string, index: string) {
    if (await indexExists(queryRunner, table, index)) {
        return await queryRunner.query(`DROP INDEX \`${index}\` ON \`${table}\``);
    }
}