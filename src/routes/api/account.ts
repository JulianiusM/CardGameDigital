import { MESSAGE_KEYS } from "../../packages/localization/keys";
import express from "express";
import { z } from "zod";
import * as account from "../../packages/application/accountService";
import settings from "../../modules/settings";
import { ExpectedError } from "../../modules/lib/errors";
import { detectLocale } from "../../packages/localization/messages";

const router = express.Router();
const credentials = z.object({
    username: z.string().min(3).max(50),
    password: z.string().min(8).max(200),
});
const registration = credentials.extend({
    displayName: z.string().trim().min(1).max(50),
    email: z.string().email().max(100),
});
const dataSpaceInput = z.object({
    name: z.string().trim().min(1).max(50),
    isDefault: z.boolean().optional(),
});

function localLoginRequired(): void {
    if (!settings.value.localLoginEnabled) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_LOCAL_DISABLED, "error", 404);
    }
}

router.get("/configuration", (_request, response) => {
    response.json({
        localLoginEnabled: settings.value.localLoginEnabled,
        oidcEnabled: settings.value.oidcEnabled,
        oidcName: settings.value.oidcName,
    });
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
    await account.login(input.username, input.password, request.session);
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

router.post("/password-resets", async (request, response) => {
    localLoginRequired();
    const input = z
        .object({ token: z.string().min(32), password: z.string().min(8).max(200) })
        .parse(request.body);
    await account.resetPassword(input.token, input.password);
    response.json({ ok: true });
});

router.get("/oidc/login", async (request, response) => {
    if (!settings.value.oidcEnabled)
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_OIDC_DISABLED, "error", 404);
    response.redirect(await account.oidcLogin(request.session));
});

router.get("/oidc/callback", async (request, response) => {
    if (!settings.value.oidcEnabled)
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_OIDC_DISABLED, "error", 404);
    await account.oidcCallback(request);
    response.redirect("/play/account");
});

router.use((request, _response, next) => {
    account.requireUser(request.session);
    next();
});

router.get("/me", async (request, response) => {
    response.json(await account.accountSnapshot(request.session));
});

router.post("/data-spaces", async (request, response) => {
    const input = dataSpaceInput.parse(request.body);
    response.status(201).json(await account.createDataSpace(request.session, input.name));
});

router.put("/data-spaces/current", async (request, response) => {
    const input = dataSpaceInput.parse(request.body);
    await account.updateDataSpace(request.session, input.name, input.isDefault ?? false);
    response.json(await account.accountSnapshot(request.session));
});

router.put("/data-spaces/current-selection", async (request, response) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.body);
    await account.selectDataSpace(request.session, id);
    response.json(await account.accountSnapshot(request.session));
});

router.get("/sessions", async (request, response) => {
    response.json({
        sessions: await account.listAccountSessions(request.session, request.sessionID),
    });
});

router.delete("/sessions/:id", async (request, response) => {
    await account.revokeAccountSession(request.session, request.params.id);
    response.status(204).end();
});

router.get("/export", async (request, response) => {
    response.attachment(`party-game-account-${request.session.auth!.user!.id}.json`);
    response.json(await account.exportAccount(request.session));
});

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
