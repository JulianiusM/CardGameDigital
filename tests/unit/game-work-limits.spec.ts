import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import settings from "../../apps/server/src/modules/settings";
import {
    createGameWorkLimiter,
    withPolicyWorkCapacity,
} from "../../apps/server/src/modules/gameWorkLimits";
import { FixedWindowRateLimiter } from "../../apps/server/src/modules/fixedWindowRateLimiter";
import { createHttpWorkCapacity } from "../../apps/server/src/modules/httpWorkCapacity";
import { asyncHandler } from "../../apps/server/src/modules/lib/asyncHandler";

const previous = { ...settings.value };
afterEach(() => Object.assign(settings.value, previous));

function application() {
    Object.assign(settings.value, {
        deploymentMode: "public",
        publicRuntimeSecurity: "enforced",
        testMode: false,
        logLevel: "silent",
    });
    const app = express();
    app.use((req, _res, next) => {
        req.session = {
            account: req.get("x-test-account")
                ? { userId: Number(req.get("x-test-account")), dataSpaceId: null }
                : undefined,
        } as typeof req.session;
        next();
    });
    app.use(createGameWorkLimiter());
    app.use((_req, res) => res.status(204).end());
    return app;
}

describe("game work admission", () => {
    it("reserves JSON work before parsing and keeps its slot after disconnect until work settles", async () => {
        Object.assign(settings.value, {
            logLevel: "silent",
            gameHttpConcurrentRequests: 2,
            gameHttpTerminalRequests: 1,
            gameWorkRetryAfterSeconds: 3,
        });
        const app = express();
        app.use(createHttpWorkCapacity());
        let release!: () => void;
        let entered = 0;
        let ready!: () => void;
        const blocked = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started = new Promise<void>((resolve) => {
            ready = resolve;
        });
        app.use(express.json());
        app.post("/api/v1/couch/sessions/game/end", (_req, res) => res.status(204).end());
        app.use(
            asyncHandler(async (_req, res) => {
                if (++entered === 2) ready();
                await blocked;
                res.status(204).end();
            }),
        );
        app.use(
            (
                error: { status: number; code: string },
                _req: express.Request,
                res: express.Response,
                _next: express.NextFunction,
            ) => res.status(error.status).json({ code: error.code }),
        );
        const first = request(app).post("/api/v1/card-policy/session/cards").send({});
        const second = request(app).post("/api/v1/card-policy/session/cards").send({});
        const firstResult = first.then(
            () => undefined,
            () => undefined,
        );
        const secondResult = second.then(() => undefined);
        try {
            await started;
            first.abort();
            await firstResult;
            const denied = await request(app)
                .post("/API/V1/CARD-POLICY/session/cards/")
                .set("Content-Type", "application/json")
                .send("invalid JSON")
                .expect(429);
            expect(denied.body.code).toBe("SESSION_CAPACITY_EXCEEDED");
            expect(denied.headers["retry-after"]).toBe("3");
            expect(entered).toBe(2);
            await request(app)
                .post("/api/v1/couch/sessions/game/end")
                .send({ revision: 0 })
                .expect(204);
        } finally {
            release();
            await Promise.all([firstResult, secondResult]);
        }
        await request(app).post("/api/v1/card-policy/session/cards").send({}).expect(204);
    });
    it("bounds anonymous and authenticated policy requests with localized retry guidance", async () => {
        const app = application();
        for (let i = 0; i < 60; i++)
            await request(app).post("/api/v1/card-policy/session/cards").expect(204);
        const denied = await request(app)
            .post("/api/v1/card-policy/session/eligibility-preview")
            .set("Accept-Language", "de-DE")
            .expect(429);
        expect(denied.body.error.code).toBe("RATE_LIMITED");
        expect(denied.headers["retry-after"]).toBe("60");
        for (let i = 0; i < 60; i++)
            await request(app)
                .post("/api/v1/card-policy/session/cards")
                .set("x-test-account", "7")
                .expect(204);
        const accountDenied = await request(app)
            .post("/api/v1/card-policy/session/cards")
            .set("x-test-account", "7")
            .set("Accept-Language", "en-GB")
            .expect(429);
        expect(accountDenied.body.error.message).not.toBe(denied.body.error.message);
    });

    it("limits repeated creation while preserving other games and terminal Couch actions on one LAN", async () => {
        const app = application();
        for (let i = 0; i < 60; i++) await request(app).post("/api/v1/couch/sessions").expect(204);
        await request(app).post("/api/v1/couch/sessions").expect(429);
        for (let i = 0; i < 120; i++)
            await request(app).get("/api/v1/couch/sessions/game-a").expect(204);
        await request(app).post("/api/v1/couch/sessions/game-a/advance").expect(429);
        await request(app).post("/api/v1/couch/sessions/game-b/advance").expect(204);
        await request(app).post("/api/v1/couch/sessions/game-a/end").expect(204);
    });

    it("rejects work before it starts and holds slots until the operation settles", async () => {
        Object.assign(settings.value, { policyConcurrentWork: 3 });
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => {
            release = resolve;
        });
        const first = withPolicyWorkCapacity(() => blocked);
        const second = withPolicyWorkCapacity(() => blocked);
        const third = withPolicyWorkCapacity(() => blocked);
        let started = false;
        await expect(
            withPolicyWorkCapacity(async () => {
                started = true;
            }),
        ).rejects.toMatchObject({ code: "SESSION_CAPACITY_EXCEEDED", status: 429 });
        expect(started).toBe(false);
        release();
        await Promise.all([first, second, third]);
        await expect(withPolicyWorkCapacity(async () => "ready")).resolves.toBe("ready");
    });

    it("bounds limiter identities without evicting live limits", () => {
        settings.value.rateLimiterMaximumKeys = 2;
        const limiter = new FixedWindowRateLimiter(1000, 1);
        expect(limiter.consume("a", 0)).toBe(true);
        expect(limiter.consume("b", 0)).toBe(true);
        expect(limiter.consume("c", 1)).toBe(false);
        expect(limiter.consume("a", 1)).toBe(false);
        expect(limiter.consume("c", 1000)).toBe(true);
    });

    it("uses configured public rates and retry windows without coupling unrelated games", async () => {
        Object.assign(settings.value, {
            gameCreationRatePerPrincipal: 1,
            gameCreationRateWindowMs: 7_000,
            policyRatePerPrincipal: 1,
            policyRateWindowMs: 9_000,
            couchRatePerGame: 1,
            couchRateWindowMs: 11_000,
        });
        const app = application();
        for (const [url, retry] of [
            ["/api/v1/couch/sessions", "7"],
            ["/api/v1/card-policy/session/cards", "9"],
            ["/api/v1/couch/sessions/configured/advance", "11"],
        ]) {
            await request(app).post(url).expect(204);
            const rejected = await request(app).post(url).expect(429);
            expect(rejected.headers["retry-after"]).toBe(retry);
        }
        await request(app).post("/api/v1/couch/sessions/independent/advance").expect(204);
        await request(app).post("/api/v1/couch/sessions/configured/end").expect(204);
    });
});
