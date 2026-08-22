import { defaultLocale, localeCatalogs, localeDefinitions, type MessageCatalog } from "./locales";

export type Locale = keyof typeof localeCatalogs;
export type Messages = MessageCatalog;

const supportedLocales = Object.keys(localeCatalogs) as Locale[];
const storageKey = "party-game.locale";

function isLocale(value: string | null | undefined): value is Locale {
    return supportedLocales.includes(value as Locale);
}

function detectLocale(): Locale {
    const saved = localStorage.getItem(storageKey);
    if (isLocale(saved)) return saved;
    for (const language of navigator.languages) {
        const candidate = language.split("-")[0];
        if (isLocale(candidate)) return candidate;
    }
    return defaultLocale;
}

export const locale = detectLocale();
export const messages: Messages = localeCatalogs[locale];
export const cardLocale = localeDefinitions[locale].cardLocale;
export const gameModes = Object.values(messages.modes);

/** Persists a new locale. Reloading keeps every non-Svelte consumer consistent too. */
export function selectLocale(next: Locale): void {
    localStorage.setItem(storageKey, next);
    location.reload();
}

export function availableLocales(): Locale[] {
    return [...supportedLocales];
}
