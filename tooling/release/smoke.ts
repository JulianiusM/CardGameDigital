import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PROTOCOL_VERSION } from "../../packages/protocol/version";
import { defaultRoomGameSettings } from "../../packages/application/roomGameSettings";
import { verifyReleaseLayout } from "./verification";
import {
    loadMariaTestProfile,
    resetMariaTestDatabase,
    dropMariaTestDatabase,
    type MariaTestProfile,
} from "../../tests/support/mariaDb";

const execute = promisify(execFile);

async function installPublicDependencies(installation: string, scratch: string): Promise<string> {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error("Release smoke must run through an npm script");
    const dependencies = path.join(scratch, "dependencies");
    fs.mkdirSync(dependencies);
    for (const file of ["package.json", "package-lock.json", ".npmrc"])
        fs.copyFileSync(path.join(installation, file), path.join(dependencies, file));
    // Exercise the shipped .npmrc with a plain npm ci, as a managed host would.
    await execute(process.execPath, [npmCli, "ci", "--no-audit", "--no-fund"], {
        cwd: dependencies,
        timeout: 120_000,
    });
    const modules = path.join(dependencies, "node_modules");
    for (const entry of fs.readdirSync(modules, { recursive: true, withFileTypes: true })) {
        if (
            (path.basename(entry.parentPath) === "node_modules" &&
                ["argon2", "better-sqlite3"].includes(entry.name)) ||
            entry.name.endsWith(".node")
        )
            throw new Error(
                `Public installation contains a native dependency: ${path.join(entry.parentPath, entry.name)}`,
            );
    }
    return modules;
}

async function unusedPort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const port = (server.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
}

async function stop(child: ChildProcess): Promise<void> {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => child.kill("SIGKILL"), 12_000);
        child.once("exit", () => {
            clearTimeout(timeout);
            resolve();
        });
        child.kill("SIGTERM");
    });
}

