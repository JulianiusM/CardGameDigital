import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GAME_MODES } from "../../packages/game-core";
import {
    getAppDataSource,
    initDataSource,
} from "../../apps/server/src/modules/database/dataSource";
import settings from "../../apps/server/src/modules/settings";
import { CouchGameSessionEntity } from "../../packages/persistence/entities/game/CouchGameSessionEntity";
import { CouchCardAppearanceEntity } from "../../packages/persistence/entities/game/CouchCardAppearanceEntity";
import { SessionImmutablePayloadChunkEntity } from "../../packages/persistence/entities/game/SessionImmutablePayloadChunkEntity";
import { SessionImmutablePayloadEntity } from "../../packages/persistence/entities/game/SessionImmutablePayloadEntity";
import { effectiveSettingsFromProfile } from "../../packages/application/roomGameSettings";
import { TypeOrmCouchSessionRepository } from "../../packages/persistence/TypeOrmCouchSessionRepository";
import { expectHiddenVotingAnswers } from "../support/votingPrivacy";
import { CardEntity } from "../../packages/persistence/entities/card/CardEntity";

const canonicalSettings = {
    profileId: "PROFILE_FRIENDS",
    adultContentConfirmed: false,
    configuration: effectiveSettingsFromProfile("PROFILE_FRIENDS"),
};

