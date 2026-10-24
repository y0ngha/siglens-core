import path from 'node:path';
import tseslint from 'typescript-eslint';

const SRC_DIR = path.resolve(import.meta.dirname, 'src');

/**
 * import 지정자를 **해석된 경로**로 판정하는 레이어 경계 규칙.
 *
 * `no-restricted-imports`는 지정자 문자열만 보므로, 같은 파일에 닿는 다른 표기를 막지
 * 못한다. 상대경로(`../../infrastructure/x`), 디렉터리 import(`..`), 공개 배럴
 * (`../../index`, 이것이 application을 재노출한다)이 전부 문자열 패턴을 비켜 갔고,
 * 반대로 `../market-application/x` 같은 domain 안 경로를 잘못 막았다. 그래서 상대경로와
 * `@/`를 `src/` 기준 경로로 풀어 그 위치로 판정한다.
 *
 * 옵션:
 * - `allowedRoot`: 이 경로(`src/` 기준) 안만 import할 수 있다.
 * - `forbiddenRoots`: 이 경로(`src/` 기준)들은 import할 수 없다.
 * - `external`: 외부 패키지·`node:*` 허용 여부. `false`여도 `node:*`의 `import type`은
 *   허용한다(src/domain/CLAUDE.md "Node built-in types that are purely type-level").
 *
 * 정적 import·재노출·동적 `import()`·`require()`를 모두 본다.
 */
const layerBoundaryRule = {
    meta: {
        type: 'problem',
        schema: [
            {
                type: 'object',
                properties: {
                    allowedRoot: { type: 'string' },
                    forbiddenRoots: {
                        type: 'array',
                        items: { type: 'string' },
                    },
                    external: { type: 'boolean' },
                },
                additionalProperties: false,
            },
        ],
        messages: {
            outside:
                "'{{specifier}}'는 {{target}}를 가리킨다. 이 레이어는 {{root}} 안만 import할 수 있다.",
            forbidden:
                "'{{specifier}}'는 {{target}}를 가리킨다. 이 레이어는 {{root}}를 import할 수 없다.",
            external:
                "'{{specifier}}': 이 레이어는 외부 패키지·node 모듈을 import할 수 없다(순수 함수 레이어).",
        },
    },
    create(context) {
        const {
            allowedRoot,
            forbiddenRoots = [],
            external = true,
        } = context.options[0] ?? {};
        const isWithin = (rel, root) =>
            rel === root || rel.startsWith(`${root}/`);

        const check = (node, source, typeOnly) => {
            if (source?.type !== 'Literal' || typeof source.value !== 'string')
                return;
            const specifier = source.value;
            let absolute;
            if (specifier.startsWith('.'))
                absolute = path.resolve(
                    path.dirname(context.filename),
                    specifier
                );
            else if (specifier.startsWith('@/'))
                absolute = path.join(SRC_DIR, specifier.slice(2));
            else {
                const typeLevelNode = typeOnly && specifier.startsWith('node:');
                if (!external && !typeLevelNode)
                    context.report({
                        node,
                        messageId: 'external',
                        data: { specifier },
                    });
                return;
            }
            const rel = path
                .relative(SRC_DIR, absolute)
                .split(path.sep)
                .join('/')
                .replace(/\.(js|ts)$/, '');
            const target = rel.startsWith('..') ? 'src/ 밖' : `src/${rel}`;
            if (allowedRoot && !isWithin(rel, allowedRoot)) {
                context.report({
                    node,
                    messageId: 'outside',
                    data: { specifier, target, root: `src/${allowedRoot}` },
                });
                return;
            }
            const hit = forbiddenRoots.find(root => isWithin(rel, root));
            if (hit)
                context.report({
                    node,
                    messageId: 'forbidden',
                    data: { specifier, target, root: `src/${hit}` },
                });
        };

        const isTypeOnlyDeclaration = node =>
            node.importKind === 'type' ||
            node.exportKind === 'type' ||
            (node.specifiers?.length > 0 &&
                node.specifiers.every(
                    s => s.importKind === 'type' || s.exportKind === 'type'
                ));

        return {
            ImportDeclaration: node =>
                check(node, node.source, isTypeOnlyDeclaration(node)),
            ExportNamedDeclaration: node =>
                check(node, node.source, isTypeOnlyDeclaration(node)),
            ExportAllDeclaration: node =>
                check(node, node.source, node.exportKind === 'type'),
            ImportExpression: node => check(node, node.source, false),
            CallExpression: node => {
                if (
                    node.callee.type === 'Identifier' &&
                    node.callee.name === 'require'
                )
                    check(node, node.arguments[0], false);
            },
        };
    },
};

const localPlugin = { rules: { 'layer-boundary': layerBoundaryRule } };

/** domain에서 비결정·I/O를 끌어오는 전역. 현재 시각은 호출자가 값으로 넘긴다(DOM-3). */
const DOMAIN_FORBIDDEN_GLOBALS = [
    ['process', '환경변수·프로세스에 접근하지 않는다.'],
    ['fetch', '네트워크 I/O를 하지 않는다.'],
    ['setTimeout', '타이머를 쓰지 않는다.'],
    ['setInterval', '타이머를 쓰지 않는다.'],
    ['setImmediate', '타이머를 쓰지 않는다.'],
    ['clearTimeout', '타이머를 쓰지 않는다.'],
    ['clearInterval', '타이머를 쓰지 않는다.'],
    ['queueMicrotask', '스케줄링을 하지 않는다.'],
    ['performance', '현재 시각은 호출자가 값으로 넘긴다.'],
    ['crypto', '난수·UUID를 만들지 않는다(결정적이어야 한다).'],
    ['globalThis', '전역 객체로 위 금지 항목을 우회하지 않는다.'],
].map(([name, reason]) => ({ name, message: `domain은 ${reason}` }));

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
    // domain은 순수 계산 레이어다(src/domain/CLAUDE.md "Dependency Rules"). 레이어 방향과
    // 함께 순수성도 여기서 강제한다 — 리뷰로만 지키던 규칙이라 사람이 놓치면 그대로 들어왔다.
    //
    // 인자 없는 `new Date()`는 막지 않는다. DOM-3이 `options.now ?? new Date()`를 권장
    // 형태로 둔다 — 주입된 시각을 무시하는 맨 `new Date()`는 리뷰가 잡는다.
    {
        files: ['src/domain/**/*.ts'],
        plugins: { local: localPlugin },
        rules: {
            'local/layer-boundary': [
                'error',
                { allowedRoot: 'domain', external: false },
            ],
            'no-console': 'error',
            'no-restricted-globals': ['error', ...DOMAIN_FORBIDDEN_GLOBALS],
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
                    // `Date()`는 생성자가 아니라 현재 시각 문자열을 돌려준다.
                    selector: "CallExpression[callee.name='Date']",
                    message: '현재 시각은 호출자가 값으로 넘긴다.',
                },
            ],
        },
    },
    // infrastructure는 application을 import할 수 없다. 공개 배럴(`index`, `index.client`)은
    // application을 재노출하므로 함께 막는다.
    {
        files: ['src/infrastructure/**/*.ts'],
        plugins: { local: localPlugin },
        rules: {
            'local/layer-boundary': [
                'error',
                {
                    forbiddenRoots: ['application', 'index', 'index.client'],
                },
            ],
        },
    }
);
