import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GAME_MODES } from "../../src/packages/game-core";
import { AppDataSource, initDataSource } from "../../src/modules/database/dataSource";
import settings from "../../src/modules/settings";
import { CouchGameSessionEntity } from "../../src/modules/database/entities/game/CouchGameSessionEntity";
import { CouchCardAppearanceEntity } from "../../src/modules/database/entities/game/CouchCardAppearanceEntity";
import { effectiveSettingsFromProfile } from "../../src/packages/application/roomGameSettings";

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
    app = (await import("../../src/app")).default;
});
afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("Couch HTTP application adapter", () => {
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
        }
    });

    it("validates payloads and rejects stale commands with stable errors", async () => {
        await request(app)
            .post("/api/v1/couch/sessions")
            .set("accept-language", "de-DE")
            .send({ mode: "INVALID", players: [] })
            .expect(400)
            .expect(({ body }) => expect(body.error.code).toBe("VALIDATION_ERROR"));
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
            AppDataSource.getRepository(CouchGameSessionEntity).findOneByOrFail({
                id: created.body.id,
            }),
        ).resolves.toMatchObject({ endedAt: expect.any(Date), revision: 3 });
        const appearances = await AppDataSource.getRepository(CouchCardAppearanceEntity).findBy({
            sessionId: created.body.id,
        });
        expect(appearances).toHaveLength(1);
        expect(appearances[0]).toMatchObject({
            skipped: false,
            completed: true,
            vetoed: false,
        });
    });

    it("applies named reveal without leaking Couch answers during collection", async () => {
        const created = await request(app)
            .post("/api/v1/couch/sessions")
            .send({
                mode: GAME_MODES.NEVER_HAVE_I_EVER,
                players: [{ name: "Anna" }, { name: "Ben" }],
                neverHaveIEverRevealMode: "NAMED_ANSWERS",
                ...canonicalSettings,
            })
            .expect(201);
        const shown = await request(app)
            .post(`/api/v1/couch/sessions/${created.body.id}/start`)
            .send({ revision: 0 })
            .expect(200);
        const firstVote = await request(app)
            .post(`/api/v1/couch/sessions/${created.body.id}/vote`)
            .send({ revision: 1, playerId: shown.body.players[0].id, vote: "YES" })
            .expect(200);
        expect(firstVote.body.neverHaveIEverVoting.result).toBeNull();
        expect(JSON.stringify(firstVote.body.neverHaveIEverVoting)).not.toContain('"YES"');

        await request(app)
            .post(`/api/v1/couch/sessions/${created.body.id}/vote`)
            .send({ revision: 2, playerId: shown.body.players[1].id, vote: "NO" })
            .expect(200)
            .expect(({ body }) =>
                expect(body.neverHaveIEverVoting.result.namedAnswers).toEqual([
                    { playerId: shown.body.players[0].id, displayName: "Anna", vote: "YES" },
                    { playerId: shown.body.players[1].id, displayName: "Ben", vote: "NO" },
                ]),
            );
    });

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
            .expect(({ body }) => expect(body.currentCard.cardText).toMatch(/laugh|night/i));
    });

    it("rejects a Card locale not present in the runtime catalog", async () => {
        await request(app)
            .post("/api/v1/couch/sessions")
            .send({
                mode: GAME_MODES.CLASSIC,
                players: [{ name: "Anna" }, { name: "Ben" }],
                cardLocale: "fr-FR",
                ...canonicalSettings,
            })
            .expect(400)
            .expect(({ body }) => expect(body.error.code).toBe("CARD_LOCALE_UNAVAILABLE"));
    });

    it("applies persistent Group history and re-enables it only after reset", async () => {
        const group = await request(app)
            .post("/api/v1/groups")
            .send({ name: "Couch history", members: ["Anna", "Ben"] })
            .expect(201);
        const payload = {
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
        await request(app)
            .post("/api/v1/couch/sessions")
            .set("accept-language", "de-DE")
            .send(payload)
            .expect(409)
            .expect(({ body }) => expect(body.error.code).toBe("CARD_POOL_EXHAUSTED"));
        await request(app)
            .post(`/api/v1/groups/${group.body.id}/history-reset`)
            .send({ confirmed: true })
            .expect(200);
        await request(app)
            .post("/api/v1/couch/sessions")
            .set("accept-language", "de-DE")
            .send(payload)
            .expect(201);
    });
});
