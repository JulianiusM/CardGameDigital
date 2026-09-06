/* Copyright 2026 Julian Malovanij, Apache-2.0 */

import * as dotenv from "dotenv";
import crypto from "node:crypto";
import fs from "node:fs";
import { z } from "zod";
import { MAX_ROOM_PARTICIPANTS, MAX_ROOM_PLAYERS } from "../../../../packages/protocol/limits";
import {
    operationalSettingsDefaults,
    operationalSettingsShape,
    operationalSettingsKeys,
    validateOperationalSettings,
} from "./operationalSettings";

const envPath =
    process.env.E2E_DOTENV_FILE ?? (process.env.NODE_ENV === "e2e" ? ".env.e2e" : ".env");
dotenv.config({ path: envPath });

const booleanValue = z
    .union([z.boolean(), z.enum(["1", "0", "true", "false", "yes", "no", "on", "off"])])
    .transform((value) => (typeof value === "boolean" ? value : /^(1|true|yes|on)$/i.test(value)));
const numberValue = z.union([z.number(), z.string()]).transform(Number).pipe(z.number());
const commaSeparatedValues = z
    .union([z.array(z.string()), z.string()])
    .transform((value) => (Array.isArray(value) ? value : value.split(",")))
    .transform((values) => values.map((value) => value.trim()).filter(Boolean));
const normalizedDisplayName = z
    .string()
    .transform((value) => value.trim().normalize("NFC"))
    .pipe(
        z
            .string()
            .min(1)
            .refine((value) => [...value].length <= 80, "must contain at most 80 Unicode scalars")
            .refine(
                (value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value),
                "must not contain controls",
            ),
    );
const relativeEndpointPath = z
    .string()
    .startsWith("/")
    .refine((value) => !value.startsWith("//") && !value.includes("://"));
