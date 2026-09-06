import { defineConfig } from "@playwright/test";
import couchConfig from "./playwright.couch.config";

const inheritedWebServer = Array.isArray(couchConfig.webServer)
    ? couchConfig.webServer[0]
    : couchConfig.webServer;

if (!inheritedWebServer) throw new Error("The visual audit requires the Couch web server config");

export default defineConfig({
    ...couchConfig,
    testMatch: "visual-audit.spec.ts",
    timeout: 120_000,
    workers: 1,
    webServer: {
        ...inheritedWebServer,
        env: {
            ...inheritedWebServer.env,
            ROOM_MAX_PARTICIPANTS: "1000",
            ROOM_MAX_PLAYERS: "1000",
        },
    },
    use: {
        ...couchConfig.use,
        screenshot: "off",
        trace: "retain-on-failure",
    },
});
