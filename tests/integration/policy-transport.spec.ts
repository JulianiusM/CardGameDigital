import { createHash } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
    getAppDataSource,
    initDataSource,
} from "../../apps/server/src/modules/database/dataSource";
import settings from "../../apps/server/src/modules/settings";
import { TypeOrmCardPolicyRepository } from "../../packages/persistence/TypeOrmCardPolicyRepository";
import { CardEntity } from "../../packages/persistence/entities/card/CardEntity";
import { LocaleEntity } from "../../packages/persistence/entities/card/LocaleEntity";
import { maximumRoomSettings } from "../support/transportCapacity";
import { probeKodiCapacity } from "../support/kodiCapacity";
import {
    MAX_HTTP_JSON_BYTES,
    MAX_POLICY_IMPORT_BYTES,
    MAX_PORTABLE_EXACT_CARDS,
} from "../../packages/protocol/limits";
import { capacityId, maximumDirectives, maximumPolicyRule } from "../support/transportCapacity";
import { translate } from "../../packages/localization/messages";
import { MESSAGE_KEYS } from "../../packages/localization/keys";

let app: import("express").Express;
beforeAll(async () => {
    Object.assign(process.env, {
        SETTINGS_FILE: "/dev/null",
        DEPLOYMENT_MODE: "local",
        AUTH_MODE: "none",
        DB_TYPE: "sqlite",
        DB_FILE: ":memory:",
        SESSION_SECRET: "policy_transport_test_secret_1234567890123456",
    });
    await settings.read("/dev/null");
    await initDataSource();
    app = (await import("../../apps/server/src/app")).default;
}, 120_000);
afterAll(async () => {
    if (getAppDataSource().isInitialized) await getAppDataSource().destroy();
});

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function portablePolicy(exactCount: number) {
    return {
        format: "party-game-card-policy/v2" as const,
        scopeDefault: maximumDirectives,
        rules: Array.from({ length: 250 }, (_, i) => {
            const { id: _id, order: _order, ...rule } = maximumPolicyRule(i + 1);
            return rule;
        }),
        exactCards: Array.from({ length: exactCount }, (_, i) => ({
            cardId: capacityId(i + 1),
            directives: maximumDirectives,
        })),
    };
}

