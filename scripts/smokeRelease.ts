import fs from "node:fs";
import path from "node:path";

const target = process.argv[2];
if (!target) throw new Error("Usage: smokeRelease.ts <release-directory>");
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
    "protocol-schemas/manifest.json",
    "protocol-schemas/client-hello.schema.json",
    "protocol-schemas/room-command.schema.json",
    "node_modules/better-sqlite3/package.json",
    "node_modules/argon2/package.json",
];
if (fs.existsSync(path.join(target, "runtime"))) {
    required.push(
        "config/settings.csv",
        "data",
        process.platform === "win32" ? "runtime/node.exe" : "runtime/node",
        process.platform === "win32" ? "start.cmd" : "start.sh",
    );
}
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
const rootPackage = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
const appPackage = JSON.parse(fs.readFileSync(path.join(target, "app/package.json"), "utf8"));
if (rootPackage.scripts?.start !== "node app/dist/server.js") {
    throw new Error("Release root launcher points at the wrong server entrypoint");
}
if (appPackage.scripts?.start !== "node dist/server.js") {
    throw new Error("Release app launcher points at the wrong server entrypoint");
}
console.log(`Release smoke layout passed: ${target}`);
