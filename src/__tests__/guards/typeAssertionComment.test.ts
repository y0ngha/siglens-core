import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Guards `CONVENTIONS.md#TS-2`: every type assertion (`x as T` and `<T>x`)
 * in non-test source carries a reason comment, on the same line as the
 * assertion or on the line directly above it. `as const` is exempt (it
 * narrows, it does not assert), and `satisfies` is not an assertion.
 *
 * This guard checks that a reason comment is present, not that it is a good
 * one; whether the reason is true is a review question. A line-above comment
 * must own its line: a trailing comment on the previous statement
 * (`foo(); // note`) does not excuse the assertion below it.
 *
 * The comment must say something: a comment that is only a lint-directive
 * (`eslint-disable…`, `prettier-ignore`, `@ts-…`) does not count as a reason.
 *
 * Existing violations are held by a numeric ratchet (`BASELINE`, uncommented
 * assertions per file, not line keys, so edits that shift lines are free). A
 * file may never exceed its baseline; when it drops below, the baseline must
 * be lowered (or the entry deleted at zero) in the same change. New files
 * start at zero. Prefer removing a cast (type guard, `satisfies`, generics)
 * over commenting it; commenting is the fallback.
 *
 * Detection is structural (TS AST), so an `as` inside a string or comment is
 * never mistaken for an assertion.
 */

const REPO_ROOT = resolve(__dirname, '../../..');
const SRC_ROOT = resolve(REPO_ROOT, 'src');

/**
 * Repo-relative file → number of uncommented assertions tolerated today.
 * Only ever lower these.
 */
const BASELINE: Readonly<Record<string, number>> = {
    'src/application/analysis/briefingModel.ts': 1,
    'src/application/analysis/callAnalysisAi.ts': 6,
    'src/application/analysis/callBriefingAi.ts': 2,
    'src/application/analysis/inFlight.ts': 2,
    'src/application/market/runAnalysis.ts': 2,
    'src/application/news/runNewsAnalysis.ts': 1,
    'src/application/overall/runOverallAnalysis.ts': 3,
    'src/domain/agent/selectHistoryWindow.ts': 1,
    'src/domain/agent/validateArgs.ts': 1,
    'src/domain/analysis/baseRateCards.ts': 3,
    'src/domain/analysis/candle-labels.ts': 2,
    'src/domain/analysis/confidence.ts': 1,
    'src/domain/analysis/indicatorState.ts': 1,
    'src/domain/analysis/newsPrompt.ts': 4,
    'src/domain/analysis/normalize.ts': 5,
    'src/domain/analysis/normalizeCards.ts': 4,
    'src/domain/analysis/normalizeCongressTrades.ts': 1,
    'src/domain/analysis/normalizeFundamental.ts': 2,
    'src/domain/analysis/normalizeInvestorFlows.ts': 2,
    'src/domain/analysis/normalizeNews.ts': 2,
    'src/domain/analysis/normalizeOverall.ts': 2,
    'src/domain/analysis/outputLocale.ts': 1,
    'src/domain/chat/buildChatPrompt.ts': 9,
    'src/domain/constants/market.ts': 1,
    'src/domain/indicators/cryptoFearGreed/align.ts': 1,
    'src/domain/indicators/index.ts': 2,
    'src/domain/signals/confluence.ts': 2,
    'src/domain/tier.ts': 2,
    'src/infrastructure/ai/providers/anthropic.ts': 4,
    'src/infrastructure/ai/providers/deepseek.ts': 8,
    'src/infrastructure/ai/providers/openai.ts': 2,
    'src/infrastructure/ai/retry/deepseekRetry.ts': 1,
    'src/infrastructure/ai/retry/withRetry.ts': 8,
    'src/infrastructure/optionalPeer/loadOptionalSdk.ts': 1,
    'src/infrastructure/skills/loader.ts': 8,
};

interface Violation {
    readonly file: string;
    readonly line: number;
    readonly text: string;
}

function listSourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) {
            return entry.name === '__tests__' ? [] : listSourceFiles(path);
        }
        return entry.name.endsWith('.ts') &&
            !entry.name.endsWith('.d.ts') &&
            !/\.(test|spec)\.ts$/.test(entry.name)
            ? [path]
            : [];
    });
}

const DIRECTIVE_ONLY =
    /^(eslint-(disable|enable)[\w-]*|prettier-ignore|@ts-[\w-]+)\b/;

/** Text of a comment with its markers stripped. */
function commentBody(raw: string): string {
    return raw
        .replace(/^\/\/+/, '')
        .replace(/^\/\*+/, '')
        .replace(/\*+\/$/, '')
        .replace(/^\s*\*+/gm, '')
        .trim();
}

function isReasonComment(raw: string): boolean {
    const body = commentBody(raw);
    return body.length > 0 && !DIRECTIVE_ONLY.test(body);
}

