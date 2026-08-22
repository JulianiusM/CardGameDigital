import { describe, expect, it } from "vitest";
import { isTrustedOrigin } from "../../src/modules/requestSecurity";

describe("public request origin validation", () => {
    it("accepts only the configured public origin", () => {
        expect(isTrustedOrigin("https://game.example", "https://game.example/play")).toBe(true);
        expect(isTrustedOrigin("https://evil.example", "https://game.example")).toBe(false);
        expect(isTrustedOrigin(undefined, "https://game.example")).toBe(false);
        expect(isTrustedOrigin("not a URL", "https://game.example")).toBe(false);
    });
});
