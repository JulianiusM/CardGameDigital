import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        include: [
            'tests/unit/**/*.spec.ts',
            'tests/integration/**/*.spec.ts',
            'tests/frontend/**/*.spec.ts',
        ],
        globals: false,
        environment: 'node',
        // Integration suites share the disposable MariaDB schema. Keeping files
        // sequential prevents one production-shaped suite from rebuilding it
        // while another suite is exercising a multi-service workflow.
        fileParallelism: false,
        hookTimeout: 30_000,
        setupFiles: ['tests/support/env.ts'],
        coverage: {
            provider: 'v8',
            reportsDirectory: 'coverage',
            reporter: ['text', 'lcov', 'json'],
            include: ['src/**/*.ts'],
            exclude: [
                'src/migrations/**',
                'src/modules/database/__index__.ts',
                'src/types/**',
            ],
        },
    },
});
