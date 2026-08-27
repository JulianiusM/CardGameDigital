import { describe, expect, it } from "vitest";
import {
    createServerWebReleaseManifest,
    removeExistingReleaseTarget,
    serverWebReleaseDirectoryName,
    serverWebReleaseManifestSchema,
} from "../../scripts/releaseBundle";

describe("server-web release bundle", () => {
    it("gives the server and web client one versioned platform artifact", () => {
        const manifest = createServerWebReleaseManifest({
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
            format: "party-game-release/v1",
            releaseUnit: "server-web",
            version: "1.2.3",
            edition: "portable",
            platform: "linux",
            architecture: "x64",
            components: { server: "1.2.3", web: "1.2.4" },
            protocolVersion: 2,
            runtime: { name: "node", version: "v24.15.0", bundled: true },
            productionDependenciesBundled: true,
            externalSoftwareDependencies: [],
        });

        expect(result.success).toBe(false);
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