describe("policy transport capacity", () => {
    it("saves and recovers maximum Couch settings through native HTTP", async () => {
        const input = maximumRoomSettings();
        const playable = await getAppDataSource()
            .getRepository(CardEntity)
            .findOneByOrFail({ active: true, cardType: "QUESTION" });
        // Keep one Card playable while filling the rest of the policy to its limits.
        input.configuration.blockedOperationalFlags = [];
        input.cardPolicy.exactCards[0] = {
            cardId: playable.id,
            directives: {
                availability: "INCLUDE",
                alwaysEligible: "ENABLE",
                repeatableInSession: "ENABLE",
                repeatCooldown: { mode: "SET", value: 0 },
                intensity: { mode: "SET", value: 1 },
                weight: { mode: "SET", value: 1 },
                socialSensitivity: { mode: "SET", value: "GENERAL" },
                playerCount: { mode: "SET", value: { minimum: 2, maximum: null } },
            },
        };
        await getAppDataSource()
            .getRepository(LocaleEntity)
            .insert(
                input.cardFallbackLocales.map((id) => ({
                    id,
                    displayName: id,
                    active: true,
                    isDefault: false,
                })),
            );
        const server = app.listen(0, "127.0.0.1");
        await new Promise<void>((resolve) => server.once("listening", resolve));
        try {
            const port = (server.address() as { port: number }).port;
            const observed = await probeKodiCapacity({
                origin: `http://127.0.0.1:${port}`,
                couch: {
                    ...input,
                    mode: "RANDOM_TRUTH_OR_DARE",
                    players: Array.from({ length: 20 }, () => ({ name: "界".repeat(40) })),
                },
            });
            expect(observed).toMatchObject({ players: 20, rules: 250, exactCards: 1000 });
            expect(observed.bytes).toBeGreaterThan(65536);
            expect(observed.bytes).toBeLessThan(MAX_HTTP_JSON_BYTES);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    }, 30_000);

    it("round-trips a 1,500-Card export with maximum Unicode rules through Express and SQLite", async () => {
        const policy = portablePolicy(1500);
        const repository = getAppDataSource().getRepository(CardEntity);
        for (let offset = 0; offset < policy.exactCards.length; offset += 50) {
            await repository.insert(
                policy.exactCards
                    .slice(offset, offset + 50)
                    .map(({ cardId }) => ({ id: cardId, cardType: "QUESTION" })),
            );
        }
        const before = await request(app).get("/api/v1/card-policy/scope").expect(200);
        const body = { policy, expectedScopeRevision: before.body.scopeRevision };
        expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(102400);
        await request(app).post("/api/v1/card-policy/import").send(body).expect(204);
        const exported = await request(app).get("/api/v1/card-policy/export").expect(200);
        expect(digest(exported.body)).toBe(digest(policy));
        const current = await request(app).get("/api/v1/card-policy/scope").expect(200);
        await request(app)
            .post("/api/v1/card-policy/import/")
            .send({ policy: exported.body, expectedScopeRevision: current.body.scopeRevision })
            .expect(204);
        const again = await request(app).get("/api/v1/card-policy/export").expect(200);
        expect(digest(again.body)).toBe(digest(policy));
        await request(app).post("/api/v1/card-policy/import").send(body).expect(409);
    }, 30_000);

    it("carries all 50,000 mixed overrides through the real export/import HTTP adapters", async () => {
        // Isolate transport scale from catalog/storage scale: the preceding test uses
        // the actual repository. No 50,000-Card catalog or test database is generated.
        const policy = portablePolicy(MAX_PORTABLE_EXACT_CARDS);
        const load = vi
            .spyOn(TypeOrmCardPolicyRepository.prototype, "load")
            .mockImplementation(async (owner) => ({
                owner,
                revision: 0,
                scopeDefault: { directives: policy.scopeDefault, revision: 0 },
                rules: policy.rules.map((rule, index) => ({
                    ...rule,
                    id: capacityId(index + 1),
                    order: index,
                    revision: 0,
                })),
                exactCards: policy.exactCards.map((entry) => ({ ...entry, revision: 0 })),
            }));
        const replace = vi
            .spyOn(TypeOrmCardPolicyRepository.prototype, "replaceScope")
            .mockResolvedValue();
        try {
            const exported = await request(app).get("/api/v1/card-policy/export").expect(200);
            const bytes = Buffer.byteLength(exported.text);
            expect(bytes).toBeGreaterThan(MAX_HTTP_JSON_BYTES);
            expect(bytes + 1024).toBeLessThan(MAX_POLICY_IMPORT_BYTES);
            expect(digest(exported.body)).toBe(digest(policy));
            for (const pathname of ["/api/v1/card-policy/import", "/API/v1/card-policy/IMPORT/"]) {
                await request(app)
                    .post(pathname)
                    .send({ policy: exported.body, expectedScopeRevision: 7 })
                    .expect(204);
            }
            expect(replace).toHaveBeenCalledTimes(2);
            const { format: _format, ...input } = policy;
            expect(digest(replace.mock.calls[1][1])).toBe(digest(input));
            expect(replace.mock.calls[1][2]).toBe(7);
        } finally {
            load.mockRestore();
            replace.mockRestore();
        }
    }, 30_000);

    it.each(["en", "de"] as const)(
        "rejects oversized JSON and unsupported policies with actionable %s errors",
        async (locale) => {
            const oversized = await request(app)
                .post("/api/v1/rooms")
                .set("Accept-Language", locale)
                .set("Content-Type", "application/json")
                .send('"' + "界".repeat(Math.floor(MAX_HTTP_JSON_BYTES / 3) + 1) + '"')
                .expect(413);
            expect(oversized.body.error).toMatchObject({
                code: "PAYLOAD_TOO_LARGE",
                message: translate(locale, MESSAGE_KEYS.REQUEST_TOO_LARGE),
                data: { maximumBytes: MAX_HTTP_JSON_BYTES },
            });
            const invalid = await request(app)
                .post("/api/v1/card-policy/import")
                .set("Accept-Language", locale)
                .send({
                    policy: {
                        ...portablePolicy(0),
                        rules: Array.from({ length: 251 }, () => ({})),
                    },
                    expectedScopeRevision: 0,
                })
                .expect(400);
            expect(invalid.body.error).toMatchObject({
                code: "VALIDATION_ERROR",
                message: translate(locale, MESSAGE_KEYS.CARD_POLICY_INVALID_IMPORT),
            });
            const malformed = await request(app)
                .post("/api/v1/card-policy/import")
                .set("Content-Type", "application/json")
                .send("{")
                .expect(400);
            expect(malformed.body.error.code).toBe("VALIDATION_ERROR");
        },
    );
});
