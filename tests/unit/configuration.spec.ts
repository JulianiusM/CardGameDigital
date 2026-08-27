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
            publicRuntimeSecurity: "enforced",
            authMode: "none",
            dbType: "sqlite",
            cardMissingTranslation: "EXCLUDE",
            cardFallbackLocale: "de-DE",
            roomMaximumParticipants: 100,
            roomMaximumPlayers: 100,
            roomReconnectGraceSeconds: 180,
            roomDisplayBootstrapEnabled: true,
            roomInitialActivationSeconds: 300,
            unactivatedParticipantTtlSeconds: 300,
            roomCreateIdempotencyTombstoneSeconds: 86_400,
            serverDisplayName: "Party Game",
            mdnsDiscoveryEnabled: true,
            mdnsServiceType: "_partycard._tcp",
            mdnsAdvertisedPort: 3000,
            webSocketPath: "/ws",
            roomJoinPathTemplate: "/play/?room={roomCode}",
            logErrorDetails: "standard",
            httpBind: "::",
            publicUrlConfigured: false,
        });
    });

    it("keeps discovery and display bootstrap off by default for public deployments", () => {
        expect(
            resolveSettings(safePublicEnvironment, "/definitely/missing/settings.csv"),
        ).toMatchObject({
            roomDisplayBootstrapEnabled: false,
            roomDisplayBootstrapConfigured: false,
            mdnsDiscoveryEnabled: false,
            mdnsDiscoveryConfigured: false,
        });
        expect(
            resolveSettings(
                {
                    ...safePublicEnvironment,
                    ROOM_DISPLAY_BOOTSTRAP_ENABLED: "true",
                    MDNS_DISCOVERY_ENABLED: "true",
                    MDNS_ADVERTISED_TLS: "true",
                    MDNS_ADVERTISED_PORT: "443",
                },
                "/definitely/missing/settings.csv",
            ),
        ).toMatchObject({
            roomDisplayBootstrapEnabled: true,
            mdnsDiscoveryEnabled: true,
            mdnsAdvertisedTls: true,
        });
    });

    it("validates discovery endpoints and Room lifecycle durations", () => {
        expect(() =>
            resolveSettings(
                { ROOM_INITIAL_ACTIVATION_SECONDS: "10" },
                "/definitely/missing/settings.csv",
            ),
        ).toThrow();
        expect(() =>
            resolveSettings(
                { ROOM_JOIN_PATH_TEMPLATE: "/play/no-room-code" },
                "/definitely/missing/settings.csv",
            ),
        ).toThrow(/roomCode/);
        expect(() =>
            resolveSettings(
                { WEB_SOCKET_PATH: "/ws?token=value" },
                "/definitely/missing/settings.csv",
            ),
        ).toThrow(/query or fragment/);
        expect(() =>
            resolveSettings(
                {
                    MDNS_INTERFACE_ALLOWLIST: "WiFi",
                    MDNS_INTERFACE_DENYLIST: "WiFi",
                },
                "/definitely/missing/settings.csv",
            ),
        ).toThrow(/must not overlap/);
        expect(() =>
            resolveSettings(
                { MDNS_SERVICE_TYPE: "_test-party._tcp" },
                "/definitely/missing/settings.csv",
            ),
        ).toThrow(/release constant/);
    });

    it("requires an explicit PUBLIC_URL for every public runtime", () => {
        expect(() =>
            resolveSettings(
                {
                    DEPLOYMENT_MODE: "public",
                    PUBLIC_RUNTIME_SECURITY: "development",
                    AUTH_MODE: "none",
                    DB_TYPE: "sqlite",
                },
                "/definitely/missing/settings.csv",
            ),
        ).toThrow(/explicit PUBLIC_URL/);
    });

    it("accepts only a credential-free HTTP(S) origin as a local QR override", () => {
        expect(
            resolveSettings(
                {
                    PUBLIC_URL: "https://cards.lan.example",
                    MDNS_ADVERTISED_TLS: "true",
                    MDNS_ADVERTISED_PORT: "443",
                },
                "/definitely/missing/settings.csv",
            ),
        ).toMatchObject({
            publicUrl: "https://cards.lan.example",
            publicUrlConfigured: true,
        });
        expect(() =>
            resolveSettings(
                { PUBLIC_URL: "https://cards.lan.example/subpath" },
                "/definitely/missing/settings.csv",
            ),
        ).toThrow(/credential-free HTTP\(S\) origin/);
        expect(() =>
            resolveSettings(
                { PUBLIC_URL: "https://cards.lan.example" },
                "/definitely/missing/settings.csv",
            ),
        ).toThrow(/TLS metadata/);
        expect(() =>
            resolveSettings({ MDNS_ADVERTISED_PORT: "4444" }, "/definitely/missing/settings.csv"),
        ).toThrow(/mDNS port/);
    });

    it("allows an administrator to run public behavior with explicit development security", () => {
        const settings = resolveSettings(
            {
                DEPLOYMENT_MODE: "public",
                PUBLIC_RUNTIME_SECURITY: "development",
                AUTH_MODE: "none",
                DB_TYPE: "sqlite",
                PUBLIC_URL: "http://192.0.2.10:3000",
                TRUST_PROXY: "false",
                LOG_ERROR_DETAILS: "diagnostic",
            },
            "/definitely/missing/settings.csv",
        );
        expect(settings).toMatchObject({
            deploymentMode: "public",
            publicRuntimeSecurity: "development",
            authMode: "none",
            dbType: "sqlite",
            publicUrl: "http://192.0.2.10:3000",
            trustProxy: false,
            logErrorDetails: "diagnostic",
        });
    });

    it("allows canonical HTTP OIDC endpoints only under explicit public development security", () => {
        const environment = {
            DEPLOYMENT_MODE: "public",
            PUBLIC_RUNTIME_SECURITY: "development",
            AUTH_MODE: "account",
            DB_TYPE: "sqlite",
            PUBLIC_URL: "http://localhost:3000",
            OIDC_ENABLED: "true",
            OIDC_ISSUER: "http://identity.local:8080",
            OIDC_CLIENT_ID: "party-game",
            OIDC_CLIENT_SECRET: "development-oidc-secret",
            OIDC_REDIRECT_URL: "http://localhost:3000/api/v1/account/oidc/callback",
            OIDC_NAME: "Development Identity",
        } satisfies NodeJS.ProcessEnv;
        const settings = resolveSettings(environment, "/definitely/missing/settings.csv");
        expect(settings).toMatchObject({ oidcEnabled: true, publicRuntimeSecurity: "development" });

        expect(() =>
            resolveSettings(
                {
                    ...environment,
                    OIDC_REDIRECT_URL: "http://localhost:3000/wrong-callback",
                },
                "/definitely/missing/settings.csv",
            ),
        ).toThrow(/canonical callback/);
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

    it("allows public semantics over HTTP only on loopback in the explicit E2E runtime", () => {
        const settings = resolveSettings(
            {
                NODE_ENV: "e2e",
                E2E_DEPLOYMENT_MODE: "public",
                E2E_AUTH_MODE: "account",
                E2E_DB_TYPE: "mariadb",
                E2E_DB_NAME: "party_game_e2e",
                E2E_DB_USER: "tester",
                E2E_DB_PASSWORD: "secret",
                E2E_PUBLIC_URL: "http://127.0.0.1:3001",
                E2E_SESSION_SECRET: "e2e-session-secret-that-is-at-least-32-characters",
                E2E_SMTP_HOST: "smtp.example.test",
                E2E_SMTP_USER: "mailer",
                E2E_SMTP_PASSWORD: "mail-password",
                E2E_SMTP_EMAIL: "cards@example.test",
                E2E_TRUST_PROXY: "1",
            },
            "/dev/null",
        );
        expect(settings).toMatchObject({
            deploymentMode: "public",
            testMode: true,
            publicUrl: "http://127.0.0.1:3001",
        });
    });

    it("does not allow the E2E HTTP exception on a non-loopback public origin", () => {
        expect(() =>
            resolveSettings(
                {
                    NODE_ENV: "e2e",
                    ...Object.fromEntries(
                        Object.entries(safePublicEnvironment).map(([key, value]) => [
                            `E2E_${key}`,
                            value,
                        ]),
                    ),
                    E2E_PUBLIC_URL: "http://cards.example",
                },
                "/dev/null",
            ),
        ).toThrow(/HTTP loopback is E2E-only/);
    });

    it("applies environment variables over the optional configuration file", () => {
        const settings = resolveSettings(
            {
                ...safePublicEnvironment,
                HTTP_PORT: "8443",
                CARD_MISSING_TRANSLATION: "FALLBACK",
                CARD_FALLBACK_LOCALE: "en-GB",
                ROOM_MAX_PARTICIPANTS: "250",
                ROOM_MAX_PLAYERS: "300",
                ROOM_RECONNECT_GRACE_SECONDS: "240",
            },
            "/definitely/missing/settings.csv",
        );
        expect(settings.publicUrl).toBe("https://cards.example");
        expect(settings.httpPort).toBe(8443);
        expect(settings.trustProxy).toBe(1);
        expect(settings.cardMissingTranslation).toBe("FALLBACK");
        expect(settings.cardFallbackLocale).toBe("en-GB");
        expect(settings.roomMaximumParticipants).toBe(250);
        expect(settings.roomMaximumPlayers).toBe(300);
        expect(settings.roomReconnectGraceSeconds).toBe(240);
    });

    it("accepts only public HTTP(S) legal links", () => {
        expect(
            resolveSettings(
                {
                    IMPRINT_URL: "https://legal.example.test/imprint",
                    PRIVACY_POLICY_URL: "http://legal.example.test/privacy",
                },
                "/definitely/missing/settings.csv",
            ),
        ).toMatchObject({
            imprintUrl: "https://legal.example.test/imprint",
            privacyPolicyUrl: "http://legal.example.test/privacy",
        });
        expect(() =>
            resolveSettings(
                { IMPRINT_URL: "javascript:alert(1)" },
                "/definitely/missing/settings.csv",
            ),
        ).toThrow(/HTTP\(S\) URL/);
    });

    it("rejects unknown public-runtime and error-detail policies", () => {
        expect(() =>
            resolveSettings(
                { ...safePublicEnvironment, PUBLIC_RUNTIME_SECURITY: "disabled" },
                "/definitely/missing/settings.csv",
            ),
        ).toThrow();
        expect(() =>
            resolveSettings(
                { ...safePublicEnvironment, LOG_ERROR_DETAILS: "everything" },
                "/definitely/missing/settings.csv",
            ),
        ).toThrow();
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
