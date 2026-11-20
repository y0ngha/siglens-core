import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every `callAnalysisAi(` call under `src/application` must pass a `responseSchema`, or
 * its file must be listed in {@link SCHEMALESS} with the reason. Without a schema the
 * runtime required-keys check in `normalizeJsonResponse` is off (it reads the keys from
 * the schema), so a reply missing a field is accepted and cached; a new call site added
 * without one would silently opt out.
 *
 * The scan is textual and fails closed: a call whose argument is not an object literal
 * (a variable) cannot be classified and fails the guard instead of passing. An object
 * literal is read as written, so a schema supplied only through a spread (`{ ...base }`)
 * counts as missing and has to be written out or listed.
 */

const REPO_ROOT = resolve(__dirname, '../../..');

/**
 * Files whose `callAnalysisAi` calls carry no `responseSchema`, with how many such calls
 * the file has and why. A second schemaless call in a listed file changes the count and
 * fails the guard. Adding a file here is a decision to run without the runtime
 * required-keys check; say why in one line.
 */
const SCHEMALESS: Readonly<
    Record<string, { readonly calls: number; readonly reason: string }>
> = {
    'src/application/economy/runIndicatorTranslation.ts': {
        calls: 1,
        reason: 'Single Korean string reply; there is no object schema to check keys against.',
    },
    'src/application/economy/runEconomicEventAnalysis.ts': {
        calls: 1,
        reason: 'Short fixed-shape classification (sentiment plus two sentences) with no response schema defined yet.',
    },
};

const CALLEE = 'callAnalysisAi';

type CallSite =
    | { readonly kind: 'with_schema' }
    | { readonly kind: 'without_schema' }
    | { readonly kind: 'unclassifiable'; readonly argument: string };

