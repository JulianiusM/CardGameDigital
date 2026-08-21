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

import {DataSource} from 'typeorm';
import settings from '../settings';
import {entities, migrations, subscribers} from "./__index__";

export let AppDataSource: DataSource;
let initialized: boolean = false;

export async function initDataSource() {
    if (initialized) {
        return;
    }

    if (!settings.value.initialized) {
        await settings.read();
    }

    AppDataSource = new DataSource({
        type: settings.value.dbType,
        host: settings.value.dbHost,
        port: settings.value.dbPort,
        username: settings.value.dbUser,
        password: settings.value.dbPassword,
        database: settings.value.dbName,
        timezone: 'Z',              // treat TIMESTAMP / DATETIME as UTC
        dateStrings: ['DATE'],       // A & B: return DATE as **string**
        entities: entities,
        migrations: migrations,
        subscribers: subscribers,
        synchronize: false,
        invalidWhereValuesBehavior: {
            null: "sql-null",
            undefined: "ignore",
        },
    });

    await AppDataSource.initialize();
    initialized = true;
}