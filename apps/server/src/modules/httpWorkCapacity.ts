import type { Request, RequestHandler } from "express";
import { MESSAGE_KEYS } from "../../../../packages/localization/keys";
import { logEvent } from "./structuredLogger";
import settings from "./settings";

type Lease = { retain: () => () => void };
const leases = new WeakMap<Request, Lease>();

/** Async adapters keep their request's reservation after a client disconnects. */
export function retainHttpWork(request: Request): () => void {
    return leases.get(request)?.retain() ?? (() => undefined);
}

/** Admit before reading ordinary game JSON. Imports have separate admission. */
export function createHttpWorkCapacity(
    maximum = settings.value.gameHttpConcurrentRequests,
    terminalAllowance = settings.value.gameHttpTerminalRequests,
    retryAfterSeconds = settings.value.gameWorkRetryAfterSeconds,
): RequestHandler {
    let active = 0;
    return (request, response, next) => {
        const path = request.path.toLowerCase().replace(/\/$/u, "");
        const gamePath = ["/api/v1/couch/", "/api/v1/card-policy/", "/api/v1/rooms"].some(
            (prefix) => path.startsWith(prefix),
        );
        if (!gamePath || (request.method === "POST" && path === "/api/v1/card-policy/import"))
            return next();
        const terminal =
            request.method === "POST" && /^\/api\/v1\/couch\/sessions\/[^/]+\/end$/u.test(path);
        if (active >= maximum + (terminal ? terminalAllowance : 0)) {
            response.setHeader("Retry-After", String(retryAfterSeconds));
            logEvent(
                "warn",
                "games.work_rejected",
                { operation: "http", reason: "in_flight" },
                settings.value.logLevel,
            );
            return next(
                Object.assign(new Error(MESSAGE_KEYS.GAME_SESSION_CAPACITY_EXCEEDED), {
                    code: "SESSION_CAPACITY_EXCEEDED",
                    status: 429,
                }),
            );
        }
        active++;
        let references = 0;
        const retain = () => {
            references++;
            let released = false;
            return () => {
                if (released) return;
                released = true;
                if (--references === 0) {
                    active--;
                    leases.delete(request);
                }
            };
        };
        leases.set(request, { retain });
        const release = retain();
        response.once("finish", release);
        response.once("close", release);
        next();
    };
}
