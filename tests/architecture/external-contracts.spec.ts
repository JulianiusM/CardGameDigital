import fs from "node:fs";
import { describe, expect, it } from "vitest";

const contractFiles = [
    "docs/contracts/http-api.md",
    "docs/contracts/websocket-v1.md",
    "docs/contracts/card-catalog-v1.md",
    "docs/contracts/card-catalog-v2.md",
    "docs/contracts/infrastructure.md",
];

describe("external contract documentation", () => {
    it("documents every public transport and integration boundary", () => {
        for (const file of contractFiles) {
            expect(fs.existsSync(file), `${file} is missing`).toBe(true);
            expect(fs.readFileSync(file, "utf8").length).toBeGreaterThan(1_000);
        }
    });

    it("keeps versioned transport and card lifecycle rules visible", () => {
        const http = fs.readFileSync(contractFiles[0], "utf8");
        const websocket = fs.readFileSync(contractFiles[1], "utf8");
        const catalogV1 = fs.readFileSync(contractFiles[2], "utf8");
        const catalogV2 = fs.readFileSync(contractFiles[3], "utf8");
        expect(http).toContain("/api/v1");
        expect(websocket).toContain('"protocol": 1');
        expect(catalogV1).toContain("game-card-catalog/v1");
        expect(catalogV2).toMatch(/producer UUID/i);
        expect(catalogV2).toMatch(/soft-(?:disabled|retire)/i);
        expect(catalogV2).toContain("game-card-catalog/v2");
    });
});
