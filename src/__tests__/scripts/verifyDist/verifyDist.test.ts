import { describe, expect, it } from 'vitest';
import {
    entryFiles,
    findUnresolvedAliases,
} from '../../../../scripts/verifyDist/verifyDist';

describe('findUnresolvedAliases', () => {
    describe('alias가 남은 경우', () => {
        it.each([
            ["export { a } from '@/domain/x';", 'ESM 재노출'],
            ['const b = require("@/infrastructure/y");', 'CommonJS require'],
            ['const c = require ( "@/x" );', '공백이 낀 require'],
            [
                'readonly ids: import("@/domain/types").Id[];',
                '.d.ts 인라인 타입 참조',
            ],
            ["import '@/side-effect';", 'side-effect import'],
        ])('%s 를 잡는다 (%s)', source => {
            expect(
                findUnresolvedAliases([{ path: 'dist/x.js', text: source }])
            ).toEqual(['dist/x.js:1']);
        });
    });

    describe('alias가 해석된 경우', () => {
        it('상대경로 import는 통과한다', () => {
            expect(
                findUnresolvedAliases([
                    {
                        path: 'dist/x.js',
                        text: [
                            'const a = require("./domain/x");',
                            "export { b } from '../infrastructure/y';",
                            'readonly ids: import("../domain/types").Id[];',
                        ].join('\n'),
                    },
                ])
            ).toEqual([]);
        });

        it('주석 속 alias 예시는 통과한다', () => {
            expect(
                findUnresolvedAliases([
                    {
                        path: 'dist/x.js',
                        text: [
                            '/**',
                            " * 예: import { a } from '@/domain/x';",
                            ' */',
                            "// require('@/x')",
                        ].join('\n'),
                    },
                ])
            ).toEqual([]);
        });
    });

    it('남은 줄의 위치를 파일·줄 번호로 돌려준다', () => {
        expect(
            findUnresolvedAliases([
                { path: 'dist/a.js', text: 'ok\nrequire("@/x");' },
                { path: 'dist/b.d.ts', text: 'import("@/y").T' },
            ])
        ).toEqual(['dist/a.js:2', 'dist/b.d.ts:1']);
    });
});

describe('entryFiles', () => {
    it('main과 조건부 exports의 모든 대상을 중복 없이 모은다', () => {
        expect(
            entryFiles({
                main: 'dist/index.js',
                exports: {
                    '.': {
                        types: './dist/index.d.ts',
                        browser: './dist/index.client.js',
                        default: './dist/index.js',
                    },
                },
            })
        ).toEqual(['dist/index.client.js', 'dist/index.d.ts', 'dist/index.js']);
    });

    it('subpath exports도 따라간다', () => {
        expect(
            entryFiles({
                exports: {
                    '.': './dist/index.js',
                    './server': { default: './dist/server.js' },
                },
            })
        ).toEqual(['dist/index.js', 'dist/server.js']);
    });

    it('main·exports가 없으면 빈 목록이다', () => {
        expect(entryFiles({})).toEqual([]);
    });
});
