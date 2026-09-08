import fs from "node:fs";
import path from "node:path";
import {
    serverWebReleaseDirectoryName,
    serverWebReleaseManifestSchema,
    type ServerWebReleaseManifest,
} from "./bundle";
import { PUBLIC_NPM_CONFIG, releaseSettings } from "./entrypoint";

export function verifyReleaseLayout(target: string): ServerWebReleaseManifest {
    const manifest = serverWebReleaseManifestSchema.parse(
        JSON.parse(fs.readFileSync(path.join(target, "release-manifest.json"), "utf8")),
    );
    for (const item of [
        "app/dist/apps/server/src/server.js",
        "app/dist/apps/server/src/modules/runtimeAssets.js",
        "app/dist/web/index.html",
        "app/dist/catalog/card-catalog.json",
        "app/dist/docs/user-guide",
        "app/package.json",
        "package.json",
        "package-lock.json",
        "LICENSE.md",
        "SBOM.cdx.json",
        "protocol-schemas/manifest.json",
        "protocol-schemas/client-hello.schema.json",
        "protocol-schemas/room-command.schema.json",
        "config/settings.csv",
        manifest.entrypoint,
    ]) {
        if (!fs.existsSync(path.join(target, item)))
            throw new Error(`Release artifact missing ${item}`);
    }
    if (path.basename(target) !== serverWebReleaseDirectoryName(manifest))
        throw new Error("Release directory does not match the manifest");
    if (
        fs.readFileSync(path.join(target, "config/settings.csv"), "utf8") !==
        releaseSettings(manifest.edition)
    )
        throw new Error("Release settings do not match the edition");
    for (const item of ["package.json", "app/package.json", "package-lock.json"]) {
        const metadata = JSON.parse(fs.readFileSync(path.join(target, item), "utf8"));
        if (metadata.version !== manifest.version)
            throw new Error("Packaged versions do not match the manifest");
    }
    const protocol = JSON.parse(
        fs.readFileSync(path.join(target, "protocol-schemas/manifest.json"), "utf8"),
    );
    if (protocol.protocolVersion !== manifest.protocolVersion)
        throw new Error("Protocol manifest version mismatch");
    const sbom = JSON.parse(fs.readFileSync(path.join(target, "SBOM.cdx.json"), "utf8"));
    if (sbom.bomFormat !== "CycloneDX") throw new Error("Release SBOM is not CycloneDX");
    if (manifest.edition === "portable") {
        for (const item of [
            "data",
            "NODE-LICENSE.txt",
            "node_modules/better-sqlite3/package.json",
        ]) {
            if (!fs.existsSync(path.join(target, item)))
                throw new Error(`Portable artifact missing ${item}`);
        }
    } else {
        const packageMetadata = JSON.parse(
            fs.readFileSync(path.join(target, "package.json"), "utf8"),
        );
        const lock = JSON.parse(fs.readFileSync(path.join(target, "package-lock.json"), "utf8"));
        for (const dependency of ["argon2", "better-sqlite3"]) {
            if (
                packageMetadata.dependencies?.[dependency] ||
                Object.keys(lock.packages ?? {}).some((name) =>
                    name.endsWith(`node_modules/${dependency}`),
                )
            )
                throw new Error(`Public dependency graph contains a native package: ${dependency}`);
        }
        if (fs.readFileSync(path.join(target, ".npmrc"), "utf8") !== PUBLIC_NPM_CONFIG)
            throw new Error(
                "Public npm configuration must omit development/optional packages and disable install scripts",
            );
        const entries = fs.readdirSync(target, { recursive: true, withFileTypes: true });
        for (const entry of entries) {
            if (
                entry.isSymbolicLink() ||
                ["node_modules", "runtime", "data", "node", "nodejs", "npm", "npx"].includes(
                    entry.name,
                ) ||
                /\.(?:node|exe|dll|so|dylib)$/i.test(entry.name)
            ) {
                throw new Error(`Public artifact contains infrastructure: ${entry.name}`);
            }
        }
    }
    return manifest;
}

export function verifyReleaseSet(
    manifests: ServerWebReleaseManifest[],
    version: string,
    sourceRevision: string,
): void {
    const expected = new Set([
        `party-game-server-web-${version}-public`,
        ...["linux", "win32", "darwin"].flatMap((platform) =>
            ["x64", "arm64"].map(
                (architecture) =>
                    `party-game-server-web-${version}-portable-${platform}-${architecture}`,
            ),
        ),
    ]);
    for (const input of manifests) {
        const manifest = serverWebReleaseManifestSchema.parse(input);
        if (manifest.version !== version || manifest.sourceRevision !== sourceRevision)
            throw new Error("Release artifacts do not share the selected source and version");
        if (!expected.delete(serverWebReleaseDirectoryName(manifest)))
            throw new Error("Unexpected or duplicate release artifact");
    }
    if (expected.size > 0)
        throw new Error(`Missing release artifacts: ${[...expected].join(", ")}`);
    if (new Set(manifests.map((manifest) => manifest.protocolVersion)).size !== 1)
        throw new Error("Release protocols do not match");
}
