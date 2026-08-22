import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyCardCatalog } from "../../src/packages/application/applyCardCatalog";
import { GAME_MODES } from "../../src/packages/game-core";
import { AppDataSource, initDataSource } from "../../src/modules/database/dataSource";
import settings from "../../src/modules/settings";
import { normalizeCards } from "../../src/tooling/card-import/normalize";

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
    const common = {
        Origin: "test",
        Intensity: 1,
        AlwaysEligible: false,
        RepeatableInSession: true,
        RepeatCooldown: 0,
        Weight: 1,
        Active: true,
        OperationalFlags: [],
    };
    await applyCardCatalog(
        AppDataSource,
        normalizeCards(
            [
                {
                    ...common,
                    ID: 1,
                    CardText: "Question",
                    Type: "Fragen",
                    YesNoAnswerPossible: true,
                    Category: "Alltag",
                },
                {
                    ...common,
                    ID: 2,
                    CardText: "Dare",
                    Type: "Pflicht",
                    YesNoAnswerPossible: false,
                    Category: "Alltag",
                    DareType: "Blödsinn",
                },
                {
                    ...common,
                    ID: 3,
                    CardText: "Meta",
                    Type: "Gespräch",
                    YesNoAnswerPossible: false,
                },
            ],
            "api-test",
            "v1",
        ),
    );
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
                    maximumIntensity: 3,
                    randomQuestionRatio: 0.6,
                    letsTalkMetaInterval: 2,
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
            .send({ mode: "INVALID", players: [] })
            .expect(400)
            .expect(({ body }) => expect(body.error.code).toBe("VALIDATION_ERROR"));
        const created = await request(app)
            .post("/api/v1/couch/sessions")
            .send({
                mode: GAME_MODES.CLASSIC,
                players: [{ name: "Anna" }],
                maximumIntensity: 3,
                randomQuestionRatio: 0.6,
                letsTalkMetaInterval: 2,
            });
        await request(app)
            .post(`/api/v1/couch/sessions/${created.body.id}/choose`)
            .send({ revision: 1, cardType: "QUESTION" })
            .expect(409)
            .expect(({ body }) => expect(body.error.code).toBe("STALE_SESSION_REVISION"));
    });
});
