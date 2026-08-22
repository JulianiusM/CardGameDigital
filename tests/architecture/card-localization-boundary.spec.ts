import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("card localization boundary", () => {
    it("keeps logical cards free of source identity and player-facing text", () => {
        const entity = fs.readFileSync("src/modules/database/entities/card/CardEntity.ts", "utf8");
        expect(entity).not.toMatch(/cardText|sourceName|sourceIdentifier/);
        expect(fs.existsSync("src/modules/database/entities/card/CardLocalizationEntity.ts")).toBe(
            true,
        );
        expect(fs.existsSync("src/modules/database/entities/card/CardSourceEntity.ts")).toBe(false);
        expect(fs.existsSync("src/modules/database/entities/card/RawCardImportEntity.ts")).toBe(
            false,
        );
    });

    it("does not derive card UUIDs from localized wording", () => {
        const schema = fs.readFileSync("src/packages/card-catalog-contract/schema.ts", "utf8");
        expect(schema).toMatch(/id: z\.uuid\(\)/);
        expect(fs.existsSync("src/tooling/card-import/normalize.ts")).toBe(false);
    });

    it("requires explicit card fallback policy", () => {
        const repository = fs.readFileSync("src/packages/application/repositories.ts", "utf8");
        expect(repository).toMatch(/missingTranslation:\s*"EXCLUDE"\s*\|\s*"FALLBACK"/);
    });

    it("does not derive Card language from the UI locale registry", () => {
        const locales = fs.readFileSync("apps/web/src/locales/index.ts", "utf8");
        const home = fs.readFileSync("apps/web/src/Home.svelte", "utf8");
        expect(locales).not.toMatch(/cardLocale/);
        expect(home).toMatch(/loadCardLocales/);
        expect(home).not.toMatch(/import \{[^}]*cardLocale[^}]*\} from "\.\/i18n"/);
    });
});
