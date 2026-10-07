import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the rule-ID convention described under "Rule Homes" in the root
 * CLAUDE.md: every `FILE#RULE-ID` reference must resolve to an anchor in the
 * file that owns the rule, anchors are unique and sit right above a heading
 * that starts with the same ID, and the retired mistakes log is not cited.
 */

const REPO_ROOT = resolve(__dirname, '../../..');

/** Layer rule files are cited by repo-relative path, docs/*.md by basename. */
const FILE_PATTERN =
    'src/(?:domain|application|infrastructure)/CLAUDE\\.md|GIT_CONVENTIONS\\.md|CONVENTIONS\\.md|PUBLIC_API\\.md';
const REFERENCE_PATTERN = new RegExp(`(${FILE_PATTERN})#([A-Z]+-\\d+)`, 'g');
/** A rule file named next to a rule ID without the `#` — a citation the scan above would miss. */
const MALFORMED_REFERENCE_PATTERN = new RegExp(
    `(?:${FILE_PATTERN})[ \\t]+[A-Z]+-\\d+\\b`,
    'g'
);
const LOCAL_LINK_PATTERN = /\]\(#([A-Z]+-\d+)\)/g;
const ANCHOR_PATTERN = /<a id="([A-Z]+-\d+)"><\/a>/g;
const TEXT_EXTENSION = /\.(?:ts|md|ya?ml|json|mjs|cjs|js)$/;

const RETIRED_LOG_NAME = ['MIS', 'TAKES'].join('');
const HISTORY_HEADING = '\n## 개정 이력\n';

/** Files that may keep citing the retired log because they are dated history. */
function isHistoryFile(path: string): boolean {
    return (
        path === 'CHANGELOG.md' ||
        path.startsWith('docs/superpowers/') ||
        path.endsWith('ruleReferences.test.ts')
    );
}

function listRepoFiles(): string[] {
    const output = execFileSync(
        'git',
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
    return output
        .split('\0')
        .filter(path => path !== '' && TEXT_EXTENSION.test(path))
        .filter(path => existsSync(resolve(REPO_ROOT, path)));
}

function readRepoFile(path: string): string {
    return readFileSync(resolve(REPO_ROOT, path), 'utf8');
}

function ruleFilePath(cited: string): string {
    return cited.startsWith('src/') ? cited : `docs/${cited}`;
}

function collectAnchors(text: string): string[] {
    return [...text.matchAll(ANCHOR_PATTERN)].map(match => match[1]);
}

const REPO_FILES = listRepoFiles();

describe('rule references', () => {
    describe('every FILE#RULE-ID reference', () => {
        it('resolves to an anchor in the cited file', () => {
            const anchorsByFile = new Map<string, Set<string>>();
            const anchorsOf = (path: string): Set<string> => {
                const cached = anchorsByFile.get(path);
                if (cached !== undefined) return cached;
                const anchors = existsSync(resolve(REPO_ROOT, path))
                    ? new Set(collectAnchors(readRepoFile(path)))
                    : new Set<string>();
                anchorsByFile.set(path, anchors);
                return anchors;
            };

            const unresolved = REPO_FILES.filter(
                path => !isHistoryFile(path)
            ).flatMap(path =>
                [...readRepoFile(path).matchAll(REFERENCE_PATTERN)]
                    .filter(
                        ([, cited, id]) =>
                            !anchorsOf(ruleFilePath(cited)).has(id)
                    )
                    .map(([whole]) => `${path}: ${whole}`)
            );

            expect(unresolved).toEqual([]);
        });

        it('finds references to check, so the scan cannot pass vacuously', () => {
            const found = REPO_FILES.filter(
                path => !isHistoryFile(path)
            ).flatMap(path => [
                ...readRepoFile(path).matchAll(REFERENCE_PATTERN),
            ]);
            expect(found.length).toBeGreaterThan(10);
        });

        it('is always written with the `#` (no `CONVENTIONS.md TE-5` form)', () => {
            const malformed = REPO_FILES.filter(
                path => !isHistoryFile(path)
            ).flatMap(path =>
                [
                    ...readRepoFile(path).matchAll(MALFORMED_REFERENCE_PATTERN),
                ].map(([whole]) => `${path}: ${whole}`)
            );
            expect(malformed).toEqual([]);
        });
    });

    describe('in-file #RULE-ID links', () => {
        it('resolve to an anchor in the same file', () => {
            const unresolved = REPO_FILES.filter(path =>
                path.endsWith('.md')
            ).flatMap(path => {
                const text = readRepoFile(path);
                const anchors = new Set(collectAnchors(text));
                return [...text.matchAll(LOCAL_LINK_PATTERN)]
                    .filter(([, id]) => !anchors.has(id))
                    .map(([whole]) => `${path}: ${whole}`);
            });

            expect(unresolved).toEqual([]);
        });
    });

    describe('rule anchors', () => {
        const ruleFiles = REPO_FILES.filter(path =>
            /^(?:docs\/(?:CONVENTIONS|PUBLIC_API|GIT_CONVENTIONS)\.md|src\/(?:domain|application|infrastructure)\/CLAUDE\.md)$/.test(
                path
            )
        );

        it('exist in the six rule documents', () => {
            expect(ruleFiles).toHaveLength(6);
            expect(
                ruleFiles.every(
                    path => collectAnchors(readRepoFile(path)).length > 0
                )
            ).toBe(true);
        });

        it('are unique within their file', () => {
            const duplicates = ruleFiles.flatMap(path => {
                const anchors = collectAnchors(readRepoFile(path));
                return anchors
                    .filter((id, index) => anchors.indexOf(id) !== index)
                    .map(id => `${path}: ${id}`);
            });

            expect(duplicates).toEqual([]);
        });

        it('sit directly above a heading that starts with the same ID', () => {
            const misplaced = ruleFiles.flatMap(path => {
                const lines = readRepoFile(path).split('\n');
                return lines.flatMap((line, index) => {
                    const id = [...line.matchAll(ANCHOR_PATTERN)][0]?.[1];
                    if (id === undefined) return [];
                    const next = lines[index + 1] ?? '';
                    return new RegExp(`^#{3,4} ${id} — `).test(next)
                        ? []
                        : [`${path}:${index + 1}: ${id}`];
                });
            });

            expect(misplaced).toEqual([]);
        });
    });

    describe('retired mistakes log', () => {
        it('is not mentioned outside changelog and dated history', () => {
            const mentions = REPO_FILES.filter(
                path => !isHistoryFile(path)
            ).flatMap(path => {
                const text = readRepoFile(path);
                const historyStart =
                    path === 'docs/PUBLIC_API.md'
                        ? text.indexOf(HISTORY_HEADING)
                        : -1;
                const live =
                    historyStart === -1 ? text : text.slice(0, historyStart);
                return live.includes(RETIRED_LOG_NAME) ? [path] : [];
            });

            expect(mentions).toEqual([]);
        });

        it('has no file left at its old path', () => {
            expect(
                existsSync(resolve(REPO_ROOT, 'docs', `${RETIRED_LOG_NAME}.md`))
            ).toBe(false);
        });
    });
});