function isAssertion(
    node: ts.Node
): node is ts.AsExpression | ts.TypeAssertion {
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        return !ts.isConstTypeReference(node.type);
    }
    return false;
}

interface CommentLines {
    /** Lines touched by any reason comment, trailing or not. */
    readonly any: Set<number>;
    /** Lines touched by a reason comment that starts its own line. */
    readonly standalone: Set<number>;
}

/** Lines (0-based) that hold or are ended by a reason comment. */
function collectCommentLines(sf: ts.SourceFile): CommentLines {
    const text = sf.getFullText();
    const lines: CommentLines = { any: new Set(), standalone: new Set() };
    const seen = new Set<number>();
    const add = (ranges: readonly ts.CommentRange[] | undefined): void => {
        for (const range of ranges ?? []) {
            if (seen.has(range.pos)) continue;
            seen.add(range.pos);
            if (!isReasonComment(text.slice(range.pos, range.end))) continue;
            const first = sf.getLineAndCharacterOfPosition(range.pos).line;
            const last = sf.getLineAndCharacterOfPosition(range.end).line;
            const lineStart = sf.getPositionOfLineAndCharacter(first, 0);
            const standalone = text.slice(lineStart, range.pos).trim() === '';
            for (let line = first; line <= last; line++) {
                lines.any.add(line);
                if (standalone) lines.standalone.add(line);
            }
        }
    };
    const visit = (node: ts.Node): void => {
        add(ts.getLeadingCommentRanges(text, node.getFullStart()));
        add(ts.getTrailingCommentRanges(text, node.getEnd()));
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return lines;
}

function findViolations(file: string, source: string): Violation[] {
    const sf = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );
    const commentLines = collectCommentLines(sf);
    const violations: Violation[] = [];
    const visit = (node: ts.Node): void => {
        if (isAssertion(node)) {
            const start = sf.getLineAndCharacterOfPosition(
                node.getStart(sf)
            ).line;
            const typeLine = sf.getLineAndCharacterOfPosition(
                node.type.getStart(sf)
            ).line;
            // Same line: any comment. Line above: only a comment that owns its
            // line, so `foo(); // note` does not excuse the next statement.
            const covered = [start, typeLine].some(
                line =>
                    commentLines.any.has(line) ||
                    commentLines.standalone.has(line - 1)
            );
            if (!covered) {
                violations.push({
                    file: relative(REPO_ROOT, file),
                    line: start + 1,
                    text: node.getText(sf).split('\n')[0],
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return violations;
}

function countByFile(
    violations: readonly Violation[]
): Map<string, Violation[]> {
    const byFile = new Map<string, Violation[]>();
    for (const violation of violations) {
        byFile.set(violation.file, [
            ...(byFile.get(violation.file) ?? []),
            violation,
        ]);
    }
    return byFile;
}

describe('type assertions carry a reason comment (TS-2)', () => {
    it('detects an uncommented assertion and accepts a commented one', () => {
        const source = [
            'const a = JSON.parse(x) as Foo;',
            '// parse boundary already validated',
            'const b = JSON.parse(x) as Foo;',
            'const c = JSON.parse(x) as Foo; // validated upstream',
            '// eslint-disable-next-line',
            'const d = <Foo>JSON.parse(x);',
            'const e = [1] as const;',
            'const f = { a: 1 } satisfies object;',
            'const g = "x as Foo"; // as Foo',
            'foo(); // note',
            'const h = JSON.parse(x) as Foo;',
        ].join('\n');
        const found = findViolations('/virtual/sample.ts', source);
        expect(found.map(violation => violation.line)).toEqual([1, 6, 11]);
    });

    const byFile = countByFile(
        listSourceFiles(SRC_ROOT).flatMap(file =>
            findViolations(file, readFileSync(file, 'utf8'))
        )
    );

    it('does not exceed the per-file baseline of uncommented assertions', () => {
        const over = [...byFile.entries()].flatMap(([file, found]) =>
            found.length > (BASELINE[file] ?? 0)
                ? [
                      `${file}: ${found.length} uncommented (baseline ${BASELINE[file] ?? 0}) — add a one-line WHY comment or remove the cast:`,
                      ...found.map(v => `  ${v.file}:${v.line}  ${v.text}`),
                  ]
                : []
        );
        expect(over).toEqual([]);
    });

    it('lowers the baseline when uncommented assertions are removed', () => {
        const stale = Object.entries(BASELINE).flatMap(([file, allowed]) => {
            const actual = byFile.get(file)?.length ?? 0;
            return actual < allowed
                ? [
                      `${file}: baseline ${allowed} but only ${actual} uncommented — lower it${actual === 0 ? ' (delete the entry)' : ''}`,
                  ]
                : [];
        });
        expect(stale).toEqual([]);
    });
});
