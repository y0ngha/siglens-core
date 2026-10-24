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
            '@typescript-eslint/no-empty-object-type': [
                'error',
                { allowInterfaces: 'with-single-extends' },
            ],
        },
    },
    // domain은 순수 계산 레이어다(src/domain/CLAUDE.md). 레이어 방향과 함께 순수성도
    // 여기서 강제한다 — 리뷰로만 지키던 규칙이라 사람이 놓치면 그대로 들어왔다.
    //
    // - import: domain 안(상대경로 또는 `@/domain/*`)만 허용한다. 외부 패키지와 `node:*`는
    //   I/O·런타임 의존을 끌고 온다. 상대경로로 상위 레이어에 닿는 형태(`../../infrastructure/x`)도
    //   막는다 — alias 패턴만 두면 상대경로가 그대로 통과한다.
    // - 비결정·I/O API: 현재 시각, 난수, 환경변수, 타이머, 네트워크, 콘솔. 시각이 필요하면
    //   호출자가 값으로 넘긴다.
    {
        files: ['src/domain/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['@/infrastructure/*', '@/application/*'],
                            message:
                                'domain은 infrastructure·application을 import할 수 없다.',
                        },
                        {
                            regex: '^\\.{1,2}/.*\\b(infrastructure|application)(/|$)',
                            message:
                                '상대경로로 domain 밖의 레이어를 import할 수 없다.',
                        },
                        {
                            regex: '^(?!\\.{1,2}/|@/domain(/|$))',
                            message:
                                'domain은 외부 패키지·node 모듈을 import할 수 없다(순수 함수 레이어).',
                        },
                    ],
                },
            ],
            'no-console': 'error',
            'no-restricted-globals': [
                'error',
                {
                    name: 'process',
                    message: 'domain은 환경변수·프로세스에 접근하지 않는다.',
                },
                {
                    name: 'fetch',
                    message: 'domain은 네트워크 I/O를 하지 않는다.',
                },
                {
                    name: 'setTimeout',
                    message: 'domain은 타이머를 쓰지 않는다.',
                },
                {
                    name: 'setInterval',
                    message: 'domain은 타이머를 쓰지 않는다.',
                },
                {
                    name: 'performance',
                    message: '현재 시각은 호출자가 값으로 넘긴다.',
                },
            ],
            'no-restricted-properties': [
                'error',
                {
                    object: 'Date',
                    property: 'now',
                    message: '현재 시각은 호출자가 값으로 넘긴다.',
                },
                {
                    object: 'Math',
                    property: 'random',
                    message: 'domain은 결정적이어야 한다.',
                },
            ],
            'no-restricted-syntax': [
                'error',
                {
                    selector:
                        "NewExpression[callee.name='Date'][arguments.length=0]",
                    message: '현재 시각은 호출자가 값으로 넘긴다.',
                },
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
