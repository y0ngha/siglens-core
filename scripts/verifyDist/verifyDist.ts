/**
 * 빌드 산출물(`dist/`)을 소비자가 쓰는 방식으로 확인한다. `yarn build` 뒤에 돈다.
 *
 * 1. `@/` alias가 남지 않았는가. 빌드는 `tsc` 뒤 `tsc-alias`가 alias를 상대경로로 바꾸는데,
 *    남은 alias는 `tsc`가 오류로 보지 않아 빌드가 성공한다. 소비자에서는 런타임(`.js`)이나
 *    타입 해석(`.d.ts`)에서 모듈을 찾지 못한다. `.d.ts`에는 `import("@/x").T` 같은 인라인
 *    타입 참조도 생기므로 그 형태까지 본다.
 * 2. `package.json`의 `main`·`exports`가 가리키는 파일이 있고, `.js`는 실제로 로드되며
 *    export가 비어 있지 않은가. 진입점 목록은 `package.json`에서 읽는다 — 하드코딩하면
 *    exports가 바뀌어도 검사가 예전 파일만 본다.
 *
 * PR CI(`ci.yml`)와 배포(`publish.yml`)가 같은 스크립트를 쓴다. 배포 커밋(release-it)은
 * PR CI를 거치지 않으므로 배포 경로에도 같은 검사가 있어야 한다.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';

/** `from '@/x'`, `require('@/x')`, `import('@/x')`, `import '@/x'`. 공백·따옴표 종류 무관. */
const UNRESOLVED_ALIAS =
    /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)(['"])@\//;

export interface SourceText {
    path: string;
    text: string;
}

/** 주석을 지운다. 산출물 JSDoc에 `@/x` 예시가 남아도 오탐하지 않게 한다. */
function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** alias가 남은 `path:line` 목록. */
export function findUnresolvedAliases(files: readonly SourceText[]): string[] {
    return files.flatMap(({ path, text }) =>
        stripComments(text)
            .split('\n')
            .flatMap((line, index) =>
                UNRESOLVED_ALIAS.test(line) ? [`${path}:${index + 1}`] : []
            )
    );
}

/** `main`과 `exports`(조건부 중첩 포함)가 가리키는 파일 경로. 중복은 하나로. */
export function entryFiles(manifest: {
    main?: string;
    exports?: unknown;
}): string[] {
    // `main: 'dist/index.js'`와 `exports: './dist/index.js'`가 같은 파일이므로
    // `./`를 벗긴 뒤에 중복을 없앤다.
    const targets = new Set<string>();
    const add = (target: string): void => {
        targets.add(target.replace(/^\.\//, ''));
    };
    if (manifest.main) add(manifest.main);
    const visit = (value: unknown): void => {
        if (typeof value === 'string') add(value);
        else if (value && typeof value === 'object')
            Object.values(value).forEach(visit);
    };
    visit(manifest.exports);
    return [...targets].sort();
}

function listFiles(dir: string): string[] {
    return readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .map(rel => rel.split(sep).join('/'))
        .filter(rel => rel.endsWith('.js') || rel.endsWith('.d.ts'));
}

function main(): void {
    const root = resolve(import.meta.dirname, '../..');
    const distDir = join(root, 'dist');
    if (!existsSync(distDir))
        throw new Error('dist/ 가 없다. yarn build 를 먼저 실행한다.');

    const problems: string[] = [];

    const files = listFiles(distDir).map(rel => ({
        path: `dist/${rel}`,
        text: readFileSync(join(distDir, rel), 'utf8'),
    }));
    const aliases = findUnresolvedAliases(files);
    if (aliases.length > 0)
        problems.push(
            `해석되지 않은 @/ alias ${aliases.length}건:\n  ${aliases.join('\n  ')}`
        );

    const manifest = JSON.parse(
        readFileSync(join(root, 'package.json'), 'utf8')
    ) as { main?: string; exports?: unknown };
    const require = createRequire(join(root, 'package.json'));
    for (const entry of entryFiles(manifest)) {
        const absolute = join(root, entry);
        if (!existsSync(absolute)) {
            problems.push(`진입점 파일이 없다: ${entry}`);
            continue;
        }
        if (!entry.endsWith('.js')) continue;
        const exported = Object.keys(require(absolute) as object).length;
        if (exported === 0)
            problems.push(`진입점 export가 비어 있다: ${entry}`);
        else console.log(`${relative(root, absolute)}: export ${exported}개`);
    }

    if (problems.length > 0) {
        console.error(problems.join('\n'));
        process.exit(1);
    }
    console.log(`dist 검증 통과 (파일 ${files.length}개)`);
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename)
    main();
