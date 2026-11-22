import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as serverApi from '@/index';
import * as clientApi from '@/index.client';

/**
 * Guards `PUBLIC_API.md#API-1`: every VALUE export of an entrypoint is
 * referenced by the paired entrypoint test, so a re-export that silently
 * becomes `undefined` (or a new export nobody asserted) fails here.
 *
 * Value exports come from the runtime module namespace, which already resolves
 * `export { … } from` / `export *` and drops type-only exports. References are
 * read structurally from the test's AST (see `collectReferences`), so names in
 * comments or unrelated strings do not count. Functions must sit in the
 * callable list (`FUNCTION_EXPORTS`), not the defined-value list.
 *
 * Intentional exceptions go in `EXEMPTIONS` with a reason per entry.
 */

const REPO_ROOT = resolve(__dirname, '../../..');

interface EntrypointPair {
    readonly entry: string;
    readonly testPath: string;
    readonly valueExports: readonly string[];
    readonly runtime: Readonly<Record<string, unknown>>;
}

const PAIRS: readonly EntrypointPair[] = [
    {
        entry: 'src/index.ts',
        testPath: 'src/__tests__/index.test.ts',
        valueExports: Object.keys(serverApi),
        runtime: serverApi,
    },
    {
        entry: 'src/index.client.ts',
        testPath: 'src/__tests__/index.client.test.ts',
        valueExports: Object.keys(clientApi),
        runtime: clientApi,
    },
];

/** entry → exported name → reason it needs no assertion in the paired test. */
const EXEMPTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> =
    {};

interface TestReferences {
    /** String elements of the `FUNCTION_EXPORTS` array literal. */
    readonly callable: ReadonlySet<string>;
    /** String elements of the `VALUE_EXPORTS` array literal. */
    readonly defined: ReadonlySet<string>;
    /** Namespace property accesses and named imports from the entrypoint. */
    readonly used: ReadonlySet<string>;
}

/**
 * What a paired test legitimately references. Only these count — a name in an
 * unrelated string (a fixture value) or a comment does not:
 * (a) string elements of the `FUNCTION_EXPORTS` / `VALUE_EXPORTS` array
 *     literals that feed the existence `it.each`,
 * (b) `<namespace>.name` where the namespace is `import * as x from <entry>`,
 * (c) named imports from the entry module.
 */
function collectReferences(path: string, entry: string): TestReferences {
    const source = ts.createSourceFile(
        path,
        readFileSync(resolve(REPO_ROOT, path), 'utf8'),
        ts.ScriptTarget.Latest,
        true
    );
    const specifier = entry.replace(/^src\//, '@/').replace(/\.ts$/, '');
    const namespaces = new Set<string>();
    const callable = new Set<string>();
    const defined = new Set<string>();
    const used = new Set<string>();
    const listFor = (name: string): Set<string> | undefined =>
        name === 'FUNCTION_EXPORTS'
            ? callable
            : name === 'VALUE_EXPORTS'
              ? defined
              : undefined;

    for (const statement of source.statements) {
        if (
            !ts.isImportDeclaration(statement) ||
            !ts.isStringLiteral(statement.moduleSpecifier) ||
            statement.moduleSpecifier.text !== specifier ||
            !statement.importClause
        ) {
            continue;
        }
        const bindings = statement.importClause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
            namespaces.add(bindings.name.text);
        } else if (bindings) {
            for (const element of bindings.elements) {
                used.add((element.propertyName ?? element.name).text);
            }
        }
    }

    const visit = (node: ts.Node): void => {
        if (
            ts.isPropertyAccessExpression(node) &&
            ts.isIdentifier(node.expression) &&
            namespaces.has(node.expression.text)
        ) {
            used.add(node.name.text);
        }
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer &&
            ts.isArrayLiteralExpression(node.initializer)
        ) {
            const list = listFor(node.name.text);
            for (const element of node.initializer.elements) {
                if (list && ts.isStringLiteralLike(element)) {
                    list.add(element.text);
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return { callable, defined, used };
}

describe('entrypoint tests reference every value export', () => {
    for (const { entry, testPath, valueExports, runtime } of PAIRS) {
        describe(entry, () => {
            const refs = collectReferences(testPath, entry);
            const exempt = EXEMPTIONS[entry] ?? {};
            const isFunction = (name: string): boolean =>
                typeof runtime[name] === 'function';

            it('has value exports to check', () => {
                expect(valueExports.length).toBeGreaterThan(100);
            });

            it(`is referenced by ${testPath}`, () => {
                const missing = valueExports
                    .filter(
                        name =>
                            !refs.callable.has(name) &&
                            !refs.defined.has(name) &&
                            !refs.used.has(name) &&
                            !(name in exempt)
                    )
                    .map(
                        name =>
                            `${name} (exported by ${entry}, not referenced in ${testPath})`
                    );
                expect(missing).toEqual([]);
            });

            it('lists functions in the callable list and only functions there', () => {
                const wrongKind = [
                    ...[...refs.defined]
                        .filter(isFunction)
                        .map(
                            name =>
                                `${name} (a function in VALUE_EXPORTS of ${testPath}; move it to FUNCTION_EXPORTS)`
                        ),
                    ...[...refs.callable]
                        .filter(name => name in runtime && !isFunction(name))
                        .map(
                            name =>
                                `${name} (not a function but in FUNCTION_EXPORTS of ${testPath})`
                        ),
                ];
                expect(wrongKind).toEqual([]);
            });

            it('lists only names this entrypoint exports', () => {
                const unknown = [...refs.callable, ...refs.defined].filter(
                    name => !(name in runtime)
                );
                expect(unknown).toEqual([]);
            });

            it('keeps no stale exemption', () => {
                const stale = Object.keys(exempt).filter(
                    name =>
                        !valueExports.includes(name) ||
                        refs.callable.has(name) ||
                        refs.defined.has(name) ||
                        refs.used.has(name)
                );
                expect(stale).toEqual([]);
            });
        });
    }
});
