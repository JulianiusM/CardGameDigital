import { AppDataSource, initDataSource } from "../../apps/server/src/modules/database/dataSource";
import { resetInstallationIdentity } from "../../apps/server/src/modules/installationIdentityReset";
import settings from "../../apps/server/src/modules/settings";

async function main(): Promise<void> {
    const arguments_ = process.argv.slice(2);
    const unknown = arguments_.filter((argument) => argument !== "--invalidate-runtime");
    if (unknown.length) throw new Error(`Unknown argument: ${unknown.join(", ")}`);
    const invalidateRuntime = arguments_.includes("--invalidate-runtime");
    await settings.read();
    await initDataSource();
    const result = await resetInstallationIdentity(AppDataSource, {
        invalidateRuntime,
        tombstoneRetentionSeconds: settings.value.roomCreateIdempotencyTombstoneSeconds,
    });
    console.log(
        `Installation identity reset. Closed Rooms: ${result.invalidatedRoomCount}; invalidated participants: ${result.invalidatedParticipantCount}; erased replay payloads: ${result.erasedReplayCount}.`,
    );
}

void main()
    .catch((error) => {
        console.error(
            error instanceof Error ? error.message : "Installation identity reset failed",
        );
        process.exitCode = 1;
    })
    .finally(async () => {
        if (AppDataSource?.isInitialized) await AppDataSource.destroy();
    });
