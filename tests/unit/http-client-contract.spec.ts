import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeCouchSessionSnapshot, decodeHttpErrorResponse } from "../../packages/protocol";

beforeEach(() => {
    vi.stubGlobal("navigator", { language: "en-GB", languages: ["en-GB"] });
    vi.stubGlobal("location", {
        href: "https://example.test/play/",
        origin: "https://example.test",
        pathname: "/play/",
        search: "",
        hash: "",
        reload: () => undefined,
    });
    vi.stubGlobal("localStorage", {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe("HTTP client contracts", () => {
    it("rejects incomplete recovery snapshots instead of treating them as a recovered game", () => {
        expect(decodeCouchSessionSnapshot(null)).toBeNull();
        expect(
            decodeCouchSessionSnapshot({ id: "10000000-0000-4000-8000-000000000001", revision: 2 }),
        ).toBeNull();
    });

    it("preserves policy error codes and status for explicit recovery", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: false,
                status: 409,
                json: async () => ({
                    error: { code: "POLICY_REVISION_CONFLICT", message: "Reload the policy" },
                }),
            }),
        );
        const { cardPolicyApi } = await import("../../apps/web/src/cardPolicyApi");
        const { ApiError } = await import("../../apps/web/src/http");
        const error = await cardPolicyApi.loadScope(null).catch((cause: unknown) => cause);
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({
            code: "POLICY_REVISION_CONFLICT",
            status: 409,
            message: "Reload the policy",
        });
    }, 30_000);

    it("decodes documented error fields without rejecting additive details", () => {
        expect(
            decodeHttpErrorResponse({
                error: {
                    code: "POLICY_RESULT_SET_CHANGED",
                    message: "The result changed",
                    data: { expected: 4 },
                    retryable: true,
                },
                requestId: "request-1",
            }),
        ).toMatchObject({
            error: {
                code: "POLICY_RESULT_SET_CHANGED",
                message: "The result changed",
                data: { expected: 4 },
            },
        });
        expect(decodeHttpErrorResponse({ error: { message: "" } })).toBeNull();
        expect(decodeHttpErrorResponse({ message: "missing envelope" })).toBeNull();
    });

    it("preserves the account adapter error subclass, code, and server message", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: false,
                status: 409,
                json: async () => ({
                    error: { code: "ACCOUNT_CONFLICT", message: "Account already changed" },
                }),
            }),
        );
        const { accountApi, AccountApiError } = await import("../../apps/web/src/accountApi");

        const error = await accountApi.status().catch((cause: unknown) => cause);

        expect(error).toBeInstanceOf(AccountApiError);
        expect(error).toMatchObject({
            code: "ACCOUNT_CONFLICT",
            message: "Account already changed",
        });
    }, 20_000);

    it("preserves the couch adapter error subclass, code, and server message", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: false,
                status: 404,
                json: async () => ({
                    error: { code: "SESSION_NOT_FOUND", message: "Session is gone" },
                }),
            }),
        );
        const { couchApi } = await import("../../apps/web/src/api");
        const { ApiError } = await import("../../apps/web/src/http");

        const error = await couchApi.get("session-id").catch((cause: unknown) => cause);

        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({
            code: "SESSION_NOT_FOUND",
            message: "Session is gone",
            status: 404,
        });
    });
});
