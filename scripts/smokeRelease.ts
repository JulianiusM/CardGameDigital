import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { serverWebReleaseDirectoryName, serverWebReleaseManifestSchema } from "./releaseBundle";

const targetArgument = process.argv[2];
if (!targetArgument) throw new Error("Usage: smokeRelease.ts <release-directory>");
const target = path.resolve(targetArgument);
const required = [
    "app/dist/server.js",
    "app/dist/web/index.html",
    "app/dist/catalog/card-catalog.json",
    "app/dist/docs/user-guide",
    "app/package.json",
    "package.json",
    "package-lock.json",
    "LICENSE.md",
    "SBOM.cdx.json",
    "release-manifest.json",
    "protocol-schemas/manifest.json",
    "protocol-schemas/client-hello.schema.json",
    "protocol-schemas/room-command.schema.json",
    "node_modules/better-sqlite3/package.json",
    "node_modules/argon2/package.json",
    "config/settings.csv",
    process.platform === "win32" ? "runtime/node.exe" : "runtime/node",
    process.platform === "win32" ? "start.cmd" : "start.sh",
];
for (const item of required) {
    if (!fs.existsSync(path.join(target, item)))
        throw new Error(`Release artifact missing ${item}`);
}
const sourceCatalog = fs.readFileSync(path.resolve("catalog/card-catalog.json"));
const packagedCatalog = fs.readFileSync(path.join(target, "app/dist/catalog/card-catalog.json"));
if (!sourceCatalog.equals(packagedCatalog)) {
    throw new Error("Packaged card-catalog.json bytes differ from the validated source artifact");
}
const sbom = JSON.parse(fs.readFileSync(path.join(target, "SBOM.cdx.json"), "utf8"));
if (sbom.bomFormat !== "CycloneDX") throw new Error("Release SBOM is not CycloneDX JSON");
const protocolManifest = JSON.parse(
    fs.readFileSync(path.join(target, "protocol-schemas/manifest.json"), "utf8"),
);
if (protocolManifest.protocolVersion !== 2) {
    throw new Error("Release protocol schema manifest has the wrong protocol version");
}
const releaseManifest = serverWebReleaseManifestSchema.parse(
    JSON.parse(fs.readFileSync(path.join(target, "release-manifest.json"), "utf8")),
);
if (
    releaseManifest.platform !== process.platform ||
    releaseManifest.architecture !== process.arch
) {
    throw new Error("Release platform does not match the smoke-test platform");
}
if (releaseManifest.protocolVersion !== protocolManifest.protocolVersion) {
    throw new Error("Release and protocol manifests disagree about the protocol version");
}
const expectedDirectoryName = serverWebReleaseDirectoryName({
    version: releaseManifest.version,
    edition: releaseManifest.edition,
    platform: releaseManifest.platform,
    architecture: releaseManifest.architecture,
});
if (path.basename(target) !== expectedDirectoryName) {
    throw new Error("Release directory name does not match the release manifest");
}
if (releaseManifest.edition === "portable" && !fs.existsSync(path.join(target, "data"))) {
    throw new Error("Portable release artifact missing data");
}
const settingsTemplate = fs.readFileSync(path.join(target, "config/settings.csv"), "utf8");
if (
    !settingsTemplate.includes(
        `DEPLOYMENT_MODE,${releaseManifest.edition === "portable" ? "local" : "public"}\n`,
    )
) {
    throw new Error("Settings template does not match the release edition");
}
const rootPackage = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
const appPackage = JSON.parse(fs.readFileSync(path.join(target, "app/package.json"), "utf8"));
if (
    rootPackage.version !== releaseManifest.version ||
    appPackage.version !== releaseManifest.version
) {
    throw new Error("Packaged application versions do not match the release manifest");
}
if (rootPackage.scripts || appPackage.scripts) {
    throw new Error("Packaged metadata must not expose a launcher requiring external npm or Node");
}
const runtime = path.join(target, "runtime", process.platform === "win32" ? "node.exe" : "node");
const runtimeVersion = execFileSync(runtime, ["--version"], { encoding: "utf8" }).trim();
if (runtimeVersion !== releaseManifest.runtime.version) {
    throw new Error("Bundled runtime version does not match the release manifest");
}
execFileSync(runtime, ["-e", "require('argon2'); require('better-sqlite3')"], {
    cwd: path.resolve(target),
    stdio: "pipe",
});
execFileSync(runtime, ["--check", "app/dist/server.js"], {
    cwd: path.resolve(target),
    stdio: "pipe",
});
console.log(`Release smoke layout passed: ${target}`);
