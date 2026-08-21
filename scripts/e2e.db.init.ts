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

import 'reflect-metadata';
import bcrypt from "bcryptjs";
import * as dotenv from 'dotenv';
import {DataSource} from 'typeorm';
import {Profile} from "../src/modules/database/entities/user/Profile";
import {User} from "../src/modules/database/entities/user/User";

dotenv.config({path: process.env.E2E_DOTENV_FILE ?? '.env.e2e'});

// ---- Guardrails: refuse to run on non-E2E DBs ----
const DB_NAME = process.env.E2E_DB_NAME ?? '';
if (!/e2e/i.test(DB_NAME)) {
    console.error(
        `Refusing to run DB init because E2E_DB_NAME "${DB_NAME}" does not contain 'e2e'.`
    );
    process.exit(1);
}

// ---- Build a TypeORM DataSource for MariaDB ----
export const E2EDataSource = new DataSource({
    type: 'mariadb',
    host: process.env.E2E_DB_HOST,
    port: parseInt(process.env.E2E_DB_PORT ?? '3306', 10),
    username: process.env.E2E_DB_USER,
    password: process.env.E2E_DB_PASSWORD,
    database: DB_NAME,
    timezone: 'Z' as any,
    // @ts-ignore common driver option
    dateStrings: ['DATE'],
    entities: ['src/modules/database/entities/**/*.ts'],
    migrations: ['src/migrations/*.ts'],
    subscribers: ['src/modules/database/subscribers/**/*.ts'],
    // Never use synchronize in CI; rely on migrations.
    synchronize: false,
    logging: false,
});

async function main() {
    await E2EDataSource.initialize();

    console.log("Resetting E2E database...")

    // Clear all tables (TypeORM v0.3+)
    const qr = E2EDataSource.createQueryRunner();
    await qr.connect();
    // MariaDB: speed up truncation
    await qr.query('SET FOREIGN_KEY_CHECKS = 0');
    await qr.clearDatabase(); // drops all tables
    await qr.query('SET FOREIGN_KEY_CHECKS = 1');
    await qr.release();

    console.log("Purged...")

    // Recreate the disposable E2E schema from entities.
    // Run migrations only when explicitly requested; the smoke E2E suite needs a stable
    // production-shaped schema but should not fail on non-idempotent historical migrations.
    await E2EDataSource.synchronize(true)
    console.log("Synced...")
    if (process.env.E2E_RUN_MIGRATIONS === 'true') {
        await E2EDataSource.runMigrations();
        console.log("Migrated...")
    } else {
        console.log("Skipped migrations for synchronized E2E schema...")
    }

    // ---- Seed minimal fixture data ----
    // Example: create a test admin user. Replace with your own seeder logic.
    const userRepo = E2EDataSource.getRepository(User);
    const passwordHash = await bcrypt.hash(process.env.E2E_ADMIN_PASSWORD!, 10);
    const adminUser = await userRepo.save(userRepo.create({
        username: process.env.E2E_ADMIN_USERNAME!,
        name: process.env.E2E_ADMIN_USERNAME!,
        email: process.env.E2E_ADMIN_EMAIL!,
        password: passwordHash,
        isActive: true,
    }));

    // The local login controller stores the first profile on the session.
    // Keep the seed realistic by creating the same user profile that normal registration creates.
    const profileRepo = E2EDataSource.getRepository(Profile);
    await profileRepo.save(profileRepo.create({
        name: process.env.E2E_ADMIN_USERNAME!,
        user: adminUser,
    }));
    console.log("Users created...")

    await E2EDataSource.destroy();
    // eslint-disable-next-line no-console
    console.log('E2E database re-initialized.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
