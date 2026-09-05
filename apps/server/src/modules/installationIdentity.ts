import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { InstallationMetadataEntity } from "../../../../packages/persistence/entities/server/InstallationMetadataEntity";
import { logEvent } from "./structuredLogger";
import settings from "./settings";

const SINGLETON_ID = 1;
let currentServerId: string | undefined;

export async function ensureInstallationIdentity(source: DataSource): Promise<string> {
    const repository = source.getRepository(InstallationMetadataEntity);
    const proposedServerId = randomUUID();
    await repository
        .createQueryBuilder()
        .insert()
        .values({
            id: SINGLETON_ID,
            serverId: proposedServerId,
            createdAt: new Date(),
            identitySchemaVersion: 1,
        })
        .orIgnore()
        .execute();
    const rows = await repository.find({ take: 2 });
    if (rows.length !== 1 || rows[0].id !== SINGLETON_ID) {
        throw new Error(
            `Installation metadata must contain exactly one singleton row; found ${rows.length}`,
        );
    }
    currentServerId = rows[0].serverId;
    if (currentServerId === proposedServerId) {
        logEvent(
            "info",
            "installation.identity_created",
            { identitySchemaVersion: rows[0].identitySchemaVersion },
            settings.value.logLevel,
        );
    }
    return currentServerId;
}

export function installationServerId(): string {
    if (!currentServerId) throw new Error("Installation identity has not been initialized");
    return currentServerId;
}

export function replaceLoadedInstallationIdentity(serverId: string): void {
    currentServerId = serverId;
}
