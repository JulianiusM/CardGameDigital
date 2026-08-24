import { describe, expect, it } from "vitest";
import { extractAccountLinkTokens } from "../../apps/web/src/accountLinkTokens";

describe("account link tokens", () => {
    it("extracts bearer tokens and returns a query-free history path", () => {
        const result = extractAccountLinkTokens(
            new URL(
                "https://cards.example/play/account?activate=activation-secret&reset=reset-secret&locale=de#account",
            ),
        );

        expect(result).toEqual({
            activationToken: "activation-secret",
            resetToken: "reset-secret",
            sanitizedPath: "/play/account?locale=de#account",
        });
        expect(result.sanitizedPath).not.toContain("secret");
    });
});
