import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Guards `CONVENTIONS.md#JD-2`: a JSDoc block sits directly above the one
 * declaration it documents. Three violations are detected structurally (TS
 * AST, so comment-looking text inside strings never counts):
 *
 * 1. Two or more JSDoc blocks stacked on the same declaration — one of them
 *    was left behind when a declaration was inserted or split.
 * 2. A JSDoc followed by a plain comment (`//` or a block comment) before the
 *    declaration — the JSDoc is orphaned. Only a blank line separates a file
 *    header from the declaration's own comments.
 * 3. A JSDoc whose first words are a backticked identifier that is exported
 *    from the same file, sitting above a top-level declaration of a different
 *    name — the doc drifted onto its neighbour. This is deliberately narrow
 *    and does NOT catch: a JSDoc separated from its target by another
 *    declaration unless it opens with that backticked export name; names
 *    that are not backticked, not the first words, or not exported; members
 *    and parameters; unnamed declarations.
 *
 * Intentional exceptions go in `EXEMPTIONS` with a reason per entry.
 */

const REPO_ROOT = resolve(__dirname, '../../..');
const SRC_ROOT = resolve(REPO_ROOT, 'src');

type RuleId = 'stacked' | 'orphaned' | 'name-mismatch';

interface Violation {
    readonly rule: RuleId;
    readonly file: string;
    readonly line: number;
    readonly message: string;
    /** Stable suffix of the exemption key (survives line shifts). */
    readonly subject?: string;
}

/**
 * Exemption key → reason. Keys survive line shifts: a stacked or orphaned
 * violation is keyed `file#rule>declaredName`, a name-mismatch violation
 * `file#documentedName>declaredName`. Only a node with no name falls back to
 * `file:line` (repo-relative, line of the first block).
 */
const EXEMPTIONS: Readonly<Record<string, string>> = {
    'src/application/byok/gate.ts#isUserApiKeyGateDenied>isUserApiKeyGateDeniedAt':
        'The doc defines the `At` variant in terms of its base predicate ("`isUserApiKeyGateDenied`, applied only at the stage that owns the policy"); the backticked name is a reference, not the subject.',
};

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

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Name(s) a node declares; empty when it declares none. */
function declaredNames(statement: ts.Node): string[] {
    if (ts.isVariableStatement(statement)) {
        return statement.declarationList.declarations.flatMap(declaration =>
            ts.isIdentifier(declaration.name) ? [declaration.name.text] : []
        );
    }
    if (
        ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)
    ) {
        return statement.name ? [statement.name.text] : [];
    }
    const name = (statement as { name?: ts.Node }).name;
    return name !== undefined && ts.isIdentifier(name) ? [name.text] : [];
}

function isExported(statement: ts.Statement): boolean {
    return (
        ts.canHaveModifiers(statement) &&
        (ts.getModifiers(statement) ?? []).some(
            modifier => modifier.kind === ts.SyntaxKind.ExportKeyword
        )
    );
}

