import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppDataSource, initDataSource } from "../../src/modules/database/dataSource";
import { DataSpace } from "../../src/modules/database/entities/user/DataSpace";
import settings from "../../src/modules/settings";

const environmentKeys = [
    "SETTINGS_FILE",
    "DEPLOYMENT_MODE",
    "PUBLIC_RUNTIME_SECURITY",
    "AUTH_MODE",
    "DB_TYPE",
    "DB_FILE",
    "PUBLIC_URL",
    "SESSION_SECRET",
] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]] as const));

let app: import("express").Express;
let directory: string;

beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "public-development-runtime-"));
    Object.assign(process.env, {
        SETTINGS_FILE: "/dev/null",
        DEPLOYMENT_MODE: "public",
        PUBLIC_RUNTIME_SECURITY: "development",
        AUTH_MODE: "none",
        DB_TYPE: "sqlite",
        DB_FILE: path.join(directory, "public-development.sqlite"),
        PUBLIC_URL: "http://192.0.2.10:3000",
        SESSION_SECRET: "public_development_test_secret",
    });
    await settings.read("/dev/null");
    await initDataSource();
    app = (await import("../../src/app")).default;
});

afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
    for (const [key, value] of originalEnvironment) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

describe("public development runtime", () => {
    it("starts with SQLite and the development catalog without creating a local DataSpace", async () => {
        expect(settings.value).toMatchObject({
            deploymentMode: "public",
            publicRuntimeSecurity: "development",
            dbType: "sqlite",
        });
        await expect(AppDataSource.getRepository(DataSpace).count()).resolves.toBe(0);
        const locales = await request(app).get("/api/v1/catalog/locales").expect(200);
        expect(locales.body.locales).toHaveLength(2);
    });

    it("creates an anonymous Quick Room without Origin, HSTS, or account infrastructure", async () => {
        const info = await request(app).get("/api/v1/server-info").expect(200);
        expect(info.body).toMatchObject({
            deploymentMode: "public",
            publicRuntimeSecurity: "development",
            authenticationAvailable: false,
        });
        expect(info.headers["strict-transport-security"]).toBeUndefined();

        const room = await request(app)
            .post("/api/v1/rooms")
            .send({ displayName: "Developer", persistence: "EPHEMERAL" })
            .expect(201);
        expect(room.body.roomCode).toMatch(/^[A-Z2-9]{6}$/);
        expect(room.body.participantCredential).toHaveLength(43);
    });
});
