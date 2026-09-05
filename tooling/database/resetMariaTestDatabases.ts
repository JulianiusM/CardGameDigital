import path from "node:path";
import {
    loadMariaTestProfile,
    resetMariaTestDatabase,
    type MariaTestProfile,
} from "../../tests/support/mariaDb";

async function reset(label: string, profile: MariaTestProfile | null): Promise<void> {
    if (!profile) {
        console.log(`${label}: no local credential profile; skipped`);
        return;
    }
    await resetMariaTestDatabase(profile);
    console.log(`${label}: reset ${profile.database} on ${profile.host}:${profile.port}`);
}

async function main(): Promise<void> {
    const integration = loadMariaTestProfile(
        process.env.TEST_DOTENV_FILE ?? path.resolve("tests/.env.test.local"),
        "TEST",
    );
    const e2e = loadMariaTestProfile(
        process.env.E2E_DOTENV_FILE ?? path.resolve(".env.e2e"),
        "E2E",
    );
    await reset("integration", integration);
    try {
        await reset("e2e", e2e);
    } catch (error) {
        if (
            !integration ||
            !e2e ||
            integration.host !== e2e.host ||
            integration.port !== e2e.port
        ) {
            throw error;
        }
        await reset("e2e (integration credential profile)", {
            ...integration,
            database: e2e.database,
        });
    }
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "MariaDB reset failed");
    process.exitCode = 1;
});
