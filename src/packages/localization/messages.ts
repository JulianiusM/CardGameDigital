import type { MessageParameters } from "./catalog";
import { MESSAGE_KEYS, type MessageKey } from "./keys";
import { de } from "./locales/de";
import { en } from "./locales/en";

export { MESSAGE_KEYS, type MessageKey } from "./keys";
export type { MessageParameters } from "./catalog";

export const DEFAULT_LOCALE = "en" as const;
export const localeCatalogs = { de, en } as const;
export type Locale = keyof typeof localeCatalogs;
export type EmailKind = Exclude<keyof (typeof en)["email"], "signature">;
function supportedLocale(candidate: string | undefined): Locale | undefined {
    if (!candidate) return undefined;
    const normalized = candidate.toLowerCase();
    if (normalized in localeCatalogs) return normalized as Locale;
    const base = normalized.split("-")[0];
    return base in localeCatalogs ? (base as Locale) : undefined;
}

export function detectLocale(acceptLanguage?: string | null): Locale {
    if (!acceptLanguage) return DEFAULT_LOCALE;
    const preferences = acceptLanguage
        .split(",")
        .map((entry) => entry.trim().split(";")[0])
        .filter(Boolean);
    for (const preference of preferences) {
        const locale = supportedLocale(preference);
        if (locale) return locale;
    }
    return DEFAULT_LOCALE;
}

function interpolate(template: string, parameters: MessageParameters): string {
    return template.replace(/\{(\w+)\}/g, (_match, key: string) =>
        String(parameters[key] ?? `{${key}}`),
    );
}

export function translate(
    locale: Locale,
    key: MessageKey,
    parameters: MessageParameters = {},
): string {
    const fallback = localeCatalogs[DEFAULT_LOCALE];
    const catalog = localeCatalogs[locale] ?? fallback;
    const template = catalog.messages[key] ?? fallback.messages[key];
    return interpolate(template, parameters);
}

const knownMessageKeys = new Set<MessageKey>(Object.values(MESSAGE_KEYS));

export function translateError(locale: Locale, candidate: string | undefined): string {
    const key = knownMessageKeys.has(candidate as MessageKey)
        ? (candidate as MessageKey)
        : MESSAGE_KEYS.REQUEST_INTERNAL;
    return translate(locale, key);
}

export function emailMessage(
    locale: Locale,
    kind: EmailKind,
    parameters: MessageParameters = {},
): { subject: string; text: string } {
    const catalog = localeCatalogs[locale] ?? localeCatalogs[DEFAULT_LOCALE];
    const fallback = localeCatalogs[DEFAULT_LOCALE];
    const message = catalog.email[kind] ?? fallback.email[kind];
    return {
        subject: interpolate(message.subject, parameters),
        text: interpolate(message.body, {
            ...parameters,
            signature: catalog.email.signature ?? fallback.email.signature,
        }),
    };
}
