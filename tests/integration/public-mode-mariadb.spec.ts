import path from "node:path";
import request, { type Response } from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppDataSource, initDataSource } from "../../src/modules/database/dataSource";
import { CouchGameSessionEntity } from "../../src/modules/database/entities/game/CouchGameSessionEntity";
import { RoomEntity } from "../../src/modules/database/entities/game/RoomEntity";
import { AccountSession } from "../../src/modules/database/entities/session/AccountSession";
import { DataSpace } from "../../src/modules/database/entities/user/DataSpace";
import { User } from "../../src/modules/database/entities/user/User";
import mailer from "../../src/modules/email";
import settings from "../../src/modules/settings";
import { getRoomService } from "../../src/modules/realtime";
import { effectiveSettingsFromProfile } from "../../src/packages/application/roomGameSettings";
import { GAME_MODES } from "../../src/packages/game-core";
import {
    loadMariaTestProfile,
    dropMariaTestDatabase,
    resetMariaTestDatabase,
    type MariaTestProfile,
} from "../support/mariaDb";

const profile = loadMariaTestProfile(
    process.env.TEST_DOTENV_FILE ?? path.resolve("tests/.env.test.local"),
    "TEST",
);
const PUBLIC_ORIGIN = "https://cards.public.test";
const username = "maria.user";
const firstPassword = "first-public-password";
const secondPassword = "second-public-password";
const canonicalSettings = {
    profileId: "PROFILE_FRIENDS",
    adultContentConfirmed: false,
    groupId: null,
    cardLocale: "de-DE",
    neverHaveIEverRevealMode: "ANONYMOUS_AGGREGATE" as const,
    configuration: effectiveSettingsFromProfile("PROFILE_FRIENDS"),
};

let app: import("express").Express;
let activationLink = "";
let resetLink = "";
let firstCookie = "";
let secondCookie = "";
let activeDataSpaceId = "";
let mariaSchemaCreated = false;

function configurePublicMaria(environment: MariaTestProfile): void {
    Object.assign(process.env, {
        NODE_ENV: "e2e",
        SETTINGS_FILE: process.platform === "win32" ? "NUL" : "/dev/null",
        E2E_DEPLOYMENT_MODE: "public",
        E2E_AUTH_MODE: "account",
        E2E_DB_TYPE: "mariadb",
        E2E_DB_HOST: environment.host,
        E2E_DB_PORT: String(environment.port),
        E2E_DB_NAME: environment.database,
        E2E_DB_USER: environment.user,
        E2E_DB_PASSWORD: environment.password,
        E2E_PUBLIC_URL: PUBLIC_ORIGIN,
        E2E_SESSION_SECRET: "public-mode-mariadb-test-session-secret",
        E2E_SMTP_HOST: "smtp.public.test",
        E2E_SMTP_PORT: "465",
        E2E_SMTP_USER: "mailer",
        E2E_SMTP_PASSWORD: "mail-password",
        E2E_SMTP_EMAIL: "cards@public.test",
        E2E_SMTP_SECURE: "true",
        E2E_TRUST_PROXY: "1",
        E2E_LOG_LEVEL: "silent",
    });
}

function publicRequest(method: "get" | "post" | "put" | "delete", url: string, cookie?: string) {
    const operation = request(app)
        [method](url)
        .set("Origin", PUBLIC_ORIGIN)
        .set("X-Forwarded-Proto", "https");
    return cookie ? operation.set("Cookie", cookie) : operation;
}

function responseCookie(response: Response): string {
    const header = response.headers["set-cookie"];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) throw new Error("Authentication response did not set a session cookie");
    return value.split(";", 1)[0];
}

function tokenFromLink(link: string, name: "activate" | "reset"): string {
    const token = new URL(link).searchParams.get(name);
    if (!token) throw new Error(`Captured ${name} link did not contain a token`);
    return token;
}

const suite = profile ? describe.sequential : describe.skip;

