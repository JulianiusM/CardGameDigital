import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { requestPathForLog } from "./requestSecurity";

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type ConfiguredLogLevel = LogLevel | "silent";
export type LogFields = Record<string, string | number | boolean | null | undefined>;
export type ErrorLogDetails = "standard" | "diagnostic";

type ErrorLogOptions = {
    details?: ErrorLogDetails;
    secrets?: readonly string[];
};

type ErrorLoggingSettings = {
    logErrorDetails: ErrorLogDetails;
    dbPassword: string;
    smtpPassword: string;
    oidcClientSecret: string;
    sessionSecret: string;
};

const priority: Record<ConfiguredLogLevel, number> = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    fatal: 60,
    silent: Number.POSITIVE_INFINITY,
};

export function logLevelEnabled(level: LogLevel, configuredLevel: ConfiguredLogLevel): boolean {
    return priority[level] >= priority[configuredLevel];
}

export function structuredLogEntry(
    level: LogLevel,
    event: string,
    fields: LogFields = {},
    now = new Date(),
): Record<string, string | number | boolean | null | undefined> {
    return {
        timestamp: now.toISOString(),
        level,
        event,
        ...fields,
    };
}

export function logEvent(
    level: LogLevel,
    event: string,
    fields: LogFields = {},
    configuredLevel: ConfiguredLogLevel = "info",
): void {
    if (!logLevelEnabled(level, configuredLevel)) return;
    const destination = level === "error" || level === "fatal" ? process.stderr : process.stdout;
    destination.write(`${JSON.stringify(structuredLogEntry(level, event, fields))}\n`);
}

export function safeErrorName(error: unknown): string {
    if (error instanceof Error && error.name) return error.name;
    return typeof error;
}

const REDACTED = "[redacted]";
const sensitiveLabel =
    "authorization|cookie|password|passwd|secret|token|credential|username|client_id|session[_-]?id|code_verifier|access_token|refresh_token|id_token";
const sensitiveUrlParameter = `${sensitiveLabel}|code|state|activate|reset`;

function escapeRegularExpression(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sensitiveEnvironmentValues(): string[] {
    const result: string[] = [];
    for (const [key, value] of Object.entries(process.env)) {
        if (!value) continue;
        if (/(?:PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|COOKIE|SESSION_ID)$/i.test(key)) {
            result.push(value);
        }
    }
    return result;
}

function redactSensitiveText(value: string, secrets: readonly string[]): string {
    let redacted = value
        .replace(
            new RegExp(
                `((?:${sensitiveLabel})\\s*(?:[:=]|\\bis\\b)\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;]+)`,
                "gi",
            ),
            `$1${REDACTED}`,
        )
        .replace(new RegExp(`([?&](?:${sensitiveUrlParameter})=)[^&#\\s]*`, "gi"), `$1${REDACTED}`)
        .replace(/(bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, `$1${REDACTED}`)
        .replace(/(connect\.sid=)[^;\s]+/gi, `$1${REDACTED}`)
        .replace(/(Access denied for user\s+)'[^']*'/gi, `$1'${REDACTED}'`)
        .replace(/(Duplicate entry\s+)'[^']*'/gi, `$1'${REDACTED}'`)
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, REDACTED)
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED);
    for (const secret of new Set([...sensitiveEnvironmentValues(), ...secrets])) {
        if (!secret) continue;
        redacted = redacted.replace(new RegExp(escapeRegularExpression(secret), "g"), REDACTED);
    }
    return redacted;
}

function addDiagnosticMetadata(
    fields: LogFields,
    source: unknown,
    prefix: string,
    secrets: readonly string[],
): void {
    if (typeof source !== "object" || source === null) return;
    const metadata = source as Record<string, unknown>;
    const keys = ["code", "errno", "sqlState", "sqlMessage"] as const;
    for (const key of keys) {
        const value = metadata[key];
        if (typeof value !== "string" && typeof value !== "number") continue;
        const fieldName = `${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}`;
        fields[fieldName] = typeof value === "string" ? redactSensitiveText(value, secrets) : value;
    }
}

