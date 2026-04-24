import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
    resolve: {
        alias: {
            '@': resolve(__dirname, './src'),
        },
    },
    test: {
        environment: 'node',
        include: ['src/__tests__/**/*.{test,spec}.ts'],
        coverage: {
            provider: 'v8',
            reportsDirectory: './coverage',
            include: ['src/domain/**/*.ts', 'src/infrastructure/**/*.ts'],
            exclude: ['src/**/types.ts', 'src/**/index.ts', 'src/**/*.d.ts'],
            thresholds: {
                lines: 100,
                functions: 100,
                branches: 100,
                statements: 100,
            },
        },
    },
});
