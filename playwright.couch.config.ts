import { defineConfig, devices } from "@playwright/test";

const port = 3011;
export default defineConfig({
    testDir: "tests/e2e",
    testMatch: "couch-mode.spec.ts",
    timeout: 30_000,
    use: {
        baseURL: `http://127.0.0.1:${port}`,
        screenshot: "only-on-failure",
        trace: "on-first-retry",
    },
    webServer: {
        command: `COUCH_E2E_DB_FILE=.tmp/couch-e2e.sqlite npm run e2e:couch:init && SETTINGS_FILE=/dev/null DEPLOYMENT_MODE=local AUTH_MODE=none DB_TYPE=sqlite DB_FILE=.tmp/couch-e2e.sqlite HTTP_BIND=127.0.0.1 HTTP_PORT=${port} PUBLIC_URL=http://127.0.0.1:${port} SESSION_SECRET=couch_e2e_session_secret_123 npm run run`,
        url: `http://127.0.0.1:${port}/healthz`,
        reuseExistingServer: false,
        timeout: 120_000,
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
