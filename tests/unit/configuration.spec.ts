import { describe, expect, it } from "vitest";
import { resolveSettings } from "../../src/modules/settings";

const safePublicEnvironment = {
    DEPLOYMENT_MODE: "public",
    AUTH_MODE: "account",
    DB_TYPE: "mariadb",
    DB_USER: "card_game",
    DB_PASSWORD: "database-password",
    PUBLIC_URL: "https://cards.example",
    SESSION_SECRET: "production-session-secret-at-least-32-characters",
    SMTP_HOST: "smtp.example",
    SMTP_USER: "mailer",
    SMTP_PASSWORD: "mail-password",
    SMTP_EMAIL: "cards@example.test",
    TRUST_PROXY: "1",
} satisfies NodeJS.ProcessEnv;

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

    it("allows the explicit E2E runtime to exercise MariaDB without public transport", () => {
        const settings = resolveSettings(
            {
                NODE_ENV: "e2e",
                E2E_DEPLOYMENT_MODE: "local",
                E2E_AUTH_MODE: "none",
                E2E_DB_TYPE: "mariadb",
                E2E_DB_NAME: "party_game_e2e",
                E2E_DB_USER: "tester",
                E2E_DB_PASSWORD: "secret",
            },
            "/dev/null",
        );
        expect(settings).toMatchObject({ testMode: true, dbType: "mariadb" });
    });

    it("applies environment variables over the optional configuration file", () => {
        const settings = resolveSettings(
            {
                ...safePublicEnvironment,
                HTTP_PORT: "8443",
                CARD_MISSING_TRANSLATION: "FALLBACK",
                CARD_FALLBACK_LOCALE: "en-GB",
            },
            "/definitely/missing/settings.csv",
        );
        expect(settings.publicUrl).toBe("https://cards.example");
        expect(settings.httpPort).toBe(8443);
        expect(settings.trustProxy).toBe(1);
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

    it.each([
        [{ PUBLIC_URL: "http://cards.example" }, /HTTPS origin PUBLIC_URL/],
        [{ PUBLIC_URL: "https://cards.example/deploy" }, /HTTPS origin PUBLIC_URL/],
        [{ DB_PASSWORD: "" }, /database credentials/],
        [{ SESSION_SECRET: "local-generated-secret-that-is-long-enough" }, /explicit 32-character/],
        [{ SMTP_HOST: "" }, /complete SMTP/],
        [{ TRUST_PROXY: "false" }, /positive TRUST_PROXY hop count/],
        [{ TRUST_PROXY: "true" }, /positive TRUST_PROXY hop count/],
    ] as const)("rejects incomplete public deployment settings", (override, message) => {
        expect(() =>
            resolveSettings(
                { ...safePublicEnvironment, ...override },
                "/definitely/missing/settings.csv",
            ),
        ).toThrow(message);
    });

    it("requires complete canonical HTTPS OIDC configuration when enabled publicly", () => {
        expect(() =>
            resolveSettings(
                { ...safePublicEnvironment, OIDC_ENABLED: "true" },
                "/definitely/missing/settings.csv",
            ),
        ).toThrow(/complete provider configuration/);
        expect(
            resolveSettings(
                {
                    ...safePublicEnvironment,
                    OIDC_ENABLED: "true",
                    OIDC_ISSUER: "https://identity.example",
                    OIDC_CLIENT_ID: "party-game",
                    OIDC_CLIENT_SECRET: "oidc-secret",
                    OIDC_REDIRECT_URL: "https://cards.example/api/v1/account/oidc/callback",
                    OIDC_NAME: "Example Identity",
                },
                "/definitely/missing/settings.csv",
            ).oidcEnabled,
        ).toBe(true);
    });
});
