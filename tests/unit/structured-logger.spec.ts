import { describe, expect, it } from "vitest";
import {
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
});
