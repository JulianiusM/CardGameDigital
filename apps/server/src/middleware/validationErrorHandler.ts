import { MESSAGE_KEYS } from "../../../../packages/localization/keys";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { APIError, ExpectedError, ValidationError } from "../modules/lib/errors";
import settings from "../modules/settings";
import { configuredErrorLogFields, logEvent } from "../modules/structuredLogger";
import {
    detectLocale,
    translate,
    translateError,
} from "../../../../packages/localization/messages";

export function logApiValidationError(error: ZodError, response: Response): void {
    logEvent(
        "warn",
        "http.api_validation_error",
        {
            requestId: response.locals.requestId,
            ...configuredErrorLogFields(error, settings.value),
        },
        settings.value.logLevel,
    );
}

export function wrapErrorApi(
    error: Error & { data?: object; status?: number },
    request: Request,
    response: Response,
    _next: NextFunction,
): void {
    const validation = error instanceof ZodError;
    const status = validation ? 400 : (error.status ?? 500);
    const serverFailure = status >= 500;
    const expected =
        error instanceof APIError ||
        error instanceof ExpectedError ||
        error instanceof ValidationError;
    if (validation) {
        logApiValidationError(error, response);
    } else if (serverFailure) {
        logEvent(
            "error",
            "http.api_unhandled_error",
            {
                requestId: response.locals.requestId,
                ...configuredErrorLogFields(error, settings.value),
            },
            settings.value.logLevel,
        );
    }
    response.status(status).json({
        error: {
            code: validation
                ? "VALIDATION_ERROR"
                : serverFailure
                  ? "INTERNAL_ERROR"
                  : ((error as { code?: string }).code ?? "INTERNAL_ERROR"),
            message: validation
                ? translate(
                      detectLocale(request.get("accept-language")),
                      MESSAGE_KEYS.REQUEST_INVALID,
                  )
                : serverFailure
                  ? translate(
                        detectLocale(request.get("accept-language")),
                        MESSAGE_KEYS.REQUEST_INTERNAL,
                    )
                  : translateError(detectLocale(request.get("accept-language")), error.message),
            data: validation
                ? error.flatten()
                : expected && !serverFailure
                  ? (error.data ?? {})
                  : {},
        },
    });
}
