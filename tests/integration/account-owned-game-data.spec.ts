import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppDataSource, initDataSource } from "../../src/modules/database/dataSource";
import { RoomEntity } from "../../src/modules/database/entities/game/RoomEntity";
import settings from "../../src/modules/settings";
import {
    registerUser,
    getDataSpacesForUser,
} from "../../src/modules/database/services/UserService";
import { requireCurrentDataSpace } from "../../src/routes/api/dataSpaceAccess";
import type { Request } from "express";

let app: import("express").Express;
let directory: string;

beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "account-game-data-"));
    Object.assign(process.env, {
        SETTINGS_FILE: "/dev/null",
        DEPLOYMENT_MODE: "local",
        AUTH_MODE: "none",
        DB_TYPE: "sqlite",
        DB_FILE: path.join(directory, "game-data.sqlite"),
        SESSION_SECRET: "account_game_data_test",
    });
    await settings.read("/dev/null");
    await initDataSource();
    app = (await import("../../src/app")).default;
});

afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("DataSpace-owned game data", () => {
    it("persists Groups and gameplay settings in the active DataSpace", async () => {
        const created = await request(app)
            .post("/api/v1/groups")
            .send({ name: "Friday friends", members: ["Ada", "Lin"] })
            .expect(201);
        await request(app)
            .put("/api/v1/game-settings")
            .send({
                preferredProfileId: "PROFILE_BEST_FRIENDS",
                maximumIntensity: 4,
                randomQuestionRatio: 0.55,
                letsTalkMetaInterval: 6,
                defaultGroupId: created.body.id,
            })
            .expect(200);
        const groups = await request(app).get("/api/v1/groups").expect(200);
        const settingsResponse = await request(app).get("/api/v1/game-settings").expect(200);
        expect(groups.body.groups).toEqual([
            expect.objectContaining({ name: "Friday friends", members: ["Ada", "Lin"] }),
        ]);
        expect(settingsResponse.body.settings).toMatchObject({
            preferredProfileId: "PROFILE_BEST_FRIENDS",
            defaultGroupId: created.body.id,
        });
    });

    it("binds newly hosted Rooms to the server-resolved DataSpace", async () => {
        const response = await request(app)
            .post("/api/v1/rooms")
            .send({ displayName: "Host", persistence: "DATASPACE" })
            .expect(201);
        const room = await AppDataSource.getRepository(RoomEntity).findOneByOrFail({
            id: response.body.roomId,
        });
        expect(room.dataSpaceId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("rejects a public account attempting to use another account's DataSpace", async () => {
        const aliceId = await registerUser("alice", "Alice", "password-one", "alice@example.test");
        const bobId = await registerUser("bob", "Bob", "password-two", "bob@example.test");
        const [aliceSpace] = await getDataSpacesForUser(aliceId);
        const [bobSpace] = await getDataSpacesForUser(bobId);
        const originalMode = settings.value.deploymentMode;
        settings.value.deploymentMode = "public";
        try {
            const request = {
                session: { auth: { user: { id: aliceId } }, dataSpace: bobSpace },
            } as unknown as Request;
            await expect(requireCurrentDataSpace(request)).rejects.toMatchObject({ status: 403 });
            request.session.dataSpace = aliceSpace;
            await expect(requireCurrentDataSpace(request)).resolves.toMatchObject({
                id: aliceSpace.id,
            });
        } finally {
            settings.value.deploymentMode = originalMode;
        }
    });

    it("allows anonymous public quick Rooms but gates persistence on authentication", async () => {
        const originalMode = settings.value.deploymentMode;
        settings.value.deploymentMode = "public";
        try {
            await request(app)
                .post("/api/v1/rooms")
                .set("origin", settings.value.publicUrl)
                .send({ displayName: "Anonymous", persistence: "EPHEMERAL" })
                .expect(201);
            await request(app)
                .post("/api/v1/rooms")
                .set("origin", settings.value.publicUrl)
                .send({ displayName: "Anonymous", persistence: "DATASPACE" })
                .expect(401);
        } finally {
            settings.value.deploymentMode = originalMode;
        }
    });
});
