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
 * 3. optional peer(`peerDependenciesMeta`의 `optional: true`)를 설치하지 않은 소비자도
 *    진입점을 로드할 수 있는가. 레포에는 devDependencies로 다 설치돼 있어 2번만으로는
 *    "진입점이 optional peer를 최상위에서 require한다"를 잡지 못한다. 그래서 자식
 *    프로세스에서 그 패키지들의 해석을 막고 진입점을 require한다(INF-11).
 *
 * PR CI(`ci.yml`)와 배포(`publish.yml`)가 같은 스크립트를 쓴다. 배포 커밋(release-it)은
 * PR CI를 거치지 않으므로 배포 경로에도 같은 검사가 있어야 한다.
 */
import { spawnSync } from 'node:child_process';
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

/** `peerDependenciesMeta`에서 `optional: true`인 패키지 이름. */
export function optionalPeers(manifest: {
    peerDependenciesMeta?: Record<string, { optional?: boolean } | undefined>;
}): string[] {
    return Object.entries(manifest.peerDependenciesMeta ?? {})
        .filter(([, meta]) => meta?.optional === true)
        .map(([name]) => name)
        .sort();
}

/**
 * 자식 프로세스에서 `peers`의 해석을 MODULE_NOT_FOUND로 막은 채 `entry`를 require한다.
 * 막는 방식은 Node가 패키지가 없을 때 내는 오류와 같은 모양이라, 진입점이 그 오류를
 * 처리하는 경로까지 실제와 같게 탄다.
 */
const LOAD_WITHOUT_PEERS = `
const Module = require('node:module');
const [entry, peersJson] = process.argv.slice(1);
const peers = JSON.parse(peersJson);
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
    if (peers.some(peer => request === peer || request.startsWith(peer + '/'))) {
        const error = new Error("Cannot find module '" + request + "'");
        error.code = 'MODULE_NOT_FOUND';
        throw error;
    }
    return resolveFilename.call(this, request, ...rest);
};
require(entry);
`;

/** 막힌 상태로 로드에 실패하면 그 오류 메시지, 성공하면 `null`. */
export function loadErrorWithoutPeers(
    entry: string,
    peers: readonly string[]
): string | null {
    const result = spawnSync(
        process.execPath,
        ['-e', LOAD_WITHOUT_PEERS, entry, JSON.stringify(peers)],
        { encoding: 'utf8' }
    );
    if (result.status === 0) return null;
    const message = result.stderr.split('\n').find(line => /Error/.test(line));
    return message?.trim() ?? `exit ${result.status}`;
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
    ) as Parameters<typeof entryFiles>[0] & Parameters<typeof optionalPeers>[0];
    const peers = optionalPeers(manifest);
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
        const withoutPeers = loadErrorWithoutPeers(absolute, peers);
        if (withoutPeers)
            problems.push(
                `optional peer(${peers.join(', ')}) 없이 진입점을 로드하지 못한다: ${entry}\n  ${withoutPeers}`
            );
    }

    if (problems.length > 0) {
        console.error(problems.join('\n'));
        process.exit(1);
    }
    console.log(`dist 검증 통과 (파일 ${files.length}개)`);
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename)
    main();
