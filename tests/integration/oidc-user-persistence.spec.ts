import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
    getAppDataSource,
    initDataSource,
} from "../../apps/server/src/modules/database/dataSource";
import { DataSpace } from "../../packages/persistence/entities/user/DataSpace";
import { findOrCreateUserFromOidc } from "../../apps/server/src/modules/database/services/UserService";
import settings from "../../apps/server/src/modules/settings";
import { User } from "../../packages/persistence/entities/user/User";
import { callback } from "../../apps/server/src/modules/oidc";

const provider = vi.hoisted(() => ({ grant: vi.fn(), userInfo: vi.fn() }));
vi.mock("openid-client", () => ({
    discovery: async () => ({ serverMetadata: () => ({ issuer: "https://identity.example" }) }),
    authorizationCodeGrant: provider.grant,
    fetchUserInfo: provider.userInfo,
}));
vi.mock("../../apps/server/src/modules/database/services/AccountSessionService", () => ({
    bindAccountSession: vi.fn(),
}));

let directory: string;

beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "oidc-user-"));
    Object.assign(process.env, {
        SETTINGS_FILE: "/dev/null",
        DEPLOYMENT_MODE: "local",
        AUTH_MODE: "account",
        DB_TYPE: "sqlite",
        DB_FILE: path.join(directory, "oidc.sqlite"),
        SESSION_SECRET: "oidc_user_persistence_test_secret",
        OIDC_ISSUER: "https://identity.example",
    });
    await settings.read("/dev/null");
    await initDataSource();
});

afterAll(async () => {
    if (getAppDataSource().isInitialized) await getAppDataSource().destroy();
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("OIDC user persistence", () => {
    async function login(token: Record<string, unknown>, userInfo?: Record<string, unknown>) {
        provider.grant.mockResolvedValue({ claims: () => token, access_token: "provider-token" });
        if (userInfo) provider.userInfo.mockResolvedValue(userInfo);
        else provider.userInfo.mockRejectedValue(new Error("UserInfo unavailable"));
        const req = {
            originalUrl: "/api/v1/account/oidc/callback?code=code&state=state",
            sessionID: randomUUID(),
            session: {
                oidc: { code_verifier: "verifier", state: "state", returnTo: "/play/" },
                regenerate(done: () => void) {
                    done();
                },
                save(done: () => void) {
                    done();
                },
            },
        } as unknown as Request;
        await expect(callback(req)).resolves.toBe("/play/");
        expect(req.session.oidc).toBeUndefined();
        return getAppDataSource()
            .getRepository(User)
            .findOneByOrFail({ id: req.session.account!.userId });
    }

    it.each([
        {
            title: "equal email, omitted verification",
            changed: false,
            verified: undefined,
            linked: true,
        },
        {
            title: "equal email, false verification",
            changed: false,
            verified: false,
            linked: false,
        },
        {
            title: "changed email, omitted verification",
            changed: true,
            verified: undefined,
            linked: false,
        },
        {
            title: "changed email, false verification",
            changed: true,
            verified: false,
            linked: false,
        },
        {
            title: "changed email, explicit verification",
            changed: true,
            verified: true,
            linked: true,
        },
    ])(
        "binds callback verification to the selected address: $title",
        async ({ changed, verified, linked }) => {
            const sub = randomUUID();
            const email = `${sub}@example.test`;
            const users = getAppDataSource().getRepository(User);
            const local = await users.save(
                users.create({ username: sub, name: "Local", email, isActive: false }),
            );
            const authenticated = await login(
                { sub, email: changed ? "different@example.test" : email, email_verified: true },
                { sub, email, ...(verified === undefined ? {} : { email_verified: verified }) },
            );
            if (linked) {
                expect(authenticated.id).toBe(local.id);
                expect(authenticated.isActive).toBe(true);
            } else {
                expect(authenticated.id).not.toBe(local.id);
                expect(authenticated.email).toMatch(/^[a-f0-9]{64}@no-email\.invalid$/);
                expect(await users.findOneByOrFail({ id: local.id })).toMatchObject({
                    isActive: false,
                    oidcSub: null,
                    oidcIssuer: null,
                });
            }
        },
    );

    it("uses verified ID-token email when UserInfo is unavailable", async () => {
        const sub = randomUUID();
        const email = `${sub}@example.test`;
        const user = await login({ sub, email, email_verified: true });
        expect(user.email).toBe(email);
    });

    it("does not apply a UserInfo verification flag without its own email", async () => {
        const sub = randomUUID();
        const user = await login(
            { sub, email: `${sub}@example.test`, email_verified: false },
            { sub, email_verified: true },
        );
        expect(user.email).toMatch(/@no-email\.invalid$/);
    });

    it.each(["https://identity.example", "https://another-identity.example"])(
        "preserves an existing link from %s when a different identity claims its email",
        async (issuer) => {
            const email = `${randomUUID()}@example.test`;
            const existing = await findOrCreateUserFromOidc(issuer, {
                sub: randomUUID(),
                email,
                email_verified: true,
            });
            const user = await login({ sub: randomUUID(), email, email_verified: true });
            expect(user.id).not.toBe(existing.id);
            expect(user.email).toMatch(/@no-email\.invalid$/);
            expect(
                await getAppDataSource().getRepository(User).findOneByOrFail({ id: existing.id }),
            ).toMatchObject({ oidcSub: existing.oidcSub, oidcIssuer: issuer, email });
        },
    );

    it("keeps the issuer/subject account when its provider email changes", async () => {
        const sub = randomUUID();
        const first = await login({
            sub,
            email: `${randomUUID()}@example.test`,
            email_verified: true,
        });
        const next = await login({
            sub,
            email: `${randomUUID()}@example.test`,
            email_verified: true,
        });
        expect(next.id).toBe(first.id);
        expect(next.email).toBe(first.email);
    });

    it("creates one owned DataSpace and reuses the issuer/subject identity", async () => {
        const claims = {
            sub: "provider-subject/with:characters",
            preferred_username: "new-user",
            name: "New User",
            email: "unverified@example.test",
            email_verified: false,
        };
        const created = await findOrCreateUserFromOidc("https://identity.example", claims);
        const repeated = await findOrCreateUserFromOidc("https://identity.example", claims);

        expect(repeated.id).toBe(created.id);
        expect(created.email).toMatch(/^[a-f0-9]{64}@no-email\.invalid$/);
        const spaces = await getAppDataSource()
            .getRepository(DataSpace)
            .findBy({
                user: { id: created.id },
            });
        expect(spaces).toHaveLength(1);
        expect(spaces[0]).toMatchObject({ name: "New User", defaultForOwner: true });
    });
});
