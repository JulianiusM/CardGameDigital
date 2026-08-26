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

import { MESSAGE_KEYS } from "./packages/localization/keys";
import { TypeormStore } from "connect-typeorm";
import express, { NextFunction, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import session from "express-session";
import path from "node:path";
import { validateSession } from "./packages/application/accountService";
import { handleGenericError } from "./middleware/genericErrorHandler";
import { AppDataSource } from "./modules/database/dataSource";
import { AccountSession } from "./modules/database/entities/session/AccountSession";
import { asyncHandler } from "./modules/lib/asyncHandler";
import { ExpectedError } from "./modules/lib/errors";
import settings, { isPublicRuntimeSecurityEnforced } from "./modules/settings";
import { isTrustedOrigin, websocketConnectSource } from "./modules/requestSecurity";
import { structuredRequestLogger } from "./modules/structuredLogger";
import { regenerateSession } from "./modules/lib/session";
import { detectLocale, translate } from "./packages/localization/messages";
import apiRouter from "./routes/api";

const app = express();
app.disable("x-powered-by");

app.use(structuredRequestLogger(() => settings.value.logLevel));
app.use((request, response, next) => {
    const websocketSource = websocketConnectSource({
        deploymentMode: settings.value.deploymentMode,
        publicUrl: settings.value.publicUrl,
        requestProtocol: request.protocol,
        requestHost: request.get("host"),
    });
    const connectSources = ["'self'"];
    if (websocketSource) connectSources.push(websocketSource);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader(
        "Content-Security-Policy",
        [
            "default-src 'self'",
            "base-uri 'none'",
            `connect-src ${connectSources.join(" ")}`,
            "font-src 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
            "img-src 'self' data:",
            "media-src 'self'",
            "object-src 'none'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
        ].join("; "),
    );
    if (isPublicRuntimeSecurityEnforced(settings.value)) {
        response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/play", express.static(path.join(__dirname, "web")));
app.get("/play", (_req, res) => res.sendFile(path.join(__dirname, "web", "index.html")));
app.get("/play/*splat", (_req, res) => res.sendFile(path.join(__dirname, "web", "index.html")));

// ensure dataSource is initialized before this
const sessionRepository = AppDataSource.getRepository(AccountSession);

// If behind a proxy (Heroku/NGINX), enable this so secure cookies work:
app.set("trust proxy", settings.value.trustProxy);

app.use(
    session({
        secret: settings.value.sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: {
            // 1 day (match store TTL below)
            maxAge: 1000 * 60 * 60 * 24,
            secure: new URL(settings.value.publicUrl).protocol === "https:",
            sameSite: "lax",
            httpOnly: true,
        },
        store: new TypeormStore({
            cleanupLimit: 2, // prune expired sessions periodically
            limitSubquery: false,
            ttl: 60 * 60 * 24, // seconds (1 day)
        }).connect(sessionRepository),
    }),
);

app.use("/api", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
});

// Enforced public deployments use same-origin checks as the CSRF boundary for all
// state-changing browser requests. Local and explicit development gameplay do not.
app.use((req: Request, res: Response, next: NextFunction) => {
    if (
        isPublicRuntimeSecurityEnforced(settings.value) &&
        ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)
    ) {
        const source = req.get("origin") ?? req.get("referer");
        if (!isTrustedOrigin(source, settings.value.publicUrl)) {
            res.status(403).json({
                error: {
                    code: "NOT_AUTHORIZED",
                    message: translate(
                        detectLocale(req.get("accept-language")),
                        MESSAGE_KEYS.REQUEST_INVALID_ORIGIN,
                    ),
                },
            });
            return;
        }
    }
    next();
});

const localizedRateLimitHandler = (req: Request, res: Response) => {
    res.status(429).json({
        error: {
            code: "RATE_LIMITED",
            message: translate(
                detectLocale(req.get("accept-language")),
                MESSAGE_KEYS.REQUEST_RATE_EXCEEDED,
            ),
        },
    });
};
const skipPublicAbuseControls = () =>
    !isPublicRuntimeSecurityEnforced(settings.value) || settings.value.testMode;
const accountLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipPublicAbuseControls,
    handler: localizedRateLimitHandler,
});
const roomCreationLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipPublicAbuseControls,
    handler: localizedRateLimitHandler,
});
const roomJoinLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipPublicAbuseControls,
    handler: localizedRateLimitHandler,
});
app.use(
    [
        "/api/v1/account/login",
        "/api/v1/account/register",
        "/api/v1/account/activation-requests",
        "/api/v1/account/password-reset-requests",
        "/api/v1/account/password-resets",
    ],
    accountLimiter,
);
app.post("/api/v1/rooms", roomCreationLimiter);
app.post("/api/v1/rooms/:roomCode/participants", roomJoinLimiter);

// Validate session on each request
app.use(
    asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
        if (!(await validateSession(req.session))) {
            // Expired account identity becomes an anonymous browser session. Public quick
            // rounds must not be blocked by a stale login cookie; protected routes still
            // return their normal authentication-required response downstream.
            await regenerateSession(req);
        }
        next();
    }),
);

app.get("/", (_req, res) => res.redirect("/play/"));
app.use("/api", apiRouter);

app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.get(
    "/readyz",
    asyncHandler(async (_req, res) => {
        await AppDataSource.query("SELECT 1");
        res.status(200).send("ready");
    }),
);

// catch 404 and forward to error handler
app.use(function (req: Request, res: Response, next: NextFunction) {
    next(new ExpectedError(MESSAGE_KEYS.REQUEST_NOT_FOUND, "error", 404));
});

// error handler
app.use(handleGenericError);

export default app;
