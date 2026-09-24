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
        // vitest 5에서 기본값이 true로 바뀌었다(매 테스트 전 `vi.clearAllMocks()`). 모듈 로드
        // 시점의 호출 기록이 첫 테스트 전에 지워져 "import 시점 호출" 단언이 조용히 공허해질 수
        // 있으므로, 기존 테스트가 전제로 삼아 온 vitest 4 의미를 유지한다.
        clearMocks: false,
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
