import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Guards that `src/` has no runtime import cycle between files.
 *
 * The ESLint layer rules only stop imports that cross layers in the wrong
 * direction. A cycle inside one layer (two `domain/` modules importing each
 * other) passes them, and at runtime it can hand a module an `undefined`
 * binding or a TDZ error depending on which file loads first.
 *
 * Specifiers are resolved with `ts.resolveModuleName` and the repository
 * `tsconfig.json`, so `paths` and directory imports resolve exactly as `tsc`
 * resolves them.
 *
 * The graph drops edges that disappear at runtime: `import type`, and a
 * declaration whose specifiers are all `type`. That matches what `tsc` emits
 * only because production code must mark type-only imports
 * (`@typescript-eslint/consistent-type-imports` in `eslint.config.mjs`); a
 * value-syntax import used only as a type would otherwise be counted here and
 * erased by `tsc`. Dynamic `import()` is dropped as well: it is evaluated after
 * the importing module finishes, so it cannot create an initialisation cycle.
 *
 * There is no allow-list. A cycle is fixed where it appears, usually by moving
 * the shared piece into its own file.
 */

const REPO_ROOT = resolve(__dirname, '../../..');
const SRC = join(REPO_ROOT, 'src');

interface ImportEdge {
    from: string;
    to: string;
    typeOnly: boolean;
    dynamic: boolean;
}

interface ImportRecord {
    specifier: string;
    typeOnly: boolean;
    dynamic: boolean;
}

type Resolution =
    | { kind: 'graph'; file: string }
    | { kind: 'external' }
    | { kind: 'outside-graph' }
    | { kind: 'unresolved' };

const isProductionSource = (rel: string): boolean =>
    rel.endsWith('.ts') &&
    !rel.endsWith('.d.ts') &&
    !rel.startsWith('..') &&
    !/(^|\/)__tests__\//.test(rel) &&
    !/\.(test|spec)\.ts$/.test(rel);

const compilerOptions = ((): ts.CompilerOptions => {
    const configPath = join(REPO_ROOT, 'tsconfig.json');
    const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
    return ts.parseJsonConfigFileContent(config, ts.sys, REPO_ROOT).options;
})();

/**
 * Where a specifier in `fromFile` (absolute) points. JSON, `.d.ts`, test files
 * and files outside `src/` cannot take part in a runtime cycle of production
 * modules, so they are `outside-graph` rather than errors.
 */
function resolveImport(specifier: string, fromFile: string): Resolution {
    // `moduleResolution` resolves built-ins only through ambient
    // `@types/node` declarations, never to a file, so classify them up front.
    if (specifier.startsWith('node:') || builtinModules.includes(specifier))
        return { kind: 'external' };
    const resolved = ts.resolveModuleName(
        specifier,
        fromFile,
        compilerOptions,
        ts.sys
    ).resolvedModule;
    if (!resolved) return { kind: 'unresolved' };
    if (resolved.isExternalLibraryImport) return { kind: 'external' };
    const rel = relative(SRC, resolved.resolvedFileName).split(sep).join('/');
    return isProductionSource(rel)
        ? { kind: 'graph', file: rel }
        : { kind: 'outside-graph' };
}

/** A declaration is type-only when it says `type`, or every listed specifier does. */
const allTypeSpecifiers = (
    elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>
): boolean => elements.length > 0 && elements.every(e => e.isTypeOnly);

function isTypeOnlyImport(clause: ts.ImportClause | undefined): boolean {
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    // A default binding is a value even when the named list is all `type`.
    if (clause.name) return false;
    const bindings = clause.namedBindings;
    return (
        bindings !== undefined &&
        ts.isNamedImports(bindings) &&
        allTypeSpecifiers(bindings.elements)
    );
}

function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
    if (node.isTypeOnly) return true;
    const clause = node.exportClause;
    return (
        clause !== undefined &&
        ts.isNamedExports(clause) &&
        allTypeSpecifiers(clause.elements)
    );
}

