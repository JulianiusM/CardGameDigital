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
    });
});
