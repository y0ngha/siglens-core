import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '@': resolve(__dirname, './src'),
        },
    },
    test: {
        environment: 'node',
        passWithNoTests: true,
        include: ['src/__tests__/**/*.{test,spec}.ts'],
        coverage: {
            provider: 'v8',
            reportsDirectory: './coverage',
            include: [
                'src/domain/**/*.ts',
                'src/infrastructure/**/*.ts',
                'src/application/**/*.ts',
            ],
            exclude: [
                'src/**/types.ts',
                'src/**/index.ts',
                'src/**/*.d.ts',
                // domain/ports/* are pure type/interface declarations (no
                // runtime code) — v8 reports them as 0% though there is
                // nothing to execute. Same rationale as the types.ts exclude.
                'src/domain/ports/**',
            ],
            thresholds: {
                lines: 90,
                functions: 90,
                branches: 90,
                statements: 90,
            },
        },
    },
});
