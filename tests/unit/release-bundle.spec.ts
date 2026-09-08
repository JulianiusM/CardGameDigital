import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyReleaseLayout, verifyReleaseSet } from "../../tooling/release/verification";
import { PUBLIC_NPM_CONFIG, releaseSettings } from "../../tooling/release/entrypoint";
import { resolveSettings } from "../../apps/server/src/modules/settings";
import {
    createServerWebReleaseManifest,
    removeExistingReleaseTarget,
    serverWebReleaseDirectoryName,
    serverWebReleaseManifestSchema,
} from "../../tooling/release/bundle";

const releaseInput = {
    version: "1.2.3",
    sourceRevision: "a".repeat(40),
    edition: "portable" as const,
    platform: "linux" as const,
    architecture: "x64" as const,
    nodeVersion: "v24.15.0",
    protocolVersion: 4,
};

describe("server-web release bundle", () => {
    it("gives the server and web client one versioned platform artifact", () => {
        const manifest = createServerWebReleaseManifest({
            sourceRevision: releaseInput.sourceRevision,
            version: "1.2.3",
            edition: "portable",
            platform: "linux",
            architecture: "x64",
            nodeVersion: "v24.15.0",
            protocolVersion: 2,
        });

        expect(manifest).toMatchObject({
            releaseUnit: "server-web",
            version: "1.2.3",
            components: { server: "1.2.3", web: "1.2.3" },
            runtime: { name: "node", version: "v24.15.0", bundled: true },
            productionDependenciesBundled: true,
            externalSoftwareDependencies: [],
        });
        expect(
            serverWebReleaseDirectoryName({
                version: manifest.version,
                edition: manifest.edition,
                platform: "linux",
                architecture: "x64",
            }),
        ).toBe("party-game-server-web-1.2.3-portable-linux-x64");
    });

    it("rejects independently versioned server and web components", () => {
        const result = serverWebReleaseManifestSchema.safeParse({
            ...createServerWebReleaseManifest(releaseInput),
            components: { server: "1.2.3", web: "1.2.4" },
        });

        expect(result.success).toBe(false);
    });

    it("describes public infrastructure as external and uses one platform-neutral artifact", () => {
        const manifest = createServerWebReleaseManifest({ ...releaseInput, edition: "public" });
        expect(manifest).toMatchObject({
            format: "party-game-release/v2",
            platform: "any",
            architecture: "any",
            entrypoint: "main.cjs",
            runtime: { bundled: false, version: ">=24.7.0 <25.0.0" },
            productionDependenciesBundled: false,
            externalSoftwareDependencies: ["node", "production-node-packages"],
        });
        expect(serverWebReleaseDirectoryName(manifest)).toBe("party-game-server-web-1.2.3-public");
        expect(
            serverWebReleaseManifestSchema.safeParse({
                ...manifest,
                productionDependenciesBundled: true,
            }).success,
        ).toBe(false);
        expect(
            serverWebReleaseManifestSchema.safeParse({
                ...manifest,
                runtime: { ...manifest.runtime, bundled: true },
            }).success,
        ).toBe(false);
    });

    it("requires all seven artifacts to share the selected version and immutable source", () => {
        const manifests = [
            createServerWebReleaseManifest({ ...releaseInput, edition: "public" }),
            ...(["linux", "win32", "darwin"] as const).flatMap((platform) =>
                (["x64", "arm64"] as const).map((architecture) =>
                    createServerWebReleaseManifest({ ...releaseInput, platform, architecture }),
                ),
            ),
        ];
        expect(() =>
            verifyReleaseSet(manifests, releaseInput.version, releaseInput.sourceRevision),
        ).not.toThrow();
        expect(() =>
            verifyReleaseSet(manifests.slice(1), releaseInput.version, releaseInput.sourceRevision),
        ).toThrow(/Missing/);
        expect(() =>
            verifyReleaseSet(
                [...manifests, manifests[0]],
                releaseInput.version,
                releaseInput.sourceRevision,
            ),
        ).toThrow(/duplicate/);
        expect(() => verifyReleaseSet(manifests, releaseInput.version, "b".repeat(40))).toThrow(
            /source and version/,
        );
        expect(() => verifyReleaseSet(manifests, "1.2.4", releaseInput.sourceRevision)).toThrow(
            /source and version/,
        );
    });

    it("rejects infrastructure even when nested in a public application directory", () => {
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "release-layout-"));
        const manifest = createServerWebReleaseManifest({ ...releaseInput, edition: "public" });
        const directory = path.join(scratch, serverWebReleaseDirectoryName(manifest));
        const files: Record<string, string> = {
            ".npmrc": PUBLIC_NPM_CONFIG,
            "release-manifest.json": JSON.stringify(manifest),
            "package.json": JSON.stringify({ version: manifest.version }),
            "app/package.json": JSON.stringify({ version: manifest.version }),
            "package-lock.json": JSON.stringify({ version: manifest.version }),
            "protocol-schemas/manifest.json": JSON.stringify({
                protocolVersion: manifest.protocolVersion,
            }),
            "SBOM.cdx.json": JSON.stringify({ bomFormat: "CycloneDX" }),
            "config/settings.csv": releaseSettings("public"),
        };
        for (const file of [
            "app/dist/apps/server/src/server.js",
            "app/dist/apps/server/src/modules/runtimeAssets.js",
            "app/dist/web/index.html",
            "app/dist/catalog/card-catalog.json",
            "app/dist/docs/user-guide/index.md",
            "LICENSE.md",
            "main.cjs",
            "protocol-schemas/client-hello.schema.json",
            "protocol-schemas/room-command.schema.json",
        ])
            files[file] = "";
        try {
            for (const [file, text] of Object.entries(files)) {
                fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
                fs.writeFileSync(path.join(directory, file), text);
            }
            expect(() => verifyReleaseLayout(directory)).not.toThrow();
            const lock = path.join(directory, "package-lock.json");
            fs.writeFileSync(
                lock,
                JSON.stringify({
                    version: manifest.version,
                    packages: { "node_modules/better-sqlite3": { version: "12.11.1" } },
                }),
            );
            expect(() => verifyReleaseLayout(directory)).toThrow(/native package/);
            fs.writeFileSync(lock, files["package-lock.json"]);
            fs.mkdirSync(path.join(directory, "app/node_modules"));
            expect(() => verifyReleaseLayout(directory)).toThrow(/infrastructure/);
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    });

    it("loads edition defaults beneath operator settings and fails closed without public configuration", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release-settings-"));
        const bundled = path.join(directory, "release.csv");
        const custom = path.join(directory, "operator.csv");
        try {
            fs.writeFileSync(bundled, releaseSettings("portable"));
            expect(resolveSettings({}, custom, bundled)).toMatchObject({
                deploymentMode: "local",
                authMode: "none",
                dbType: "sqlite",
                dbFile: "data/game.sqlite",
                mdnsDiscoveryEnabled: true,
            });
            fs.writeFileSync(bundled, releaseSettings("public"));
            expect(() => resolveSettings({}, custom, bundled)).toThrow();
            fs.writeFileSync(
                custom,
                "HTTP_PORT,4000\nDB_USER,game\nDB_PASSWORD,test-password\nPUBLIC_URL,https://cards.example\nSESSION_SECRET,test-session-secret-with-32-characters\nSMTP_HOST,smtp.example\nSMTP_USER,game\nSMTP_PASSWORD,test-password\nSMTP_EMAIL,game@example.test\nTRUST_PROXY,1\n",
            );
            expect(resolveSettings({}, custom, bundled)).toMatchObject({
                deploymentMode: "public",
                publicRuntimeSecurity: "enforced",
                authMode: "account",
                dbType: "mariadb",
                httpPort: 4000,
                httpBind: "127.0.0.1",
                mdnsDiscoveryEnabled: false,
            });
            expect(resolveSettings({ HTTP_PORT: "5000" }, custom, bundled).httpPort).toBe(5000);
            expect(() => resolveSettings({}, custom, path.join(directory, "missing.csv"))).toThrow(
                /Release defaults file is missing/,
            );
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it("retries cleanup and explains a bundle held open by Windows", () => {
        const error = Object.assign(new Error("permission denied"), { code: "EPERM" });
        let receivedOptions: import("node:fs").RmOptions | undefined;

        expect(() =>
            removeExistingReleaseTarget("C:\\release", (_target, options) => {
                receivedOptions = options;
                throw error;
            }),
        ).toThrow(/Stop any server started from this bundle/);
        expect(receivedOptions).toMatchObject({
            recursive: true,
            force: true,
            maxRetries: 8,
            retryDelay: 250,
        });
    });
});
