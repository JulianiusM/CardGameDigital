import { MESSAGE_KEYS } from "../../../../../packages/localization/keys";
import express from "express";
import { z, ZodError } from "zod";
import { getRoomService } from "../../modules/realtime";
import { requireCurrentDataSpace } from "./dataSpaceAccess";
import { detectLocale, translate } from "../../../../../packages/localization/messages";
import { roomCreateRequestSchema } from "../../../../../packages/protocol";
import { logApiValidationError } from "../../middleware/validationErrorHandler";
import { installationServerId } from "../../modules/installationIdentity";
import settings from "../../modules/settings";
import { logEvent } from "../../modules/structuredLogger";
import { recordRoomCreateBoundaryIdempotency } from "../../modules/roomObservability";

const router = express.Router();
const joinSchema = z
    .object({ displayName: z.string().trim().min(1).max(40), role: z.enum(["PLAYER", "DISPLAY"]) })
    .strict();

router.post("/", async (req, res, next) => {
    try {
        const requestBody: unknown = req.body;
        const input = roomCreateRequestSchema.parse(requestBody);
        const idempotencyKey = parseIdempotencyKey(req);
        if (input.bootstrapMode === "DISPLAY_WAITING_FOR_HOST" && !idempotencyKey) {
            recordRoomCreateBoundaryIdempotency("REQUIRED");
            throw coded("IDEMPOTENCY_KEY_REQUIRED", MESSAGE_KEYS.ROOM_IDEMPOTENCY_REQUIRED);
        }
        // Anonymous and authenticated users can both open ephemeral Rooms. Persistence is
        // deliberately opt-in and only then requires an owned DataSpace.
        const dataSpace =
            input.persistence === "DATASPACE" ? await requireCurrentDataSpace(req) : null;
        const execution = await getRoomService().createRoomWithOutcome(
            input.displayName,
            dataSpace?.id ?? null,
            input.settings,
            {
                bootstrapMode: input.bootstrapMode,
                idempotency: idempotencyKey
                    ? {
                          key: idempotencyKey,
                          principalScope: roomCreatePrincipalScope(req),
                          requestBody,
                      }
                    : undefined,
            },
        );
        const created = execution.response;
        logEvent(
            "info",
            "room.create_response_committed",
            {
                requestId: res.locals.requestId,
                roomId: created.roomId,
                bootstrapMode: created.bootstrapMode ?? input.bootstrapMode,
                creatorRole: created.role,
                idempotencyRequested: idempotencyKey !== null,
                outcome: execution.outcome,
            },
            settings.value.logLevel,
        );
        if (execution.outcome === "REPLAYED") {
            res.setHeader("Idempotency-Replayed", "true");
        }
        res.status(201).json(created);
    } catch (error) {
        respondOrNext(error, req, res, next);
    }
});
router.post("/:roomCode/participants", async (req, res, next) => {
    try {
        const input = joinSchema.parse(req.body);
        res.status(201).json(
            await getRoomService().joinRoom(
                req.params.roomCode.toUpperCase(),
                input.displayName,
                input.role,
            ),
        );
    } catch (error) {
        respondOrNext(error, req, res, next);
    }
});
function respondOrNext(
    error: unknown,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
): void {
    const locale = detectLocale(req.get("accept-language"));
    if (error instanceof ZodError) {
        logApiValidationError(error, res);
        res.status(400).json({
            error: {
                code: "VALIDATION_ERROR",
                message: translate(locale, MESSAGE_KEYS.ROOM_INVALID_REQUEST),
                data: z.flattenError(error),
            },
        });
        return;
    }
    if ((error as { code?: string }).code === "ROOM_NOT_FOUND") {
        res.status(404).json({
            error: {
                code: "ROOM_NOT_FOUND",
                message: translate(locale, MESSAGE_KEYS.ROOM_NOT_FOUND),
            },
        });
        return;
    }
    if ((error as { code?: string }).code === "ROOM_FULL") {
        res.status(409).json({
            error: {
                code: "ROOM_FULL",
                message: translate(locale, MESSAGE_KEYS.ROOM_FULL),
            },
        });
        return;
    }
    if ((error as { code?: string }).code === "CARD_LOCALE_UNAVAILABLE") {
        res.status(400).json({
            error: {
                code: "CARD_LOCALE_UNAVAILABLE",
                message: translate(locale, MESSAGE_KEYS.CARD_LOCALE_UNAVAILABLE),
            },
        });
        return;
    }
    const idempotencyErrors = {
        ROOM_BOOTSTRAP_MODE_UNSUPPORTED: {
            status: 409,
            message: MESSAGE_KEYS.ROOM_BOOTSTRAP_UNSUPPORTED,
        },
        IDEMPOTENCY_KEY_REQUIRED: {
            status: 400,
            message: MESSAGE_KEYS.ROOM_IDEMPOTENCY_REQUIRED,
        },
        IDEMPOTENCY_KEY_INVALID: {
            status: 400,
            message: MESSAGE_KEYS.ROOM_IDEMPOTENCY_INVALID,
        },
        IDEMPOTENCY_KEY_REUSED: {
            status: 409,
            message: MESSAGE_KEYS.ROOM_IDEMPOTENCY_REUSED,
        },
        IDEMPOTENCY_REQUEST_IN_PROGRESS: {
            status: 409,
            message: MESSAGE_KEYS.ROOM_IDEMPOTENCY_IN_PROGRESS,
        },
        IDEMPOTENCY_RESULT_GONE: {
            status: 410,
            message: MESSAGE_KEYS.ROOM_IDEMPOTENCY_GONE,
        },
    } as const;
    const errorCode = (error as { code?: string }).code;
    const mapped = errorCode
        ? idempotencyErrors[errorCode as keyof typeof idempotencyErrors]
        : undefined;
    if (errorCode && mapped) {
        logEvent(
            "warn",
            "room.create_request_rejected",
            { requestId: res.locals.requestId, reason: errorCode },
            settings.value.logLevel,
        );
        if (errorCode === "IDEMPOTENCY_REQUEST_IN_PROGRESS") res.setHeader("Retry-After", "1");
        res.status(mapped.status).json({
            error: { code: errorCode, message: translate(locale, mapped.message) },
        });
        return;
    }
    next(error);
}

function parseIdempotencyKey(req: express.Request): string | null {
    const values: string[] = [];
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
        if (req.rawHeaders[index].toLowerCase() !== "idempotency-key") continue;
        values.push(req.rawHeaders[index + 1] ?? "");
    }
    if (values.length === 0) return null;
    const value = values[0].trim().toLowerCase();
    if (
        values.length !== 1 ||
        values[0].includes(",") ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value)
    ) {
        recordRoomCreateBoundaryIdempotency("INVALID");
        throw coded("IDEMPOTENCY_KEY_INVALID", MESSAGE_KEYS.ROOM_IDEMPOTENCY_INVALID);
    }
    return value;
}

function roomCreatePrincipalScope(req: express.Request): string {
    const installation = installationServerId();
    if (req.session.account) return `${installation}:account:${req.session.account.userId}`;
    const namespace = settings.value.deploymentMode === "public" ? "anonymous" : "local";
    return `${installation}:${namespace}`;
}

function coded(code: string, message: string): Error {
    return Object.assign(new Error(message), { code });
}
export default router;
