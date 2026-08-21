/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// src/settings-csv.ts
import * as dotenv from "dotenv";
import crypto from "node:crypto";
import fs from "node:fs";

// Load env before anything else.
// Priority: E2E_DOTENV_FILE > .env.e2e (when NODE_ENV=e2e) > .env
const envPath =
    process.env.E2E_DOTENV_FILE ??
    (process.env.NODE_ENV === "e2e" ? ".env.e2e" : ".env");
dotenv.config({path: envPath});

export type Settings = {
    appPort: number;
    file: string;
    dbType: "mariadb" | "mysql";
    dbName: string;
    dbHost: string;
    dbPassword: string;
    dbPort: number;
    dbUser: string;
    rootUrl: string;
    sessionSecret: string;
    smtpEmail: string;
    smtpHost: string;
    smtpPassword: string;
    smtpPool: boolean;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUser: string;
    localLoginEnabled: boolean;
    oidcEnabled: boolean;
    oidcName: string;
    oidcIssuerBaseUrl: string;
    oidcClientId: string;
    oidcClientSecret: string;
    oidcRedirectUrl: string;
    invoiceDir: string;
    headerImgDir: string;
    imprintUrl: string;
    privacyPolicyUrl: string;
    initialized: boolean;
    activityAvailabilityWeight: number;
    activitySwapOptimizationIterations: number;
    activityArrivalDeparturePenalty: number;
};

const defaults: Settings = {
    initialized: false,
    rootUrl: "http://localhost:3000",

    dbType: "mariadb",
    dbHost: "localhost",
    dbPort: 3306,
    dbUser: "user",
    dbPassword: "password",
    dbName: "database",

    smtpPool: true,
    smtpHost: "smtp.example.com",
    smtpPort: 465,
    smtpSecure: true,
    smtpEmail: "test@example.com",
    smtpUser: "username",
    smtpPassword: "password",

    oidcEnabled: false,
    oidcName: "OIDC Provider",
    oidcClientId: "CLIENT_ID",
    oidcClientSecret: "CLIENT_SECRET",
    oidcIssuerBaseUrl: "http://example.com",
    oidcRedirectUrl: "http://localhost:3000/user/oidc/callback",

    localLoginEnabled: true,

    sessionSecret:
        "CHANGE__" + crypto.randomBytes(32).toString("base64url").slice(0, 20),
    appPort: 3000,

    file: "./settings.csv",

    invoiceDir: "uploads/invoices/",
    headerImgDir: "uploads/headerImgs/",

    imprintUrl: "http://example.com/imprint",
    privacyPolicyUrl: "http://example.com/privacy",

    activityAvailabilityWeight: 0.30,
    activitySwapOptimizationIterations: 10,
    activityArrivalDeparturePenalty: 0.2,
};

// CSV_KEY -> settings key
const keyMap: Record<string, keyof Settings> = {
    ROOT_URL: "rootUrl",
    DB_TYPE: "dbType",
    DB_HOST: "dbHost",
    DB_PORT: "dbPort",
    DB_NAME: "dbName",
    DB_USER: "dbUser",
    DB_PASSWORD: "dbPassword",
    SMTP_POOL: "smtpPool",
    SMTP_HOST: "smtpHost",
    SMTP_PORT: "smtpPort",
    SMTP_SECURE: "smtpSecure",
    SMTP_EMAIL: "smtpEmail",
    SMTP_USER: "smtpUser",
    SMTP_PASSWORD: "smtpPassword",
    OIDC_ENABLED: "oidcEnabled",
    OIDC_NAME: "oidcName",
    OIDC_CLIENT_ID: "oidcClientId",
    OIDC_CLIENT_SECRET: "oidcClientSecret",
    OIDC_ISSUER_BASE_URL: "oidcIssuerBaseUrl",
    OIDC_REDIRECT_URL: "oidcRedirectUrl",
    LOCAL_LOGIN_ENABLED: "localLoginEnabled",
    SESSION_SECRET: "sessionSecret",
    APP_PORT: "appPort",
    INVOICE_DIR: "invoiceDir",
    HEADER_IMG_DIR: "headerImgDir",
    IMPRINT_URL: "imprintUrl",
    PRIVACY_POLICY_URL: "privacyPolicyUrl",
    ACTIVITY_AVAILABILITY_WEIGHT: "activityAvailabilityWeight",
    ACTIVITY_SWAP_OPTIMIZATION_ITERATIONS: "activitySwapOptimizationIterations",
    ACTIVITY_ARRIVAL_DEPARTURE_PENALTY: "activityArrivalDeparturePenalty",
};