/** Backticked identifier at the very start of a JSDoc body, if any. */
function leadingBacktickedName(jsdoc: string): string | undefined {
    const body = jsdoc
        .replace(/^\/\*\*/, '')
        .replace(/\*\/$/, '')
        .split('\n')
        .map(line => line.replace(/^\s*\*? ?/, ''))
        .join('\n')
        .trim();
    const match = /^`([^`]+)`/.exec(body);
    return match && IDENTIFIER.test(match[1]) ? match[1] : undefined;
}

function findViolations(fileName: string, text: string): readonly Violation[] {
    const source = ts.createSourceFile(
        fileName,
        text,
        ts.ScriptTarget.Latest,
        true
    );
    const violations: Violation[] = [];
    const seen = new Set<number>();
    const lineOf = (pos: number): number =>
        source.getLineAndCharacterOfPosition(pos).line + 1;

    const isJsdoc = (range: ts.CommentRange): boolean =>
        range.kind === ts.SyntaxKind.MultiLineCommentTrivia &&
        text.startsWith('/**', range.pos);
    const commentsAbove = (node: ts.Node): ts.CommentRange[] =>
        ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
    /** Split into runs; a blank line starts a new run (a file header). */
    const runsOf = (comments: ts.CommentRange[]): ts.CommentRange[][] =>
        comments.reduce<ts.CommentRange[][]>((runs, range, i) => {
            const blankBefore =
                i > 0 &&
                /\r?\n[ \t]*\r?\n/.test(
                    text.slice(comments[i - 1].end, range.pos)
                );
            if (i === 0 || blankBefore) runs.push([range]);
            else runs[runs.length - 1].push(range);
            return runs;
        }, []);

    const exportedNames = new Set(
        source.statements.filter(isExported).flatMap(declaredNames)
    );

    const visit = (node: ts.Node): void => {
        // The SourceFile shares full start 0 with its first statement; let
        // the statement claim the leading comments so it carries a name.
        if (ts.isSourceFile(node)) {
            ts.forEachChild(node, visit);
            return;
        }
        const all = commentsAbove(node).filter(range => !seen.has(range.pos));
        all.forEach(range => seen.add(range.pos));
        const docs = all.filter(isJsdoc);

        if (all.length > 0 && node.kind !== ts.SyntaxKind.EndOfFileToken) {
            const names = declaredNames(node);
            const subjectFor = (rule: RuleId): string | undefined =>
                names.length > 0 ? `${rule}>${names.join(',')}` : undefined;
            for (const run of runsOf(all)) {
                run.forEach((range, i) => {
                    if (!isJsdoc(range) || i === run.length - 1) return;
                    const next = run[i + 1];
                    const [rule, what]: [RuleId, string] = isJsdoc(next)
                        ? [
                              'stacked',
                              `JSDoc blocks at lines ${lineOf(range.pos)} and ${lineOf(next.pos)} are stacked on one declaration`,
                          ]
                        : [
                              'orphaned',
                              `JSDoc at line ${lineOf(range.pos)} is followed by a plain comment at line ${lineOf(next.pos)} before its declaration`,
                          ];
                    violations.push({
                        rule,
                        file: fileName,
                        line: lineOf(range.pos),
                        message: what,
                        subject: subjectFor(rule),
                    });
                });
            }

            if (ts.isSourceFile(node.parent)) {
                const last = docs[docs.length - 1];
                const referenced =
                    last === undefined
                        ? undefined
                        : leadingBacktickedName(text.slice(last.pos, last.end));
                if (
                    referenced !== undefined &&
                    names.length > 0 &&
                    exportedNames.has(referenced) &&
                    !names.includes(referenced) &&
                    last !== undefined
                ) {
                    violations.push({
                        rule: 'name-mismatch',
                        file: fileName,
                        line: lineOf(last.pos),
                        message: `JSDoc describes \`${referenced}\` but sits above \`${names.join(', ')}\``,
                        subject: `${referenced}>${names.join(',')}`,
                    });
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return violations;
}

const files = listSourceFiles(SRC_ROOT);

function locate(violation: Violation): string {
    return `${relative(REPO_ROOT, violation.file)}:${violation.line}`;
}

function exemptionKey(violation: Violation): string {
    return violation.subject === undefined
        ? locate(violation)
        : `${relative(REPO_ROOT, violation.file)}#${violation.subject}`;
}

function unexempted(
    violations: readonly Violation[],
    exemptions: Readonly<Record<string, string>>
): string[] {
    return violations
        .filter(violation => !(exemptionKey(violation) in exemptions))
        .map(violation => `${locate(violation)} ${violation.message}`);
}

function staleExemptions(
    violations: readonly Violation[],
    exemptions: Readonly<Record<string, string>>
): string[] {
    const live = new Set(violations.map(exemptionKey));
    return Object.keys(exemptions).filter(key => !live.has(key));
}

const allViolations: readonly Violation[] = files.flatMap(file =>
    findViolations(file, readFileSync(file, 'utf8'))
);