const webSocketEndpointPath = relativeEndpointPath
    .refine((value) => !/[?#]/u.test(value), "must be a path without query or fragment")
    .refine(
        (value) => !/(credential|token|secret|idempotency|participantId)/i.test(value),
        "must be credential-free",
    );
const roomJoinPathTemplate = relativeEndpointPath
    .refine(
        (value) => value.split("{roomCode}").length === 2,
        "must contain exactly one {roomCode} placeholder",
    )
    .refine(
        (value) => !/(credential|token|secret|idempotency|participantId)/i.test(value),
        "must be credential-free",
    );
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
        ...operationalSettingsShape,
        deploymentMode: z.enum(["local", "public"]),
        publicRuntimeSecurity: z.enum(["enforced", "development"]),
        authMode: z.enum(["none", "account"]),
        httpBind: z.string().min(1),
        httpPort: numberValue.pipe(z.number().int().min(1).max(65_535)),
        roomMaximumParticipants: numberValue.pipe(
            z.number().int().min(2).max(MAX_ROOM_PARTICIPANTS),
        ),
        roomMaximumPlayers: numberValue.pipe(z.number().int().min(2).max(MAX_ROOM_PLAYERS)),
        roomReconnectGraceSeconds: numberValue.pipe(z.number().int().min(120).max(3_600)),
        roomDisplayBootstrapEnabled: booleanValue,
        roomDisplayBootstrapConfigured: z.boolean(),
        roomInitialActivationSeconds: numberValue.pipe(z.number().int().min(30).max(3_600)),
        unactivatedParticipantTtlSeconds: numberValue.pipe(z.number().int().min(30).max(3_600)),
        roomCreateIdempotencyTombstoneSeconds: numberValue.pipe(
            z.number().int().min(3_600).max(604_800),
        ),
        roomCreateSecret: z.string(),
        roomCreateSecretFile: z.string().min(1),
        serverDisplayName: normalizedDisplayName,
        mdnsDiscoveryEnabled: booleanValue,
        mdnsDiscoveryConfigured: z.boolean(),
        mdnsServiceType: z.string().regex(/^_[a-z][a-z0-9-]{0,14}\._tcp$/),
        mdnsInstanceName: z.string(),
        mdnsHostLabel: z
            .string()
            .min(1)
            .max(63)
            .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
        mdnsInterfaceAllowlist: commaSeparatedValues,
        mdnsInterfaceDenylist: commaSeparatedValues,
        mdnsAllowPublicIpv4: booleanValue,
        mdnsAdvertisedPort: numberValue.pipe(z.number().int().min(1).max(65_535)),
        mdnsAdvertisedTls: booleanValue,
        webSocketPath: webSocketEndpointPath,
        roomJoinPathTemplate,
        publicUrl: z.url(),
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
    .superRefine(validateOperationalSettings)
    .superRefine(function validateDeploymentOrigin(value, context) {
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
    })
    .superRefine(function validateDiscoverySettings(value, context) {
        const overlappingInterfaces = value.mdnsInterfaceAllowlist.filter((name) =>
            value.mdnsInterfaceDenylist.includes(name),
        );
        if (overlappingInterfaces.length) {
            context.addIssue({
                code: "custom",
                path: ["mdnsInterfaceAllowlist"],
                message: "mDNS interface allowlist and denylist must not overlap",
            });
        }
        if (
            value.mdnsDiscoveryEnabled &&
            value.mdnsServiceType !== "_partycard._tcp" &&
            !value.testMode
        ) {
            context.addIssue({
                code: "custom",
                path: ["mdnsServiceType"],
                message: "MDNS_SERVICE_TYPE is the release constant _partycard._tcp",
            });
        }
        const endpointUsesTls = value.publicUrlConfigured
            ? new URL(value.publicUrl).protocol === "https:"
            : false;
        const configuredFrontDoor = value.publicUrlConfigured ? new URL(value.publicUrl) : null;
        let frontDoorPort = value.httpPort;
        if (configuredFrontDoor) {
            const defaultPort = configuredFrontDoor.protocol === "https:" ? "443" : "80";
            frontDoorPort = Number(configuredFrontDoor.port || defaultPort);
        }
        if (value.mdnsDiscoveryEnabled && value.mdnsAdvertisedTls !== endpointUsesTls) {
            context.addIssue({
                code: "custom",
                path: ["mdnsAdvertisedTls"],
                message: "mDNS TLS metadata must match the advertised HTTP front door",
            });
        }
        if (value.mdnsDiscoveryEnabled && value.mdnsAdvertisedPort !== frontDoorPort) {
            context.addIssue({
                code: "custom",
                path: ["mdnsAdvertisedPort"],
                message:
                    "mDNS port must match the configured HTTP listener or PUBLIC_URL front door",
            });
        }
    })
    .superRefine(function validatePublicDatabase(value, context) {
        const publicSecurityEnforced = isPublicRuntimeSecurityEnforced(value);
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
    })
    .superRefine(function validatePublicOrigin(value, context) {
        if (!isPublicRuntimeSecurityEnforced(value)) return;
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
    })
    .superRefine(function validatePublicCredentials(value, context) {
        if (!isPublicRuntimeSecurityEnforced(value)) return;
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
    })
    .superRefine(function validateOidcSettings(value, context) {
        const publicSecurityEnforced = isPublicRuntimeSecurityEnforced(value);
        if (value.oidcEnabled && value.authMode !== "account") {
            context.addIssue({
                code: "custom",
                path: ["oidcEnabled"],
                message: "OIDC requires account authentication",
            });
        }
        if (!value.oidcEnabled) return;
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
            const expectedRedirect = new URL("/api/v1/account/oidc/callback", value.publicUrl).href;
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
    });

export type Settings = z.infer<typeof settingsSchema> & { initialized: boolean };

export function isPublicRuntimeSecurityEnforced(
    value: Pick<Settings, "deploymentMode" | "publicRuntimeSecurity">,
): boolean {
    return value.deploymentMode === "public" && value.publicRuntimeSecurity === "enforced";
}

const defaults = {
    ...operationalSettingsDefaults,
    deploymentMode: "local",
    publicRuntimeSecurity: "enforced",
    authMode: "none",
    httpBind: "::",
    httpPort: 3000,
    roomMaximumParticipants: 100,
    roomMaximumPlayers: 100,
    roomReconnectGraceSeconds: 180,
    roomDisplayBootstrapEnabled: true,
    roomDisplayBootstrapConfigured: false,
    roomInitialActivationSeconds: 300,
    unactivatedParticipantTtlSeconds: 300,
    roomCreateIdempotencyTombstoneSeconds: 86_400,
    roomCreateSecret: "",
    roomCreateSecretFile: "./data/room-create-idempotency.key",
    serverDisplayName: "Party Game",
    mdnsDiscoveryEnabled: true,
    mdnsDiscoveryConfigured: false,
    mdnsServiceType: "_partycard._tcp",
    mdnsInstanceName: "",
    mdnsHostLabel: "party-game",
    mdnsInterfaceAllowlist: [],
    mdnsInterfaceDenylist: [],
    mdnsAllowPublicIpv4: false,
    mdnsAdvertisedPort: 3000,
    mdnsAdvertisedTls: false,
    webSocketPath: "/ws",
    roomJoinPathTemplate: "/play/?room={roomCode}",
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
    ...operationalSettingsKeys,
    DEPLOYMENT_MODE: "deploymentMode",
    PUBLIC_RUNTIME_SECURITY: "publicRuntimeSecurity",
    AUTH_MODE: "authMode",
    HTTP_BIND: "httpBind",
    HTTP_PORT: "httpPort",
    APP_PORT: "httpPort",
    ROOM_MAX_PARTICIPANTS: "roomMaximumParticipants",
    ROOM_MAX_PLAYERS: "roomMaximumPlayers",
    ROOM_RECONNECT_GRACE_SECONDS: "roomReconnectGraceSeconds",
    ROOM_DISPLAY_BOOTSTRAP_ENABLED: "roomDisplayBootstrapEnabled",
    ROOM_INITIAL_ACTIVATION_SECONDS: "roomInitialActivationSeconds",
    UNACTIVATED_PARTICIPANT_TTL_SECONDS: "unactivatedParticipantTtlSeconds",
    ROOM_CREATE_IDEMPOTENCY_TOMBSTONE_SECONDS: "roomCreateIdempotencyTombstoneSeconds",
    ROOM_CREATE_SECRET: "roomCreateSecret",
    ROOM_CREATE_SECRET_FILE: "roomCreateSecretFile",
    SERVER_DISPLAY_NAME: "serverDisplayName",
    MDNS_DISCOVERY_ENABLED: "mdnsDiscoveryEnabled",
    MDNS_SERVICE_TYPE: "mdnsServiceType",
    MDNS_INSTANCE_NAME: "mdnsInstanceName",
    MDNS_HOST_LABEL: "mdnsHostLabel",
    MDNS_INTERFACE_ALLOWLIST: "mdnsInterfaceAllowlist",
    MDNS_INTERFACE_DENYLIST: "mdnsInterfaceDenylist",
    MDNS_ALLOW_PUBLIC_IPV4: "mdnsAllowPublicIpv4",
    MDNS_ADVERTISED_PORT: "mdnsAdvertisedPort",
    MDNS_ADVERTISED_TLS: "mdnsAdvertisedTls",
    WEB_SOCKET_PATH: "webSocketPath",
    ROOM_JOIN_PATH_TEMPLATE: "roomJoinPathTemplate",
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
    const roomDisplayBootstrapConfigured =
        Object.hasOwn(fromFile, "roomDisplayBootstrapEnabled") ||
        Object.hasOwn(fromEnvironment, "roomDisplayBootstrapEnabled");
    const mdnsDiscoveryConfigured =
        Object.hasOwn(fromFile, "mdnsDiscoveryEnabled") ||
        Object.hasOwn(fromEnvironment, "mdnsDiscoveryEnabled");
    const combined = { ...defaults, ...fromFile, ...fromEnvironment };
    const deploymentMode = combined.deploymentMode;
    const localDeployment = deploymentMode === "local";
    const httpPort = Number(combined.httpPort);
    const parsed = settingsSchema.parse({
        ...combined,
        publicUrlConfigured,
        roomDisplayBootstrapConfigured,
        roomDisplayBootstrapEnabled: roomDisplayBootstrapConfigured
            ? combined.roomDisplayBootstrapEnabled
            : localDeployment,
        mdnsDiscoveryConfigured,
        mdnsDiscoveryEnabled: mdnsDiscoveryConfigured
            ? combined.mdnsDiscoveryEnabled
            : localDeployment,
        mdnsAdvertisedPort:
            Object.hasOwn(fromFile, "mdnsAdvertisedPort") ||
            Object.hasOwn(fromEnvironment, "mdnsAdvertisedPort")
                ? combined.mdnsAdvertisedPort
                : httpPort,
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