function extractImports(fileName: string, text: string): ImportRecord[] {
    const sourceFile = ts.createSourceFile(
        fileName,
        text,
        ts.ScriptTarget.Latest
    );
    const found: ImportRecord[] = [];
    const visit = (node: ts.Node): void => {
        if (
            ts.isImportDeclaration(node) &&
            ts.isStringLiteral(node.moduleSpecifier)
        )
            found.push({
                specifier: node.moduleSpecifier.text,
                typeOnly: isTypeOnlyImport(node.importClause),
                dynamic: false,
            });
        else if (
            ts.isExportDeclaration(node) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
        )
            found.push({
                specifier: node.moduleSpecifier.text,
                typeOnly: isTypeOnlyExport(node),
                dynamic: false,
            });
        else if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments[0] &&
            ts.isStringLiteral(node.arguments[0])
        )
            found.push({
                specifier: node.arguments[0].text,
                typeOnly: false,
                dynamic: true,
            });
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
}

function buildImportGraph(): { edges: ImportEdge[]; unresolved: string[] } {
    const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
        .map(rel => rel.split(sep).join('/'))
        .filter(isProductionSource)
        .sort();
    const edges: ImportEdge[] = [];
    const unresolved: string[] = [];
    for (const rel of files) {
        const absolute = join(SRC, rel);
        for (const record of extractImports(
            absolute,
            readFileSync(absolute, 'utf8')
        )) {
            const resolution = resolveImport(record.specifier, absolute);
            if (resolution.kind === 'unresolved')
                unresolved.push(`${rel} -> ${record.specifier}`);
            else if (resolution.kind === 'graph')
                edges.push({
                    from: rel,
                    to: resolution.file,
                    typeOnly: record.typeOnly,
                    dynamic: record.dynamic,
                });
        }
    }
    return { edges, unresolved };
}

/** Tarjan's algorithm with an explicit stack. Returns components of size 2 or more. */
function stronglyConnectedComponents(
    adjacency: ReadonlyMap<string, readonly string[]>
): string[][] {
    const nodes = new Set<string>();
    for (const [from, targets] of adjacency) {
        nodes.add(from);
        targets.forEach(to => nodes.add(to));
    }
    const discovery = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const components: string[][] = [];
    let counter = 0;
    for (const root of nodes) {
        if (discovery.has(root)) continue;
        const callStack: [string, number][] = [[root, 0]];
        while (callStack.length > 0) {
            const frame = callStack[callStack.length - 1]!;
            const node = frame[0];
            if (frame[1] === 0 && !discovery.has(node)) {
                discovery.set(node, counter);
                low.set(node, counter);
                counter += 1;
                stack.push(node);
                onStack.add(node);
            }
            const neighbours = adjacency.get(node) ?? [];
            let descended = false;
            while (frame[1] < neighbours.length) {
                const next = neighbours[frame[1]]!;
                frame[1] += 1;
                if (!discovery.has(next)) {
                    callStack.push([next, 0]);
                    descended = true;
                    break;
                }
                if (onStack.has(next))
                    low.set(
                        node,
                        Math.min(low.get(node)!, discovery.get(next)!)
                    );
            }
            if (descended) continue;
            if (low.get(node) === discovery.get(node)) {
                const component: string[] = [];
                let popped: string;
                do {
                    popped = stack.pop()!;
                    onStack.delete(popped);
                    component.push(popped);
                } while (popped !== node);
                if (component.length > 1) components.push(component.sort());
            }
            callStack.pop();
            const parent = callStack[callStack.length - 1];
            if (parent)
                low.set(
                    parent[0],
                    Math.min(low.get(parent[0])!, low.get(node)!)
                );
        }
    }
    return components;
}

