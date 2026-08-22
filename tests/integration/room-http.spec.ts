import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppDataSource, initDataSource } from "../../src/modules/database/dataSource";
import { RoomParticipantEntity } from "../../src/modules/database/entities/game/RoomParticipantEntity";
import settings from "../../src/modules/settings";

let app: import("express").Express;
let directory: string;
beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "room-http-"));
    Object.assign(process.env, {
        SETTINGS_FILE: "/dev/null",
        DEPLOYMENT_MODE: "local",
        AUTH_MODE: "none",
        DB_TYPE: "sqlite",
        DB_FILE: path.join(directory, "rooms.sqlite"),
        SESSION_SECRET: "room_http_test_secret_123",
    });
    await settings.read("/dev/null");
    await initDataSource();
    app = (await import("../../src/app")).default;
});
afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("Room HTTP API", () => {
    it("lists database-backed Card locales and localized taxonomies", async () => {
        const locales = await request(app).get("/api/v1/catalog/locales").expect(200);
        expect(locales.body).toMatchObject({
            defaultLocale: "de-DE",
            locales: expect.arrayContaining([
                { id: "en-GB", nativeName: "English (United Kingdom)", coverage: 1 },
            ]),
        });
        const taxonomies = await request(app)
            .get("/api/v1/catalog/taxonomies?locale=en-GB")
            .expect(200);
        expect(taxonomies.body.questionCategories).toContainEqual({
            id: "CAT_EVERYDAY",
            label: "Everyday life",
            description: null,
        });
    });

    it("rejects a Room Card locale that is not active in the catalog", async () => {
        const settings = {
            mode: "CLASSIC_TRUTH_OR_DARE",
            profileId: "PROFILE_FRIENDS",
            groupId: null,
            adultContentConfirmed: false,
            cardLocale: "fr-FR",
            configuration: {
                enabledQuestionCategoryIds: ["CAT_EVERYDAY"],
                enabledDareTypeIds: ["DARE_SILLY"],
                blockedOperationalFlags: [],
                maximumIntensity: 3,
                randomQuestionRatio: 0.5,
                maximumTypeStreak: 3,
                letsTalkMetaInterval: 5,
            },
        };
        const response = await request(app)
            .post("/api/v1/rooms")
            .send({ displayName: "Host", settings })
            .expect(400);
        expect(response.body.error.code).toBe("CARD_LOCALE_UNAVAILABLE");
    });

    it("reports that Account UI is unavailable for AUTH_MODE=none", async () => {
        const response = await request(app).get("/api/v1/server-info").expect(200);
        expect(response.body.authenticationAvailable).toBe(false);
    });

    it("serves built-in GameProfiles plus an explicit neutral Custom option", async () => {
        const response = await request(app).get("/api/v1/game-profiles").expect(200);
        expect(response.body.profiles).toHaveLength(6);
        expect(response.body.profiles[0]).toMatchObject({
            immutable: true,
            editorialStatus: "PUBLISHED",
        });
        expect(
            response.body.profiles.find(({ id }: { id: string }) => id === "PROFILE_COUPLES_SPICY"),
        ).toMatchObject({ requiresAdultConfirmation: true });
        expect(
            response.body.profiles.find(({ id }: { id: string }) => id === "PROFILE_CUSTOM"),
        ).toMatchObject({
            immutable: false,
            maximumIntensity: 1,
            enabledQuestionCategoryIds: [],
            enabledDareTypeIds: [],
        });
    });

    it("creates and joins a Room without persisting reusable credentials", async () => {
        const host = await request(app)
            .post("/api/v1/rooms")
            .send({ displayName: "Host" })
            .expect(201);
        const player = await request(app)
            .post(`/api/v1/rooms/${host.body.roomCode}/participants`)
            .send({ displayName: "Player", role: "PLAYER" })
            .expect(201);
        expect(host.body.participantCredential).toHaveLength(43);
        expect(player.body.roomId).toBe(host.body.roomId);
        const stored = await AppDataSource.getRepository(RoomParticipantEntity).find();
        expect(stored.every((participant) => participant.credentialHash.length === 64)).toBe(true);
        expect(stored.map((participant) => participant.credentialHash)).not.toContain(
            host.body.participantCredential,
        );
    });
    it("supports independent simultaneous Rooms on one local network server", async () => {
        const [siblings, friends] = await Promise.all([
            request(app).post("/api/v1/rooms").send({ displayName: "Sibling A" }).expect(201),
            request(app).post("/api/v1/rooms").send({ displayName: "Sibling B" }).expect(201),
        ]);
        expect(siblings.body.roomId).not.toBe(friends.body.roomId);
        expect(siblings.body.roomCode).not.toBe(friends.body.roomCode);
    });
    it("validates create and join payloads", async () => {
        await request(app)
            .post("/api/v1/rooms")
            .send({ displayName: "" })
            .expect(400)
            .expect(({ body }) => expect(body.error.code).toBe("VALIDATION_ERROR"));
        const host = await request(app)
            .post("/api/v1/rooms")
            .send({ displayName: "Only host" })
            .expect(201);
        await request(app)
            .post(`/api/v1/rooms/${host.body.roomCode}/participants`)
            .send({ displayName: "Second host", role: "HOST" })
            .expect(400);
    });
});
