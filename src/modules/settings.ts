/* Copyright 2026 Julian Malovanij, Apache-2.0 */

import * as dotenv from "dotenv";
import crypto from "node:crypto";
import fs from "node:fs";
import { z } from "zod";

const envPath =
    process.env.E2E_DOTENV_FILE ?? (process.env.NODE_ENV === "e2e" ? ".env.e2e" : ".env");
dotenv.config({ path: envPath });

const booleanValue = z
    .union([z.boolean(), z.enum(["1", "0", "true", "false", "yes", "no", "on", "off"])])
    .transform((value) => (typeof value === "boolean" ? value : /^(1|true|yes|on)$/i.test(value)));
const numberValue = z.union([z.number(), z.string()]).transform(Number).pipe(z.number().finite());
const trustProxyString = z
    .string()
    .regex(/^(?:true|false|yes|no|on|off|\d+)$/i)
    .transform((value) => {
        if (/^\d+$/.test(value)) return Number(value);
        return /^(?:true|yes|on)$/i.test(value);
    });
const trustProxyValue = z.union([z.boolean(), z.number().int().nonnegative(), trustProxyString]);
const optionalPublicUrl = z.string().refine((value) => {
    if (!value) return true;
    const parsed = z.url().safeParse(value);
    return parsed.success && ["http:", "https:"].includes(new URL(value).protocol);
}, "must be empty or an HTTP(S) URL");

