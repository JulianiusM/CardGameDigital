import { describe, expect, it } from "vitest";
import { resolveSettings } from "../../src/modules/settings";

describe("deployment configuration", () => {
    it("uses a local, account-free SQLite deployment by default", () => {
        const settings = resolveSettings({}, "/definitely/missing/settings.csv");
        expect(settings).toMatchObject({
            deploymentMode: "local",
            authMode: "none",
            dbType: "sqlite",
            cardMissingTranslation: "EXCLUDE",
            cardFallbackLocale: "de-DE",
        });
    });

    it("applies environment variables over the optional configuration file", () => {
        const settings = resolveSettings(
            {
                DEPLOYMENT_MODE: "public",
                AUTH_MODE: "account",
                DB_TYPE: "mariadb",
                PUBLIC_URL: "https://cards.example",
                HTTP_PORT: "8443",
                TRUST_PROXY: "1",
                CARD_MISSING_TRANSLATION: "FALLBACK",
                CARD_FALLBACK_LOCALE: "en-GB",
            },
            "/definitely/missing/settings.csv",
        );
        expect(settings.publicUrl).toBe("https://cards.example");
        expect(settings.httpPort).toBe(8443);
        expect(settings.trustProxy).toBe(true);
        expect(settings.cardMissingTranslation).toBe("FALLBACK");
        expect(settings.cardFallbackLocale).toBe("en-GB");
    });

    it("rejects unsafe deployment/database combinations before initialization", () => {
        expect(() =>
            resolveSettings(
                { DEPLOYMENT_MODE: "public", AUTH_MODE: "none", DB_TYPE: "sqlite" },
                "/dev/null",
            ),
        ).toThrow(/public deployment requires MariaDB\/MySQL/);
    });
});
