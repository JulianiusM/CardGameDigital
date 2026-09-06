import type { ReleaseEdition } from "./bundle";

export function releaseSettings(edition: ReleaseEdition): string {
    if (edition === "portable") {
        return "DEPLOYMENT_MODE,local\nAUTH_MODE,none\nDB_TYPE,sqlite\nDB_FILE,data/game.sqlite\nHTTP_BIND,::\nHTTP_PORT,3000\n";
    }
    return "DEPLOYMENT_MODE,public\nPUBLIC_RUNTIME_SECURITY,enforced\nAUTH_MODE,account\nDB_TYPE,mariadb\nHTTP_BIND,127.0.0.1\nHTTP_PORT,3000\n";
}

/** Only built-ins are available to the embedded Node SEA bootstrap. */
export function releaseEntrypoint(edition: ReleaseEdition): string {
    const rootExpression = edition === "portable" ? "path.dirname(process.execPath)" : "__dirname";
    const changeDirectory = edition === "portable" ? "process.chdir(root);" : "";
    return `"use strict";
const path = require("node:path");
const { createRequire } = require("node:module");
const root = ${rootExpression};
// Preserve an operator's relative settings path before local data switches to the archive.
if (process.env.SETTINGS_FILE) process.env.SETTINGS_FILE = path.resolve(process.env.SETTINGS_FILE);
${changeDirectory}
const appRequire = createRequire(path.join(root, "main.cjs"));
const settings = appRequire("./app/dist/apps/server/src/modules/settings.js").default;
settings.setReleaseDefaults(path.join(root, "config/settings.csv"));
appRequire("./app/dist/apps/server/src/server.js");
`;
}