/** Edges whose two ends sit in the same component, as `"a -> b"`. */
function cycleEdges(edges: readonly ImportEdge[]): string[] {
    const adjacency = new Map<string, string[]>();
    const seen = new Set<string>();
    for (const { from, to } of edges) {
        const key = `${from} -> ${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const targets = adjacency.get(from);
        if (targets) targets.push(to);
        else adjacency.set(from, [to]);
    }
    const componentOf = new Map<string, number>();
    stronglyConnectedComponents(adjacency).forEach((component, index) =>
        component.forEach(node => componentOf.set(node, index))
    );
    return [...seen]
        .filter(key => {
            const [from, to] = key.split(' -> ') as [string, string];
            const component = componentOf.get(from);
            return component !== undefined && component === componentOf.get(to);
        })
        .sort();
}

/** Edges that exist when modules are evaluated. */
const runtimeStatic = (edge: ImportEdge): boolean =>
    !edge.typeOnly && !edge.dynamic;

describe('import graph of src/', () => {
    const graph = buildImportGraph();

    it('resolves every internal import', () => {
        // A broken resolver drops edges, the cycles vanish with them, and the
        // cycle test passes for the wrong reason.
        expect(graph.unresolved).toEqual([]);
    });

    it('has no runtime import cycle between files', () => {
        expect(cycleEdges(graph.edges.filter(runtimeStatic))).toEqual([]);
    });
});

describe('resolveImport', () => {
    const from = (rel: string): string => join(SRC, rel);

    it('resolves a `@/` path alias to the source file', () => {
        expect(resolveImport('@/domain/types', from('index.ts'))).toEqual({
            kind: 'graph',
            file: 'domain/types.ts',
        });
    });

    it('leaves a bare repo path unresolved, as tsc does without `baseUrl`', () => {
        expect(resolveImport('src/domain/types', from('index.ts'))).toEqual({
            kind: 'unresolved',
        });
    });

    it('resolves a directory import to its index file', () => {
        expect(
            resolveImport('../indicators', from('domain/signals/index.ts'))
        ).toEqual({ kind: 'graph', file: 'domain/indicators/index.ts' });
    });

    it('treats packages and node built-ins as external', () => {
        expect(resolveImport('typescript', from('index.ts'))).toEqual({
            kind: 'external',
        });
        expect(resolveImport('node:fs', from('index.ts'))).toEqual({
            kind: 'external',
        });
    });

    it('keeps files that cannot join a production cycle out of the graph', () => {
        expect(resolveImport('../package.json', from('index.ts'))).toEqual({
            kind: 'outside-graph',
        });
    });

    it('reports a path that resolves to nothing', () => {
        expect(resolveImport('./does-not-exist', from('index.ts'))).toEqual({
            kind: 'unresolved',
        });
    });
});

describe('extractImports', () => {
    const typeOnlyOf = (source: string): boolean[] =>
        extractImports('x.ts', source).map(record => record.typeOnly);

    describe('type-only declarations', () => {
        it.each([
            ["import type { A } from './a';", '`import type`'],
            ["import { type A, type B } from './a';", 'all specifiers `type`'],
            ["export type { E } from './e';", '`export type`'],
            [
                "export { type E } from './e';",
                'all re-exported specifiers `type`',
            ],
        ])('%s is type-only (%s)', source => {
            expect(typeOnlyOf(source)).toEqual([true]);
        });
    });

    describe('runtime declarations', () => {
        it.each([
            [
                "import D, { type A } from './a';",
                'default binding next to type specifiers',
            ],
            ["import { type A, b } from './a';", 'one value specifier'],
            ["import * as ns from './a';", 'namespace import'],
            ["import './side-effect';", 'side-effect import'],
            ["export * from './f';", 'star re-export'],
            ["export { g } from './g';", 'value re-export'],
        ])('%s is a runtime edge (%s)', source => {
            expect(typeOnlyOf(source)).toEqual([false]);
        });
    });

    it('marks `import()` as dynamic', () => {
        expect(
            extractImports('x.ts', "const g = () => import('./g');")
        ).toEqual([{ specifier: './g', typeOnly: false, dynamic: true }]);
    });

    it('ignores an import written in a comment', () => {
        expect(extractImports('x.ts', "// import { h } from './h';")).toEqual(
            []
        );
    });
});

describe('cycleEdges', () => {
    const edge = (from: string, to: string): ImportEdge => ({
        from,
        to,
        typeOnly: false,
        dynamic: false,
    });

    it('reports every edge of a cycle and none outside it', () => {
        expect(
            cycleEdges([
                edge('a.ts', 'b.ts'),
                edge('b.ts', 'c.ts'),
                edge('c.ts', 'a.ts'),
                edge('c.ts', 'd.ts'),
            ])
        ).toEqual(['a.ts -> b.ts', 'b.ts -> c.ts', 'c.ts -> a.ts']);
    });

    it('reports nothing for an acyclic graph', () => {
        expect(
            cycleEdges([edge('a.ts', 'b.ts'), edge('b.ts', 'c.ts')])
        ).toEqual([]);
    });
});

describe('runtimeStatic', () => {
    const base: ImportEdge = {
        from: 'a.ts',
        to: 'b.ts',
        typeOnly: false,
        dynamic: false,
    };

    it('keeps a static value edge', () => {
        expect(runtimeStatic(base)).toBe(true);
    });

    it('drops a type-only edge', () => {
        expect(runtimeStatic({ ...base, typeOnly: true })).toBe(false);
    });

    it('drops a dynamic edge', () => {
        expect(runtimeStatic({ ...base, dynamic: true })).toBe(false);
    });
});
