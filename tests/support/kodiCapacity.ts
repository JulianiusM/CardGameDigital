import { spawn } from "node:child_process";

export type NativeCapacityResult = {
    bytes: number;
    participants?: number;
    players: number;
    rules: number;
    exactCards: number;
    cardBytes?: number;
    result?: { total: number; namedAnswers: number } | null;
};

export function probeKodiCapacity(input: object): Promise<NativeCapacityResult> {
    return new Promise((resolve, reject) => {
        const child = spawn("python", ["-B", "tests/support/kodiCapacityProbe.py"], {
            windowsHide: true,
        });
        let output = "",
            error = "";
        const deadline = setTimeout(() => {
            child.kill();
            reject(new Error("Native capacity probe timed out"));
        }, 20_000);
        child.stdout.on("data", (chunk) => {
            output += chunk;
        });
        child.stderr.on("data", (chunk) => {
            error += chunk;
        });
        child.on("error", reject);
        child.on("close", (code) => {
            clearTimeout(deadline);
            if (code !== 0) return reject(new Error(error));
            try {
                resolve(JSON.parse(output));
            } catch (cause) {
                reject(cause);
            }
        });
        child.stdin.end(JSON.stringify(input));
    });
}