export const settingsSchema = z
    .object({
        deploymentMode: z.enum(["local", "public"]),
        publicRuntimeSecurity: z.enum(["enforced", "development"]),
        authMode: z.enum(["none", "account"]),
        httpBind: z.string().min(1),
        httpPort: numberValue.pipe(z.number().int().min(1).max(65_535)),
        roomMaximumParticipants: numberValue.pipe(z.number().int().min(2).max(1_000)),
        roomMaximumPlayers: numberValue.pipe(z.number().int().min(2).max(1_000)),
        roomReconnectGraceSeconds: numberValue.pipe(z.number().int().min(120).max(3_600)),
        publicUrl: z.string().url(),
        publicUrlConfigured: z.boolean(),
        dbType: z.enum(["sqlite", "mariadb", "mysql"]),
        dbFile: z.string().min(1),
        dbHost: z.string().min(1),
        dbPort: numberValue.pipe(z.number().int().min(1).max(65_535)),
        dbName: z.string().min(1),
        dbUser: z.string(),
        dbPassword: z.string(),
        smtpHost: z.string(),
        smtpPort: numberValue.pipe(z.number().int().min(1).max(65_535)),
        smtpUser: z.string(),
        smtpPassword: z.string(),
        smtpEmail: z.string(),
        smtpPool: booleanValue,
        smtpSecure: booleanValue,
        oidcEnabled: booleanValue,
        oidcIssuer: z.string().max(255),
        oidcClientId: z.string(),
        oidcClientSecret: z.string(),
        oidcRedirectUrl: z.string(),
        oidcName: z.string(),
        trustProxy: trustProxyValue,
        logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]),
        logErrorDetails: z.enum(["standard", "diagnostic"]),
        sessionSecret: z.string().min(16),
        imprintUrl: optionalPublicUrl,
        privacyPolicyUrl: optionalPublicUrl,
        cardMissingTranslation: z.enum(["EXCLUDE", "FALLBACK"]),
        cardFallbackLocale: z.string().min(2).max(35),
        file: z.string(),
        testMode: z.boolean(),
    })
    .superRefine((value, context) => {
        const publicSecurityEnforced =
            value.deploymentMode === "public" && value.publicRuntimeSecurity === "enforced";
        if (value.deploymentMode === "public" && !value.publicUrlConfigured) {
            context.addIssue({
                code: "custom",
                path: ["publicUrl"],
                message: "public deployment requires an explicit PUBLIC_URL",
            });
        }
        if (value.publicUrlConfigured) {
            const configuredUrl = new URL(value.publicUrl);
            if (
                !["http:", "https:"].includes(configuredUrl.protocol) ||
                configuredUrl.username ||
                configuredUrl.password ||
                configuredUrl.pathname !== "/" ||
                configuredUrl.search ||
                configuredUrl.hash
            ) {
                context.addIssue({
                    code: "custom",
                    path: ["publicUrl"],
                    message: "PUBLIC_URL must be a credential-free HTTP(S) origin",
                });
            }
        }
        if (value.deploymentMode === "local" && value.dbType !== "sqlite" && !value.testMode) {
            context.addIssue({
                code: "custom",
                path: ["dbType"],
                message: "local deployment requires DB_TYPE=sqlite",
            });
        }
        if (publicSecurityEnforced && value.dbType === "sqlite") {
            context.addIssue({
                code: "custom",
                path: ["dbType"],
                message: "public deployment requires MariaDB/MySQL",
            });
        }
        if (publicSecurityEnforced && value.authMode !== "account") {
            context.addIssue({
                code: "custom",
                path: ["authMode"],
                message: "public deployment requires account authentication",
            });
        }
        if (publicSecurityEnforced) {
            const publicUrl = new URL(value.publicUrl);
            const testLoopbackOrigin =
                value.testMode &&
                publicUrl.protocol === "http:" &&
                ["localhost", "127.0.0.1", "[::1]"].includes(publicUrl.hostname);
            if (
                (publicUrl.protocol !== "https:" && !testLoopbackOrigin) ||
                publicUrl.username ||
                publicUrl.password ||
                publicUrl.pathname !== "/" ||
                publicUrl.search ||
                publicUrl.hash
            ) {
                context.addIssue({
                    code: "custom",
                    path: ["publicUrl"],
                    message:
                        "public deployment requires a credential-free HTTPS origin PUBLIC_URL (HTTP loopback is E2E-only)",
                });
            }
            if (!value.dbUser.trim() || !value.dbPassword) {
                context.addIssue({
                    code: "custom",
                    path: ["dbUser"],
                    message: "public deployment requires database credentials",
                });
            }
            if (value.sessionSecret.startsWith("local-") || value.sessionSecret.length < 32) {
                context.addIssue({
                    code: "custom",
                    path: ["sessionSecret"],
                    message: "public deployment requires an explicit 32-character SESSION_SECRET",
                });
            }
            if (
                !value.smtpHost.trim() ||
                !value.smtpUser.trim() ||
                !value.smtpPassword ||
                !z.email().safeParse(value.smtpEmail).success
            ) {
                context.addIssue({
                    code: "custom",
                    path: ["smtpHost"],
                    message: "public deployment requires complete SMTP configuration",
                });
            }
            if (typeof value.trustProxy !== "number" || value.trustProxy < 1) {
                context.addIssue({
                    code: "custom",
                    path: ["trustProxy"],
                    message: "public deployment requires a positive TRUST_PROXY hop count",
                });
            }
        }
        if (value.oidcEnabled && value.authMode !== "account") {
            context.addIssue({
                code: "custom",
                path: ["oidcEnabled"],
                message: "OIDC requires account authentication",
            });
        }
        if (value.oidcEnabled) {
            const requiredOidcValues = [
                value.oidcIssuer,
                value.oidcClientId,
                value.oidcClientSecret,
                value.oidcRedirectUrl,
                value.oidcName,
            ];
            if (requiredOidcValues.some((entry) => !entry.trim())) {
                context.addIssue({
                    code: "custom",
                    path: ["oidcEnabled"],
                    message: "enabled OIDC requires complete provider configuration",
                });
            }
            const redirect = z.url().safeParse(value.oidcRedirectUrl);
            const issuer = z.url().safeParse(value.oidcIssuer);
            if (!redirect.success || !issuer.success) {
                context.addIssue({
                    code: "custom",
                    path: ["oidcRedirectUrl"],
                    message: "OIDC issuer and redirect must be valid URLs",
                });
            }
            if (value.deploymentMode === "public" && redirect.success && issuer.success) {
                const expectedRedirect = new URL("/api/v1/account/oidc/callback", value.publicUrl)
                    .href;
                const insecureOidc =
                    publicSecurityEnforced &&
                    (new URL(value.oidcRedirectUrl).protocol !== "https:" ||
                        new URL(value.oidcIssuer).protocol !== "https:");
                if (insecureOidc || value.oidcRedirectUrl !== expectedRedirect) {
                    context.addIssue({
                        code: "custom",
                        path: ["oidcRedirectUrl"],
                        message: publicSecurityEnforced
                            ? "public OIDC requires HTTPS URLs and the canonical callback URL"
                            : "public OIDC requires the canonical callback URL",
                    });
                }
            }
        }
    });

export type Settings = z.infer<typeof settingsSchema> & { initialized: boolean };

export function isPublicRuntimeSecurityEnforced(
    value: Pick<Settings, "deploymentMode" | "publicRuntimeSecurity">,
): boolean {
    return value.deploymentMode === "public" && value.publicRuntimeSecurity === "enforced";
}

