import { TypeOrmGameRetention } from "../../../../packages/persistence/TypeOrmGameRetention";
import { getAppDataSource } from "./database/dataSource";
import { getCouchService } from "./couchSessions";
import { getRoomService } from "./realtime";
import { logEvent } from "./structuredLogger";
import settings from "./settings";
import { gameResourceLimits } from "./operationalSettings";

/** Startup and periodic work use the same persisted cutoffs; ticks never overlap. */
export function startGameMaintenance() {
    const retention = new TypeOrmGameRetention(
        getAppDataSource(),
        gameResourceLimits(settings.value),
    );
    let running: Promise<void> | undefined;
    const sweep = () => {
        if (running) return running;
        running = (async () => {
            const at = Date.now();
            const evicted =
                getCouchService().pruneSessions(at) + getRoomService().pruneSessions(at);
            const result = await retention.sweep(at);
            logEvent(
                "info",
                "games.retention",
                { ...result, evicted, durationMs: Date.now() - at },
                settings.value.logLevel,
            );
        })()
            .catch(() => {
                // Only aggregate operational data; never runtime, policy or private inputs.
                logEvent("error", "games.retention_failed", {}, settings.value.logLevel);
            })
            .finally(() => {
                running = undefined;
            });
        return running;
    };
    const ready = sweep();
    const timer = setInterval(() => {
        void sweep();
    }, settings.value.gameMaintenanceIntervalMs);
    timer.unref();
    return {
        ready,
        async stop() {
            clearInterval(timer);
            await running;
        },
    };
}
