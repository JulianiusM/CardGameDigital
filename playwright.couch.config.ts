import type { ReporterDescription } from "@playwright/test";
import { defineConfig, devices } from "@playwright/test";

const port = 3011;
const isCi = process.env.CI === "true" || process.env.CI === "1";
const htmlReportDirectory = process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ?? "playwright-report";
let junitReporter: ReporterDescription | null = null;
if (process.env.PLAYWRIGHT_JUNIT_OUTPUT) {
    junitReporter = ["junit", { outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT }];
} else if (isCi) {
    junitReporter = ["junit"];
}

const reporters: ReporterDescription[] =
    isCi || junitReporter
        ? [
              [isCi ? "line" : "list"],
              ...(junitReporter ? [junitReporter] : []),
              ["html", { open: "never", outputFolder: htmlReportDirectory }],
          ]
        : [["list"], ["html", { open: "never" }]];

export default defineConfig({
    testDir: "tests/e2e",
    testMatch: ["couch-mode.spec.ts", "couch-recovery.spec.ts", "party-screen.spec.ts"],
    timeout: 30_000,
    fullyParallel: false,
    // Specs share one SQLite server and its process-wide policy-work capacity.
    // Isolate scenarios; multiplayer concurrency is exercised inside each test.
    workers: 1,
    reporter: reporters,
    use: {
        baseURL: `http://127.0.0.1:${port}`,
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
    },
    webServer: {
        command: "npm run e2e:couch:init && npm run run",
        env: {
            ...process.env,
            COUCH_E2E_DB_FILE: ".tmp/couch-e2e.sqlite",
            SETTINGS_FILE: process.platform === "win32" ? "NUL" : "/dev/null",
            DEPLOYMENT_MODE: "local",
            AUTH_MODE: "none",
            DB_TYPE: "sqlite",
            DB_FILE: ".tmp/couch-e2e.sqlite",
            HTTP_BIND: "::",
            HTTP_PORT: String(port),
            PUBLIC_URL: `http://127.0.0.1:${port}`,
            SESSION_SECRET: "couch_e2e_session_secret_123",
            IMPRINT_URL: "https://legal.example.test/imprint",
            PRIVACY_POLICY_URL: "https://legal.example.test/privacy",
        },
        url: `http://127.0.0.1:${port}/healthz`,
        reuseExistingServer: false,
        timeout: 120_000,
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
