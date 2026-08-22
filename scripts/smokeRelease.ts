import fs from "node:fs";
import path from "node:path";

const target = process.argv[2];
if (!target) throw new Error("Usage: smokeRelease.ts <release-directory>");
const required = [
    "app/dist/server.js",
    "app/dist/web/index.html",
    "app/dist/docs/user-guide",
    "app/package.json",
    "package.json",
    "package-lock.json",
    "node_modules/better-sqlite3/package.json",
    "node_modules/argon2/package.json",
];
if (fs.existsSync(path.join(target, "runtime"))) {
    required.push(
        "config/settings.csv",
        "data",
        process.platform === "win32" ? "runtime/node.exe" : "runtime/node",
    );
}
for (const item of required) {
    if (!fs.existsSync(path.join(target, item)))
        throw new Error(`Release artifact missing ${item}`);
}
console.log(`Release smoke layout passed: ${target}`);
