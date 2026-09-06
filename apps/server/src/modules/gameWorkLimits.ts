import type { RequestHandler } from "express";
import { FixedWindowRateLimiter } from "./fixedWindowRateLimiter";
import settings, { isPublicRuntimeSecurityEnforced } from "./settings";
import { detectLocale, translate } from "../../../../packages/localization/messages";
import { MESSAGE_KEYS } from "../../../../packages/localization/keys";
import { logEvent } from "./structuredLogger";

export function createGameWorkLimiter(): RequestHandler {
    const config = settings.value;
    const creation = new FixedWindowRateLimiter(
        config.gameCreationRateWindowMs,
        config.gameCreationRatePerPrincipal,
    );
    const globalCreation = new FixedWindowRateLimiter(
        config.gameCreationRateWindowMs,
        config.gameCreationRateProcess,
    );
    const policy = new FixedWindowRateLimiter(
        config.policyRateWindowMs,
        config.policyRatePerPrincipal,
    );
    const globalPolicy = new FixedWindowRateLimiter(
        config.policyRateWindowMs,
        config.policyRateProcess,
    );
    const couch = new FixedWindowRateLimiter(config.couchRateWindowMs, config.couchRatePerGame);
    const addressPolicy = new FixedWindowRateLimiter(
        config.policyRateWindowMs,
        config.policyRatePerAddress,
    );
    return (request, response, next) => {
        if (!isPublicRuntimeSecurityEnforced(settings.value) || settings.value.testMode)
            return next();
        const path = request.path.toLowerCase().replace(/\/$/u, "");
        const address = request.ip ?? "unknown";
        const principal = request.session.account
            ? `account:${request.session.account.userId}`
            : address;
        let operation: "create" | "policy" | "couch" | undefined;
        let allowed = true;
        if (
            request.method === "POST" &&
            ["/api/v1/couch/sessions", "/api/v1/rooms"].includes(path)
        ) {
            operation = "create";
            allowed = creation.consume(principal) && globalCreation.consume("process");
        } else if (path.startsWith("/api/v1/card-policy/")) {
            operation = "policy";
            allowed =
                policy.consume(principal) &&
                addressPolicy.consume(address) &&
                globalPolicy.consume("process");
        } else if (path.startsWith("/api/v1/couch/sessions/") && !path.endsWith("/end")) {
            operation = "couch";
            // Per game: a school/LAN's unrelated devices do not share command tokens.
            allowed = couch.consume(path.split("/")[5] ?? principal);
        }
        if (allowed) return next();
        logEvent(
            "warn",
            "games.work_rejected",
            { operation, reason: "rate" },
            settings.value.logLevel,
        );
        let windowMs = config.policyRateWindowMs;
        if (operation === "create") windowMs = config.gameCreationRateWindowMs;
        else if (operation === "couch") windowMs = config.couchRateWindowMs;
        response.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
        response.status(429).json({
            error: {
                code: "RATE_LIMITED",
                message: translate(
                    detectLocale(request.get("accept-language")),
                    MESSAGE_KEYS.REQUEST_RATE_EXCEEDED,
                ),
            },
        });
    };
}

let policyWork = 0;
/** Held until work settles, including when the requesting client disconnects. */
export async function withPolicyWorkCapacity<T>(action: () => Promise<T>): Promise<T> {
    if (policyWork >= settings.value.policyConcurrentWork) {
        logEvent(
            "warn",
            "games.work_rejected",
            { operation: "policy", reason: "concurrency" },
            settings.value.logLevel,
        );
        throw Object.assign(new Error(MESSAGE_KEYS.GAME_SESSION_CAPACITY_EXCEEDED), {
            code: "SESSION_CAPACITY_EXCEEDED",
            status: 429,
        });
    }
    policyWork++;
    try {
        return await action();
    } finally {
        policyWork--;
    }
}
