import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type Edition = "portable" | "public";
const edition = process.argv[2] as Edition;
if (edition !== "portable" && edition !== "public") {
    throw new Error("Usage: packageRelease.ts <portable|public>");
}

const root = process.cwd();
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const version = process.env.RELEASE_VERSION || packageVersion;
const target = path.join(
    root,
    "artifacts",
    `party-game-${version}-${edition}-${process.platform}-${process.arch}`,
);
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.join(target, "app"), { recursive: true });
fs.cpSync(path.join(root, "dist"), path.join(target, "app", "dist"), { recursive: true });
fs.copyFileSync(path.join(root, "package-lock.json"), path.join(target, "package-lock.json"));

const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
delete sourcePackage.devDependencies;
sourcePackage.scripts = { start: "node app/dist/server.js" };
fs.writeFileSync(path.join(target, "package.json"), `${JSON.stringify(sourcePackage, null, 2)}\n`);
fs.copyFileSync(path.join(target, "package.json"), path.join(target, "app", "package.json"));

// npm already resolved the locked production graph. Copy exactly those packages,
// including the platform-specific Argon2 and better-sqlite3 native bindings.
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Release packaging must run through an npm script");
const productionPaths = execFileSync(
    process.execPath,
    [npmCli, "ls", "--omit=dev", "--parseable", "--all"],
    {
        cwd: root,
        encoding: "utf8",
    },
)
    .trim()
    .split(/\r?\n/)
    .filter((entry) => entry && entry !== root);
for (const source of productionPaths) {
    const relative = path.relative(root, source);
    if (relative.startsWith("..")) continue;
    fs.mkdirSync(path.dirname(path.join(target, relative)), { recursive: true });
    fs.cpSync(source, path.join(target, relative), { recursive: true, dereference: false });
}

if (edition === "portable") {
    fs.mkdirSync(path.join(target, "runtime"), { recursive: true });
    fs.mkdirSync(path.join(target, "data"), { recursive: true });
    fs.mkdirSync(path.join(target, "config"), { recursive: true });
    const runtimeName = process.platform === "win32" ? "node.exe" : "node";
    fs.copyFileSync(process.execPath, path.join(target, "runtime", runtimeName));
    fs.chmodSync(path.join(target, "runtime", runtimeName), 0o755);
    fs.writeFileSync(
        path.join(target, "config", "settings.csv"),
        "DEPLOYMENT_MODE,local\nAUTH_MODE,none\nDB_TYPE,sqlite\nDB_FILE,data/game.sqlite\nHTTP_BIND,0.0.0.0\nHTTP_PORT,3000\n",
    );
    fs.writeFileSync(
        path.join(target, "start.sh"),
        '#!/bin/sh\ncd "$(dirname "$0")"\nexport SETTINGS_FILE=config/settings.csv\nexec runtime/node app/dist/server.js\n',
        { mode: 0o755 },
    );
    fs.writeFileSync(
        path.join(target, "start.cmd"),
        "@echo off\r\ncd /d %~dp0\r\nset SETTINGS_FILE=config/settings.csv\r\nruntime\\node.exe app\\dist\\server.js\r\n",
    );
}

fs.writeFileSync(
    path.join(target, "README.txt"),
    edition === "portable"
        ? "Start with start.cmd on Windows or ./start.sh on Linux/macOS. Open http://localhost:3000/play/. No internet or installed Node.js is required.\n"
        : "Public deployment bundle. Configure DEPLOYMENT_MODE=public, MariaDB, PUBLIC_URL, SESSION_SECRET, and authentication/email settings before running npm start.\n",
);

console.log(target);
