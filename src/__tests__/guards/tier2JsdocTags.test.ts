import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Guards the Tier 2 row of `CONVENTIONS.md#JD-1` ("Required Tags by Tier"):
 * every function exported from `src/index.ts` / `src/index.client.ts` that
 * `docs/PUBLIC_API.md` lists in its Tier 2 inventory section must carry a
 * JSDoc `@param` for every declared parameter and a `@returns` unless the
 * function returns `void` (or `Promise<void>`).
 *
 * The Tier 2 membership source is the inventory table rows between the
 * `### Tier 2` and `### Tier 3` headings under `## 현재 노출 인벤토리`: the
 * backticked identifiers in a row's first cell. A name that resolves to no
 * export of either entry point fails the guard; one that resolves to a
 * non-function symbol (constant, type) is recognised and skipped; a function
 * export that is not a plain function/arrow declaration cannot be checked and
 * fails. A named parameter needs a `@param` of its own name; a destructured
 * one (no name) needs a `@param` at its position among the top-level tags.
 *
 * This does NOT check the description, English language or `@example`.
 */

const REPO_ROOT = resolve(__dirname, '../../..');
const ENTRY_POINTS = ['src/index.ts', 'src/index.client.ts'] as const;
const INVENTORY_HEADING = '## 현재 노출 인벤토리';
const TIER2_HEADING = '\n### Tier 2';
const TIER3_HEADING = '\n### Tier 3';

/**
 * Exemption key (`file#name`) → reason. Keep empty unless a tag cannot be
 * written truthfully.
 */
const EXEMPTIONS: Readonly<Record<string, string>> = {};

/** Identifiers in the first cell of a Tier 2 table row (before ` — `). */
function firstCellIdentifiers(row: string): string[] {
    const body = row.slice('| '.length);
    const dash = body.indexOf(' — ');
    const end = dash >= 0 ? dash : body.lastIndexOf(' | ');
    const head = end >= 0 ? body.slice(0, end) : body;
    return [...head.matchAll(/`([A-Za-z_$][\w$]*)/g)].map(match => match[1]);
}

function tier2Names(doc: string): Set<string> {
    const inventory = doc.indexOf(INVENTORY_HEADING);
    if (inventory === -1) throw new Error(`"${INVENTORY_HEADING}" not found`);
    const start = doc.indexOf(TIER2_HEADING, inventory);
    const end = doc.indexOf(TIER3_HEADING, start);
    if (start === -1 || end === -1) {
        throw new Error('Tier 2 / Tier 3 inventory headings not found');
    }
    return new Set(
        doc
            .slice(start, end)
            .split('\n')
            .filter(line => line.startsWith('| `'))
            .flatMap(firstCellIdentifiers)
    );
}

function createProgram(): ts.Program {
    const configPath = resolve(REPO_ROOT, 'tsconfig.json');
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
        config.config,
        ts.sys,
        REPO_ROOT
    );
    return ts.createProgram({
        rootNames: ENTRY_POINTS.map(path => resolve(REPO_ROOT, path)),
        options: { ...parsed.options, noEmit: true },
    });
}

type FunctionLike =
    ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

/** The function node and the node that carries its JSDoc, if the declaration is a function. */
function asFunction(
    declaration: ts.Declaration
): { fn: FunctionLike; docHost: ts.Node } | undefined {
    if (ts.isFunctionDeclaration(declaration)) {
        return { fn: declaration, docHost: declaration };
    }
    if (
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer))
    ) {
        return {
            fn: declaration.initializer,
            docHost: declaration.parent.parent,
        };
    }
    return undefined;
}

function isVoidLike(checker: ts.TypeChecker, fn: FunctionLike): boolean {
    const signature = checker.getSignatureFromDeclaration(fn);
    if (!signature) return false;
    const isVoid = (type: ts.Type): boolean =>
        (type.flags & ts.TypeFlags.Void) !== 0;
    const returnType = checker.getReturnTypeOfSignature(signature);
    if (isVoid(returnType)) return true;
    const awaited = checker.getAwaitedType(returnType);
    return (
        awaited !== undefined &&
        awaited !== returnType &&
        isVoid(awaited) &&
        checker.typeToString(returnType).startsWith('Promise<')
    );
}