let app: import("express").Express;
let directory: string;
beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "couch-api-"));
    Object.assign(process.env, {
        SETTINGS_FILE: "/dev/null",
        DEPLOYMENT_MODE: "local",
        AUTH_MODE: "none",
        DB_TYPE: "sqlite",
        DB_FILE: path.join(directory, "api.sqlite"),
        SESSION_SECRET: "couch_api_test_secret_123",
    });
    await settings.read("/dev/null");
    await initDataSource();
    const adultCardId = randomUUID();
    await getAppDataSource()
        .getRepository(CardEntity)
        .save({
            id: adultCardId,
            cardType: "QUESTION",
            questionCategoryId: "CAT_EVERYDAY",
            dareTypeId: null,
            socialSensitivity: "EXPLICIT",
            intensity: 1,
            localizations: [
                {
                    cardId: adultCardId,
                    locale: "de-DE",
                    text: "Adult-classified regression Card",
                    active: true,
                    updatedAt: new Date(),
                },
            ],
        });
    app = (await import("../../apps/server/src/app")).default;
}, 120_000);
afterAll(async () => {
    if (getAppDataSource().isInitialized) await getAppDataSource().destroy();
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("Couch HTTP application adapter", () => {
    it.each(["de-DE", "en-GB", "en-US"])(
        "enforces effective adult confirmation with localized %s errors",
        async (locale) => {
            const input = {
                mode: GAME_MODES.CLASSIC,
                players: [{ name: "Anna" }, { name: "Ben" }],
                profileId: "PROFILE_CUSTOM",
                configuration: effectiveSettingsFromProfile("PROFILE_SPICY"),
                adultContentConfirmed: false,
                cardLocale: "de-DE",
            };
            const rejected = await request(app)
                .post("/api/v1/couch/sessions")
                .set("accept-language", locale)
                .send(input)
                .expect(400);
            expect(rejected.body.error.code).toBe("VALIDATION_ERROR");
            expect(rejected.body.error.message).toBe(
                locale === "de-DE"
                    ? "Explizite Inhalte erfordern eine Bestätigung."
                    : "Explicit content requires confirmation.",
            );
            await request(app)
                .post("/api/v1/couch/sessions")
                .send({ ...input, adultContentConfirmed: true })
                .expect(201);
        },
    );

    it("captures sparse Session policy once and enforces its player-count range", async () => {
        const cardPolicy = {
            scopeDefault: {
                playerCount: { mode: "SET", value: { minimum: 3, maximum: null } },
            },
            conditionalRules: [],
            exactCards: [],
        };
        await request(app)
            .post("/api/v1/couch/sessions")
            .send({
                mode: GAME_MODES.CLASSIC,
                players: [{ name: "Anna" }, { name: "Ben" }],
                cardPolicy,
                ...canonicalSettings,
            })
            .expect(409)
            .expect(({ body }) => expect(body.error.code).toBe("CARD_POOL_EXHAUSTED"));

        const created = await request(app)
            .post("/api/v1/couch/sessions")
            .send({
                persistence: "DATASPACE",
                mode: GAME_MODES.CLASSIC,
                players: [{ name: "Anna" }, { name: "Ben" }, { name: "Carla" }],
                cardPolicy,
                ...canonicalSettings,
            })
            .expect(201);
        const stored = await getAppDataSource()
            .getRepository(CouchGameSessionEntity)
            .findOneByOrFail({
                id: created.body.id,
            });
        expect(stored.runtimeStateVersion).toBe(7);
        expect(JSON.parse(stored.runtimeStateJson).policySnapshot).toBeNull();
        expect(stored.policyInputDigest).toMatch(/^[a-f0-9]{64}$/);
        const snapshot = await getAppDataSource()
            .getRepository(SessionImmutablePayloadEntity)
            .findOneByOrFail({
                digest: stored.policyInputDigest!,
                payloadKind: "POLICY_INPUT",
            });
        const chunks = await getAppDataSource()
            .getRepository(SessionImmutablePayloadChunkEntity)
            .findBy({ payloadDigest: snapshot.digest });
        expect(chunks).toHaveLength(snapshot.chunkCount);
        expect(
            chunks.every(({ payloadBase64 }) => Buffer.byteLength(payloadBase64, "utf8") <= 32_768),
        ).toBe(true);
        const hydrated = await new TypeOrmCouchSessionRepository(getAppDataSource()).load(
            created.body.id,
        );
        expect(hydrated?.sessionCardPolicy).toEqual(cardPolicy);
        expect(hydrated?.catalog).toMatchObject({ contract: "game-card-catalog/v2" });
        expect(Buffer.byteLength(stored.runtimeStateJson, "utf8")).toBeLessThan(32_000);

        await request(app)
            .post(`/api/v1/couch/sessions/${created.body.id}/choose`)
            .send({ revision: 0, cardType: "QUESTION" })
            .expect(200);
        const storedAfterCard = await getAppDataSource()
            .getRepository(CouchGameSessionEntity)
            .findOneByOrFail({ id: created.body.id });
        expect(JSON.parse(storedAfterCard.runtimeStateJson).sessionHistory).toHaveLength(1);
        const hydratedAfterCard = await new TypeOrmCouchSessionRepository(getAppDataSource()).load(
            created.body.id,
        );
        expect(hydratedAfterCard?.sessionHistory).toHaveLength(1);

        const second = await request(app)
            .post("/api/v1/couch/sessions")
            .send({
                persistence: "DATASPACE",
                mode: GAME_MODES.CLASSIC,
                players: [{ name: "Dan" }, { name: "Eli" }, { name: "Fran" }],
                cardPolicy,
                ...canonicalSettings,
            })
            .expect(201);
        const secondStored = await getAppDataSource()
            .getRepository(CouchGameSessionEntity)
            .findOneByOrFail({ id: second.body.id });
        expect(secondStored.policyInputDigest).toBe(stored.policyInputDigest);
        expect(
            await getAppDataSource().getRepository(SessionImmutablePayloadEntity).countBy({
                digest: stored.policyInputDigest!,
            }),
        ).toBe(1);
        await getAppDataSource()
            .getRepository(CouchGameSessionEntity)
            .delete({ id: created.body.id });
        await getAppDataSource()
            .getRepository(CouchGameSessionEntity)
            .delete({ id: second.body.id });
    });

    it("runs every mode without making the client authoritative", async () => {
        for (const mode of Object.values(GAME_MODES)) {
            const created = await request(app)
                .post("/api/v1/couch/sessions")
                .set("accept-language", "de-DE")
                .send({
                    mode,
                    players: [{ name: "Anna" }, { name: "Ben" }],
                    ...canonicalSettings,
                })
                .expect(201);
            const command = mode === GAME_MODES.CLASSIC ? "choose" : "start";
            const payload =
                mode === GAME_MODES.CLASSIC
                    ? { revision: 0, cardType: "QUESTION" }
                    : { revision: 0 };
            const shown = await request(app)
                .post(`/api/v1/couch/sessions/${created.body.id}/${command}`)
                .set("accept-language", "de-DE")
                .send(payload)
                .expect(200);
            expect(shown.body).toMatchObject({ revision: 1, cardsShown: 1 });
            expect(shown.body.currentCard.cardText).toBeTruthy();
            expect(shown.body.currentCard).toMatchObject({
                cardIntensity: expect.any(Number),
                intensity: expect.any(Number),
            });
        }
        expect(await getAppDataSource().getRepository(CouchGameSessionEntity).count()).toBe(0);
    });

    it("validates payloads and rejects stale commands with stable errors", async () => {
        await request(app)
            .post("/api/v1/couch/sessions")
            .set("accept-language", "de-DE")
            .send({ mode: "INVALID", players: [] })
            .expect(400)
            .expect(({ body }) => {
                expect(body.error.code).toBe("VALIDATION_ERROR");
                expect(body.error.data.fieldErrors).toMatchObject({
                    mode: expect.any(Array),
                    players: expect.any(Array),
                });
                expect(body.error.details).toBeUndefined();
            });
        await request(app)
            .post("/api/v1/couch/sessions")
            .set("accept-language", "de-DE")
            .send({
                mode: GAME_MODES.CLASSIC,
                players: [{ name: "Anna" }],
                ...canonicalSettings,
            })
            .expect(400);
        const created = await request(app)
            .post("/api/v1/couch/sessions")
            .set("accept-language", "de-DE")
            .send({
                mode: GAME_MODES.CLASSIC,
                players: [{ name: "Anna" }, { name: "Ben" }],
                ...canonicalSettings,
            })
            .expect(201);
        await request(app)
            .post(`/api/v1/couch/sessions/${created.body.id}/choose`)
            .send({ revision: 1, cardType: "QUESTION" })
            .expect(409)
            .expect(({ body }) => expect(body.error.code).toBe("STALE_SESSION_REVISION"));
    });

    it("persists Couch history and the final EndSession state", async () => {
        const created = await request(app)
            .post("/api/v1/couch/sessions")
            .set("accept-language", "de-DE")
            .send({
                persistence: "DATASPACE",
                mode: GAME_MODES.CLASSIC,
                players: [{ name: "Anna" }, { name: "Ben" }],
                ...canonicalSettings,
            })
            .expect(201);
        const shown = await request(app)
            .post(`/api/v1/couch/sessions/${created.body.id}/choose`)
            .send({ revision: 0, cardType: "QUESTION" })
            .expect(200);
        const advanced = await request(app)
            .post(`/api/v1/couch/sessions/${created.body.id}/advance`)
            .send({ revision: shown.body.revision })
            .expect(200);
        await request(app)
            .post(`/api/v1/couch/sessions/${created.body.id}/end`)
            .send({ revision: advanced.body.revision })
            .expect(200)
            .expect(({ body }) => expect(body.state).toBe("ENDED"));
        await expect(
            getAppDataSource().getRepository(CouchGameSessionEntity).findOneByOrFail({
                id: created.body.id,
            }),
        ).resolves.toMatchObject({ endedAt: expect.any(Date), revision: 3 });
        const appearances = await getAppDataSource()
            .getRepository(CouchCardAppearanceEntity)
            .findBy({
                sessionId: created.body.id,
            });
        expect(appearances).toHaveLength(1);
        expect(appearances[0]).toMatchObject({
            skipped: false,
            completed: true,
            vetoed: false,
        });
    });

    it.each(["ANONYMOUS_AGGREGATE", "NAMED_ANSWERS"])(
        "protects the complete Couch response in %s",
        async (revealMode) => {
            const created = await request(app)
                .post("/api/v1/couch/sessions")
                .send({
                    mode: GAME_MODES.NEVER_HAVE_I_EVER,
                    players: [{ name: "Anna" }, { name: "Ben" }, { name: "Chris" }],
                    neverHaveIEverRevealMode: revealMode,
                    ...canonicalSettings,
                })
                .expect(201);
            const shown = await request(app)
                .post(`/api/v1/couch/sessions/${created.body.id}/start`)
                .send({ revision: 0 })
                .expect(200);
            expectHiddenVotingAnswers(created.body);
            expectHiddenVotingAnswers(shown.body);
            for (const [index, vote] of ["YES", "NO"].entries()) {
                const response = await request(app)
                    .post(`/api/v1/couch/sessions/${created.body.id}/vote`)
                    .send({ revision: index + 1, playerId: shown.body.players[index].id, vote })
                    .expect(200);
                expect(response.body.neverHaveIEverVoting.result).toBeNull();
                expectHiddenVotingAnswers(response.body);
                const reloaded = await request(app)
                    .get(`/api/v1/couch/sessions/${created.body.id}`)
                    .expect(200);
                expectHiddenVotingAnswers(reloaded.body);
            }
            const revealed = await request(app)
                .post(`/api/v1/couch/sessions/${created.body.id}/vote`)
                .send({ revision: 3, playerId: shown.body.players[2].id, vote: "YES" })
                .expect(200);
            expect(revealed.body.voteResult).toEqual({ yes: 2, no: 1, total: 3 });
            expect(revealed.body.neverHaveIEverVoting.result).toMatchObject(
                revealed.body.voteResult,
            );
            if (revealMode === "NAMED_ANSWERS") {
                expect(revealed.body.neverHaveIEverVoting.result.namedAnswers).toEqual([
                    { playerId: shown.body.players[0].id, displayName: "Anna", vote: "YES" },
                    { playerId: shown.body.players[1].id, displayName: "Ben", vote: "NO" },
                    { playerId: shown.body.players[2].id, displayName: "Chris", vote: "YES" },
                ]);
            } else {
                expect(JSON.stringify(revealed.body)).not.toMatch(
                    /"(?:YES|NO)"|"(?:vote|votes|namedAnswers)"\s*:/,
                );
            }
            for (const [index, action] of ["advance", "end"].entries()) {
                const response = await request(app)
                    .post(`/api/v1/couch/sessions/${created.body.id}/${action}`)
                    .send({ revision: 4 + index })
                    .expect(200);
                expectHiddenVotingAnswers(response.body);
            }
        },
    );

    it("selects an active Card locale independently of Accept-Language", async () => {
        const created = await request(app)
            .post("/api/v1/couch/sessions")
            .set("accept-language", "de-DE")
            .send({
                mode: GAME_MODES.CLASSIC,
                players: [{ name: "Anna" }, { name: "Ben" }],
                cardLocale: "en-GB",
                ...canonicalSettings,
            })
            .expect(201);
        await request(app)
            .post(`/api/v1/couch/sessions/${created.body.id}/choose`)
            .send({ revision: 0, cardType: "QUESTION" })
            .expect(200)
            .expect(({ body }) =>
                expect(body.currentCard.cardText).toMatch(/greatest wish|friendships/i),
            );
    });

    it("rejects a Card locale not present in the runtime catalog", async () => {
        await request(app)
            .post("/api/v1/couch/sessions")
            .send({
                mode: GAME_MODES.CLASSIC,
                players: [{ name: "Anna" }, { name: "Ben" }],
                cardLocale: "es-ES",
                ...canonicalSettings,
            })
            .expect(400)
            .expect(({ body }) => expect(body.error.code).toBe("CARD_LOCALE_UNAVAILABLE"));
    });

    it("keeps unplayed Group Cards available and re-enables history after reset", async () => {
        const group = await request(app)
            .post("/api/v1/groups")
            .send({ name: "Couch history", members: ["Anna", "Ben"] })
            .expect(201);
        const payload = {
            persistence: "DATASPACE",
            mode: GAME_MODES.NEVER_HAVE_I_EVER,
            players: [{ name: "Anna" }, { name: "Ben" }],
            ...canonicalSettings,
            groupId: group.body.id,
        };
        const first = await request(app)
            .post("/api/v1/couch/sessions")
            .set("accept-language", "de-DE")
            .send(payload)
            .expect(201);
        const shown = await request(app)
            .post(`/api/v1/couch/sessions/${first.body.id}/start`)
            .send({ revision: 0 })
            .expect(200);
        await request(app)
            .post(`/api/v1/couch/sessions/${first.body.id}/end`)
            .send({ revision: shown.body.revision })
            .expect(200);
        const continued = await request(app)
            .post("/api/v1/couch/sessions")
            .set("accept-language", "de-DE")
            .send(payload)
            .expect(201);
        expect(continued.body.remainingCardCount).toBeGreaterThan(0);
        await request(app)
            .post(`/api/v1/groups/${group.body.id}/history-reset`)
            .send({ confirmed: true })
            .expect(200);
        const reset = await request(app)
            .post("/api/v1/couch/sessions")
            .set("accept-language", "de-DE")
            .send(payload)
            .expect(201);
        expect(reset.body.remainingCardCount).toBeGreaterThan(continued.body.remainingCardCount);
    });
});