// per-field coercion
const coerce: Partial<Record<keyof Settings, (v: string) => any>> = {
    dbPort: Number,
    smtpPort: Number,
    appPort: Number,
    smtpPool: (v) => /^(1|true|yes|on)$/i.test(v),
    smtpSecure: (v) => /^(1|true|yes|on)$/i.test(v),
    localLoginEnabled: (v) => /^(1|true|yes|on)$/i.test(v),
    oidcEnabled: (v) => /^(1|true|yes|on)$/i.test(v),
    activityAvailabilityWeight: Number,
    activitySwapOptimizationIterations: Number,
    activityArrivalDeparturePenalty: Number,
};

// Apply environment variable overrides AFTER reading CSV.
// In E2E: E2E_* vars override; otherwise plain vars override.
// Example: E2E_DB_HOST > DB_HOST > CSV value.
function applyEnvOverrides(target: Settings): void {
    const entries = Object.entries(keyMap) as [string, keyof Settings][];

    for (const [csvKey, settingsKey] of entries) {
        // Prefer E2E_ prefixed variables when running in E2E mode
        let raw;
        if (process.env.NODE_ENV === 'e2e') {
            raw = process.env[`E2E_${csvKey}` as keyof NodeJS.ProcessEnv]
        }
        raw = raw ?? process.env[csvKey as keyof NodeJS.ProcessEnv];

        if (raw === undefined || raw === "") continue;

        const conv = coerce[settingsKey];
        const v = conv ? conv(String(raw)) : String(raw);
        (target as any)[settingsKey] = v;
    }

    // Allow overriding the settings file location itself.
    if (process.env.SETTINGS_FILE) {
        target.file = process.env.SETTINGS_FILE;
    }

    // Safety: when in E2E, nudge to use a dedicated database.
    if (
        process.env.NODE_ENV === "e2e" &&
        target.dbName &&
        !/e2e/i.test(target.dbName)
    ) {
        console.warn(
            `[settings] E2E mode: database name "${target.dbName}" does not contain "e2e". ` +
            `Consider setting E2E_DB_NAME for safety.`
        );
    }
}

export class SettingsStore {
    private readonly _settings: Settings = {...defaults};

    get value(): Settings {
        return this._settings;
    }

    async read(file = this._settings.file, forceCsv: boolean = false): Promise<void> {
        // If an env override for the file is present, prefer it.
        if (!forceCsv && process.env.SETTINGS_FILE) {
            file = process.env.SETTINGS_FILE;
            this._settings.file = file;
        }

        const isE2E = process.env.NODE_ENV === "e2e";

        // If the CSV doesn't exist:
        // - in normal modes, create it from defaults (original behavior)
        // - in E2E, SKIP writing (we rely on env-only for secrets)
        if (!fs.existsSync(file)) {
            if (!isE2E) {
                await this.write(file);
            }
            applyEnvOverrides(this._settings);
            this._settings.initialized = true;
            return;
        }

        // Parse CSV
        const text = fs.readFileSync(file, "utf8");
        for (const line of text.split(/\r?\n/)) {
            if (!line.trim()) continue;
            const [kRaw, ...rest] = line.split(",");
            const k = kRaw.trim();
            const vRaw = rest.join(","); // allow commas in values
            const mapKey = keyMap[k];
            if (!mapKey) {
                console.warn("Unknown setting:", k);
                continue;
            }
            const conv = coerce[mapKey];
            const v = (conv ? conv(vRaw) : vRaw) as any;
            (this._settings as any)[mapKey] = v;
        }

        // Finally, apply env overrides on top.
        if (!forceCsv) applyEnvOverrides(this._settings);
        this._settings.initialized = true;
    }

    async write(file = this._settings.file): Promise<void> {
        const reverse = Object.fromEntries(
            Object.entries(keyMap).map(([csv, key]) => [key, csv])
        );
        const lines: string[] = [];
        for (const [key, value] of Object.entries(this._settings)) {
            const csvKey = (reverse as any)[key];
            if (!csvKey) continue; // skip fields not in CSV
            lines.push(`${csvKey},${String(value)}`);
        }
        fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
        console.log("Settings file written!");
    }
}

const settingsStore = new SettingsStore();
export default settingsStore;