function missingTags(
    checker: ts.TypeChecker,
    fn: FunctionLike,
    docHost: ts.Node
): string[] {
    const tags = ts.getJSDocTags(docHost);
    const paramTags = tags.filter(ts.isJSDocParameterTag);
    const topLevel = paramTags
        .map(tag => tag.name.getText())
        .filter(name => !name.includes('.'));
    const problems: string[] = [];
    const named = new Set(
        fn.parameters.flatMap(parameter =>
            ts.isIdentifier(parameter.name) ? [parameter.name.text] : []
        )
    );
    fn.parameters.forEach((parameter, index) => {
        const isNamed = ts.isIdentifier(parameter.name);
        // A destructured parameter has no name: the tag at its index counts,
        // unless that tag is already the name of another parameter.
        const documented = isNamed
            ? topLevel.includes((parameter.name as ts.Identifier).text)
            : index < topLevel.length && !named.has(topLevel[index]);
        if (!documented) {
            problems.push(
                `missing @param for ${isNamed ? `\`${parameter.name.getText()}\`` : `parameter #${index + 1}`}`
            );
        }
    });
    const hasReturns = tags.some(
        tag => ts.isJSDocReturnTag(tag) || tag.tagName.text === 'returns'
    );
    if (!hasReturns && !isVoidLike(checker, fn)) {
        problems.push('missing @returns');
    }
    return problems;
}

interface Findings {
    readonly violations: string[];
    /** Functions whose tags were actually checked. */
    readonly checkedCount: number;
}

/**
 * Checks every `names` entry against the exports of `entries` in `program`.
 * `displayRoot` only shortens file names in messages.
 */
function checkProgram(
    program: ts.Program,
    entries: readonly string[],
    names: ReadonlySet<string>,
    displayRoot: string
): Findings {
    const checker = program.getTypeChecker();
    const violations: string[] = [];
    const checked = new Set<ts.Node>();
    const resolved = new Set<string>();
    for (const entry of entries) {
        const source = program.getSourceFile(entry);
        const moduleSymbol = source && checker.getSymbolAtLocation(source);
        if (!moduleSymbol) throw new Error(`cannot resolve ${entry}`);
        for (const exported of checker.getExportsOfModule(moduleSymbol)) {
            if (!names.has(exported.name)) continue;
            resolved.add(exported.name);
            const symbol =
                exported.flags & ts.SymbolFlags.Alias
                    ? checker.getAliasedSymbol(exported)
                    : exported;
            const declarations = symbol.declarations ?? [];
            const functions = declarations.flatMap(declaration => {
                const target = asFunction(declaration);
                // The implementation signature of an overloaded function
                // is not public; its overload signatures are.
                const isImplementation =
                    target !== undefined &&
                    ts.isFunctionDeclaration(target.fn) &&
                    target.fn.body !== undefined &&
                    declarations.length > 1;
                return target && !isImplementation
                    ? [{ declaration, ...target }]
                    : [];
            });
            if (functions.length === 0) {
                const type = checker.getTypeOfSymbolAtLocation(
                    symbol,
                    declarations[0] ?? source
                );
                if (type.getCallSignatures().length > 0) {
                    violations.push(
                        `\`${exported.name}\` (Tier 2): a callable export that is not a function or arrow declaration; the guard cannot read its JSDoc`
                    );
                }
                continue;
            }
            // Overloads share one doc block, written above the first signature:
            // check the documented overload, else the first one.
            const documented = functions.filter(
                ({ docHost }) => ts.getJSDocTags(docHost).length > 0
            );
            for (const { declaration, fn, docHost } of documented.length > 0
                ? documented
                : functions.slice(0, 1)) {
                if (checked.has(fn)) continue;
                checked.add(fn);
                const file = relative(
                    displayRoot,
                    declaration.getSourceFile().fileName
                );
                if (`${file}#${exported.name}` in EXEMPTIONS) continue;
                const line =
                    declaration
                        .getSourceFile()
                        .getLineAndCharacterOfPosition(declaration.getStart())
                        .line + 1;
                for (const problem of missingTags(checker, fn, docHost)) {
                    violations.push(
                        `${file}:${line} \`${exported.name}\` (Tier 2): ${problem}`
                    );
                }
            }
        }
    }
    for (const name of names) {
        if (!resolved.has(name)) {
            violations.push(
                `\`${name}\` (Tier 2): listed in PUBLIC_API.md but exported from no entry point`
            );
        }
    }
    return { violations: violations.sort(), checkedCount: checked.size };
}

/** Smallest plausible count of Tier 2 functions; a drop means the guard stopped seeing them. */
const MIN_CHECKED_FUNCTIONS = 30;

