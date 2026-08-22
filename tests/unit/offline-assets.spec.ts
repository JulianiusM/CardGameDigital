import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("offline gameplay assets", () => {
    it("bundles audio locally and has no remote browser runtime dependency", () => {
        for (const name of [
            "ambient-menu.wav",
            "ambient-lobby.wav",
            "ambient-question.wav",
            "ambient-dare.wav",
            "ambient-conversation.wav",
            "ambient-end.wav",
            "action.wav",
            "card-reveal.wav",
        ]) {
            const file = fs.readFileSync(path.join("apps/web/public/audio", name));
            expect(file.subarray(0, 4).toString("ascii")).toBe("RIFF");
            expect(file.length).toBeGreaterThan(1_000);
        }
        const browserSources = fs
            .readdirSync("apps/web/src")
            .filter((name) => /\.(ts|svelte|css)$/.test(name))
            .map((name) => fs.readFileSync(path.join("apps/web/src", name), "utf8"))
            .join("\n");
        expect(browserSources).not.toMatch(/https?:\/\//);
        expect(browserSources).not.toContain("Google Fonts");
    });
});
