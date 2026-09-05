import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(directory: string, extension: RegExp): string {
    return fs
        .readdirSync(directory, { withFileTypes: true })
        .flatMap((entry) => {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) return read(file, extension);
            return extension.test(file) ? fs.readFileSync(file, "utf8") : [];
        })
        .join("\n");
}

describe("localization boundary", () => {
    it("keeps language-specific client catalogs behind the i18n facade", () => {
        const components = read("apps/web/src", /\.svelte$/);
        expect(components).not.toMatch(/from ["'].+locales\//);
        expect(components).not.toMatch(/messages\.[a-z]{2}\b/);
        expect(components).not.toMatch(/[ÄÖÜäöüß]/);
    });

    it("keeps account and help editorial copy in locale catalogs", () => {
        const components = ["Account.svelte", "Help.svelte", "Home.svelte"]
            .map((file) => fs.readFileSync(path.join("apps/web/src", file), "utf8"))
            .join("\n");
        expect(components).not.toMatch(/Konto|Hilfe|Passwort|Anmelden|Abmelden|Erstellen|löschen/);
    });

    it("uses stable localization keys for application errors", () => {
        const services = ["accountService.ts", "helpService.ts"]
            .map((file) => fs.readFileSync(path.join("apps/server/src/application", file), "utf8"))
            .join("\n");
        expect(services).not.toMatch(/new ExpectedError\("/);
        expect(services).toMatch(/new ExpectedError\(MESSAGE_KEYS\./);
    });

    it("keeps locale composition explicit and readable", () => {
        const composition = fs.readFileSync("apps/web/src/locales/index.ts", "utf8");
        expect(composition).not.toMatch(/type\s+\w+<[^>]+>\s*=\s*[^;]+extends/);
        expect(fs.existsSync("packages/localization/locales/de.ts")).toBe(true);
        expect(fs.existsSync("packages/localization/locales/en.ts")).toBe(true);
    });

    it("does not duplicate server-owned profile or group-option catalogs in the browser", () => {
        const browserCatalogs = read("apps/web/src/locales", /\.ts$/);
        expect(browserCatalogs).not.toMatch(
            /PROFILE_(?:CHILD|ACQUAINTANCES|FRIENDS|CLOSE|SPICY|CUSTOM)/,
        );
        expect(browserCatalogs).not.toMatch(/\bgroupOptions\s*:/);
    });
});
