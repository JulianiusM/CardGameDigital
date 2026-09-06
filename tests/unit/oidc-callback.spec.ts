import { describe, expect, it } from "vitest";
import { canonicalOidcCallbackUrl } from "../../apps/server/src/modules/oidc";
import { resolveOidcIdentityClaims } from "../../apps/server/src/modules/oidcIdentity";

describe("OIDC callback URL", () => {
    it("rejects mismatched subjects and malformed identity claims", () => {
        const token = { sub: "subject", email: "verified@example.test", email_verified: true };
        for (const userInfo of [
            { sub: "another-subject", email: token.email, email_verified: true },
            { sub: token.sub, email: "invalid", email_verified: true },
            { sub: token.sub, email: token.email, email_verified: "true" },
        ])
            expect(() => resolveOidcIdentityClaims(token, userInfo)).toThrow();
    });
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
