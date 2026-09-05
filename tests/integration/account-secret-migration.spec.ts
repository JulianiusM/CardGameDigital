import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppDataSource, initDataSource } from "../../apps/server/src/modules/database/dataSource";
import { User } from "../../packages/persistence/entities/user/User";
import {
    consumeActivationToken,
    consumePasswordResetToken,
    generateActivationToken,
    generatePasswordResetToken,
    registerUser,
    verifyActivationToken,
    verifyPassword,
    verifyPasswordResetToken,
} from "../../apps/server/src/modules/database/services/UserService";
import settings from "../../apps/server/src/modules/settings";

let directory: string;
let userId: number;

beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "account-secrets-"));
    Object.assign(process.env, {
        SETTINGS_FILE: "/dev/null",
        DEPLOYMENT_MODE: "local",
        AUTH_MODE: "none",
        DB_TYPE: "sqlite",
        DB_FILE: path.join(directory, "accounts.sqlite"),
        SESSION_SECRET: "account_secret_migration_test",
    });
    await settings.read("/dev/null");
    await initDataSource();
    userId = await registerUser("alice", "Alice", "initial-password", "alice@example.test");
});

afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("account secret migration", () => {
    it("stores only hashes for activation and reset tokens and consumes them once", async () => {
        const users = AppDataSource.getRepository(User);
        const activation = await generateActivationToken(userId);
        let stored = await users.findOne({
            where: { id: userId },
            select: { activationTokenHash: true },
        });
        expect(stored?.activationTokenHash).toHaveLength(64);
        expect(stored?.activationTokenHash).not.toBe(activation);
        expect(await verifyActivationToken(activation)).toMatchObject({ id: userId });
        expect(await consumeActivationToken(activation)).toBe(true);
        expect(await consumeActivationToken(activation)).toBe(false);
        expect(await verifyActivationToken(activation)).toBeNull();

        const reset = await generatePasswordResetToken("alice");
        stored = await users.findOne({
            where: { id: userId },
            select: { resetTokenHash: true },
        });
        expect(stored?.resetTokenHash).toHaveLength(64);
        expect(await verifyPasswordResetToken(reset)).toMatchObject({ id: userId });
        expect(await consumePasswordResetToken(reset, "new-password")).toBe(userId);
        expect(await consumePasswordResetToken(reset, "another-password")).toBeNull();
        expect(await verifyPasswordResetToken(reset)).toBeNull();
    });

    it("registers an account with an Argon2id password", async () => {
        const users = AppDataSource.getRepository(User);
        await expect(verifyPassword(userId, "new-password")).resolves.toBe(true);
        await expect(verifyPassword(userId, "wrong-password")).resolves.toBe(false);
        const stored = await users.findOne({
            where: { id: userId },
            select: { password: true },
        });
        expect(stored?.password).toMatch(/^\$argon2id\$/);
    });
});
