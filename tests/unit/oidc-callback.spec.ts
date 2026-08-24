import { describe, expect, it } from "vitest";
import { canonicalOidcCallbackUrl } from "../../src/modules/oidc";

describe("OIDC callback URL", () => {
    it("uses the configured callback authority and only copies provider query values", () => {
        expect(
            canonicalOidcCallbackUrl(
                "https://attacker.example/elsewhere?code=provider-code&state=state-value",
                "https://cards.example/api/v1/account/oidc/callback",
            ).href,
        ).toBe(
            "https://cards.example/api/v1/account/oidc/callback?code=provider-code&state=state-value",
        );
    });
});
