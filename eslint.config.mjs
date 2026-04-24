import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            'dist/**',
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
    }
);
