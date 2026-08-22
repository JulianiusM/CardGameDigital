import fs from "node:fs";
import { describe, expect, it } from "vitest";

const contractFiles = [
    "docs/contracts/http-api.md",
    "docs/contracts/websocket-v1.md",
    "docs/contracts/card-catalog-v1.md",
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
        const catalog = fs.readFileSync(contractFiles[2], "utf8");
        expect(http).toContain("/api/v1");
        expect(websocket).toContain('"protocol": 1');
        expect(catalog).toMatch(/producer UUID/i);
        expect(catalog).toMatch(/soft-disabled/i);
        expect(catalog).toContain("game-card-catalog/v1");
    });
});
