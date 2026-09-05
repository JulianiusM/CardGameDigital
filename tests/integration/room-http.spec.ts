import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppDataSource, initDataSource } from "../../apps/server/src/modules/database/dataSource";
import { RoomParticipantEntity } from "../../packages/persistence/entities/game/RoomParticipantEntity";
import { RoomEntity } from "../../packages/persistence/entities/game/RoomEntity";
import { RoomCreateIdempotencyEntity } from "../../packages/persistence/entities/game/RoomCreateIdempotencyEntity";
import settings from "../../apps/server/src/modules/settings";
import { getRoomService } from "../../apps/server/src/modules/realtime";
import { defaultRoomGameSettings } from "../../packages/application/roomGameSettings";
import { DARE_TYPE_IDS, QUESTION_CATEGORY_IDS } from "../../packages/game-core";

let app: import("express").Express;
let directory: string;
const HTTP_SUITE_SETUP_TIMEOUT_MS = 120_000;
beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "room-http-"));
    Object.assign(process.env, {
        SETTINGS_FILE: "/dev/null",
        DEPLOYMENT_MODE: "local",
        AUTH_MODE: "none",
        DB_TYPE: "sqlite",
        DB_FILE: path.join(directory, "rooms.sqlite"),
        SESSION_SECRET: "room_http_test_secret_1234567890123456",
        ROOM_MAX_PARTICIPANTS: "20",
        ROOM_MAX_PLAYERS: "20",
    });
    await settings.read("/dev/null");
    await initDataSource();
    app = (await import("../../apps/server/src/app")).default;
}, HTTP_SUITE_SETUP_TIMEOUT_MS);
afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("Room HTTP API", () => {
    it("manages sparse Card policy through the local DataSpace ownership boundary", async () => {
        const initial = await request(app).get("/api/v1/card-policy/default").expect(200);
        expect(initial.body.scopeDefault).toEqual({ directives: {}, revision: 0 });

        const savedDefault = await request(app)
            .put("/api/v1/card-policy/default")
            .send({ directives: { availability: "EXCLUDE" }, expectedRevision: 0 })
            .expect(200);
        expect(savedDefault.body.scopeDefault.revision).toBe(1);

        const rule = await request(app)
            .post("/api/v1/card-policy/rules")
            .send({
                name: "Personal Cards",
                enabled: true,
                predicate: { socialSensitivities: ["PERSONAL"] },
                directives: { availability: "INCLUDE" },
            })
            .expect(201);
        expect(rule.body.rule).toMatchObject({ name: "Personal Cards", order: 10, revision: 1 });

        const preview = await request(app)
            .post("/api/v1/card-policy/rules/preview")
            .send({ predicate: { socialSensitivities: ["PERSONAL"] }, locale: "en-GB" })
            .expect(200);
        expect(preview.body.matchCount).toBe(2);

        const page = await request(app)
            .get("/api/v1/card-policy/cards?locale=en-GB&limit=2")
            .expect(200);
        expect(page.body.cards).toHaveLength(2);
        expect(page.body.total).toBe(4);
        expect(page.body.nextCursor).toBeTypeOf("string");
        const firstPageIds = page.body.cards.map(({ id }: { id: string }) => id);
        const nextPage = await request(app)
            .get(
                `/api/v1/card-policy/cards?locale=en-GB&limit=2&cursor=${encodeURIComponent(page.body.nextCursor)}`,
            )
            .expect(200);
        expect(nextPage.body.cards).toHaveLength(2);
        expect(nextPage.body.total).toBe(page.body.total);
        expect(nextPage.body.cards.map(({ id }: { id: string }) => id)).not.toEqual(firstPageIds);

        const previousPage = await request(app)
            .get("/api/v1/card-policy/cards?locale=en-GB&limit=2")
            .expect(200);
        expect(previousPage.body.total).toBe(page.body.total);
        expect(previousPage.body.cards.map(({ id }: { id: string }) => id)).toEqual(firstPageIds);
        const personalCard = page.body.cards.find(
            ({ producer }: { producer: { socialSensitivity: string } }) =>
                producer.socialSensitivity === "PERSONAL",
        );
        expect(personalCard).toMatchObject({
            producer: { socialSensitivity: "PERSONAL", playerCount: { minimum: 2, maximum: null } },
            effective: { availability: "INCLUDE" },
            provenance: { availability: "DataSpace rule “Personal Cards”" },
        });

        const exact = await request(app)
            .put(`/api/v1/card-policy/cards/${personalCard.id}`)
            .send({ directives: { intensity: { mode: "SET", value: 4 } }, expectedRevision: 0 })
            .expect(200);
        expect(exact.body.policy.revision).toBe(1);

        const sessionPage = await request(app)
            .post("/api/v1/card-policy/session/cards")
            .send({
                sessionPolicy: {
                    scopeDefault: { availability: "INCLUDE" },
                    conditionalRules: [],
                    exactCards: [
                        {
                            cardId: personalCard.id,
                            directives: { intensity: { mode: "SET", value: 5 } },
                        },
                    ],
                },
                search: { locale: "en-GB", limit: 2 },
            })
            .expect(200);
        expect(
            sessionPage.body.cards.find(({ id }: { id: string }) => id === personalCard.id),
        ).toMatchObject({
            effective: { availability: "INCLUDE", intensity: 5 },
            localDirectives: { intensity: { mode: "SET", value: 5 } },
            provenance: {
                availability: "Session Scope Default",
                intensity: "Session Exact Card",
            },
        });
        expect(sessionPage.body.total).toBe(page.body.total);
        expect(sessionPage.body.nextCursor).toBeTypeOf("string");
        const sessionNextPage = await request(app)
            .post("/api/v1/card-policy/session/cards")
            .send({
                sessionPolicy: {
                    scopeDefault: { availability: "INCLUDE" },
                    conditionalRules: [],
                    exactCards: [
                        {
                            cardId: personalCard.id,
                            directives: { intensity: { mode: "SET", value: 5 } },
                        },
                    ],
                },
                search: {
                    locale: "en-GB",
                    limit: 2,
                    cursor: sessionPage.body.nextCursor,
                },
            })
            .expect(200);
        expect(sessionNextPage.body.cards).toHaveLength(2);
        expect(sessionNextPage.body.total).toBe(sessionPage.body.total);
        expect(sessionNextPage.body.cards.map(({ id }: { id: string }) => id)).not.toEqual(
            sessionPage.body.cards.map(({ id }: { id: string }) => id),
        );

        const portable = await request(app).get("/api/v1/card-policy/export").expect(200);
        expect(portable.headers["content-disposition"]).toContain("card-policy.json");
        expect(portable.body).toMatchObject({
            format: "party-game-card-policy/v2",
            scopeDefault: { availability: "EXCLUDE" },
            rules: [{ name: "Personal Cards" }],
            exactCards: [{ cardId: personalCard.id }],
        });
        await request(app)
            .delete(`/api/v1/card-policy/cards/${personalCard.id}?expectedRevision=1`)
            .expect(204);
        await request(app)
            .delete(`/api/v1/card-policy/rules/${rule.body.rule.id}?expectedRevision=1`)
            .expect(204);
        await request(app)
            .post("/api/v1/card-policy/import")
            .send({ ...portable.body, scopeDefault: { availability: "INCLUDE" } })
            .expect(200)
            .expect(({ body }) =>
                expect(body.scope.scopeDefault).toEqual({
                    directives: { availability: "INCLUDE" },
                    revision: 1,
                }),
            );
        await request(app)
            .post("/api/v1/card-policy/import")
            .send({
                ...portable.body,
                exactCards: [
                    {
                        cardId: "99999999-9999-4999-8999-999999999999",
                        directives: { availability: "EXCLUDE" },
                    },
                ],
            })
            .expect(400);
        await request(app)
            .get("/api/v1/card-policy/default")
            .expect(200)
            .expect(({ body }) =>
                expect(body.scopeDefault.directives).toEqual({ availability: "INCLUDE" }),
            );

        await request(app)
            .post("/api/v1/card-policy/cards/bulk")
            .send({
                filters: { locale: "en-GB", socialSensitivity: "PERSONAL" },
                directives: { repeatableInSession: "ENABLE" },
                confirmedCount: 2,
            })
            .expect(200)
            .expect(({ body }) => expect(body.appliedCount).toBe(2));
        await request(app)
            .post("/api/v1/card-policy/cards/bulk")
            .send({
                filters: { locale: "en-GB", socialSensitivity: "PERSONAL" },
                directives: { repeatableInSession: "DISABLE" },
                confirmedCount: 1,
            })
            .expect(409);

        await request(app)
            .put("/api/v1/card-policy/default")
            .send({ directives: {}, expectedRevision: 0 })
            .expect(409);
    });

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
            label: "Everyday",
            description: null,
        });
        const returnedQuestionCategoryIds = taxonomies.body.questionCategories.map(
            ({ id }: { id: string }) => id,
        );
        const returnedDareTypeIds = taxonomies.body.dareTypes.map(({ id }: { id: string }) => id);
        expect(returnedQuestionCategoryIds).toEqual(
            QUESTION_CATEGORY_IDS.filter((id) => returnedQuestionCategoryIds.includes(id)),
        );
        expect(returnedDareTypeIds).toEqual(
            DARE_TYPE_IDS.filter((id) => returnedDareTypeIds.includes(id)),
        );
    });

    it("previews the authoritative eligible Card pool before a game starts", async () => {
        const gameSettings = defaultRoomGameSettings();
        gameSettings.cardLocale = "en-GB";
        const response = await request(app)
            .post("/api/v1/card-policy/session/eligibility-preview")
            .send({ settings: gameSettings, playerCount: 2 })
            .expect(200);

        expect(response.body).toMatchObject({
            playerCount: 2,
            byType: {
                QUESTION: expect.any(Number),
                DARE: expect.any(Number),
                CONVERSATION_META: 0,
            },
        });
        expect(response.body.total).toBeGreaterThan(0);
        expect(response.body.availableAtStart).toBeLessThanOrEqual(response.body.total);

        const room = await request(app)
            .post("/api/v1/rooms")
            .send({ displayName: "Preview Host", settings: gameSettings })
            .expect(201);
        const roomPreview = await request(app)
            .post("/api/v1/card-policy/session/eligibility-preview")
            .send({
                roomCode: room.body.roomCode,
                participantCredential: room.body.participantCredential,
            })
            .expect(200);
        expect(roomPreview.body).toMatchObject({
            total: response.body.total,
            playerCount: 2,
        });
        await request(app)
            .post("/api/v1/card-policy/session/eligibility-preview")
            .send({
                roomCode: room.body.roomCode,
                participantCredential: "x".repeat(43),
            })
            .expect(404);
    });

    it("returns the active DataSpace with persisted sensitivity defaults", async () => {
        const initial = await request(app).get("/api/v1/game-settings").expect(200);
        expect(initial.body.dataSpace).toMatchObject({
            id: expect.any(String),
            name: expect.any(String),
        });
        expect(initial.body.settings.maximumSocialSensitivity).toBe("PERSONAL");

        await request(app)
            .put("/api/v1/game-settings")
            .send({
                preferredProfileId: "PROFILE_FRIENDS",
                startingIntensity: 1,
                maximumIntensity: 3,
                maximumSocialSensitivity: "DEEP_PERSONAL",
                intensityProgressionUnit: "CARDS",
                intensityProgressionInterval: 2,
                intensityProgressionIncrement: 1,
                randomQuestionRatio: 0.6,
                letsTalkMetaInterval: 5,
                defaultGroupId: null,
            })
            .expect(200);
        const saved = await request(app).get("/api/v1/game-settings").expect(200);
        expect(saved.body.settings.maximumSocialSensitivity).toBe("DEEP_PERSONAL");
        expect(saved.body.dataSpace.id).toBe(initial.body.dataSpace.id);
    });

    it("rejects a Room Card locale that is not active in the catalog", async () => {
        const settings = {
            mode: "CLASSIC_TRUTH_OR_DARE",
            profileId: "PROFILE_FRIENDS",
            groupId: null,
            adultContentConfirmed: false,
            cardLocale: "es-ES",
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
        expect(response.body.publicRuntimeSecurity).toBe("enforced");
        expect(response.body.roomCapacity).toEqual({
            maximumParticipants: 20,
            maximumPlayers: 20,
        });
        expect(response.body.roomAccess).toMatchObject({
            configuredBaseUrl: null,
            availableBaseUrls: expect.any(Array),
        });
        expect(response.body).toMatchObject({
            serverId: expect.stringMatching(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
            ),
            displayName: "Party Game",
            capabilities: {
                localNetworkDiscovery: true,
                displayBootstrapRoomCreation: true,
                nativeDeviceAuthorization: false,
            },
            nativeDeviceAuthorization: null,
            localNetworkDiscovery: {
                advertising: false,
                serviceType: "_partycard._tcp",
                txtVersion: 1,
            },
            endpoints: {
                apiBasePath: "/api/v1",
                webSocketPath: "/ws",
                roomJoinPathTemplate: "/play/?room={roomCode}",
            },
        });
        expect(response.headers["x-content-type-options"]).toBe("nosniff");
        expect(response.headers["x-frame-options"]).toBe("DENY");
        expect(response.headers["content-security-policy"]).toContain("script-src 'self'");
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.headers["x-request-id"]).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
    });

    it("authorizes WebSockets on the local request host for IPv4 and IPv6", async () => {
        const ipv4 = await request(app)
            .get("/api/v1/server-info")
            .set("Host", "192.168.1.20:3000")
            .expect(200);
        expect(ipv4.headers["content-security-policy"]).toContain(
            "connect-src 'self' ws://192.168.1.20:3000",
        );

        const ipv6 = await request(app)
            .get("/api/v1/server-info")
            .set("Host", "[2001:db8::20]:3000")
            .expect(200);
        expect(ipv6.headers["content-security-policy"]).toContain("connect-src 'self' ws:");
    });

    it("allows the explicit public development policy to bypass runtime transport gates", async () => {
        const originalMode = settings.value.deploymentMode;
        const originalSecurity = settings.value.publicRuntimeSecurity;
        settings.value.deploymentMode = "public";
        settings.value.publicRuntimeSecurity = "enforced";
        try {
            const rejected = await request(app)
                .post("/api/v1/rooms")
                .send({ displayName: "No origin", persistence: "EPHEMERAL" })
                .expect(403);
            expect(rejected.headers["strict-transport-security"]).toBeTruthy();

            settings.value.publicRuntimeSecurity = "development";
            const created = await request(app)
                .post("/api/v1/rooms")
                .send({ displayName: "Developer", persistence: "EPHEMERAL" })
                .expect(201);
            expect(created.headers["strict-transport-security"]).toBeUndefined();
            const info = await request(app).get("/api/v1/server-info").expect(200);
            expect(info.body.publicRuntimeSecurity).toBe("development");
        } finally {
            settings.value.deploymentMode = originalMode;
            settings.value.publicRuntimeSecurity = originalSecurity;
        }
    });

    it("serves built-in GameProfiles plus an explicit neutral Custom option", async () => {
        const response = await request(app).get("/api/v1/game-profiles").expect(200);
        expect(response.body.profiles).toHaveLength(6);
        expect(response.body.profiles[0]).toMatchObject({
            immutable: true,
            editorialStatus: "PUBLISHED",
        });
        expect(
            response.body.profiles.find(({ id }: { id: string }) => id === "PROFILE_SPICY"),
        ).toMatchObject({ requiresAdultConfirmation: true });
        expect(response.body.profiles.map(({ name }: { name: string }) => name)).toEqual([
            "Child-friendly",
            "Acquaintances & colleagues",
            "Good friends",
            "Close friends",
            "Spicy",
            "Custom",
        ]);
        expect(
            response.body.profiles.find(
                ({ id }: { id: string }) => id === "PROFILE_CHILD_FRIENDLY",
            ),
        ).toMatchObject({
            name: "Child-friendly",
            requiresAdultConfirmation: false,
            maximumSocialSensitivity: "DEEP_PERSONAL",
            maximumIntensity: 3,
        });
        expect(
            response.body.profiles.find(({ id }: { id: string }) => id === "PROFILE_CUSTOM"),
        ).toMatchObject({
            immutable: false,
            maximumSocialSensitivity: "EXPLICIT",
            startingIntensity: 1,
            maximumIntensity: 1,
            intensityProgressionUnit: "CARDS",
            intensityProgressionInterval: 2,
            intensityProgressionIncrement: 1,
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
    it("opens a display-only Room idempotently and assigns the first connected Player as Host", async () => {
        const idempotencyKey = randomUUID();
        const createBody = {
            displayName: "Shared display",
            persistence: "EPHEMERAL",
            bootstrapMode: "DISPLAY_WAITING_FOR_HOST",
        };
        const created = await request(app)
            .post("/api/v1/rooms")
            .set("Idempotency-Key", idempotencyKey)
            .send(createBody)
            .expect(201);
        const replayed = await request(app)
            .post("/api/v1/rooms")
            .set("Idempotency-Key", idempotencyKey)
            .send(createBody)
            .expect(201);

        expect(replayed.body).toEqual(created.body);
        expect(replayed.headers["idempotency-replayed"]).toBe("true");
        expect(created.body).toMatchObject({
            role: "DISPLAY",
            bootstrapMode: "DISPLAY_WAITING_FOR_HOST",
            hostStatus: {
                state: "AWAITING_FIRST_HOST",
                participantId: null,
                displayName: null,
                deadline: null,
            },
        });
        expect(
            await AppDataSource.getRepository(RoomEntity).countBy({ id: created.body.roomId }),
        ).toBe(1);
        expect(
            await AppDataSource.getRepository(RoomCreateIdempotencyEntity).countBy({
                resourceId: created.body.roomId,
            }),
        ).toBe(1);
        expect(
            await AppDataSource.getRepository(RoomParticipantEntity).countBy({
                roomId: created.body.roomId,
            }),
        ).toBe(1);

        const player = await request(app)
            .post(`/api/v1/rooms/${created.body.roomCode}/participants`)
            .send({ displayName: "Alex", role: "PLAYER" })
            .expect(201);
        expect(player.body.role).toBe("PLAYER");
        const service = getRoomService();
        await service.authenticate(created.body.roomCode, created.body.participantCredential);
        const activation = await service.authenticate(
            player.body.roomCode,
            player.body.participantCredential,
        );
        expect(activation).toMatchObject({ role: "HOST", displayName: "Alex" });
        expect(activation?.roleChanges).toContainEqual({
            participantId: player.body.participantId,
            previousRole: "PLAYER",
            role: "HOST",
            reason: "INITIAL_HOST_ASSIGNED",
        });
        expect((await service.snapshot(created.body.roomId)).hostStatus).toMatchObject({
            state: "CONNECTED",
            participantId: player.body.participantId,
            displayName: "Alex",
        });
    });
    it("enforces display-bootstrap idempotency header errors and terminal replay tombstones", async () => {
        const body = {
            displayName: "Temporary display",
            bootstrapMode: "DISPLAY_WAITING_FOR_HOST",
        };
        await request(app)
            .post("/api/v1/rooms")
            .send(body)
            .expect(400)
            .expect(({ body: responseBody }) => {
                expect(responseBody.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
            });
        await request(app)
            .post("/api/v1/rooms")
            .set("Idempotency-Key", "not-a-uuid")
            .send(body)
            .expect(400)
            .expect(({ body: responseBody }) => {
                expect(responseBody.error.code).toBe("IDEMPOTENCY_KEY_INVALID");
            });

        const key = randomUUID();
        const created = await request(app)
            .post("/api/v1/rooms")
            .set("Idempotency-Key", key)
            .send(body)
            .expect(201);
        await request(app)
            .post("/api/v1/rooms")
            .set("Idempotency-Key", key)
            .send({ ...body, displayName: "Changed display" })
            .expect(409)
            .expect(({ body: responseBody }) => {
                expect(responseBody.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
            });

        const service = getRoomService();
        const display = await service.authenticate(
            created.body.roomCode,
            created.body.participantCredential,
        );
        expect(display).not.toBeNull();
        await service.execute(created.body.roomId, display!, {
            type: "command.leaveRoom",
            revision: null,
            payload: {},
        });
        await request(app)
            .post("/api/v1/rooms")
            .set("Idempotency-Key", key)
            .send(body)
            .expect(410)
            .expect(({ body: responseBody }) => {
                expect(responseBody.error.code).toBe("IDEMPOTENCY_RESULT_GONE");
            });
        const record = await AppDataSource.getRepository(
            RoomCreateIdempotencyEntity,
        ).findOneByOrFail({ resourceId: created.body.roomId });
        expect(record).toMatchObject({
            state: "RESOURCE_GONE",
            responseCiphertext: null,
            responseKeyId: null,
        });
    });
    it("supports independent simultaneous Rooms on one local network server", async () => {
        const [siblings, friends] = await Promise.all([
            request(app).post("/api/v1/rooms").send({ displayName: "Sibling A" }).expect(201),
            request(app).post("/api/v1/rooms").send({ displayName: "Sibling B" }).expect(201),
        ]);
        expect(siblings.body.roomId).not.toBe(friends.body.roomId);
        expect(siblings.body.roomCode).not.toBe(friends.body.roomCode);
    });
    it("rejects joins after the Room participant capacity is reached", async () => {
        const host = await request(app)
            .post("/api/v1/rooms")
            .send({ displayName: "Capacity host" })
            .expect(201);
        for (let index = 1; index < 20; index++) {
            await request(app)
                .post(`/api/v1/rooms/${host.body.roomCode}/participants`)
                .send({ displayName: `Player ${index}`, role: "PLAYER" })
                .expect(201);
        }
        const response = await request(app)
            .post(`/api/v1/rooms/${host.body.roomCode}/participants`)
            .send({ displayName: "Player 20", role: "PLAYER" })
            .expect(409);
        expect(response.body.error.code).toBe("ROOM_FULL");
    });
    it("validates create and join payloads", async () => {
        await request(app)
            .post("/api/v1/rooms")
            .send({ displayName: "" })
            .expect(400)
            .expect(({ body }) => {
                expect(body.error.code).toBe("VALIDATION_ERROR");
                expect(body.error.data.fieldErrors.displayName).toEqual(expect.any(Array));
                expect(body.error.details).toBeUndefined();
            });
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
