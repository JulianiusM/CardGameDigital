import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
    errorLogFields,
    logLevelEnabled,
    safeErrorName,
    structuredLogEntry,
} from "../../src/modules/structuredLogger";

describe("structured logging", () => {
    it("honors the configured severity threshold", () => {
        expect(logLevelEnabled("info", "info")).toBe(true);
        expect(logLevelEnabled("debug", "info")).toBe(false);
        expect(logLevelEnabled("fatal", "silent")).toBe(false);
    });

    it("emits stable JSON fields without serializing Error payloads", () => {
        expect(
            structuredLogEntry(
                "warn",
                "test.event",
                { requestId: "request-1", statusCode: 429 },
                new Date("2026-08-24T10:00:00.000Z"),
            ),
        ).toEqual({
            timestamp: "2026-08-24T10:00:00.000Z",
            level: "warn",
            event: "test.event",
            requestId: "request-1",
            statusCode: 429,
        });
        expect(safeErrorName(new Error("secret-bearing message"))).toBe("Error");
    });

    it("keeps real exception messages, stack frames, and safe Zod issue details", () => {
        const ordinary = errorLogFields(new Error("profile lookup failed"));
        expect(ordinary.errorMessage).toBe("profile lookup failed");
        expect(ordinary.errorStack).toContain("Error: profile lookup failed");
        expect(ordinary.errorStack).toContain("structured-logger.spec.ts");

        const parsed = z.object({ roomMaximumPlayers: z.number().min(2) }).safeParse({
            roomMaximumPlayers: 1,
        });
        expect(parsed.success).toBe(false);
        if (!parsed.success) {
            const validation = errorLogFields(parsed.error);
            expect(validation.errorStack).toContain("ZodError");
            expect(validation.errorMessage).toContain("roomMaximumPlayers");
            expect(validation.errorDetails).toContain("roomMaximumPlayers");
        }
    });

    it("adds causes and driver codes in diagnostic mode while redacting concrete secrets", () => {
        const cause = new Error("socket refused connection");
        const failure = Object.assign(new Error("password=database-password; query failed"), {
            code: "ER_ACCESS_DENIED_ERROR",
            errno: 1045,
            sqlState: "28000",
            cause,
        });
        const details = errorLogFields(failure, {
            details: "diagnostic",
            secrets: ["database-password"],
        });

        expect(details.errorMessage).toContain("password=[redacted]");
        expect(details.errorMessage).not.toContain("database-password");
        expect(details.errorStack).not.toContain("database-password");
        expect(details.errorCode).toBe("ER_ACCESS_DENIED_ERROR");
        expect(details.errorErrno).toBe(1045);
        expect(details.errorSqlState).toBe("28000");
        expect(details.errorCauseStack).toContain("socket refused connection");

        const mailFailure = errorLogFields(
            new Error("mail failed for https://cards.test/play/account?activate=one-time-value"),
        );
        expect(mailFailure.errorMessage).toContain("activate=[redacted]");
        expect(mailFailure.errorMessage).not.toContain("one-time-value");
    });
});
