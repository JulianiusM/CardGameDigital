import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("release boundaries", () => {
    it("exposes only coupled server-web release commands", () => {
        const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
        const releaseScripts = Object.keys(packageJson.scripts).filter((name) =>
            name.startsWith("package:"),
        );

        expect(packageJson.scripts.build).toBe("npm run build:server-web");
        expect(releaseScripts).toEqual([
            "package:server-web",
            "package:server-web:portable",
            "package:server-web:public",
            "package:server-web:smoke",
        ]);
    });

    it("builds server-web artifacts on each supported platform and excludes native clients", () => {
        const workflow = fs.readFileSync(".github/workflows/release.yml", "utf8");

        expect(workflow).toContain("package-server-web:");
        expect(workflow).toContain("npm run package:server-web");
        expect(workflow).toContain("ubuntu-24.04");
        expect(workflow).toContain("windows-2025");
        expect(workflow).toContain("macos-15");
        expect(workflow).not.toMatch(/apps\/(?:kodi|android-tv)/);
        expect(workflow).not.toContain("apps/kodi");
    });

    it("releases the Kodi client independently with native checks and provenance", () => {
        const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
        const workflow = fs.readFileSync(".github/workflows/kodi-release.yml", "utf8");

        expect(packageJson.scripts["kodi:package"]).toContain("tooling/kodi/release.ts package");
        expect(workflow).toContain("npm run kodi:package");
        expect(workflow).toContain("kodi-client-v");
        expect(workflow).not.toContain("package:server-web");
        expect(fs.readFileSync("apps/kodi/addon.xml", "utf8")).toContain(
            'id="script.partycard.tv"',
        );
        const releaseSource = fs.readFileSync("tooling/kodi/release.ts", "utf8");
        expect(releaseSource).toContain(
            'import { PROTOCOL_VERSION } from "../../packages/protocol"',
        );
        expect(releaseSource).not.toContain("protocolVersion: 2");
        expect(releaseSource).not.toContain("kodiRelease.ts");
        expect(releaseSource).toContain('!relative.startsWith(".test-profile/")');
    });
});
