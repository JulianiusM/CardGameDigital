import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    getAppDataSource,
    initDataSource,
} from "../../apps/server/src/modules/database/dataSource";
import settings from "../../apps/server/src/modules/settings";
import { GroupEntity } from "../../packages/persistence/entities/game/GroupEntity";
import { DataSpace } from "../../packages/persistence/entities/user/DataSpace";
import { User } from "../../packages/persistence/entities/user/User";
import {
    registerUser,
    getDataSpacesForUser,
} from "../../apps/server/src/modules/database/services/UserService";
import { MESSAGE_KEYS, translate } from "../../packages/localization/messages";

let app: import("express").Express;
beforeAll(async () => {
    Object.assign(process.env, {
        SETTINGS_FILE: "/dev/null",
        DEPLOYMENT_MODE: "local",
        AUTH_MODE: "none",
        DB_TYPE: "sqlite",
        DB_FILE: ":memory:",
        SESSION_SECRET: "policy_errors_test_secret_1234567890123456",
    });
    await settings.read("/dev/null");
    await initDataSource();
    app = (await import("../../apps/server/src/app")).default;
}, 240_000);
afterAll(async () => {
    if (getAppDataSource().isInitialized) await getAppDataSource().destroy();
});

describe.each(["en", "de"] as const)("actionable policy errors in %s", (locale) => {
    it("retains transactional 409 conflicts for stale and removed rules with specific messages", async () => {
        const group = await request(app)
            .post("/api/v1/groups")
            .send({ name: `Recovery ${locale}` })
            .expect(201);
        const query = `?groupId=${group.body.id}`;
        const root = "/api/v1/card-policy";
        const input = { name: "Original", enabled: false, predicate: {}, directives: {} };
        const created = await request(app).post(`${root}/rules${query}`).send(input).expect(201);
        const rule = created.body.rule;
        const stale = { ...input, name: "Unsaved edit", expectedRevision: rule.revision };
        const updated = await request(app)
            .put(`${root}/rules/${rule.id}${query}`)
            .send({ ...input, name: "Changed elsewhere", expectedRevision: rule.revision })
            .expect(200);
        const before = await request(app).get(`${root}/scope${query}`).expect(200);
        const conflict = await request(app)
            .put(`${root}/rules/${rule.id}${query}`)
            .set("Accept-Language", locale)
            .send(stale)
            .expect(409);
        expect(conflict.body.error).toMatchObject({
            code: "POLICY_REVISION_CONFLICT",
            message: translate(locale, MESSAGE_KEYS.CARD_POLICY_REVISION_CONFLICT),
        });
        const order = await request(app)
            .post(`${root}/rules/reorder${query}`)
            .set("Accept-Language", locale)
            .send({ orderedIds: [], expectedScopeRevision: before.body.scopeRevision })
            .expect(400);
        expect(order.body.error).toMatchObject({
            code: "VALIDATION_ERROR",
            message: translate(locale, MESSAGE_KEYS.CARD_POLICY_INVALID_RULE_ORDER),
        });
        const matches = await request(app)
            .get(`${root}/cards${query}&locale=de-DE&limit=1`)
            .expect(200);
        const changedResults = await request(app)
            .post(`${root}/cards/bulk${query}`)
            .set("Accept-Language", locale)
            .send({
                filters: { locale: "de-DE" },
                directives: { availability: "EXCLUDE" },
                confirmedCount: matches.body.total + 1,
                expectedScopeRevision: before.body.scopeRevision,
            })
            .expect(409);
        expect(changedResults.body.error).toMatchObject({
            code: "POLICY_RESULT_SET_CHANGED",
            message: translate(locale, MESSAGE_KEYS.CARD_POLICY_RESULT_SET_CHANGED),
        });
        expect((await request(app).get(`${root}/scope${query}`)).body).toEqual(before.body);
        await request(app)
            .delete(
                `${root}/rules/${rule.id}${query}&expectedRevision=${updated.body.rule.revision}`,
            )
            .expect(204);
        const afterDelete = (await request(app).get(`${root}/scope${query}`)).body;
        const missingUpdate = await request(app)
            .put(`${root}/rules/${rule.id}${query}`)
            .set("Accept-Language", locale)
            .send(stale)
            .expect(409);
        const missingDelete = await request(app)
            .delete(`${root}/rules/${rule.id}${query}&expectedRevision=${rule.revision}`)
            .set("Accept-Language", locale)
            .expect(409);
        for (const response of [missingUpdate, missingDelete]) {
            expect(response.body.error).toMatchObject({
                code: "POLICY_REVISION_CONFLICT",
                message: translate(locale, MESSAGE_KEYS.CARD_POLICY_RULE_NOT_FOUND),
            });
        }
        expect((await request(app).get(`${root}/scope${query}`)).body).toEqual(afterDelete);
    });

    it("does not distinguish missing Groups from Groups in another DataSpace", async () => {
        const dataSource = getAppDataSource();
        const localSpace = await dataSource.getRepository(DataSpace).findOneByOrFail({});
        const group = await dataSource.getRepository(GroupEntity).save({
            id: randomUUID(),
            dataSpaceId: localSpace.id,
            name: "Private Group",
            membersJson: "[]",
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const username = `policy.reader.${locale}`;
        const password = "policy-reader-test-password";
        const userId = await registerUser(
            username,
            "Policy reader",
            password,
            `${username}@example.test`,
        );
        const spaces = await getDataSpacesForUser(userId);
        await dataSource.getRepository(User).update(userId, { isActive: true });
        const originalMode = settings.value.deploymentMode;
        const originalAuth = settings.value.authMode;
        try {
            settings.value.deploymentMode = "public";
            settings.value.authMode = "account";
            const reader = request.agent(app);
            await reader
                .post("/api/v1/account/login")
                .set("Origin", settings.value.publicUrl)
                .send({ username, password })
                .expect(200);
            const missing = await reader
                .get(`/api/v1/card-policy/scope?groupId=${randomUUID()}`)
                .set("Accept-Language", locale)
                .expect(404);
            const foreign = await reader
                .get(`/api/v1/card-policy/scope?groupId=${group.id}`)
                .set("Accept-Language", locale)
                .expect(404);
            expect(missing.body).toEqual(foreign.body);
            expect(foreign.body.error).toMatchObject({
                code: "GROUP_NOT_FOUND",
                message: translate(locale, MESSAGE_KEYS.GROUP_NOT_FOUND),
            });
            expect(JSON.stringify(foreign.body)).not.toContain(group.name);
        } finally {
            settings.value.deploymentMode = originalMode;
            settings.value.authMode = originalAuth;
            await dataSource.getRepository(GroupEntity).delete(group.id);
            await dataSource.getRepository(DataSpace).delete(spaces.map(({ id }) => id));
            await dataSource.getRepository(User).delete(userId);
        }
    });
});
