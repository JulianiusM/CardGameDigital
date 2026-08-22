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

export const settingsSchema = z
    .object({
        deploymentMode: z.enum(["local", "public"]),
        authMode: z.enum(["none", "account"]),
        httpBind: z.string().min(1),
        httpPort: numberValue.pipe(z.number().int().min(1).max(65_535)),
        publicUrl: z.string().url(),
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
        oidcIssuer: z.string(),
        oidcClientId: z.string(),
        oidcClientSecret: z.string(),
        oidcRedirectUrl: z.string(),
        oidcName: z.string(),
        trustProxy: z.union([booleanValue, numberValue.pipe(z.number().int().nonnegative())]),
        logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]),
        sessionSecret: z.string().min(16),
        imprintUrl: z.string(),
        privacyPolicyUrl: z.string(),
        cardMissingTranslation: z.enum(["EXCLUDE", "FALLBACK"]),
        cardFallbackLocale: z.string().min(2).max(35),
        file: z.string(),
    })
    .superRefine((value, context) => {
        if (value.deploymentMode === "local" && value.dbType !== "sqlite") {
            context.addIssue({
                code: "custom",
                path: ["dbType"],
                message: "local deployment requires DB_TYPE=sqlite",
            });
        }
        if (value.deploymentMode === "public" && value.dbType === "sqlite") {
            context.addIssue({
                code: "custom",
                path: ["dbType"],
                message: "public deployment requires MariaDB/MySQL",
            });
        }
        if (value.deploymentMode === "public" && value.authMode !== "account") {
            context.addIssue({
                code: "custom",
                path: ["authMode"],
                message: "public deployment requires account authentication",
            });
        }
        if (value.oidcEnabled && value.authMode !== "account") {
            context.addIssue({
                code: "custom",
                path: ["oidcEnabled"],
                message: "OIDC requires account authentication",
            });
        }
    });

export type Settings = z.infer<typeof settingsSchema> & {
    initialized: boolean;
    // Compatibility names retained while account/UI callers migrate.
    appPort: number;
    rootUrl: string;
    localLoginEnabled: boolean;
    oidcIssuerBaseUrl: string;
};

const defaults = {
    deploymentMode: "local",
    authMode: "none",
    httpBind: "127.0.0.1",
    httpPort: 3000,
    publicUrl: "http://localhost:3000",
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
    sessionSecret: `local-${crypto.randomBytes(24).toString("base64url")}`,
    imprintUrl: "",
    privacyPolicyUrl: "",
    cardMissingTranslation: "EXCLUDE",
    cardFallbackLocale: "de-DE",
    file: "./settings.csv",
} satisfies z.input<typeof settingsSchema>;

const keyMap: Record<string, keyof typeof defaults> = {
    DEPLOYMENT_MODE: "deploymentMode",
    AUTH_MODE: "authMode",
    HTTP_BIND: "httpBind",
    HTTP_PORT: "httpPort",
    APP_PORT: "httpPort",
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
    const parsed = settingsSchema.parse({
        ...defaults,
        ...fromFile,
        ...fromEnvironment,
        file: configFile,
    });
    return {
        ...parsed,
        initialized: true,
        appPort: parsed.httpPort,
        rootUrl: parsed.publicUrl,
        localLoginEnabled: parsed.authMode === "account",
        oidcIssuerBaseUrl: parsed.oidcIssuer,
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
