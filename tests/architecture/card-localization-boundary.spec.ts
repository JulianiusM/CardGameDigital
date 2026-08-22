import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("card localization boundary", () => {
    it("keeps logical cards free of source identity and player-facing text", () => {
        const entity = fs.readFileSync("src/modules/database/entities/card/CardEntity.ts", "utf8");
        expect(entity).not.toMatch(/cardText|sourceName|sourceIdentifier/);
        expect(fs.existsSync("src/modules/database/entities/card/CardTranslationEntity.ts")).toBe(
            true,
        );
        expect(fs.existsSync("src/modules/database/entities/card/CardSourceEntity.ts")).toBe(true);
    });

    it("does not derive card UUIDs from localized wording", () => {
        const normalizer = fs.readFileSync("src/tooling/card-import/normalize.ts", "utf8");
        expect(normalizer).not.toMatch(/uuidv5|CardText[^\n]+id|id[^\n]+CardText/);
        expect(normalizer).toMatch(/sourceId/);
    });

    it("requires explicit card fallback policy", () => {
        const repository = fs.readFileSync("src/packages/application/repositories.ts", "utf8");
        expect(repository).toMatch(/missingTranslation:\s*"EXCLUDE"\s*\|\s*"FALLBACK"/);
    });
});