describe('JSDoc placement (JD-2)', () => {
    it('scans source files', () => {
        expect(files.length).toBeGreaterThan(100);
    });

    it('has no stacked, orphaned or name-mismatched JSDoc', () => {
        expect(unexempted(allViolations, EXEMPTIONS)).toEqual([]);
    });

    it('keeps no stale exemption', () => {
        expect(staleExemptions(allViolations, EXEMPTIONS)).toEqual([]);
    });

    it('requires a reason for every exemption', () => {
        const blank = Object.entries(EXEMPTIONS)
            .filter(([, reason]) => reason.trim() === '')
            .map(([key]) => key);
        expect(blank).toEqual([]);
    });

    describe('detector', () => {
        it('flags two stacked JSDoc blocks', () => {
            const found = findViolations(
                'a.ts',
                '/** one */\n/** two */\nexport const a = 1;\n'
            );
            expect(found.map(v => [v.rule, v.line])).toEqual([['stacked', 1]]);
        });

        it('flags a JSDoc naming another export above a different declaration', () => {
            const found = findViolations(
                'a.ts',
                'export const a = 1;\n/** `a` is the thing. */\nexport const b = 2;\n'
            );
            expect(found.map(v => [v.rule, v.line])).toEqual([
                ['name-mismatch', 2],
            ]);
        });

        it('accepts a matching name, a member reference and a single block', () => {
            const found = findViolations(
                'a.ts',
                [
                    '/** `a` is the thing. */',
                    'export const a = 1;',
                    '/** `a.length` is not a name check. */',
                    'export const b = 2;',
                    '/** Uses `a` inside. */',
                    'export const c = 3;',
                    '',
                ].join('\n')
            );
            expect(found).toEqual([]);
        });

        it('ignores a blank-line-separated file header', () => {
            const found = findViolations(
                'a.ts',
                '/** header */\n\n/** doc */\nexport const a = 1;\n'
            );
            expect(found).toEqual([]);
        });

        it('flags a JSDoc followed by a plain comment', () => {
            const found = findViolations(
                'a.ts',
                '/** one */\n// note\nexport const a = 1;\n/** two */\n/* note */\nexport const b = 2;\n'
            );
            expect(found.map(v => [v.rule, v.line])).toEqual([
                ['orphaned', 1],
                ['orphaned', 4],
            ]);
        });

        it('flags JSDoc, comment, JSDoc as orphaned', () => {
            const found = findViolations(
                'a.ts',
                '/** one */\n// note\n/** two */\nexport const a = 1;\n'
            );
            expect(found.map(v => [v.rule, v.line])).toEqual([['orphaned', 1]]);
        });

        it('treats only a blank line as a header separator', () => {
            const found = findViolations(
                'a.ts',
                '/** header */\n\n// note\nexport const a = 1;\n'
            );
            expect(found).toEqual([]);
        });

        it('flags three stacked blocks as two adjacent pairs', () => {
            const found = findViolations(
                'a.ts',
                '/** one */\n/** two */\n/** three */\nexport const a = 1;\n'
            );
            expect(found.map(v => [v.rule, v.line])).toEqual([
                ['stacked', 1],
                ['stacked', 2],
            ]);
        });

        it('flags stacked JSDoc on an interface member', () => {
            const found = findViolations(
                'a.ts',
                'export interface A {\n    /** one */\n    /** two */\n    x: number;\n}\n'
            );
            expect(found.map(v => [v.rule, v.line, v.subject])).toEqual([
                ['stacked', 2, 'stacked>x'],
            ]);
        });

        it('keeps the exemption key stable across a line shift', () => {
            const code = '/** one */\n/** two */\nexport const a = 1;\n';
            const [before] = findViolations('a.ts', code);
            const [after] = findViolations('a.ts', `// pad\n\n${code}`);
            expect(after.line).not.toBe(before.line);
            expect(exemptionKey(after)).toBe(exemptionKey(before));
            expect(exemptionKey(before)).toMatch(/#stacked>a$/);
        });

        it('falls back to file:line for an unnamed node', () => {
            const [found] = findViolations(
                'a.ts',
                '/** one */\n/** two */\nexport default 1;\n'
            );
            expect(exemptionKey(found)).toMatch(/a\.ts:1$/);
        });

        it('applies and expires name-mismatch exemptions', () => {
            const violations = findViolations(
                'a.ts',
                'export const a = 1;\n/** `a` is the thing. */\nexport const b = 2;\n'
            );
            const key = exemptionKey(violations[0]);
            expect(key).toMatch(/#a>b$/);
            expect(unexempted(violations, { [key]: 'why' })).toEqual([]);
            expect(unexempted(violations, {})).toHaveLength(1);
            expect(staleExemptions(violations, { [key]: 'why' })).toEqual([]);
            expect(staleExemptions([], { [key]: 'why' })).toEqual([key]);
        });

        it('ignores JSDoc-looking text in strings', () => {
            const found = findViolations(
                'a.ts',
                "const s = '/** x */ /** y */';\n/** one */\nexport const a = s;\n"
            );
            expect(found).toEqual([]);
        });
    });
});