function diagnosticCauseStack(error: Error, secrets: readonly string[]): string | undefined {
    const stacks: string[] = [];
    const seen = new Set<unknown>();
    let cause: unknown = (error as Error & { cause?: unknown }).cause;
    while (cause !== undefined && cause !== null && stacks.length < 5 && !seen.has(cause)) {
        seen.add(cause);
        if (cause instanceof Error) {
            stacks.push(cause.stack ?? `${safeErrorName(cause)}: ${cause.message}`);
            cause = (cause as Error & { cause?: unknown }).cause;
        } else {
            stacks.push(String(cause));
            cause = undefined;
        }
    }
    if (stacks.length === 0) return undefined;
    return redactSensitiveText(stacks.join("\nCaused by:\n"), secrets);
}

/**
 * Logs the real exception message and call stack. Only concrete configured secrets,
 * bearer/session values, and common database echoes of boundary values are redacted.
 * Diagnostic mode also exposes cause stacks and driver error metadata without dumping
 * arbitrary Error properties, request bodies, SQL parameters, or rejected inputs.
 */
export function errorLogFields(error: unknown, options: ErrorLogOptions = {}): LogFields {
    const errorName = safeErrorName(error);
    const secrets = options.secrets ?? [];
    if (!(error instanceof Error)) {
        return {
            errorName,
            errorMessage: redactSensitiveText(String(error), secrets),
            errorStack: "unavailable",
        };
    }
    const fields: LogFields = {
        errorName,
        errorMessage: redactSensitiveText(error.message, secrets),
        errorStack: redactSensitiveText(error.stack ?? `${errorName}: ${error.message}`, secrets),
    };
    const issues = (error as Error & { issues?: unknown }).issues;
    if (Array.isArray(issues)) {
        fields.errorDetails = JSON.stringify(
            issues.map((issue) => {
                const value = issue as { code?: unknown; path?: unknown; message?: unknown };
                return {
                    code: typeof value.code === "string" ? value.code : "unknown",
                    path: Array.isArray(value.path) ? value.path.map(String).join(".") : "",
                    message:
                        typeof value.message === "string"
                            ? redactSensitiveText(value.message, secrets)
                            : "invalid value",
                };
            }),
        );
    }
    if (options.details === "diagnostic") {
        addDiagnosticMetadata(fields, error, "error", secrets);
        addDiagnosticMetadata(
            fields,
            (error as Error & { driverError?: unknown }).driverError,
            "driverError",
            secrets,
        );
        fields.errorCauseStack = diagnosticCauseStack(error, secrets);
    }
    return fields;
}

export function configuredErrorLogFields(error: unknown, config: ErrorLoggingSettings): LogFields {
    return errorLogFields(error, {
        details: config.logErrorDetails,
        secrets: [
            config.dbPassword,
            config.smtpPassword,
            config.oidcClientSecret,
            config.sessionSecret,
        ],
    });
}

export function structuredRequestLogger(
    configuredLevel: ConfiguredLogLevel | (() => ConfiguredLogLevel),
): RequestHandler {
    return (request: Request, response: Response, next: NextFunction) => {
        const startedAt = process.hrtime.bigint();
        const requestId = randomUUID();
        let written = false;
        response.locals.requestId = requestId;
        response.setHeader("X-Request-ID", requestId);

        const sendJson = response.json.bind(response);
        response.json = ((body: unknown) => {
            const error =
                typeof body === "object" && body !== null
                    ? (body as { error?: unknown }).error
                    : undefined;
            const code =
                typeof error === "object" && error !== null
                    ? (error as { code?: unknown }).code
                    : undefined;
            if (typeof code === "string" && code.length > 0) {
                response.locals.responseErrorCode = code;
            }
            return sendJson(body);
        }) as Response["json"];

        const writeRequest = () => {
            if (written) return;
            written = true;
            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
            const level: LogLevel =
                response.statusCode >= 500 ? "error" : response.statusCode >= 400 ? "warn" : "info";
            logEvent(
                level,
                "http.request",
                {
                    requestId,
                    method: request.method,
                    path: requestPathForLog(request.originalUrl ?? request.url),
                    statusCode: response.statusCode,
                    failureReason:
                        response.statusCode >= 400
                            ? (response.locals.responseErrorCode ?? "UNSPECIFIED_HTTP_ERROR")
                            : undefined,
                    durationMs: Number(durationMs.toFixed(3)),
                    aborted: !response.writableEnded,
                },
                typeof configuredLevel === "function" ? configuredLevel() : configuredLevel,
            );
        };

        response.once("finish", writeRequest);
        response.once("close", writeRequest);
        next();
    };
}
