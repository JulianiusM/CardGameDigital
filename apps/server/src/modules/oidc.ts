/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { MESSAGE_KEYS } from "../../../../packages/localization/keys";
import type { Request } from "express";
import * as oidc from "openid-client";
import { ensureDataSpaceForUser, findOrCreateUserFromOidc } from "./database/services/UserService";
import { bindAccountSession } from "./database/services/AccountSessionService";
import { ExpectedError } from "./lib/errors";
import { persistSession, regenerateSession } from "./lib/session";
import settings from "./settings";
import { resolveOidcIdentityClaims } from "./oidcIdentity";

let config: oidc.Configuration;

export async function initOIDC() {
    if (!settings.value.initialized) await settings.read();
    const server = new URL(settings.value.oidcIssuer);
    const clientId = settings.value.oidcClientId;
    const clientSecret = settings.value.oidcClientSecret;

    config = await oidc.discovery(server, clientId, clientSecret);
    return config;
}

export function canonicalOidcCallbackUrl(originalUrl: string, configuredRedirect: string): URL {
    const incoming = new URL(originalUrl, configuredRedirect);
    const callback = new URL(configuredRedirect);
    callback.search = incoming.search;
    return callback;
}

export async function startLogin(session: Request["session"], returnTo = "/play/") {
    if (!config) await initOIDC();

    const redirect_uri = settings.value.oidcRedirectUrl;
    const code_challenge_method = "S256";

    // Per v6 example: generate a new verifier (+ maybe nonce) for each auth request
    const code_verifier = oidc.randomPKCECodeVerifier();
    const code_challenge = await oidc.calculatePKCECodeChallenge(code_verifier);

    // NEW: state for CSRF
    const state = oidc.randomState();

    // Store in session for callback verification
    session.oidc = { code_verifier, state, returnTo };

    const parameters: Record<string, string> = {
        redirect_uri,
        scope: "openid email profile",
        code_challenge,
        code_challenge_method,
        state,
    };

    // If PKCE may not be supported, also use nonce (back-compat safety)
    if (!config.serverMetadata().supportsPKCE()) {
        const nonce = oidc.randomNonce();
        session.oidc.nonce = nonce;
        parameters.nonce = nonce;
    }

    await persistSession(session);
    const redirectTo = oidc.buildAuthorizationUrl(config, parameters);
    return redirectTo.href;
}

export async function callback(req: Request): Promise<string> {
    if (!config) await initOIDC();

    const sess = req.session.oidc;

    if (!sess?.code_verifier) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_INVALID_OIDC_SESSION);
    }

    const currentUrl = canonicalOidcCallbackUrl(
        req.originalUrl || req.url,
        settings.value.oidcRedirectUrl,
    );

    // Exchange the authorization code for tokens (ID Token expected)
    const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
        pkceCodeVerifier: sess.code_verifier,
        expectedState: sess.state,
        expectedNonce: sess.nonce,
        idTokenExpected: true,
    });

    // tokens.claims() are the ID Token claims (already verified)
    const claims = tokens.claims();
    if (!claims) throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_INVALID_OIDC_SESSION);
    const issuer = String(config.serverMetadata().issuer);

    // Optionally fetch userinfo (sometimes includes richer profile)
    // You can skip this if ID Token already has what you need.
    let userInfo: Record<string, unknown> | undefined;
    if (tokens.access_token && claims.sub) {
        try {
            userInfo = await oidc.fetchUserInfo(config, tokens.access_token, claims.sub);
        } catch {
            // UserInfo may be disabled/misconfigured; proceed with ID token claims
        }
    }

    const identityClaims = resolveOidcIdentityClaims(claims, userInfo);

    // JIT-provision or load your local user
    // Persist your standard session identity (same model as manual login)
    const user = await findOrCreateUserFromOidc(issuer, identityClaims, {
        linkByEmail: identityClaims.email_verified === true,
    });
    const dataSpace = await ensureDataSpaceForUser(user.id);
    if (!dataSpace) {
        throw new ExpectedError(MESSAGE_KEYS.ACCOUNT_AUTHENTICATION_REQUIRED);
    }
    const returnTo = sess.returnTo ?? "/play/";
    const authenticatedSession = await regenerateSession(req);
    authenticatedSession.account = {
        userId: user.id,
        dataSpaceId: dataSpace.id,
    };

    // Clear transient OIDC artifacts
    authenticatedSession.oidc = undefined;

    await persistSession(authenticatedSession);
    await bindAccountSession(req.sessionID, user.id);
    return returnTo;
}
