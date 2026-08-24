import { describe, expect, it } from "vitest";
import { isTrustedOrigin, requestPathForLog } from "../../src/modules/requestSecurity";

describe("public request origin validation", () => {
    it("accepts only the configured public origin", () => {
        expect(isTrustedOrigin("https://game.example", "https://game.example/play")).toBe(true);
        expect(isTrustedOrigin("https://evil.example", "https://game.example")).toBe(false);
        expect(isTrustedOrigin(undefined, "https://game.example")).toBe(false);
        expect(isTrustedOrigin("not a URL", "https://game.example")).toBe(false);
    });

    it("removes query strings and fragments from request log paths", () => {
        expect(requestPathForLog("/play/account?reset=secret-token")).toBe("/play/account");
        expect(requestPathForLog("/api/v1/account/oidc/callback?code=secret&state=secret")).toBe(
            "/api/v1/account/oidc/callback",
        );
        expect(requestPathForLog(undefined)).toBe("-");
    });
});