const defaults = {
    deploymentMode: "local",
    publicRuntimeSecurity: "enforced",
    authMode: "none",
    httpBind: "::",
    httpPort: 3000,
    roomMaximumParticipants: 100,
    roomMaximumPlayers: 100,
    roomReconnectGraceSeconds: 180,
    publicUrl: "http://localhost:3000",
    publicUrlConfigured: false,
    dbType: "sqlite",
    dbFile: "./data/card-game.sqlite",
    dbHost: "localhost",
    dbPort: 3306,
    dbName: "card_game",
    dbUser: "",
    dbPassword: "",
    smtpHost: "",
    smtpPort: 465,
    smtpUser: "",
    smtpPassword: "",
    smtpEmail: "",
    smtpPool: true,
    smtpSecure: true,
    oidcEnabled: false,
    oidcIssuer: "",
    oidcClientId: "",
    oidcClientSecret: "",
    oidcRedirectUrl: "http://localhost:3000/api/v1/account/oidc/callback",
    oidcName: "OIDC Provider",
    trustProxy: false,
    logLevel: "info",
    logErrorDetails: "standard",
    sessionSecret: `local-${crypto.randomBytes(24).toString("base64url")}`,
    imprintUrl: "",
    privacyPolicyUrl: "",
    cardMissingTranslation: "EXCLUDE",
    cardFallbackLocale: "de-DE",
    file: "./settings.csv",
    testMode: false,
} satisfies z.input<typeof settingsSchema>;

const keyMap: Record<string, keyof typeof defaults> = {
    DEPLOYMENT_MODE: "deploymentMode",
    PUBLIC_RUNTIME_SECURITY: "publicRuntimeSecurity",
    AUTH_MODE: "authMode",
    HTTP_BIND: "httpBind",
    HTTP_PORT: "httpPort",
    APP_PORT: "httpPort",
    ROOM_MAX_PARTICIPANTS: "roomMaximumParticipants",
    ROOM_MAX_PLAYERS: "roomMaximumPlayers",
    ROOM_RECONNECT_GRACE_SECONDS: "roomReconnectGraceSeconds",
    PUBLIC_URL: "publicUrl",
    ROOT_URL: "publicUrl",
    DB_TYPE: "dbType",
    DB_FILE: "dbFile",
    DB_HOST: "dbHost",
    DB_PORT: "dbPort",
    DB_NAME: "dbName",
    DB_USER: "dbUser",
    DB_PASSWORD: "dbPassword",
    SMTP_HOST: "smtpHost",
    SMTP_PORT: "smtpPort",
    SMTP_USER: "smtpUser",
    SMTP_PASSWORD: "smtpPassword",
    SMTP_EMAIL: "smtpEmail",
    SMTP_POOL: "smtpPool",
    SMTP_SECURE: "smtpSecure",
    OIDC_ENABLED: "oidcEnabled",
    OIDC_ISSUER: "oidcIssuer",
    OIDC_ISSUER_BASE_URL: "oidcIssuer",
    OIDC_CLIENT_ID: "oidcClientId",
    OIDC_CLIENT_SECRET: "oidcClientSecret",
    OIDC_REDIRECT_URL: "oidcRedirectUrl",
    OIDC_NAME: "oidcName",
    TRUST_PROXY: "trustProxy",
    LOG_LEVEL: "logLevel",
    LOG_ERROR_DETAILS: "logErrorDetails",
    SESSION_SECRET: "sessionSecret",
    IMPRINT_URL: "imprintUrl",
    PRIVACY_POLICY_URL: "privacyPolicyUrl",
    CARD_MISSING_TRANSLATION: "cardMissingTranslation",
    CARD_FALLBACK_LOCALE: "cardFallbackLocale",
};

function loadCsv(file: string): Record<string, unknown> {
    if (!fs.existsSync(file)) return {};
    const result: Record<string, unknown> = {};
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        if (!line.trim() || line.trimStart().startsWith("#")) continue;
        const [rawKey, ...rest] = line.split(",");
        const key = keyMap[rawKey.trim()];
        if (key) result[key] = rest.join(",").trim();
    }
    return result;
}

export function resolveSettings(
    environment: NodeJS.ProcessEnv = process.env,
    file?: string,
): Settings {
    const configFile = file ?? environment.SETTINGS_FILE ?? defaults.file;
    const fromFile = loadCsv(configFile);
    const fromEnvironment: Record<string, unknown> = {};
    for (const [external, internal] of Object.entries(keyMap)) {
        const e2eValue =
            environment.NODE_ENV === "e2e" ? environment[`E2E_${external}`] : undefined;
        const value = e2eValue ?? environment[external];
        if (value !== undefined && value !== "") fromEnvironment[internal] = value;
    }
    const publicUrlConfigured =
        Object.hasOwn(fromFile, "publicUrl") || Object.hasOwn(fromEnvironment, "publicUrl");
    const parsed = settingsSchema.parse({
        ...defaults,
        ...fromFile,
        ...fromEnvironment,
        publicUrlConfigured,
        file: configFile,
        testMode: environment.NODE_ENV === "e2e",
    });
    return {
        ...parsed,
        initialized: true,
    };
}

export class SettingsStore {
    private settings: Settings = { ...resolveSettings({}, "/dev/null"), initialized: false };
    get value(): Settings {
        return this.settings;
    }
    async read(file?: string): Promise<void> {
        this.settings = resolveSettings(process.env, file);
    }
}

export default new SettingsStore();
