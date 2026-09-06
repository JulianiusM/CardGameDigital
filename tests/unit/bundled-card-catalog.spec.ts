import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    bundledCardCatalogArtifact,
    setBundledCardCatalogPathForTests,
} from "../../apps/server/src/modules/database/bundledCardCatalog";

describe("bundled Card catalog deployment policy", async () => {
    it("accepts the producer-shaped test release in local and public modes", async () => {
        expect((await bundledCardCatalogArtifact("local")).catalog.catalogId).toBe("core");
        expect((await bundledCardCatalogArtifact("public")).catalog.catalogId).toBe("core");
    });

    it("refuses a named development fixture publicly unless explicitly allowed", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bundled-catalog-policy-"));
        const file = path.join(directory, "card-catalog.json");
        const fixture = JSON.parse(
            fs.readFileSync("tests/fixtures/card-catalog-v2.example.json", "utf8"),
        ) as { catalogVersion: string };
        fixture.catalogVersion = "development-fixture-test";
        fs.writeFileSync(file, JSON.stringify(fixture));
        setBundledCardCatalogPathForTests(file);
        try {
            await expect(bundledCardCatalogArtifact("public")).rejects.toThrow(
                /refuses the bundled development Card catalog/,
            );
            expect((await bundledCardCatalogArtifact("public", true)).catalog.catalogId).toBe(
                "core",
            );
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});
