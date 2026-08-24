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

    it("bundles every runtime card motif without unused scene-only files", () => {
        const motifs = [
            "general",
            "curiosity",
            "inner-self",
            "connection",
            "unfiltered",
            "intimate-talk",
            "desire-stories",
            "mischief",
            "social-chaos",
            "affection",
            "flirt",
            "reveal",
            "heat",
            "generic-dare",
            "conversation",
        ];
        for (const name of motifs) {
            const svg = fs.readFileSync(path.join("apps/web/public/motifs", `${name}.svg`), "utf8");
            expect(svg).toMatch(/^<svg/);
            expect(svg).not.toContain("<text");
            expect(svg.match(/<(?:path|circle|rect|ellipse)\b/g)?.length).toBeGreaterThanOrEqual(4);
        }
        expect(fs.existsSync("apps/web/public/motifs/lobby.svg")).toBe(false);
        expect(fs.existsSync("apps/web/public/motifs/end.svg")).toBe(false);
        const uiIcons = fs.readFileSync("apps/web/public/motifs/ui-icons.svg", "utf8");
        expect(uiIcons.match(/<symbol\b/g)?.length).toBeGreaterThanOrEqual(20);
        const backgroundSymbols = fs.readFileSync(
            "apps/web/public/motifs/motif-symbols.svg",
            "utf8",
        );
        expect(backgroundSymbols.match(/<symbol\b/g)?.length).toBeGreaterThanOrEqual(40);
        const backdrop = fs.readFileSync("apps/web/src/BackdropLayer.svelte", "utf8");
        expect(backdrop).toContain("motif-symbols.svg#");
        expect(backdrop).toContain("globalThis.crypto.getRandomValues");
        expect(backdrop).toContain("data-segment={segment}");
        expect(backdrop).not.toContain("mask-image");
        expect(backdrop).not.toContain("motif-drift");
        expect(backdrop).not.toContain("familyHash");
        expect(backdrop).not.toContain("densityByIntensity");
        expect(backdrop).not.toContain("gradient-breathe");
        expect(backdrop).not.toContain("repeating-linear-gradient");
        expect(backdrop).not.toContain("mix-blend-mode");
        expect(backdrop).toContain("sampleGradientColor");
        expect(backdrop).toContain("relativeSymbolColor");
        expect(backdrop).toContain('data-gradient-renderer="continuous-field"');
        expect(backdrop).toContain("dataset.gradientColor");
        expect(backdrop).toContain("image-rendering: auto");

        const presentation = fs.readFileSync("apps/web/src/presentation.ts", "utf8");
        expect(presentation).toContain("motifDriftPixelsPerSecond");
        expect(presentation).toContain('motifToneStrategy: "dark-relative" | "hot-relative"');
        expect(presentation).toContain("lightPatternTone");
        expect(presentation).toContain("motifIconGap");
        expect(presentation).toContain("motifIconSize");
        expect(presentation).toContain("motifTrackGap");

        const presentationStyles = ["apps/web/src/style.css", "apps/web/src/experience.css"]
            .map((name) => fs.readFileSync(name, "utf8"))
            .join("\n");
        expect(presentationStyles).not.toContain("conic-gradient");
        expect(presentationStyles).not.toContain("backdrop-filter");
        expect(presentationStyles).not.toMatch(/#(?:17132d|211a3b|100c22|65d1c5|78d8ff)/i);
        expect(presentationStyles).toContain("#e4ba61");
        expect(presentationStyles).toContain("#c98e2f");
        expect(presentationStyles).toContain("#c58a72");
        expect(presentationStyles).toContain("#9f6558");
        expect(presentationStyles).not.toContain("var(--color-result-honey)");

        const index = fs.readFileSync("apps/web/index.html", "utf8");
        expect(index).toContain('name="theme-color" content="#ffd166"');
        expect(index).not.toContain("#17132d");
    });
});