suite("public mode on MariaDB", () => {
    beforeAll(async () => {
        await resetMariaTestDatabase(profile!);
        mariaSchemaCreated = true;
        configurePublicMaria(profile!);
        await settings.read(process.env.SETTINGS_FILE);
        await initDataSource();
        vi.spyOn(mailer, "sendActivationEmail").mockImplementation(
            async (_locale, _email, link) => {
                activationLink = link;
            },
        );
        vi.spyOn(mailer, "sendPasswordResetEmail").mockImplementation(
            async (_locale, _email, link) => {
                resetLink = link;
            },
        );
        vi.spyOn(mailer, "sendDeletionEmail").mockResolvedValue(undefined);
        app = (await import("../../src/app")).default;
    }, 60_000);

    afterAll(async () => {
        vi.restoreAllMocks();
        if (AppDataSource?.isInitialized) await AppDataSource.destroy();
        if (profile && mariaSchemaCreated) await dropMariaTestDatabase(profile);
    });

    it("runs every mode as an anonymous quick round without account persistence", async () => {
        for (const mode of Object.values(GAME_MODES)) {
            const created = await publicRequest("post", "/api/v1/couch/sessions")
                .send({
                    persistence: "EPHEMERAL",
                    mode,
                    players: [{ name: "Anna" }, { name: "Ben" }],
                    ...canonicalSettings,
                })
                .expect(201);
            expect(created.body.persistence).toBe("EPHEMERAL");
            const command = mode === GAME_MODES.CLASSIC ? "choose" : "start";
            const body =
                mode === GAME_MODES.CLASSIC
                    ? { revision: 0, cardType: "QUESTION" }
                    : { revision: 0 };
            await publicRequest("post", `/api/v1/couch/sessions/${created.body.id}/${command}`)
                .send(body)
                .expect(200);

            const room = await publicRequest("post", "/api/v1/rooms")
                .send({
                    displayName: `Host ${mode}`,
                    persistence: "EPHEMERAL",
                    settings: { ...canonicalSettings, mode },
                })
                .expect(201);
            await expect(
                AppDataSource.getRepository(RoomEntity).findOneByOrFail({ id: room.body.roomId }),
            ).resolves.toMatchObject({ dataSpaceId: null });
        }
        expect(await AppDataSource.getRepository(CouchGameSessionEntity).count()).toBe(0);
    });

    it("keeps persistence authenticated and enforces the public Origin boundary", async () => {
        await request(app)
            .post("/api/v1/rooms")
            .set("X-Forwarded-Proto", "https")
            .send({ displayName: "Missing origin", persistence: "EPHEMERAL" })
            .expect(403);
        await publicRequest("post", "/api/v1/rooms")
            .send({ displayName: "Anonymous", persistence: "DATASPACE" })
            .expect(401)
            .expect(({ body }) => expect(body.error.code).toBe("ACCOUNT_AUTHENTICATION_REQUIRED"));
        await publicRequest("post", "/api/v1/couch/sessions")
            .send({
                persistence: "DATASPACE",
                mode: GAME_MODES.CLASSIC,
                players: [{ name: "Anna" }, { name: "Ben" }],
                ...canonicalSettings,
            })
            .expect(401);
    });

    it("registers, activates, logs in, and binds the minimal account session", async () => {
        await publicRequest("post", "/api/v1/account/register")
            .send({
                username: "Maria.User",
                displayName: "Maria User",
                email: "MARIA@EXAMPLE.TEST",
                password: firstPassword,
            })
            .expect(201);
        expect(activationLink).toContain(`${PUBLIC_ORIGIN}/play/account?activate=`);
        await publicRequest("post", "/api/v1/account/login")
            .send({ username, password: firstPassword })
            .expect(403);
        const token = tokenFromLink(activationLink, "activate");
        await publicRequest("post", "/api/v1/account/activate").send({ token }).expect(200);
        await publicRequest("post", "/api/v1/account/activate").send({ token }).expect(401);

        const login = await publicRequest("post", "/api/v1/account/login")
            .send({ username: "MARIA.USER", password: firstPassword })
            .expect(200);
        firstCookie = responseCookie(login);
        expect(login.headers["set-cookie"][0]).toMatch(/HttpOnly/i);
        expect(login.headers["set-cookie"][0]).toMatch(/Secure/i);
        expect(login.headers["set-cookie"][0]).toMatch(/SameSite=Lax/i);
        activeDataSpaceId = login.body.activeDataSpaceId;

        const status = await publicRequest("get", "/api/v1/account/status", firstCookie).expect(
            200,
        );
        expect(status.body).toMatchObject({
            deploymentMode: "public",
            authenticated: true,
            account: { user: { username, email: "maria@example.test" } },
        });
        const stored = await AppDataSource.getRepository(AccountSession).find();
        expect(stored).toHaveLength(1);
        expect(stored[0].accountUserId).toBe(login.body.user.id);
        expect(JSON.parse(stored[0].json)).toMatchObject({
            account: { userId: login.body.user.id, dataSpaceId: activeDataSpaceId },
        });
        expect(stored[0].json).not.toContain("maria@example.test");
    });

    it("persists owned Groups, defaults, Couch history, and Rooms", async () => {
        const preferences = await publicRequest(
            "put",
            "/api/v1/account/language-preferences",
            firstCookie,
        )
            .send({
                useSystemLanguage: false,
                interfaceLocale: "en",
                cardLocale: "en-GB",
                fallbackLocales: ["de-DE"],
            })
            .expect(200);
        expect(preferences.body.languagePreferences).toEqual({
            useSystemLanguage: false,
            interfaceLocale: "en",
            cardLocale: "en-GB",
            fallbackLocales: ["de-DE"],
        });
        const group = await publicRequest("post", "/api/v1/groups", firstCookie)
            .send({
                name: "Maria friends",
                members: ["Maria", "Alex"],
                preferredProfileId: "PROFILE_FRIENDS",
            })
            .expect(201);
        await publicRequest("put", "/api/v1/game-settings", firstCookie)
            .send({
                preferredProfileId: "PROFILE_FRIENDS",
                startingIntensity: 1,
                maximumIntensity: 3,
                intensityProgressionUnit: "CARDS",
                intensityProgressionInterval: 2,
                intensityProgressionIncrement: 1,
                randomQuestionRatio: 0.6,
                letsTalkMetaInterval: 5,
                defaultGroupId: group.body.id,
            })
            .expect(200);
        const customConfiguration = {
            ...effectiveSettingsFromProfile("PROFILE_CUSTOM"),
            enabledQuestionCategoryIds: ["CAT_FRIENDSHIP"],
            startingIntensity: 2,
            maximumIntensity: 4,
        };
        await publicRequest("put", `/api/v1/groups/${group.body.id}`, firstCookie)
            .send({
                name: group.body.name,
                members: group.body.members,
                preferredProfileId: "PROFILE_CUSTOM",
                customConfiguration,
                cardLanguageSettings: {
                    cardLocale: "en-GB",
                    cardFallbackEnabled: true,
                    cardFallbackLocales: ["de-DE"],
                },
            })
            .expect(200);
        const savedGroups = await publicRequest("get", "/api/v1/groups", firstCookie).expect(200);
        expect(savedGroups.body.groups).toContainEqual(
            expect.objectContaining({
                id: group.body.id,
                customConfiguration,
                cardLanguageSettings: {
                    cardLocale: "en-GB",
                    cardFallbackEnabled: true,
                    cardFallbackLocales: ["de-DE"],
                },
            }),
        );
        await publicRequest("put", "/api/v1/game-settings", firstCookie)
            .send({
                preferredProfileId: "PROFILE_CUSTOM",
                startingIntensity: 2,
                maximumIntensity: 4,
                intensityProgressionUnit: "CARDS",
                intensityProgressionInterval: 2,
                intensityProgressionIncrement: 1,
                randomQuestionRatio: 0.5,
                letsTalkMetaInterval: 5,
                defaultGroupId: group.body.id,
                customConfiguration,
                cardLanguageSettings: {
                    cardLocale: "en-GB",
                    cardFallbackEnabled: true,
                    cardFallbackLocales: ["de-DE"],
                },
            })
            .expect(200);
        await publicRequest("put", "/api/v1/game-settings", firstCookie)
            .send({
                preferredProfileId: "PROFILE_FRIENDS",
                startingIntensity: 1,
                maximumIntensity: 3,
                intensityProgressionUnit: "CARDS",
                intensityProgressionInterval: 2,
                intensityProgressionIncrement: 1,
                randomQuestionRatio: 0.6,
                letsTalkMetaInterval: 5,
                defaultGroupId: group.body.id,
            })
            .expect(200);
        const savedSettings = await publicRequest(
            "get",
            "/api/v1/game-settings",
            firstCookie,
        ).expect(200);
        expect(savedSettings.body.settings.customConfiguration).toEqual(customConfiguration);
        expect(savedSettings.body.settings.cardLanguageSettings).toEqual({
            cardLocale: "en-GB",
            cardFallbackEnabled: true,
            cardFallbackLocales: ["de-DE"],
        });

        const couch = await publicRequest("post", "/api/v1/couch/sessions", firstCookie)
            .send({
                persistence: "DATASPACE",
                mode: GAME_MODES.CLASSIC,
                players: [{ name: "Maria" }, { name: "Alex" }],
                ...canonicalSettings,
                groupId: group.body.id,
            })
            .expect(201);
        expect(couch.body.persistence).toBe("DATASPACE");
        const shown = await publicRequest(
            "post",
            `/api/v1/couch/sessions/${couch.body.id}/choose`,
            firstCookie,
        )
            .send({ revision: 0, cardType: "QUESTION" })
            .expect(200);
        await publicRequest("post", `/api/v1/couch/sessions/${couch.body.id}/end`, firstCookie)
            .send({ revision: shown.body.revision })
            .expect(200);
        await expect(
            AppDataSource.getRepository(CouchGameSessionEntity).findOneByOrFail({
                id: couch.body.id,
            }),
        ).resolves.toMatchObject({ dataSpaceId: activeDataSpaceId, groupId: group.body.id });

        const room = await publicRequest("post", "/api/v1/rooms", firstCookie)
            .send({
                displayName: "Maria",
                persistence: "DATASPACE",
                settings: { ...canonicalSettings, groupId: group.body.id, mode: GAME_MODES.RANDOM },
            })
            .expect(201);
        await expect(
            AppDataSource.getRepository(RoomEntity).findOneByOrFail({ id: room.body.roomId }),
        ).resolves.toMatchObject({ dataSpaceId: activeDataSpaceId, groupId: group.body.id });

        const exported = await publicRequest("get", "/api/v1/account/export", firstCookie).expect(
            200,
        );
        expect(exported.body.groups).toContainEqual(
            expect.objectContaining({ id: group.body.id, name: "Maria friends" }),
        );
        expect(exported.body.languagePreferences.fallbackLocales).toEqual(["de-DE"]);
        expect(exported.body.gameSessions).toContainEqual(
            expect.objectContaining({ topology: "COUCH", id: couch.body.id }),
        );
        expect(JSON.stringify(exported.body)).not.toContain("runtimeStateJson");

        await expect(
            getRoomService().expireDisconnectedParticipant(
                room.body.roomId,
                room.body.participantId,
            ),
        ).resolves.toBe(true);
        const closedRoom = await AppDataSource.getRepository(RoomEntity).findOneByOrFail({
            id: room.body.roomId,
        });
        expect(closedRoom.closedAt).toBeInstanceOf(Date);
    });

    it("lists and revokes login sessions and invalidates all sessions on password reset", async () => {
        const secondLogin = await publicRequest("post", "/api/v1/account/login")
            .send({ username, password: firstPassword })
            .expect(200);
        secondCookie = responseCookie(secondLogin);
        const sessions = await publicRequest("get", "/api/v1/account/sessions", firstCookie).expect(
            200,
        );
        expect(sessions.body.sessions).toHaveLength(2);
        const other = sessions.body.sessions.find(({ current }: { current: boolean }) => !current);
        await publicRequest(
            "delete",
            `/api/v1/account/sessions/${encodeURIComponent(other.id)}`,
            firstCookie,
        ).expect(204);
        await publicRequest("get", "/api/v1/account/status", secondCookie)
            .expect(200)
            .expect(({ body }) => expect(body.authenticated).toBe(false));

        await publicRequest("post", "/api/v1/account/password-reset-requests")
            .send({ identifier: "MARIA@EXAMPLE.TEST" })
            .expect(202);
        await publicRequest("post", "/api/v1/account/password-reset-requests")
            .send({ identifier: "missing@example.test" })
            .expect(202);
        await publicRequest("post", "/api/v1/account/password-resets", firstCookie)
            .send({ token: tokenFromLink(resetLink, "reset"), password: secondPassword })
            .expect(200);
        await publicRequest("get", "/api/v1/account/status", firstCookie)
            .expect(200)
            .expect(({ body }) => expect(body.authenticated).toBe(false));

        const login = await publicRequest("post", "/api/v1/account/login")
            .send({ username, password: secondPassword })
            .expect(200);
        firstCookie = responseCookie(login);
    });

    it("manages DataSpaces and deletes all account-owned MariaDB data", async () => {
        const created = await publicRequest("post", "/api/v1/account/data-spaces", firstCookie)
            .send({ name: "Second space" })
            .expect(201);
        await publicRequest("put", "/api/v1/account/data-spaces/current-selection", firstCookie)
            .send({ id: created.body.id })
            .expect(200);
        await publicRequest("put", "/api/v1/account/data-spaces/current", firstCookie)
            .send({ name: "Renamed space", isDefault: true })
            .expect(200)
            .expect(({ body }) => {
                expect(body.activeDataSpaceId).toBe(created.body.id);
                expect(body.dataSpaces).toContainEqual(
                    expect.objectContaining({
                        id: created.body.id,
                        name: "Renamed space",
                        defaultForOwner: true,
                    }),
                );
            });

        await publicRequest(
            "delete",
            `/api/v1/account/data-spaces/${activeDataSpaceId}`,
            firstCookie,
        )
            .expect(200)
            .expect(({ body }) => {
                expect(body.activeDataSpaceId).toBe(created.body.id);
                expect(body.dataSpaces).toHaveLength(1);
            });
        expect(
            await AppDataSource.getRepository(CouchGameSessionEntity).countBy({
                dataSpaceId: activeDataSpaceId,
            }),
        ).toBe(0);
        expect(
            await AppDataSource.getRepository(RoomEntity).countBy({
                dataSpaceId: activeDataSpaceId,
            }),
        ).toBe(0);
        await publicRequest(
            "delete",
            `/api/v1/account/data-spaces/${created.body.id}`,
            firstCookie,
        ).expect(409);

        await publicRequest("delete", "/api/v1/account/me", firstCookie)
            .send({ username })
            .expect(204);
        expect(await AppDataSource.getRepository(User).count()).toBe(0);
        expect(await AppDataSource.getRepository(DataSpace).count()).toBe(0);
        expect(
            await AppDataSource.getRepository(CouchGameSessionEntity).countBy({
                dataSpaceId: activeDataSpaceId,
            }),
        ).toBe(0);
        expect(
            await AppDataSource.getRepository(RoomEntity).countBy({
                dataSpaceId: activeDataSpaceId,
            }),
        ).toBe(0);
        expect(await AppDataSource.getRepository(AccountSession).count()).toBe(0);
    });
});
