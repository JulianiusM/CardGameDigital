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

import http from 'node:http';
import {initDataSource} from "./modules/database/dataSource";
import settings from './modules/settings';

async function bootstrap() {
    try {
        console.log('🔧 Initializing database connection...');
        await settings.read();
        await initDataSource();

        const {default: app} = await require('./app');
        const server = http.createServer(app);
        server.listen(settings.value.appPort, () => {
            console.log(`🚀 Server listening on ${settings.value.rootUrl}`);
        });
    } catch (err) {
        console.error('❌ Failed to initialize app:', err);
        process.exit(1);
    }
}

bootstrap();
