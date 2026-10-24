import { readdirSync, readFileSync } from 'node:fs';
import { posix, resolve, sep } from 'node:path';
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
 * The graph keeps static `import … from`, `export … from` and `import()` edges
 * and drops edges that disappear at runtime (`import type`, or a declaration
 * whose specifiers are all `type`). Dynamic `import()` is dropped from the
 * cycle check as well: it is evaluated after the importing module finishes,
 * so it cannot create an initialisation cycle.
 *
 * There is no allow-list. A cycle is fixed where it appears, usually by moving
 * the shared piece into its own file.
 */

const SRC = resolve(__dirname, '../..');

interface ImportEdge {
    from: string;
    to: string;
    typeOnly: boolean;
    dynamic: boolean;
}

const isProductionSource = (rel: string): boolean =>
    rel.endsWith('.ts') &&
    !rel.endsWith('.d.ts') &&
    !/(^|\/)__tests__\//.test(rel) &&
    !/\.(test|spec)\.ts$/.test(rel);

const RESOLVE_SUFFIXES = ['', '.ts', '/index.ts'];

/** `undefined` for external packages, `null` for an internal path that does not exist. */
function resolveSpecifier(
    specifier: string,
    fromRel: string,
    fileSet: ReadonlySet<string>
): string | null | undefined {
    let base: string;
    if (specifier.startsWith('@/')) base = specifier.slice(2);
    else if (specifier.startsWith('.'))
        base = posix.normalize(posix.join(posix.dirname(fromRel), specifier));
    else return undefined;
    base = base.replace(/\.js$/, '');
    for (const suffix of RESOLVE_SUFFIXES)
        if (fileSet.has(base + suffix)) return base + suffix;
    return null;
}

const allTypeSpecifiers = (
    elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>
): boolean => elements.length > 0 && elements.every(e => e.isTypeOnly);

function extractImports(
    rel: string,
    text: string
): { specifier: string; typeOnly: boolean; dynamic: boolean }[] {
    const sourceFile = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest);
    const found: { specifier: string; typeOnly: boolean; dynamic: boolean }[] =
        [];
    const visit = (node: ts.Node): void => {
        if (
            ts.isImportDeclaration(node) &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            const clause = node.importClause;
            const named =
                clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
                    ? clause.namedBindings
                    : undefined;
            found.push({
                specifier: node.moduleSpecifier.text,
                typeOnly:
                    Boolean(clause?.isTypeOnly) ||
                    (!clause?.name &&
                        named !== undefined &&
                        allTypeSpecifiers(named.elements)),
                dynamic: false,
            });
        } else if (
            ts.isExportDeclaration(node) &&
            node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            const named =
                node.exportClause && ts.isNamedExports(node.exportClause)
                    ? node.exportClause
                    : undefined;
            found.push({
                specifier: node.moduleSpecifier.text,
                typeOnly:
                    node.isTypeOnly ||
                    (named !== undefined && allTypeSpecifiers(named.elements)),
                dynamic: false,
            });
        } else if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments[0] &&
            ts.isStringLiteral(node.arguments[0])
        ) {
            found.push({
                specifier: node.arguments[0].text,
                typeOnly: false,
                dynamic: true,
            });
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
}

function buildImportGraph(): {
    files: string[];
    edges: ImportEdge[];
    unresolved: string[];
} {
    const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
        .map(rel => rel.split(sep).join('/'))
        .filter(isProductionSource)
        .sort();
    const fileSet = new Set(files);
    const edges: ImportEdge[] = [];
    const unresolved: string[] = [];
    for (const rel of files) {
        const text = readFileSync(resolve(SRC, rel), 'utf8');
        for (const { specifier, typeOnly, dynamic } of extractImports(
            rel,
            text
        )) {
            const to = resolveSpecifier(specifier, rel, fileSet);
            if (to === undefined) continue;
            if (to === null) unresolved.push(`${rel} -> ${specifier}`);
            else if (to !== rel)
                edges.push({ from: rel, to, typeOnly, dynamic });
        }
    }
    return { files, edges, unresolved };
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
        adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
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

const runtimeStatic = (edge: ImportEdge): boolean =>
    !edge.typeOnly && !edge.dynamic;

describe('import cycles', () => {
    const graph = buildImportGraph();

    it('resolves every internal import to a file', () => {
        // A broken resolver drops edges, the cycles vanish with them, and the
        // next test passes for the wrong reason. Pin resolution first.
        expect(graph.unresolved).toEqual([]);
        expect(graph.edges.length).toBeGreaterThan(graph.files.length);
    });

    it('has no runtime import cycle between files', () => {
        expect(cycleEdges(graph.edges.filter(runtimeStatic))).toEqual([]);
    });
});

describe('cycle detector', () => {
    const edge = (
        from: string,
        to: string,
        extra: Partial<ImportEdge> = {}
    ): ImportEdge => ({ from, to, typeOnly: false, dynamic: false, ...extra });

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

    it('ignores cycles closed only by type-only or dynamic edges', () => {
        const edges = [
            edge('a.ts', 'b.ts'),
            edge('b.ts', 'a.ts', { typeOnly: true }),
            edge('c.ts', 'd.ts'),
            edge('d.ts', 'c.ts', { dynamic: true }),
        ];
        expect(cycleEdges(edges.filter(runtimeStatic))).toEqual([]);
        expect(cycleEdges(edges)).toHaveLength(4);
    });

    it('classifies type-only imports from the source text', () => {
        const kinds = extractImports(
            'x.ts',
            [
                "import type { A } from './a';",
                "import { type B } from './b';",
                "import { type C, d } from './c';",
                "export type { E } from './e';",
                "export * from './f';",
                "const g = () => import('./g');",
                "// import { h } from './h';",
            ].join('\n')
        ).map(({ specifier, typeOnly, dynamic }) =>
            [specifier, typeOnly, dynamic].join(':')
        );
        expect(kinds).toEqual([
            './a:true:false',
            './b:true:false',
            './c:false:false',
            './e:true:false',
            './f:false:false',
            './g:false:true',
        ]);
    });
});
