import { MESSAGE_KEYS } from "../../packages/localization/keys";
import express from "express";
import { z, ZodError } from "zod";
import { getRoomService } from "../../modules/realtime";
import { requireCurrentDataSpace } from "./dataSpaceAccess";
import { detectLocale, translate } from "../../packages/localization/messages";
import { roomGameSettingsSchema } from "../../packages/protocol";

const router = express.Router();
const createSchema = z
    .object({
        displayName: z.string().trim().min(1).max(40),
        persistence: z.enum(["EPHEMERAL", "DATASPACE"]).default("EPHEMERAL"),
        settings: roomGameSettingsSchema.optional(),
    })
    .strict();
const joinSchema = z
    .object({ displayName: z.string().trim().min(1).max(40), role: z.enum(["PLAYER", "DISPLAY"]) })
    .strict();

router.post("/", async (req, res, next) => {
    try {
        const input = createSchema.parse(req.body);
        // Anonymous and authenticated users can both open ephemeral Rooms. Persistence is
        // deliberately opt-in and only then requires an owned DataSpace.
        const dataSpace =
            input.persistence === "DATASPACE" ? await requireCurrentDataSpace(req) : null;
        res.status(201).json(
            await getRoomService().createRoom(
                input.displayName,
                dataSpace?.id ?? null,
                input.settings,
            ),
        );
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
        res.status(400).json({
            error: {
                code: "VALIDATION_ERROR",
                message: translate(locale, MESSAGE_KEYS.ROOM_INVALID_REQUEST),
                details: error.issues,
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
    next(error);
}
export default router;
