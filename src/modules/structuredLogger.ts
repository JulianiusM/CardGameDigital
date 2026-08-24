import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { requestPathForLog } from "./requestSecurity";

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type ConfiguredLogLevel = LogLevel | "silent";
export type LogFields = Record<string, string | number | boolean | null | undefined>;

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

export function structuredRequestLogger(
    configuredLevel: ConfiguredLogLevel | (() => ConfiguredLogLevel),
): RequestHandler {
    return (request: Request, response: Response, next: NextFunction) => {
        const startedAt = process.hrtime.bigint();
        const requestId = randomUUID();
        let written = false;
        response.locals.requestId = requestId;
        response.setHeader("X-Request-ID", requestId);

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
