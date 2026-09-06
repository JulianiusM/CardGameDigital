import type { Request, Response } from "express";
import { MESSAGE_KEYS } from "../../../../packages/localization/keys";
import { detectLocale, translate } from "../../../../packages/localization/messages";

/** Global and route-specific parsers must return the same public error contract. */
export function handleJsonBodyError(error: Error, request: Request, response: Response): boolean {
    const parserError = error as Error & { type?: string; limit?: number };
    const tooLarge = parserError.type === "entity.too.large";
    if (!tooLarge && parserError.type !== "entity.parse.failed") return false;
    response.status(tooLarge ? 413 : 400).json({
        error: {
            code: tooLarge ? "PAYLOAD_TOO_LARGE" : "VALIDATION_ERROR",
            message: translate(
                detectLocale(request.get("accept-language")),
                tooLarge ? MESSAGE_KEYS.REQUEST_TOO_LARGE : MESSAGE_KEYS.REQUEST_INVALID,
            ),
            data: tooLarge ? { maximumBytes: parserError.limit } : {},
        },
    });
    return true;
}
