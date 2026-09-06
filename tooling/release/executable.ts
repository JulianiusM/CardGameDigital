import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { portableExecutableName } from "./bundle";
import { releaseEntrypoint } from "./entrypoint";

/** Build on the target host so the runtime and native dependencies have the same ABI. */
export function createPortableExecutable(target: string): void {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "party-game-sea-"));
    const executable = path.join(target, portableExecutableName(process.platform));
    try {
        const main = path.join(scratch, "main.cjs");
        const blob = path.join(scratch, "sea.blob");
        const config = path.join(scratch, "sea.json");
        fs.writeFileSync(main, releaseEntrypoint("portable"));
        fs.writeFileSync(
            config,
            JSON.stringify({
                main,
                output: blob,
                disableExperimentalSEAWarning: true,
                useSnapshot: false,
                useCodeCache: false,
            }),
        );
        execFileSync(process.execPath, ["--experimental-sea-config", config], { stdio: "pipe" });
        fs.copyFileSync(process.execPath, executable);
        const runtimeDirectory = path.dirname(process.execPath);
        const license = [
            path.join(runtimeDirectory, "LICENSE"),
            path.join(runtimeDirectory, "../LICENSE"),
        ].find(fs.existsSync);
        if (!license) throw new Error("The build runtime must include its Node LICENSE file");
        fs.copyFileSync(license, path.join(target, "NODE-LICENSE.txt"));
        if (process.platform === "darwin") {
            execFileSync("codesign", ["--remove-signature", executable]);
        }
        const args = [
            require.resolve("postject/dist/cli.js"),
            executable,
            "NODE_SEA_BLOB",
            blob,
            "--sentinel-fuse",
            "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
        ];
        if (process.platform === "darwin") args.push("--macho-segment-name", "NODE_SEA");
        execFileSync(process.execPath, args, { stdio: "pipe" });
        fs.chmodSync(executable, 0o755);
        if (process.platform === "darwin") {
            execFileSync("codesign", ["--sign", "-", executable]);
        }
    } finally {
        // mkdtemp returned this exact absolute scratch directory; never remove the target here.
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}
