import { describe, expect, it } from "vitest";
import { bundledCardCatalogArtifact } from "../../src/modules/database/bundledCardCatalog";

describe("bundled Card catalog deployment policy", () => {
    it("allows the development fixture locally but refuses it in public mode", () => {
        expect(bundledCardCatalogArtifact("local").catalog.catalogId).toBe("development");
        expect(() => bundledCardCatalogArtifact("public")).toThrow(
            /refuses the bundled development Card catalog/,
        );
    });
});