async function main(): Promise<void> {
    if (!process.argv[2]) throw new Error("Usage: tooling/release/smoke.ts <release-directory>");
    const target = path.resolve(process.argv[2]);
    const manifest = verifyReleaseLayout(target);
    if (manifest.protocolVersion !== PROTOCOL_VERSION)
        throw new Error("Unexpected protocol version");
    const sourceCatalog = fs.readFileSync(path.resolve("catalog/card-catalog.json"));
    if (
        !sourceCatalog.equals(
            fs.readFileSync(path.join(target, "app/dist/catalog/card-catalog.json")),
        )
    ) {
        throw new Error("Packaged catalog bytes differ from the validated source");
    }
    if (
        manifest.edition === "portable" &&
        (manifest.platform !== process.platform || manifest.architecture !== process.arch)
    ) {
        throw new Error("Portable smoke test must run on its target platform");
    }
    // A fresh extraction outside the repository prevents accidental access to developer packages,
    // settings, assets, or data. Spaces also exercise native executable path handling.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "party game release smoke "));
    let child: ChildProcess | undefined;
    let publicDatabase: MariaTestProfile | undefined;
    let passed = false;
    try {
        const installation = path.join(scratch, "installation");
        const workingDirectory = path.join(scratch, "service-data");
        fs.cpSync(target, installation, { recursive: true });
        fs.mkdirSync(workingDirectory);
        const port = await unusedPort();
        const environment: NodeJS.ProcessEnv = {};
        for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"]) {
            if (process.env[key]) environment[key] = process.env[key];
        }
        Object.assign(environment, {
            PATH: "",
            HTTP_PORT: String(port),
            MDNS_DISCOVERY_ENABLED: "false",
            LOG_LEVEL: "info",
        });
        let command = path.join(installation, manifest.entrypoint);
        let args: string[] = [];
        if (manifest.edition === "public") {
            command = process.execPath;
            args = [path.join(installation, manifest.entrypoint)];
            environment.NODE_PATH = await installPublicDependencies(installation, scratch);
            await execute(
                command,
                [
                    "-e",
                    `
                const assert = require("node:assert/strict");
                const {hashPassword, verifyPasswordHash} = require(${JSON.stringify(path.join(installation, "app/dist/apps/server/src/modules/passwordHash.js"))});
                (async () => {
                    const hash = await hashPassword("release smoke password");
                    assert.equal(await verifyPasswordHash("release smoke password", hash), true);
                    assert.equal(await verifyPasswordHash("wrong", hash), false);
                })().catch(() => process.exit(1));
            `,
                ],
                { cwd: workingDirectory, env: environment },
            );
            const rejected = spawn(command, args, {
                cwd: workingDirectory,
                env: environment,
                stdio: ["ignore", "pipe", "pipe"],
            });
            let rejection = "";
            rejected.stdout.on("data", (chunk) => {
                rejection += chunk;
            });
            rejected.stderr.on("data", (chunk) => {
                rejection += chunk;
            });
            const code = await new Promise<number | null>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    rejected.kill("SIGKILL");
                    reject(new Error("Unconfigured public release did not fail closed"));
                }, 15_000);
                rejected.once("error", (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
                rejected.once("exit", (code) => {
                    clearTimeout(timeout);
                    resolve(code);
                });
            });
            if (
                code !== 1 ||
                !rejection.includes("server.startup_failed") ||
                rejection.includes("server.listening")
            ) {
                throw new Error(
                    "Unconfigured public release must reject startup through enforced settings validation",
                );
            }
            const profile = loadMariaTestProfile(
                process.env.TEST_DOTENV_FILE ?? path.resolve("tests/.env.test.local"),
                "TEST",
            );
            if (!profile)
                throw new Error(
                    "Public release smoke requires a disposable TEST_DB_* MariaDB profile",
                );
            await resetMariaTestDatabase(profile);
            publicDatabase = profile;
            // The HTTP smoke uses the explicit development policy. MariaDB and accounts
            // stay enabled; enforced deployment and account flows have integration gates.
            Object.assign(environment, {
                PUBLIC_RUNTIME_SECURITY: "development",
                PUBLIC_URL: `http://127.0.0.1:${port}`,
                DB_HOST: profile.host,
                DB_PORT: String(profile.port),
                DB_NAME: profile.database,
                DB_USER: profile.user,
                DB_PASSWORD: profile.password,
            });
        }
        child = spawn(command, args, {
            cwd: workingDirectory,
            env: environment,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        let spawnError: Error | undefined;
        child.on("error", (error) => {
            spawnError = error;
        });
        child.stdout?.on("data", (chunk) => {
            output = (output + chunk).slice(-16_000);
        });
        child.stderr?.on("data", (chunk) => {
            output = (output + chunk).slice(-16_000);
        });
        const origin = `http://127.0.0.1:${port}`;
        const deadline = Date.now() + 120_000;
        let ready = false;
        while (Date.now() < deadline) {
            if (spawnError) throw spawnError;
            if (child.exitCode !== null)
                throw new Error(`Release exited before readiness: ${output}`);
            const response = await fetch(`${origin}/readyz`, {
                signal: AbortSignal.timeout(2_000),
            }).catch(() => undefined);
            if (response?.ok) {
                ready = true;
                break;
            }
            await delay(250);
        }
        if (!ready) throw new Error(`Release did not become ready: ${output}`);
        const page = await fetch(`${origin}/play/`);
        const html = await page.text();
        if (!page.ok || !html.includes("/play/assets/"))
            throw new Error("Release did not serve the built browser client");
        const script = html.match(/src="([^"]+\.js)"/)?.[1];
        if (!script || !(await fetch(new URL(script, origin))).ok)
            throw new Error("Release browser JavaScript is unavailable");
        const info = (await (await fetch(`${origin}/api/v1/server-info`)).json()) as {
            deploymentMode: string;
            authenticationAvailable: boolean;
        };
        const expectedMode = manifest.edition === "portable" ? "local" : "public";
        if (
            info.deploymentMode !== expectedMode ||
            info.authenticationAvailable !== (manifest.edition === "public")
        )
            throw new Error("Release did not load its edition defaults");
        const created = await fetch(`${origin}/api/v1/couch/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ...defaultRoomGameSettings(),
                mode: "CLASSIC_TRUTH_OR_DARE",
                players: [{ name: "Alice" }, { name: "Ben" }],
            }),
        });
        if (created.status !== 201)
            throw new Error(`Release could not create a local game (${created.status})`);
        const session = (await created.json()) as { id: string; revision: number };
        const shown = await fetch(`${origin}/api/v1/couch/sessions/${session.id}/choose`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ revision: session.revision, cardType: "QUESTION" }),
        });
        if (!shown.ok) throw new Error(`Release could not draw a bundled Card (${shown.status})`);
        if (
            manifest.edition === "portable" &&
            !fs.existsSync(path.join(installation, "data/game.sqlite"))
        ) {
            throw new Error("Portable executable did not initialize its own SQLite data");
        }
        console.log(`Release layout and isolated startup passed: ${target}`);
        passed = true;
    } finally {
        if (child) await stop(child);
        if (publicDatabase) await dropMariaTestDatabase(publicDatabase);
        // Only remove the exact scratch directory created above, after its server has exited.
        if (passed)
            fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
        else console.error(`Failed release smoke evidence retained at: ${scratch}`);
    }
}

void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
