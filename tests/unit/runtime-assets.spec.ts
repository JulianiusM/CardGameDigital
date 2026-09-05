import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveRuntimeAssetPath } from "../../apps/server/src/modules/runtimeAssets";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "party-game-runtime-assets-"));
    temporaryDirectories.push(directory);
    return directory;
}

function createDirectory(directory: string): void {
    fs.mkdirSync(directory, { recursive: true });
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("server runtime assets", () => {
    it("resolves source assets and the Vite output while running through ts-node", () => {
        const repository = temporaryDirectory();
        const moduleDirectory = path.join(repository, "apps/server/src/modules");
        const documentation = path.join(repository, "docs/user-guide/en");
        const catalog = path.join(repository, "catalog/card-catalog.json");
        const web = path.join(repository, "dist/web");
        createDirectory(moduleDirectory);
        createDirectory(documentation);
        createDirectory(path.dirname(catalog));
        fs.writeFileSync(catalog, "{}");
        createDirectory(web);

        const options = { moduleDirectory, workingDirectory: repository };
        expect(resolveRuntimeAssetPath("docs/user-guide/en", options)).toBe(documentation);
        expect(resolveRuntimeAssetPath("catalog/card-catalog.json", options)).toBe(catalog);
        expect(resolveRuntimeAssetPath("web", options)).toBe(web);
    });

    it("resolves every asset beside the compiled server in a packaged release", () => {
        const release = temporaryDirectory();
        const distribution = path.join(release, "app/dist");
        const moduleDirectory = path.join(distribution, "apps/server/src/modules");
        const web = path.join(distribution, "web");
        const documentation = path.join(distribution, "docs/user-guide/en");
        const catalog = path.join(distribution, "catalog/card-catalog.json");
        createDirectory(moduleDirectory);
        createDirectory(web);
        createDirectory(documentation);
        createDirectory(path.dirname(catalog));
        fs.writeFileSync(catalog, "{}");

        const options = { moduleDirectory, workingDirectory: release };
        expect(resolveRuntimeAssetPath("web", options)).toBe(web);
        expect(resolveRuntimeAssetPath("docs/user-guide/en", options)).toBe(documentation);
        expect(resolveRuntimeAssetPath("catalog/card-catalog.json", options)).toBe(catalog);
    });
});
