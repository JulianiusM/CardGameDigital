import { describe, expect, it } from "vitest";
import {
    DEFAULT_LOCALE,
    MESSAGE_KEYS,
    detectLocale,
    emailMessage,
    translate,
} from "../../src/packages/localization/messages";
import { getHelpDocument, listHelpDocuments } from "../../src/packages/application/helpService";

describe("account email localization", () => {
    it("provides German and English account messages without legacy product copy", () => {
        const german = emailMessage("de", "activation", { link: "https://example.test/activate" });
        const english = emailMessage("en", "passwordReset", { link: "https://example.test/reset" });
        expect(german.subject).toBe("Konto aktivieren");
        expect(english.subject).toBe("Reset your password");
        expect(`${german.text}${english.text}`).not.toMatch(/survey|guest account/i);
    });

    it("detects a supported locale from a weighted language header", () => {
        expect(detectLocale("fr-FR, en-US;q=0.8")).toBe("en");
        expect(detectLocale("de-DE,de;q=0.9")).toBe("de");
        expect(detectLocale("fr-FR")).toBe(DEFAULT_LOCALE);
        expect(detectLocale()).toBe(DEFAULT_LOCALE);
        expect(translate(detectLocale("en-AU"), MESSAGE_KEYS.REQUEST_INVALID)).toBe(
            "Invalid input.",
        );
    });

    it("loads help content from the detected locale directory", () => {
        expect(getHelpDocument("de").title).toBe("Hilfe im Überblick");
        expect(getHelpDocument("en").title).toBe("Help overview");
        const german = listHelpDocuments("de").map(({ slug }) => slug);
        const english = listHelpDocuments("en").map(({ slug }) => slug);
        expect(german).toEqual(english);
        expect(german).toEqual([
            "readme",
            "getting-started",
            "game-modes",
            "rooms-and-devices",
            "safety-and-boundaries",
            "accounts-and-data",
            "card-management",
            "troubleshooting",
        ]);
    });
});
