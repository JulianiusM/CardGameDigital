import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppDataSource, initDataSource } from "../../src/modules/database/dataSource";
import { AccountSession } from "../../src/modules/database/entities/session/AccountSession";
import { DataSpace } from "../../src/modules/database/entities/user/DataSpace";
import {
    consumeActivationToken,
    generateActivationToken,
    registerUser,
} from "../../src/modules/database/services/UserService";
import settings from "../../src/modules/settings";

let app: import("express").Express;
let directory: string;
let accountId: number;

beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "account-api-"));
    Object.assign(process.env, {
        SETTINGS_FILE: "/dev/null",
        DEPLOYMENT_MODE: "local",
        AUTH_MODE: "account",
        DB_TYPE: "sqlite",
        DB_FILE: path.join(directory, "account.sqlite"),
        SESSION_SECRET: "account_api_test_secret",
    });
    await settings.read("/dev/null");
    await initDataSource();
    accountId = await registerUser("anna", "Anna", "long-test-password", "anna@example.test");
    expect(await consumeActivationToken(await generateActivationToken(accountId))).toBe(true);
    app = (await import("../../src/app")).default;
});

afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("native account API", () => {
    it("exposes only configured public legal destinations", async () => {
        const originalImprint = settings.value.imprintUrl;
        const originalPrivacy = settings.value.privacyPolicyUrl;
        settings.value.imprintUrl = "https://legal.example.test/imprint";
        settings.value.privacyPolicyUrl = "https://legal.example.test/privacy";
        try {
            await expect(
                request(app).get("/api/v1/account/configuration").expect(200),
            ).resolves.toMatchObject({
                body: {
                    imprintUrl: "https://legal.example.test/imprint",
                    privacyPolicyUrl: "https://legal.example.test/privacy",
                },
            });
            await expect(
                request(app).get("/api/v1/account/status").expect(200),
            ).resolves.toMatchObject({
                body: {
                    imprintUrl: "https://legal.example.test/imprint",
                    privacyPolicyUrl: "https://legal.example.test/privacy",
                },
            });
        } finally {
            settings.value.imprintUrl = originalImprint;
            settings.value.privacyPolicyUrl = originalPrivacy;
        }
    });

    it("authenticates, exposes account state, manages DataSpaces and logs out", async () => {
        const agent = request.agent(app);
        const login = await agent
            .post("/api/v1/account/login")
            .send({ username: "anna", password: "long-test-password" })
            .expect(200);
        expect(login.body.user).toMatchObject({ username: "anna", name: "Anna" });
        expect(login.body.languagePreferences).toBeNull();
        const initialDataSpaceId = login.body.activeDataSpaceId;

        const languagePreferences = await agent
            .put("/api/v1/account/language-preferences")
            .send({
                useSystemLanguage: false,
                interfaceLocale: "en",
                cardLocale: "en-GB",
                fallbackLocales: ["de-DE", "fr-FR"],
            })
            .expect(200);
        expect(languagePreferences.body.languagePreferences).toEqual({
            useSystemLanguage: false,
            interfaceLocale: "en",
            cardLocale: "en-GB",
            fallbackLocales: ["de-DE", "fr-FR"],
        });

        const created = await agent
            .post("/api/v1/account/data-spaces")
            .send({ name: "Friends" })
            .expect(201);
        expect((await agent.get("/api/v1/account/me").expect(200)).body.activeDataSpaceId).toBe(
            created.body.id,
        );
        const account = await agent.get("/api/v1/account/me").expect(200);
        expect(account.body.dataSpaces.map(({ name }: { name: string }) => name)).toContain(
            "Friends",
        );
        const deleted = await agent
            .delete(`/api/v1/account/data-spaces/${created.body.id}`)
            .expect(200);
        expect(deleted.body.activeDataSpaceId).toBe(initialDataSpaceId);
        expect(deleted.body.dataSpaces).toHaveLength(1);
        await agent.delete(`/api/v1/account/data-spaces/${initialDataSpaceId}`).expect(409);
        const sessions = await agent.get("/api/v1/account/sessions").expect(200);
        expect(sessions.body.sessions).toEqual([expect.objectContaining({ current: true })]);
        const exported = await agent.get("/api/v1/account/export").expect(200);
        expect(exported.body.exportVersion).toBe(3);
        expect(exported.body.account.username).toBe("anna");
        expect(exported.body.languagePreferences.fallbackLocales).toEqual(["de-DE", "fr-FR"]);
        expect(exported.body.cardPolicies).toEqual({
            scopeDefaults: [],
            conditionalRules: [],
            exactCards: [],
        });
        expect(exported.headers["content-disposition"]).toContain("attachment");

        await agent.post("/api/v1/account/logout").expect(204);
        expect(await AppDataSource.getRepository(AccountSession).count()).toBe(0);
        await agent.get("/api/v1/account/me").expect(401);
    });

    it("returns stable JSON validation errors", async () => {
        const response = await request(app)
            .post("/api/v1/account/login")
            .set("accept-language", "en-US,en;q=0.9")
            .send({ username: "x", password: "short" })
            .expect(400);
        expect(response.body.error.code).toBe("VALIDATION_ERROR");
        expect(response.body.error.message).toBe("Invalid input.");

        const credentials = await request(app)
            .post("/api/v1/account/login")
            .send({ username: "anna", password: "wrong-password" })
            .expect(401);
        expect(credentials.body.error.code).toBe("ACCOUNT_INVALID_CREDENTIALS");

        const missing = await request(app).get("/api/v1/does-not-exist").expect(404);
        expect(missing.body.error).toMatchObject({
            code: "REQUEST_NOT_FOUND",
            message: "Not found.",
        });

        const agent = request.agent(app);
        await agent
            .post("/api/v1/account/login")
            .send({ username: "anna", password: "long-test-password" })
            .expect(200);
        await agent
            .put("/api/v1/account/language-preferences")
            .send({ fallbackLocales: ["en-GB", "en-gb"] })
            .expect(400);
    });

    it("repairs a stale account with no DataSpace before persistence APIs run", async () => {
        await AppDataSource.getRepository(DataSpace).delete({ user: { id: accountId } });
        const agent = request.agent(app);
        const login = await agent
            .post("/api/v1/account/login")
            .send({ username: "anna", password: "long-test-password" })
            .expect(200);
        expect(login.body.activeDataSpaceId).toMatch(/^[0-9a-f-]{36}$/);

        const originalMode = settings.value.deploymentMode;
        settings.value.deploymentMode = "public";
        try {
            await agent.get("/api/v1/groups").expect(200);
            await agent.get("/api/v1/game-settings").expect(200);
        } finally {
            settings.value.deploymentMode = originalMode;
        }
    });
});
