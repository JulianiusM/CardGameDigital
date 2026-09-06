import { MESSAGE_KEYS } from "../../../../packages/localization/keys";
import { handleJsonBodyError } from "./jsonBodyErrorHandler";
import type { NextFunction, Request, Response } from "express";
import { z, ZodError } from "zod";
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
    if (handleJsonBodyError(error, request, response)) return;
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
    const locale = detectLocale(request.get("accept-language"));
    if (validation) {
        response.status(status).json({
            error: {
                code: "VALIDATION_ERROR",
                message: translate(locale, MESSAGE_KEYS.REQUEST_INVALID),
                data: z.flattenError(error),
            },
        });
        return;
    }
    if (serverFailure) {
        response.status(status).json({
            error: {
                code: "INTERNAL_ERROR",
                message: translate(locale, MESSAGE_KEYS.REQUEST_INTERNAL),
                data: {},
            },
        });
        return;
    }
    response.status(status).json({
        error: {
            code: (error as { code?: string }).code ?? "INTERNAL_ERROR",
            message: translateError(locale, error.message),
            data: expected ? (error.data ?? {}) : {},
        },
    });
}
