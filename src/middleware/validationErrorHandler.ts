import { MESSAGE_KEYS } from "../packages/localization/keys";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { detectLocale, translate, translateError } from "../packages/localization/messages";

export function wrapErrorApi(
    error: Error & { data?: object; status?: number },
    request: Request,
    response: Response,
    _next: NextFunction,
): void {
    const validation = error instanceof ZodError;
    response.status(validation ? 400 : (error.status ?? 500)).json({
        error: {
            code: validation ? "VALIDATION_ERROR" : error.name.toUpperCase(),
            message: validation
                ? translate(
                      detectLocale(request.get("accept-language")),
                      MESSAGE_KEYS.REQUEST_INVALID,
                  )
                : translateError(detectLocale(request.get("accept-language")), error.message),
            data: validation ? error.flatten() : (error.data ?? {}),
        },
    });
}