/** Drops block comments and line comments (not the `//` of a URL inside a string). */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
        .replace(/(?<![:'"`\w])\/\/.*$/gm, '');
}

/**
 * `text` with every character inside a string/template literal, or nested deeper than
 * `keepDepth` brackets, replaced by a space. What is left are the tokens at that depth.
 */
function maskBelowDepth(text: string, keepDepth: number): string {
    const quotes = new Set(["'", '"', '`']);
    const state = text.split('').reduce(
        (acc, ch) => {
            if (acc.quote !== null) {
                const closes = !acc.escaped && ch === acc.quote;
                return {
                    ...acc,
                    out: `${acc.out} `,
                    escaped: !acc.escaped && ch === '\\',
                    quote: closes ? null : acc.quote,
                };
            }
            if (quotes.has(ch)) {
                return {
                    ...acc,
                    out: `${acc.out} `,
                    quote: ch,
                    escaped: false,
                };
            }
            const opens = '({['.includes(ch);
            const closes = ')}]'.includes(ch);
            const depth = acc.depth + (opens ? 1 : 0) - (closes ? 1 : 0);
            const visible = opens ? acc.depth <= keepDepth : depth <= keepDepth;
            return {
                ...acc,
                out: `${acc.out}${visible || ch === '\n' ? ch : ' '}`,
                depth,
            };
        },
        { out: '', depth: 0, quote: null as string | null, escaped: false }
    );
    return state.out;
}

/** Index just past the `)` that closes the `(` at `open`, string-aware; -1 if unbalanced. */
function closingParen(text: string, open: number): number {
    const masked = maskBelowDepth(text.slice(open), 0);
    const end = masked.search(/\)/);
    return end === -1 ? -1 : open + end + 1;
}

/** Every `callAnalysisAi(` call expression of `source`, classified by its argument. */
function classifyCallSites(source: string): readonly CallSite[] {
    const code = stripComments(source);
    return [...code.matchAll(new RegExp(`\\b${CALLEE}\\s*\\(`, 'g'))]
        .filter(match => !/function\s+$/.test(code.slice(0, match.index)))
        .map((match): CallSite => {
            const open = match.index + match[0].length - 1;
            const close = closingParen(code, open);
            const argument =
                close === -1 ? '' : code.slice(open + 1, close - 1).trim();
            if (!argument.startsWith('{') || !argument.endsWith('}')) {
                return { kind: 'unclassifiable', argument };
            }
            const topLevel = maskBelowDepth(argument, 1);
            return /[\s{,]responseSchema\s*[:,}]/.test(topLevel)
                ? { kind: 'with_schema' }
                : { kind: 'without_schema' };
        });
}

function applicationSourceFiles(): readonly string[] {
    return execFileSync(
        'git',
        [
            'ls-files',
            '-z',
            '--cached',
            '--others',
            '--exclude-standard',
            'src/application',
        ],
        { cwd: REPO_ROOT, encoding: 'utf8' }
    )
        .split('\0')
        .filter(
            path => path.endsWith('.ts') && existsSync(resolve(REPO_ROOT, path))
        );
}

const FILES = applicationSourceFiles().map(path => ({
    path,
    source: readFileSync(resolve(REPO_ROOT, path), 'utf8'),
}));
const SITES = FILES.map(file => ({
    path: file.path,
    imports: new RegExp(`import\\s*{[^}]*\\b${CALLEE}\\b[^}]*}`).test(
        file.source
    ),
    sites: classifyCallSites(file.source),
}));

describe('callAnalysisAi call sites pass a responseSchema', () => {
    it('finds the call of every file that imports callAnalysisAi', () => {
        const importersWithoutCall = SITES.filter(
            file => file.imports && file.sites.length === 0
        ).map(file => file.path);
        expect(importersWithoutCall).toEqual([]);
        expect(SITES.some(file => file.sites.length > 0)).toBe(true);
    });

    it('classifies every call (none passes a variable that could hide its keys)', () => {
        const unclassifiable = SITES.flatMap(file =>
            file.sites
                .filter(site => site.kind === 'unclassifiable')
                .map(() => file.path)
        );
        expect(unclassifiable).toEqual([]);
    });

    const schemalessCount = (path: string): number =>
        SITES.filter(file => file.path === path)
            .flatMap(file => file.sites)
            .filter(site => site.kind === 'without_schema').length;

    it('has a responseSchema on every call whose file is not listed as schemaless', () => {
        const missing = SITES.filter(
            file =>
                file.sites.some(site => site.kind === 'without_schema') &&
                !(file.path in SCHEMALESS)
        ).map(file => file.path);
        expect(missing).toEqual([]);
    });

    it('lists each schemaless file with exactly the number of schemaless calls it has', () => {
        const mismatched = Object.entries(SCHEMALESS)
            .filter(([path, { calls }]) => schemalessCount(path) !== calls)
            .map(
                ([path, { calls }]) =>
                    `${path}: listed ${calls}, found ${schemalessCount(path)}`
            );
        expect(mismatched).toEqual([]);
    });

    it('gives every schemaless entry a one-line reason', () => {
        expect(
            Object.values(SCHEMALESS).filter(
                ({ reason }) => reason.trim() === '' || reason.includes('\n')
            )
        ).toEqual([]);
    });
});

describe('classifyCallSites', () => {
    it('sees a top-level responseSchema key, written out or as a shorthand', () => {
        expect(
            classifyCallSites(
                `callAnalysisAi({ prompt, responseSchema: SCHEMA, model })`
            )
        ).toEqual([{ kind: 'with_schema' }]);
        expect(
            classifyCallSites(`callAnalysisAi({ prompt, responseSchema })`)
        ).toEqual([{ kind: 'with_schema' }]);
    });

    it('does not count a responseSchema nested one level down or named in a string', () => {
        expect(
            classifyCallSites(
                `callAnalysisAi({ prompt: 'responseSchema: x', extra: { responseSchema: S } })`
            )
        ).toEqual([{ kind: 'without_schema' }]);
    });

    it('reads a call whose argument spans lines and holds parentheses in strings', () => {
        expect(
            classifyCallSites(
                `await callAnalysisAi({\n  prompt: "a ) b",\n  model: pick(x),\n  responseSchema:\n    cond ? A : B,\n})`
            )
        ).toEqual([{ kind: 'with_schema' }]);
    });

    it('ignores comments, the declaration and plain mentions', () => {
        expect(
            classifyCallSites(
                [
                    '// callAnalysisAi({ prompt })',
                    '/* callAnalysisAi({ prompt }) */',
                    'export async function callAnalysisAi(options: X) {}',
                    "console.warn('[callAnalysisAi] note');",
                ].join('\n')
            )
        ).toEqual([]);
    });

    it('refuses to classify a variable argument', () => {
        expect(classifyCallSites(`callAnalysisAi(options)`)).toEqual([
            { kind: 'unclassifiable', argument: 'options' },
        ]);
    });

    it('reads a spread as written: a schema that only comes through it counts as missing', () => {
        expect(classifyCallSites(`callAnalysisAi({ ...base })`)).toEqual([
            { kind: 'without_schema' },
        ]);
    });

    it('reports an unbalanced call as unclassifiable', () => {
        expect(classifyCallSites(`callAnalysisAi({ prompt`)).toEqual([
            { kind: 'unclassifiable', argument: '' },
        ]);
    });

    it('counts every call of a file', () => {
        expect(
            classifyCallSites(
                `callAnalysisAi({ responseSchema: A });\ncallAnalysisAi({ prompt });`
            )
        ).toEqual([{ kind: 'with_schema' }, { kind: 'without_schema' }]);
    });
});
