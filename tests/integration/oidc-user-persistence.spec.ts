import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    getAppDataSource,
    initDataSource,
} from "../../apps/server/src/modules/database/dataSource";
import { DataSpace } from "../../packages/persistence/entities/user/DataSpace";
import { findOrCreateUserFromOidc } from "../../apps/server/src/modules/database/services/UserService";
import settings from "../../apps/server/src/modules/settings";

let directory: string;

beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "oidc-user-"));
    Object.assign(process.env, {
        SETTINGS_FILE: "/dev/null",
        DEPLOYMENT_MODE: "local",
        AUTH_MODE: "account",
        DB_TYPE: "sqlite",
        DB_FILE: path.join(directory, "oidc.sqlite"),
        SESSION_SECRET: "oidc_user_persistence_test_secret",
    });
    await settings.read("/dev/null");
    await initDataSource();
});

afterAll(async () => {
    if (getAppDataSource().isInitialized) await getAppDataSource().destroy();
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("OIDC user persistence", () => {
    it("creates one owned DataSpace and reuses the issuer/subject identity", async () => {
        const claims = {
            sub: "provider-subject/with:characters",
            preferred_username: "new-user",
            name: "New User",
            email: "unverified@example.test",
            email_verified: false,
        };
        const created = await findOrCreateUserFromOidc("https://identity.example", claims);
        const repeated = await findOrCreateUserFromOidc("https://identity.example", claims);

        expect(repeated.id).toBe(created.id);
        expect(created.email).toMatch(/^[a-f0-9]{64}@no-email\.invalid$/);
        const spaces = await getAppDataSource()
            .getRepository(DataSpace)
            .findBy({
                user: { id: created.id },
            });
        expect(spaces).toHaveLength(1);
        expect(spaces[0]).toMatchObject({ name: "New User", defaultForOwner: true });
    });
});