/** In-memory program of one fixture module (no lib: only `void` is needed). */
function fixtureProgram(code: string): ts.Program {
    const fileName = '/fixture/entry.ts';
    const options: ts.CompilerOptions = {
        noLib: true,
        noEmit: true,
        target: ts.ScriptTarget.ES2022,
    };
    const host = ts.createCompilerHost(options);
    const source = ts.createSourceFile(
        fileName,
        code,
        ts.ScriptTarget.ES2022,
        true
    );
    return ts.createProgram({
        rootNames: [fileName],
        options,
        host: {
            ...host,
            getSourceFile: (name, ...rest) =>
                name === fileName ? source : host.getSourceFile(name, ...rest),
            fileExists: name => name === fileName || host.fileExists(name),
            readFile: name => (name === fileName ? code : host.readFile(name)),
        },
    });
}

function checkFixture(code: string, names: string[]): Findings {
    return checkProgram(
        fixtureProgram(code),
        ['/fixture/entry.ts'],
        new Set(names),
        '/fixture'
    );
}

describe('Tier 2 JSDoc required tags (CONVENTIONS.md#JD-1)', () => {
    it('every Tier 2 function documents each parameter and its return value', () => {
        const doc = readFileSync(
            resolve(REPO_ROOT, 'docs/PUBLIC_API.md'),
            'utf8'
        );
        const { violations, checkedCount } = checkProgram(
            createProgram(),
            ENTRY_POINTS.map(path => resolve(REPO_ROOT, path)),
            tier2Names(doc),
            REPO_ROOT
        );
        expect(
            violations,
            `Tier 2 functions need @param for every parameter and @returns for a non-void return:\n${violations.join('\n')}`
        ).toEqual([]);
        expect(checkedCount).toBeGreaterThanOrEqual(MIN_CHECKED_FUNCTIONS);
    });

    it('has no stale exemptions', () => {
        expect(Object.keys(EXEMPTIONS)).toEqual([]);
    });
});

describe('Tier 2 checker on fixtures', () => {
    const run = (code: string, name = 'f'): Findings =>
        checkFixture(code, [name]);

    it('accepts a fully tagged function', () => {
        const result = run(
            `/** d\n * @param a - x\n * @param b - y\n * @returns z */\nexport function f(a: number, b = 1): number { return a + b; }`
        );
        expect(result).toEqual({ violations: [], checkedCount: 1 });
    });

    it('flags a missing @returns but not for void', () => {
        expect(
            run(
                `/** d\n * @param a - x */\nexport function f(a: number): number { return a; }`
            ).violations
        ).toEqual([expect.stringContaining('missing @returns')]);
        expect(
            run(
                `/** d\n * @param a - x */\nexport function f(a: number): void { void a; }`
            ).violations
        ).toEqual([]);
    });

    it('matches named parameters by name, defaults and rest included', () => {
        const violations = run(
            `/** d\n * @param a - x\n * @param wrong - y\n * @param rest - z\n * @returns r */\nexport function f(a: number, b = 1, ...rest: number[]): number { return a + b + rest.length; }`
        ).violations;
        expect(violations).toEqual([
            expect.stringContaining('missing @param for `b`'),
        ]);
    });

    it('matches a destructured parameter by position', () => {
        const code = (tags: string): string =>
            `/** d\n${tags} * @returns r */\nexport function f(a: number, { x }: { x: number }): number { return a + x; }`;
        expect(
            run(code(' * @param a - x\n * @param options - y\n')).violations
        ).toEqual([]);
        expect(run(code(' * @param a - x\n')).violations).toEqual([
            expect.stringContaining('missing @param for parameter #2'),
        ]);
        // The second tag repeating a named parameter does not cover it.
        expect(
            run(code(' * @param a - x\n * @param a - y\n')).violations
        ).toEqual([expect.stringContaining('missing @param for parameter #2')]);
    });

    it('checks the documented overload, not the implementation', () => {
        const ok = run(
            `/** d\n * @param a - x\n * @returns r */\nexport function f(a: number): number;\nexport function f(a: string): string;\nexport function f(a: number | string): number | string { return a; }`
        );
        expect(ok).toEqual({ violations: [], checkedCount: 1 });
    });

    it('fails on a name no entry point exports and on an undocumented callable const', () => {
        expect(run('export const other = 1;', 'gone').violations).toEqual([
            expect.stringContaining('exported from no entry point'),
        ]);
        expect(
            run(
                `declare function make(): () => number;\nexport const f = make();`
            ).violations
        ).toEqual([expect.stringContaining('callable export')]);
        expect(run('export const f = 1;')).toEqual({
            violations: [],
            checkedCount: 0,
        });
    });
});
