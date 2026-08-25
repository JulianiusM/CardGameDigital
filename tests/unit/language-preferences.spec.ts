import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    browserLanguageCandidates,
    loadLanguagePreferences,
    matchSupportedLanguage,
    updateLocalLanguagePreferences,
} from "../../apps/web/src/languagePreferences";

describe("language preferences", () => {
    const values = new Map<string, string>();

    beforeEach(() => {
        values.clear();
        vi.stubGlobal("localStorage", {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
        });
        vi.stubGlobal("navigator", { languages: ["fr-CA", "en-GB"], language: "fr-CA" });
    });

    it("uses browser languages without writing an automatic preference", () => {
        expect(loadLanguagePreferences()).toEqual({
            useSystemLanguage: true,
            interfaceLocale: null,
            cardLocale: null,
            fallbackLocales: [],
        });
        expect(browserLanguageCandidates()).toEqual(["fr-CA", "en-GB"]);
        expect(values.size).toBe(0);
    });

    it("persists only explicit changes and preserves fallback order", () => {
        updateLocalLanguagePreferences({
            useSystemLanguage: false,
            interfaceLocale: "en",
            cardLocale: "en-GB",
            fallbackLocales: ["fr-FR", "de-DE", "fr-FR"],
        });
        expect(loadLanguagePreferences()).toMatchObject({
            useSystemLanguage: false,
            interfaceLocale: "en",
            cardLocale: "en-GB",
            fallbackLocales: ["fr-FR", "de-DE"],
        });
    });

    it("matches exact locales before deterministic base-language and final fallbacks", () => {
        const supported = ["de-DE", "en-US", "en-GB"];
        expect(matchSupportedLanguage(["en-GB"], supported, "de-DE")).toBe("en-GB");
        expect(matchSupportedLanguage(["en-AU"], supported, "de-DE")).toBe("en-US");
        expect(matchSupportedLanguage(["fr-FR", "en-GB"], supported, "de-DE")).toBe("en-GB");
        expect(matchSupportedLanguage(["fr-FR"], supported, "de-DE")).toBe("de-DE");
    });
});
