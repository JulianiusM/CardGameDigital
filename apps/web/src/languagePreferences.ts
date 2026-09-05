import type { AccountBootstrapStatus, LanguagePreferences } from "../../../packages/protocol";

export type { LanguagePreferences };

const STORAGE_KEY = "party-game.language-preferences.v1";
const LEGACY_INTERFACE_LOCALE_KEY = "party-game.locale";

const automaticPreferences: LanguagePreferences = {
    useSystemLanguage: true,
    interfaceLocale: null,
    cardLocale: null,
    fallbackLocales: [],
};

function validStoredPreferences(value: unknown): value is LanguagePreferences {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<LanguagePreferences>;
    return (
        typeof candidate.useSystemLanguage === "boolean" &&
        (candidate.interfaceLocale === null || typeof candidate.interfaceLocale === "string") &&
        (candidate.cardLocale === null || typeof candidate.cardLocale === "string") &&
        Array.isArray(candidate.fallbackLocales) &&
        candidate.fallbackLocales.every((entry) => typeof entry === "string")
    );
}

export function loadLanguagePreferences(): LanguagePreferences {
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
        if (validStoredPreferences(parsed))
            return { ...parsed, fallbackLocales: [...parsed.fallbackLocales] };
        const legacyLocale = localStorage.getItem(LEGACY_INTERFACE_LOCALE_KEY);
        if (legacyLocale) {
            return {
                ...automaticPreferences,
                useSystemLanguage: false,
                interfaceLocale: legacyLocale,
            };
        }
    } catch {
        // Invalid browser storage is ignored; browser language remains authoritative.
    }
    return { ...automaticPreferences };
}

export function saveLanguagePreferences(preferences: LanguagePreferences): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    localStorage.removeItem(LEGACY_INTERFACE_LOCALE_KEY);
}

export function updateLocalLanguagePreferences(
    patch: Partial<LanguagePreferences>,
): LanguagePreferences {
    const preferences = { ...loadLanguagePreferences(), ...patch };
    preferences.fallbackLocales = [...new Set(preferences.fallbackLocales)];
    saveLanguagePreferences(preferences);
    return preferences;
}

export function browserLanguageCandidates(): string[] {
    return [...new Set([...(navigator.languages ?? []), navigator.language].filter(Boolean))];
}

export function matchSupportedLanguage(
    candidates: readonly string[],
    supported: readonly string[],
    deterministicDefault: string,
): string {
    const exact = new Map(supported.map((entry) => [entry.toLowerCase(), entry]));
    for (const candidate of candidates) {
        const matched = exact.get(candidate.toLowerCase());
        if (matched) return matched;
        const language = candidate.split("-")[0].toLowerCase();
        const related = supported.find((entry) => entry.split("-")[0].toLowerCase() === language);
        if (related) return related;
    }
    return deterministicDefault;
}

/** Load account-owned choices before localization modules are evaluated. */
export async function bootstrapAccountLanguagePreferences(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_500);
    try {
        const response = await fetch("/api/v1/account/status", {
            headers: { Accept: "application/json" },
            credentials: "same-origin",
            signal: controller.signal,
        });
        if (!response.ok) return;
        const body = (await response.json()) as AccountBootstrapStatus;
        const preferences = body.authenticated ? body.account?.languagePreferences : null;
        if (preferences && validStoredPreferences(preferences))
            saveLanguagePreferences(preferences);
    } catch {
        // Offline startup keeps the last local choice and remains playable after reconnection.
    } finally {
        clearTimeout(timeout);
    }
}
