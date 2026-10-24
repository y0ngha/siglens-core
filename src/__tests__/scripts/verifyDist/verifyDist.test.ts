import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    entryFiles,
    findUnresolvedAliases,
    loadErrorWithoutPeers,
    optionalPeers,
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

describe('optionalPeers', () => {
    it('optional: true인 peer만 이름순으로 고른다', () => {
        expect(
            optionalPeers({
                peerDependenciesMeta: {
                    zeta: { optional: true },
                    alpha: { optional: true },
                    required: { optional: false },
                    bare: {},
                },
            })
        ).toEqual(['alpha', 'zeta']);
    });

    it('peerDependenciesMeta가 없으면 빈 목록이다', () => {
        expect(optionalPeers({})).toEqual([]);
    });
});

describe('loadErrorWithoutPeers', () => {
    const tempDirs: string[] = [];
    afterEach(() => {
        tempDirs
            .splice(0)
            .forEach(dir => rmSync(dir, { recursive: true, force: true }));
    });

    // 임시 디렉터리에 가짜 패키지를 실제로 설치해 둔다. 그래야 실패가 "막아서" 난 것인지
    // "원래 없어서" 난 것인지 구분된다(막지 않으면 로드가 성공해야 한다).
    const entryRequiring = (specifier: string): string => {
        const dir = mkdtempSync(join(tmpdir(), 'verify-dist-'));
        tempDirs.push(dir);
        for (const name of ['fake-peer', '@scope/pkg']) {
            const pkgDir = join(dir, 'node_modules', name);
            mkdirSync(join(pkgDir, 'sub'), { recursive: true });
            writeFileSync(join(pkgDir, 'index.js'), 'module.exports = 1;\n');
            writeFileSync(
                join(pkgDir, 'sub', 'index.js'),
                'module.exports = 2;\n'
            );
        }
        const entry = join(dir, 'index.js');
        writeFileSync(entry, `require(${JSON.stringify(specifier)});\n`);
        return entry;
    };

    it('막은 peer를 최상위에서 require하는 진입점은 실패를 돌려준다', () => {
        expect(
            loadErrorWithoutPeers(entryRequiring('fake-peer'), ['fake-peer'])
        ).toMatch(/Cannot find module 'fake-peer'/);
    });

    it('막은 peer의 하위 경로도 막는다', () => {
        expect(
            loadErrorWithoutPeers(entryRequiring('@scope/pkg/sub'), [
                '@scope/pkg',
            ])
        ).toMatch(/Cannot find module '@scope\/pkg\/sub'/);
    });

    it('소스 발췌 줄이 아니라 오류 메시지 줄을 돌려준다', () => {
        const dir = mkdtempSync(join(tmpdir(), 'verify-dist-'));
        tempDirs.push(dir);
        const entry = join(dir, 'index.js');
        writeFileSync(entry, "throw new TypeError('broken entry');\n");
        expect(loadErrorWithoutPeers(entry, [])).toBe(
            'TypeError: broken entry'
        );
    });

    it('막지 않은 패키지는 그대로 로드된다', () => {
        expect(
            loadErrorWithoutPeers(entryRequiring('fake-peer'), [
                '@upstash/redis',
            ])
        ).toBeNull();
    });
});
