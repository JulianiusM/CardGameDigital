import { defaultLocale, localeCatalogs, localeDefinitions, type MessageCatalog } from "./locales";
import {
    browserLanguageCandidates,
    loadLanguagePreferences,
    matchSupportedLanguage,
    updateLocalLanguagePreferences,
} from "./languagePreferences";
import { reloadWithoutNavigationPrompt } from "./router";

export { localeDefinitions } from "./locales";

export type Locale = keyof typeof localeCatalogs;
export type Messages = MessageCatalog;

const supportedLocales = Object.keys(localeCatalogs) as Locale[];
function detectLocale(): Locale {
    const preferences = loadLanguagePreferences();
    const requested = preferences.useSystemLanguage
        ? browserLanguageCandidates()
        : [preferences.interfaceLocale ?? ""];
    const candidates = [...requested, ...preferences.fallbackLocales];
    return matchSupportedLanguage(candidates, supportedLocales, defaultLocale) as Locale;
}

export const locale = detectLocale();
export const messages: Messages = localeCatalogs[locale];
export const gameModes = Object.values(messages.modes);

/** Persists a new locale. Reloading keeps every non-Svelte consumer consistent too. */
export function selectLocale(next: Locale): void {
    updateLocalLanguagePreferences({ useSystemLanguage: false, interfaceLocale: next });
    reloadWithoutNavigationPrompt();
}

export function selectSystemLocale(): void {
    updateLocalLanguagePreferences({ useSystemLanguage: true });
    reloadWithoutNavigationPrompt();
}

export function availableLocales(): Locale[] {
    return [...supportedLocales];
}
