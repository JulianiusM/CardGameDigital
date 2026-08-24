import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
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
