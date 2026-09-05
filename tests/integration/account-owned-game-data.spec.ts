import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    getAppDataSource,
    initDataSource,
} from "../../apps/server/src/modules/database/dataSource";
import { RoomEntity } from "../../packages/persistence/entities/game/RoomEntity";
import { GroupEntity } from "../../packages/persistence/entities/game/GroupEntity";
import { DataSpaceGameSettingsEntity } from "../../packages/persistence/entities/game/DataSpaceGameSettingsEntity";
import settings from "../../apps/server/src/modules/settings";
import {
    registerUser,
    getDataSpacesForUser,
} from "../../apps/server/src/modules/database/services/UserService";
import { requireCurrentDataSpace } from "../../apps/server/src/routes/api/dataSpaceAccess";
import type { Request } from "express";
import {
    defaultRoomGameSettings,
    effectiveSettingsFromProfile,
} from "../../packages/application/roomGameSettings";

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
    app = (await import("../../apps/server/src/app")).default;
});

afterAll(async () => {
    if (getAppDataSource().isInitialized) await getAppDataSource().destroy();
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
                preferredProfileId: "PROFILE_CLOSE_FRIENDS",
                startingIntensity: 2,
                maximumIntensity: 4,
                intensityProgressionUnit: "CARDS",
                intensityProgressionInterval: 6,
                intensityProgressionIncrement: 0.5,
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
            preferredProfileId: "PROFILE_CLOSE_FRIENDS",
            startingIntensity: 2,
            maximumIntensity: 4,
            intensityProgressionUnit: "CARDS",
            intensityProgressionInterval: 6,
            intensityProgressionIncrement: 0.5,
            defaultGroupId: created.body.id,
        });
    });

    it("resets only Group card history after explicit confirmation", async () => {
        const created = await request(app)
            .post("/api/v1/groups")
            .send({ name: "Resettable group", members: ["A", "B"] })
            .expect(201);
        await request(app)
            .post(`/api/v1/groups/${created.body.id}/history-reset`)
            .send({ confirmed: false })
            .expect(400);
        const reset = await request(app)
            .post(`/api/v1/groups/${created.body.id}/history-reset`)
            .send({ confirmed: true })
            .expect(200);
        expect(reset.body).toMatchObject({
            id: created.body.id,
            name: "Resettable group",
            members: ["A", "B"],
        });
        expect(reset.body.historyResetAt).toBeTruthy();
    });

    it("keeps the saved Custom snapshot isolated from other profile customizations", async () => {
        const customConfiguration = {
            ...effectiveSettingsFromProfile("PROFILE_CUSTOM"),
            enabledQuestionCategoryIds: ["CAT_FRIENDSHIP"],
            enabledDareTypeIds: ["DARE_SILLY"],
            startingIntensity: 2,
            maximumIntensity: 4,
        };
        await request(app)
            .put("/api/v1/game-settings")
            .send({
                preferredProfileId: "PROFILE_CUSTOM",
                startingIntensity: 2,
                maximumIntensity: 4,
                intensityProgressionUnit: "CARDS",
                intensityProgressionInterval: 2,
                intensityProgressionIncrement: 1,
                randomQuestionRatio: 0.5,
                letsTalkMetaInterval: 5,
                defaultGroupId: null,
                customConfiguration,
                cardLanguageSettings: {
                    cardLocale: "de-DE",
                    cardFallbackEnabled: true,
                    cardFallbackLocales: ["en-GB"],
                },
            })
            .expect(200);
        await request(app)
            .put("/api/v1/game-settings")
            .send({
                preferredProfileId: "PROFILE_FRIENDS",
                startingIntensity: 4,
                maximumIntensity: 5,
                intensityProgressionUnit: "ROUNDS",
                intensityProgressionInterval: 7,
                intensityProgressionIncrement: 2,
                randomQuestionRatio: 0.2,
                letsTalkMetaInterval: 9,
                defaultGroupId: null,
            })
            .expect(200);

        const response = await request(app).get("/api/v1/game-settings").expect(200);
        expect(response.body.settings.customConfiguration).toEqual(customConfiguration);
        expect(response.body.settings.cardLanguageSettings).toEqual({
            cardLocale: "de-DE",
            cardFallbackEnabled: true,
            cardFallbackLocales: ["en-GB"],
        });
        expect(response.body.settings).toMatchObject({
            preferredProfileId: "PROFILE_FRIENDS",
            startingIntensity: 4,
            maximumIntensity: 5,
        });
    });

    it("keeps Custom and Card-language defaults isolated per Group", async () => {
        const first = await request(app)
            .post("/api/v1/groups")
            .send({ name: "German custom group", members: ["Ada", "Lin"] })
            .expect(201);
        const second = await request(app)
            .post("/api/v1/groups")
            .send({ name: "English custom group", members: ["Sam", "Jo"] })
            .expect(201);
        const quickRoundSettings = (await request(app).get("/api/v1/game-settings").expect(200))
            .body.settings;
        const firstCustom = {
            ...effectiveSettingsFromProfile("PROFILE_CUSTOM"),
            enabledQuestionCategoryIds: ["CAT_FRIENDSHIP"],
            startingIntensity: 1,
            maximumIntensity: 2,
        };
        const secondCustom = {
            ...effectiveSettingsFromProfile("PROFILE_CUSTOM"),
            enabledQuestionCategoryIds: ["CAT_RELATIONSHIP"],
            startingIntensity: 3,
            maximumIntensity: 5,
        };

        await request(app)
            .put(`/api/v1/groups/${first.body.id}`)
            .send({
                name: first.body.name,
                members: first.body.members,
                preferredProfileId: "PROFILE_CUSTOM",
                customConfiguration: firstCustom,
                cardLanguageSettings: {
                    cardLocale: "de-DE",
                    cardFallbackEnabled: true,
                    cardFallbackLocales: ["en-GB"],
                },
            })
            .expect(200);
        await request(app)
            .put(`/api/v1/groups/${second.body.id}`)
            .send({
                name: second.body.name,
                members: second.body.members,
                preferredProfileId: "PROFILE_CUSTOM",
                customConfiguration: secondCustom,
                cardLanguageSettings: {
                    cardLocale: "en-GB",
                    cardFallbackEnabled: false,
                    cardFallbackLocales: ["de-DE"],
                },
            })
            .expect(200);

        const stored = (await request(app).get("/api/v1/groups").expect(200)).body.groups;
        expect(stored.find(({ id }: { id: string }) => id === first.body.id)).toMatchObject({
            customConfiguration: firstCustom,
            cardLanguageSettings: {
                cardLocale: "de-DE",
                cardFallbackEnabled: true,
                cardFallbackLocales: ["en-GB"],
            },
        });
        expect(stored.find(({ id }: { id: string }) => id === second.body.id)).toMatchObject({
            customConfiguration: secondCustom,
            cardLanguageSettings: {
                cardLocale: "en-GB",
                cardFallbackEnabled: false,
                cardFallbackLocales: ["de-DE"],
            },
        });
        expect((await request(app).get("/api/v1/game-settings").expect(200)).body.settings).toEqual(
            quickRoundSettings,
        );

        await request(app)
            .put(`/api/v1/groups/${first.body.id}`)
            .send({
                name: first.body.name,
                members: first.body.members,
                cardLanguageSettings: {
                    cardLocale: "es-ES",
                    cardFallbackEnabled: false,
                    cardFallbackLocales: [],
                },
            })
            .expect(400);
    });

    it("fully deletes an owned Group and detaches authoritative defaults and Rooms", async () => {
        const created = await request(app)
            .post("/api/v1/groups")
            .send({ name: "Delete all traces", members: ["A", "B"] })
            .expect(201);
        await request(app)
            .put("/api/v1/game-settings")
            .send({
                preferredProfileId: "PROFILE_FRIENDS",
                startingIntensity: 1,
                maximumIntensity: 3,
                intensityProgressionUnit: "CARDS",
                intensityProgressionInterval: 2,
                intensityProgressionIncrement: 1,
                randomQuestionRatio: 0.6,
                letsTalkMetaInterval: 5,
                defaultGroupId: created.body.id,
            })
            .expect(200);
        const roomSettings = { ...defaultRoomGameSettings(), groupId: created.body.id };
        const ownedGroup = await getAppDataSource().getRepository(GroupEntity).findOneByOrFail({
            id: created.body.id,
        });
        const roomId = "4fdca0db-3322-4a16-b839-a9d7af0c07cb";
        await getAppDataSource()
            .getRepository(RoomEntity)
            .insert({
                id: roomId,
                code: "DEL234",
                dataSpaceId: ownedGroup.dataSpaceId,
                groupId: created.body.id,
                settingsRevision: 0,
                gameSettingsJson: JSON.stringify(roomSettings),
                settingsUpdatedByParticipantId: null,
                currentSessionId: null,
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 60_000),
                closedAt: null,
            });

        await request(app).delete(`/api/v1/groups/${created.body.id}`).expect(204);

        await expect(
            getAppDataSource().getRepository(GroupEntity).findOneBy({ id: created.body.id }),
        ).resolves.toBeNull();
        await expect(
            getAppDataSource().getRepository(DataSpaceGameSettingsEntity).findOneByOrFail({}),
        ).resolves.toMatchObject({ defaultGroupId: null });
        const room = await getAppDataSource().getRepository(RoomEntity).findOneByOrFail({
            id: roomId,
        });
        expect(room.groupId).toBeNull();
        expect(JSON.parse(room.gameSettingsJson).groupId).toBeNull();
        await request(app).delete(`/api/v1/groups/${created.body.id}`).expect(404);
    });

    it("keeps a saved Group after closing and reopening the database", async () => {
        const created = await request(app)
            .post("/api/v1/groups")
            .send({ name: "Reload survivors", members: ["Ada", "Lin"] })
            .expect(201);
        await getAppDataSource().destroy();
        await initDataSource();
        await expect(
            getAppDataSource().getRepository(GroupEntity).findOneByOrFail({ id: created.body.id }),
        ).resolves.toMatchObject({ name: "Reload survivors", membersJson: '["Ada","Lin"]' });
    });

    it("binds newly hosted Rooms to the server-resolved DataSpace", async () => {
        const response = await request(app)
            .post("/api/v1/rooms")
            .send({ displayName: "Host", persistence: "DATASPACE" })
            .expect(201);
        const room = await getAppDataSource().getRepository(RoomEntity).findOneByOrFail({
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
                session: { account: { userId: aliceId, dataSpaceId: bobSpace.id } },
            } as unknown as Request;
            await expect(requireCurrentDataSpace(request)).rejects.toMatchObject({ status: 403 });
            request.session.account = { userId: aliceId, dataSpaceId: aliceSpace.id };
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
            const quickRoom = await request(app)
                .post("/api/v1/rooms")
                .set("origin", settings.value.publicUrl)
                .send({ displayName: "Anonymous", persistence: "EPHEMERAL" })
                .expect(201);
            await request(app)
                .post("/api/v1/rooms")
                .set("origin", settings.value.publicUrl)
                .send({ displayName: "Anonymous", persistence: "DATASPACE" })
                .expect(401);
            expect(quickRoom.body).toMatchObject({ role: "HOST", roomCode: expect.any(String) });
        } finally {
            settings.value.deploymentMode = originalMode;
        }
    });
});
