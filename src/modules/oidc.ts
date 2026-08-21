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

import type {Request} from 'express';
import * as oidc from 'openid-client';
import {getDefaultProfile} from "../controller/userController";
import {findOrCreateUserFromOidc} from "./database/services/UserService";
import {ExpectedError} from "./lib/errors";
import {persistSession} from "./lib/session";
import settings from "./settings";

let config: oidc.Configuration;

export async function initOIDC() {
    if (!settings.value.initialized) await settings.read();
    const server = new URL(settings.value.oidcIssuerBaseUrl);
    const clientId = settings.value.oidcClientId;
    const clientSecret = settings.value.oidcClientSecret;

    config = await oidc.discovery(server, clientId, clientSecret);
    return config;
}

function getCurrentUrlFromRequest(req: Request) {
    // Builds the full callback URL exactly as received
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
    const host = (req.headers['x-forwarded-host'] as string) || req.get('host');
    return new URL(`${proto}://${host}${req.originalUrl || req.url}`);
}

export async function startLogin(session: Request['session']) {
    if (!config) await initOIDC();

    const redirect_uri = settings.value.oidcRedirectUrl;
    const code_challenge_method = 'S256';

    // Per v6 example: generate a new verifier (+ maybe nonce) for each auth request
    const code_verifier = oidc.randomPKCECodeVerifier();
    const code_challenge = await oidc.calculatePKCECodeChallenge(code_verifier);

    // NEW: state for CSRF
    const state = oidc.randomState();

    // Store in session for callback verification
    session.oidc = {code_verifier, state};

    const parameters: Record<string, string> = {
        redirect_uri,
        scope: 'openid email profile',
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

    const redirectTo = oidc.buildAuthorizationUrl(config, parameters);
    return redirectTo.href;
}

export async function callback(req: Request) {
    if (!config) await initOIDC();

    const sess = req.session.oidc;

    if (!sess?.code_verifier) {
        throw new ExpectedError('Invalid or expired login session.');
    }

    const currentUrl = getCurrentUrlFromRequest(req);

    // Exchange the authorization code for tokens (ID Token expected)
    const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
        pkceCodeVerifier: sess.code_verifier,
        expectedState: sess.state,
        expectedNonce: sess.nonce,
        idTokenExpected: true,
    });

    // tokens.claims() are the ID Token claims (already verified)
    const claims = tokens.claims()!;
    const issuer = String(config.serverMetadata().issuer);

    // Optionally fetch userinfo (sometimes includes richer profile)
    // You can skip this if ID Token already has what you need.
    let userInfo: Record<string, any> | undefined;
    if (tokens.access_token && claims.sub) {
        try {
            userInfo = await oidc.fetchUserInfo(config, tokens.access_token, claims.sub);
        } catch {
            // UserInfo may be disabled/misconfigured; proceed with ID token claims
        }
    }

    // Prefer userInfo claims if present, otherwise ID Token claims
    const identityClaims = (userInfo ?? claims) as any;

    // JIT-provision or load your local user
    // Persist your standard session identity (same model as manual login)
    const user = await findOrCreateUserFromOidc(issuer, identityClaims, {
        linkByEmail: true,
    });
    req.session.auth = {user};
    req.session.profile = getDefaultProfile(user.profiles);

    // Optionally keep tokens for logout/API calls
    req.session.tokens = {
        id_token: tokens.id_token,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at, // epoch seconds if present
        token_type: tokens.token_type,
    };

    // Clear transient OIDC artifacts
    req.session.oidc = undefined;

    await persistSession(req.session);
}

export async function logout(session: Request['session']) {
    const id_token_hint = session.tokens?.id_token;
    const isOidc = !!session.tokens;

    // Clear local session first
    session.auth = undefined;
    session.profile = undefined;
    session.tokens = undefined;

    await persistSession(session);

    // Only initialize OIDC if this is an OIDC session
    if (isOidc) {
        if (!config) await initOIDC();

        const meta = config.serverMetadata();
        const endSession = meta.end_session_endpoint;
        const postLogoutRedirectUri = settings.value.rootUrl;

        if (endSession) {
            const url = new URL(endSession);
            if (id_token_hint) url.searchParams.set('id_token_hint', id_token_hint);
            url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
            return url.toString();
        }
    }

    return settings.value.rootUrl;
}
