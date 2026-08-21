import type {ReporterDescription} from '@playwright/test';
import {defineConfig, devices} from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config({path: process.env.E2E_DOTENV_FILE ?? '.env.e2e'});

const PORT = Number.parseInt(process.env.APP_PORT ?? '3001', 10);
const BASE_URL = process.env.ROOT_URL ?? `http://localhost:${PORT}`;
const IS_CI = process.env.CI === 'true' || process.env.CI === '1';
const HTML_REPORT_DIR = process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ?? 'playwright-report';
let junitReporter: ReporterDescription | null = null;
if (process.env.PLAYWRIGHT_JUNIT_OUTPUT) {
    junitReporter = ['junit', {outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT}];
} else if (IS_CI) {
    junitReporter = ['junit'];
}

const reporters: ReporterDescription[] = IS_CI || junitReporter
    ? [[IS_CI ? 'line' : 'list'], ...(junitReporter ? [junitReporter] : []), ['html', {
        open: 'never',
        outputFolder: HTML_REPORT_DIR
    }]]
    : [['list'], ['html', {open: 'never'}]];

export default defineConfig({
    testDir: 'tests/e2e',
    testMatch: '**/*.spec.ts',
    timeout: 30_000,
    expect: {timeout: 5_000},
    fullyParallel: true,
    reporter: reporters,
    use: {
        baseURL: BASE_URL,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'off',
    },
    webServer: {
        command: 'npm run e2e:init',
        url: `${BASE_URL}/healthz`,
        reuseExistingServer: !IS_CI,
        timeout: 180_000,
        stderr: 'pipe',
        stdout: 'pipe',
    },
    projects: [
        {name: 'chromium', use: {...devices['Desktop Chrome']}},
    ],
});
