import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { wrapErrorApi } from "../../src/middleware/validationErrorHandler";
import { APIError } from "../../src/modules/lib/errors";

function responseRecorder(): {
    response: Response;
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
} {
    const status = vi.fn();
    const json = vi.fn();
    const response = {
        locals: { requestId: "request-id" },
        status,
        json,
    } as unknown as Response;
    status.mockReturnValue(response);
    json.mockReturnValue(response);
    return { response, status, json };
}

describe("API error boundary", () => {
    it("logs validation stacks and issue paths without logging the request body", () => {
        const { response } = responseRecorder();
        const request = {
            get: (name: string) => (name === "accept-language" ? "en" : undefined),
        } as Request;
        const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
        const boundaryValue = "private-boundary-value";
        const parsed = z.object({ displayName: z.string().max(3) }).safeParse({
            displayName: boundaryValue,
        });
        expect(parsed.success).toBe(false);

        if (!parsed.success) wrapErrorApi(parsed.error, request, response, vi.fn());

        const entry = JSON.parse(String(write.mock.calls[0][0])) as Record<string, string>;
        expect(entry).toMatchObject({
            level: "warn",
            event: "http.api_validation_error",
            errorName: "ZodError",
        });
        expect(entry.errorStack).toContain("ZodError");
        expect(entry.errorDetails).toContain("displayName");
        expect(JSON.stringify(entry)).not.toContain(boundaryValue);
        write.mockRestore();
    });

    it("does not expose messages or data from server failures", () => {
        const { response, status, json } = responseRecorder();
        const request = {
            get: (name: string) => (name === "accept-language" ? "en" : undefined),
        } as Request;

        wrapErrorApi(
            new APIError("database password leaked", { token: "secret" }, 500),
            request,
            response,
            vi.fn(),
        );

        expect(status).toHaveBeenCalledWith(500);
        expect(json).toHaveBeenCalledWith({
            error: {
                code: "INTERNAL_ERROR",
                message: "Internal server error",
                data: {},
            },
        });
    });
});
