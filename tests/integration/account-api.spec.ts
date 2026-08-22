import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppDataSource, initDataSource } from "../../src/modules/database/dataSource";
import {
    consumeActivationToken,
    generateActivationToken,
    registerUser,
} from "../../src/modules/database/services/UserService";
import settings from "../../src/modules/settings";

let app: import("express").Express;
let directory: string;

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
    const id = await registerUser("anna", "Anna", "long-test-password", "anna@example.test");
    expect(await consumeActivationToken(await generateActivationToken(id))).toBe(true);
    app = (await import("../../src/app")).default;
});

afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("native account API", () => {
    it("authenticates, exposes account state, manages DataSpaces and logs out", async () => {
        const agent = request.agent(app);
        const login = await agent
            .post("/api/v1/account/login")
            .send({ username: "anna", password: "long-test-password" })
            .expect(200);
        expect(login.body.user).toMatchObject({ username: "anna", name: "Anna" });

        await agent.post("/api/v1/account/data-spaces").send({ name: "Friends" }).expect(201);
        const account = await agent.get("/api/v1/account/me").expect(200);
        expect(account.body.dataSpaces.map(({ name }: { name: string }) => name)).toContain(
            "Friends",
        );
        const sessions = await agent.get("/api/v1/account/sessions").expect(200);
        expect(sessions.body.sessions).toEqual([expect.objectContaining({ current: true })]);
        const exported = await agent.get("/api/v1/account/export").expect(200);
        expect(exported.body.account.username).toBe("anna");
        expect(exported.headers["content-disposition"]).toContain("attachment");

        await agent.post("/api/v1/account/logout").expect(204);
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
    });
});
