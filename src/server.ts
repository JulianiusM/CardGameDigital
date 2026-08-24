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

import http from "node:http";
import { AppDataSource, initDataSource } from "./modules/database/dataSource";
import settings from "./modules/settings";
import { logEvent, safeErrorName } from "./modules/structuredLogger";

function closeServer(server: http.Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

async function bootstrap() {
    try {
        logEvent("info", "server.database_initializing", {}, settings.value.logLevel);
        await settings.read();
        await initDataSource();

        const { default: app } = await require("./app");
        const server = http.createServer(app);
        const { attachWebSocketServer } = await require("./modules/websocket");
        const { getRoomService } = await require("./modules/realtime");
        const websocketServer = attachWebSocketServer(server, getRoomService());
        await new Promise<void>((resolve, reject) => {
            const onError = (error: Error) => reject(error);
            server.once("error", onError);
            server.listen(settings.value.httpPort, settings.value.httpBind, () => {
                server.off("error", onError);
                resolve();
            });
        });
        logEvent(
            "info",
            "server.listening",
            { publicOrigin: new URL(settings.value.publicUrl).origin },
            settings.value.logLevel,
        );

        let shuttingDown = false;
        const shutdown = async (signal: string) => {
            if (shuttingDown) return;
            shuttingDown = true;
            logEvent("info", "server.shutdown_started", { signal }, settings.value.logLevel);
            const deadline = setTimeout(() => {
                logEvent("fatal", "server.shutdown_timeout", {}, settings.value.logLevel);
                process.exit(1);
            }, 10_000);
            deadline.unref();
            for (const client of websocketServer.clients) client.close(1001, "server shutdown");
            const websocketClosed = new Promise<void>((resolve, reject) => {
                websocketServer.close((error?: Error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
            await Promise.all([closeServer(server), websocketClosed]);
            if (AppDataSource.isInitialized) await AppDataSource.destroy();
            clearTimeout(deadline);
        };
        const handleSignal = (signal: string) => {
            void shutdown(signal).catch((error) => {
                logEvent(
                    "error",
                    "server.shutdown_failed",
                    { errorName: safeErrorName(error) },
                    settings.value.logLevel,
                );
                process.exitCode = 1;
            });
        };
        process.once("SIGTERM", () => handleSignal("SIGTERM"));
        process.once("SIGINT", () => handleSignal("SIGINT"));
    } catch (err) {
        logEvent(
            "fatal",
            "server.startup_failed",
            { errorName: safeErrorName(err) },
            settings.value.logLevel,
        );
        process.exit(1);
    }
}

bootstrap();
