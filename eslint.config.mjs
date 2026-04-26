import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            'dist/**',
            'docs/api/**',
            'node_modules/**',
            'coverage/**',
            '.yarn/**',
            '.pnp.*',
            '.claude/**',
            '.gemini/**',
            '.husky/**',
            '.vscode/**',
            '*.tsbuildinfo',
            '.agents/**',
        ],
    },
    ...tseslint.configs.recommended,
    {
        files: ['**/*.ts'],
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                    destructuredArrayIgnorePattern: '^_',
                },
            ],
        },
    },
    // domain은 infrastructure, application을 import할 수 없다
    {
        files: ['src/domain/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                { patterns: ['@/infrastructure/*', '@/application/*'] },
            ],
        },
    },
    // infrastructure는 application을 import할 수 없다
    {
        files: ['src/infrastructure/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                { patterns: ['@/application/*'] },
            ],
        },
    }
);
