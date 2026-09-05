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

import "reflect-metadata";
import * as dotenv from "dotenv";
import { DataSource } from "typeorm";
import { dataSourceOptions } from "../../apps/server/src/modules/database/dataSource";
import { DataSpace } from "../../packages/persistence/entities/user/DataSpace";
import { User } from "../../packages/persistence/entities/user/User";
import { hashPassword } from "../../apps/server/src/modules/passwordHash";
import { resolveSettings } from "../../apps/server/src/modules/settings";

dotenv.config({ path: process.env.E2E_DOTENV_FILE ?? ".env.e2e" });

// ---- Guardrails: refuse to run on non-E2E DBs ----
const runtimeSettings = resolveSettings(process.env, "/dev/null");
const DB_NAME = runtimeSettings.dbName;
if (!/(?:e2e|test)/i.test(DB_NAME)) {
    console.error(
        `Refusing to run DB init because E2E_DB_NAME "${DB_NAME}" is not a test/e2e database.`,
    );
    process.exit(1);
}

if (runtimeSettings.dbType !== "mariadb" && runtimeSettings.dbType !== "mysql") {
    throw new Error("E2E initialization requires E2E_DB_TYPE=mariadb or mysql");
}

export const E2EDataSource = new DataSource(dataSourceOptions(runtimeSettings));

async function main() {
    await E2EDataSource.initialize();

    console.log("Resetting E2E database...");

    await E2EDataSource.dropDatabase();
    console.log("Purged...");
    await E2EDataSource.runMigrations({ transaction: "all" });
    console.log("Migrated...");

    // ---- Seed minimal fixture data ----
    // Example: create a test admin user. Replace with your own seeder logic.
    const userRepo = E2EDataSource.getRepository(User);
    const passwordHash = await hashPassword(process.env.E2E_ADMIN_PASSWORD!);
    const adminUser = await userRepo.save(
        userRepo.create({
            username: process.env.E2E_ADMIN_USERNAME!,
            name: process.env.E2E_ADMIN_USERNAME!,
            email: process.env.E2E_ADMIN_EMAIL!,
            password: passwordHash,
            isActive: true,
        }),
    );

    // Login stores the account's default DataSpace on the HTTP session.
    const dataSpaceRepo = E2EDataSource.getRepository(DataSpace);
    await dataSpaceRepo.save(
        dataSpaceRepo.create({
            name: process.env.E2E_ADMIN_USERNAME!,
            user: adminUser,
            defaultForOwner: true,
        }),
    );
    console.log("Users created...");

    await E2EDataSource.destroy();
    // eslint-disable-next-line no-console
    console.log("E2E database re-initialized.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
