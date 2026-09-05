import { MESSAGE_KEYS } from "../../../../../packages/localization/keys";
import express from "express";
import { z } from "zod";
import * as account from "../../application/accountService";
import settings from "../../modules/settings";
import { ExpectedError } from "../../modules/lib/errors";
import { detectLocale } from "../../../../../packages/localization/messages";
import type {
    AccountConfiguration,
    AccountSessionsResponse,
    AccountStatus,
} from "../../../../../packages/protocol";

const router = express.Router();
const username = z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/)
    .transform((value) => value.toLowerCase());
const credentials = z.object({
    username,
    password: z.string().min(8).max(200),
});
const registration = credentials.extend({
    displayName: z.string().trim().min(1).max(50),
    email: z
        .string()
        .trim()
        .pipe(z.email().max(100))
        .transform((value) => value.toLowerCase()),
});
const dataSpaceInput = z.object({
    name: z.string().trim().min(1).max(50),
    isDefault: z.boolean().optional(),
});
const languageTag = z
    .string()
    .trim()
    .min(2)
    .max(35)
    .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/);
const languagePreferencesInput = z
    .object({
        useSystemLanguage: z.boolean().optional(),
        interfaceLocale: languageTag.nullable().optional(),
        cardLocale: languageTag.nullable().optional(),
        fallbackLocales: z.array(languageTag).max(100).optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, "At least one preference is required")
    .refine(
        ({ fallbackLocales }) =>
            !fallbackLocales ||
            new Set(fallbackLocales.map((entry) => entry.toLowerCase())).size ===
                fallbackLocales.length,
        { message: "Fallback locales must be unique", path: ["fallbackLocales"] },
    );

function localLoginRequired(): void {
    if (settings.value.authMode !== "account") {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_LOCAL_DISABLED, "error", 404);
    }
}

router.get("/configuration", (_request, response) => {
    const configuration: AccountConfiguration = {
        localLoginEnabled: settings.value.authMode === "account",
        oidcEnabled: settings.value.oidcEnabled,
        oidcName: settings.value.oidcName,
        imprintUrl: settings.value.imprintUrl,
        privacyPolicyUrl: settings.value.privacyPolicyUrl,
    };
    response.json(configuration);
});

router.get("/status", async (request, response) => {
    const configuration = {
        authenticationAvailable: settings.value.authMode === "account",
        localLoginEnabled: settings.value.authMode === "account",
        oidcEnabled: settings.value.oidcEnabled,
        oidcName: settings.value.oidcName,
        imprintUrl: settings.value.imprintUrl,
        privacyPolicyUrl: settings.value.privacyPolicyUrl,
        deploymentMode: settings.value.deploymentMode,
    };
    const status: AccountStatus = {
        ...configuration,
        authenticated: Boolean(request.session.account),
        account: request.session.account ? await account.accountSnapshot(request.session) : null,
    };
    response.json(status);
});

router.post("/register", async (request, response) => {
    localLoginRequired();
    await account.register(
        detectLocale(request.get("accept-language")),
        registration.parse(request.body),
    );
    response.status(201).json({ ok: true });
});

router.post("/login", async (request, response) => {
    localLoginRequired();
    const input = credentials.parse(request.body);
    await account.login(input.username, input.password, request);
    response.json(await account.accountSnapshot(request.session));
});

router.post("/logout", async (request, response) => {
    await account.logout(request.session);
    response.status(204).end();
});

router.post("/activate", async (request, response) => {
    localLoginRequired();
    const { token } = z.object({ token: z.string().min(32) }).parse(request.body);
    await account.activate(token);
    response.json({ ok: true });
});

router.post("/password-reset-requests", async (request, response) => {
    localLoginRequired();
    const { identifier } = z.object({ identifier: z.string().trim().min(1) }).parse(request.body);
    await account.requestPasswordReset(detectLocale(request.get("accept-language")), identifier);
    response.status(202).json({ ok: true });
});

router.post("/activation-requests", async (request, response) => {
    localLoginRequired();
    const { identifier } = z.object({ identifier: z.string().trim().min(1) }).parse(request.body);
    await account.requestActivation(detectLocale(request.get("accept-language")), identifier);
    response.status(202).json({ ok: true });
});

router.post("/password-resets", async (request, response) => {
    localLoginRequired();
    const input = z
        .object({ token: z.string().min(32), password: z.string().min(8).max(200) })
        .parse(request.body);
    const resetUserId = await account.resetPassword(input.token, input.password);
    if (request.session.account?.userId === resetUserId) await account.logout(request.session);
    response.json({ ok: true });
});

router.get("/oidc/login", async (request, response) => {
    if (!settings.value.oidcEnabled)
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_OIDC_DISABLED, "error", 404);
    const returnTo = safeReturnTo(z.string().optional().parse(request.query.returnTo));
    response.redirect(await account.oidcLogin(request.session, returnTo));
});

router.get("/oidc/callback", async (request, response) => {
    if (!settings.value.oidcEnabled)
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_OIDC_DISABLED, "error", 404);
    response.redirect(await account.oidcCallback(request));
});

router.use((request, _response, next) => {
    account.requireAccountIdentity(request.session);
    next();
});

router.get("/me", async (request, response) => {
    response.json(await account.accountSnapshot(request.session));
});

router.put("/language-preferences", async (request, response) => {
    const input = languagePreferencesInput.parse(request.body);
    response.json(await account.updateLanguagePreferences(request.session, input));
});

router.post("/data-spaces", async (request, response) => {
    const input = dataSpaceInput.parse(request.body);
    response.status(201).json(await account.createDataSpace(request.session, input.name));
});

router.delete("/data-spaces/:id", async (request, response) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    response.json(await account.deleteDataSpace(request.session, id));
});

router.put("/data-spaces/current", async (request, response) => {
    const input = dataSpaceInput.parse(request.body);
    await account.updateDataSpace(request.session, input.name, input.isDefault ?? false);
    response.json(await account.accountSnapshot(request.session));
});

router.put("/data-spaces/current-selection", async (request, response) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.body);
    await account.selectDataSpace(request.session, id);
    response.json(await account.accountSnapshot(request.session));
});

router.get("/sessions", async (request, response) => {
    const result: AccountSessionsResponse = {
        sessions: await account.listAccountSessions(request.session, request.sessionID),
    };
    response.json(result);
});

router.delete("/sessions/:id", async (request, response) => {
    await account.revokeAccountSession(request.session, request.params.id);
    response.status(204).end();
});

router.get("/export", async (request, response) => {
    response.attachment(
        `party-game-account-${account.requireAccountIdentity(request.session).userId}.json`,
    );
    response.json(await account.exportAccount(request.session));
});

function safeReturnTo(value: string | undefined): string {
    if (!value) return "/play/";
    try {
        const parsed = new URL(value, "https://local.invalid");
        const applicationPath = parsed.pathname === "/play" || parsed.pathname.startsWith("/play/");
        if (parsed.origin !== "https://local.invalid" || !applicationPath) {
            return "/play/";
        }
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
        return "/play/";
    }
}

router.delete("/me", async (request, response) => {
    const { username } = z.object({ username: z.string().min(1) }).parse(request.body);
    await account.deleteAccount(
        detectLocale(request.get("accept-language")),
        username,
        request.session,
    );
    response.status(204).end();
});

export default router;
