import settings from "../../apps/server/src/modules/settings";
import { spawn } from "node:child_process";

async function main() {
    try {
        if (!settings.value.initialized) await settings.read();

        // Map your CSV keys to env vars expected by dataSource.ts
        process.env.DB_TYPE = settings.value.dbType;
        process.env.DB_HOST = settings.value.dbHost || "";
        process.env.DB_PORT = String(settings.value.dbPort) || "";
        process.env.DB_USER = settings.value.dbUser || "";
        process.env.DB_PASSWORD = settings.value.dbPassword || "";
        process.env.DB_NAME = settings.value.dbName || "";

        // Now spawn the typeorm CLI migration command
        const cliArgs = process.argv.slice(2); // forward all args after script name
        const cmd = cliArgs.shift();

        const typeormProcess = spawn(
            process.execPath,
            [
                require.resolve("ts-node/dist/bin.js"),
                "--project",
                "./tsconfig.server.json",
                require.resolve("typeorm/cli.js"),
                cmd as string,
                "-d",
                ...cliArgs,
            ],
            { stdio: "inherit", shell: false, env: process.env },
        );

        typeormProcess.on("exit", (code) => process.exit(code));
    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

main();
