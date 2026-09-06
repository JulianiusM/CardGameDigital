import { MESSAGE_KEYS } from "../../../../packages/localization/keys";
import type { NextFunction, Request, Response } from "express";
import { handleJsonBodyError } from "./jsonBodyErrorHandler";
import { APIError, ExpectedError, ValidationError } from "../modules/lib/errors";
import settings from "../modules/settings";
import { configuredErrorLogFields, logEvent } from "../modules/structuredLogger";
import {
    detectLocale,
    translate,
    translateError,
} from "../../../../packages/localization/messages";

export function handleGenericError(
    error: Error,
    request: Request,
    response: Response,
    _next: NextFunction,
): void {
    if (handleJsonBodyError(error, request, response)) return;
    const status = "status" in error && typeof error.status === "number" ? error.status : 500;
    if (status >= 500) {
        logEvent(
            "error",
            "http.unhandled_error",
            {
                requestId: response.locals.requestId,
                ...configuredErrorLogFields(error, settings.value),
            },
            settings.value.logLevel,
        );
    }
    const data =
        error instanceof APIError ||
        error instanceof ExpectedError ||
        error instanceof ValidationError
            ? error.data
            : {};
    response.status(status).json({
        error: {
            code: (error as { code?: string }).code ?? "INTERNAL_ERROR",
            message:
                status >= 500
                    ? translate(
                          detectLocale(request.get("accept-language")),
                          MESSAGE_KEYS.REQUEST_INTERNAL,
                      )
                    : translateError(detectLocale(request.get("accept-language")), error.message),
            data,
        },
    });
}
