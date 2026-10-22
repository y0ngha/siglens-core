import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Guards that `docs/PUBLIC_API.md` and the two entry points agree:
 *
 * (a) every name exported from `src/index.ts` or `src/index.client.ts` is
 *     mentioned in the doc as a backticked identifier, and
 * (b) every identifier that leads the first cell of an inventory table row is
 *     actually exported from one of the entry points.
 *
 * Fix a failure by updating the inventory (or the exports), not by
 * allow-listing — see `PUBLIC_API.md#API-6`.
 */

const REPO_ROOT = resolve(__dirname, '../../..');
const ENTRY_POINTS = ['src/index.ts', 'src/index.client.ts'] as const;
const INVENTORY_HEADING = '## 현재 노출 인벤토리';

function readRepoFile(path: string): string {
    return readFileSync(resolve(REPO_ROOT, path), 'utf8');
}

function hasExportModifier(node: ts.Node): boolean {
    return (
        ts.canHaveModifiers(node) &&
        (ts.getModifiers(node) ?? []).some(
            modifier => modifier.kind === ts.SyntaxKind.ExportKeyword
        )
    );
}

/** Names introduced by one exported declaration statement. */
function declaredNames(statement: ts.Statement): string[] {
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
    return [];
}

/**
 * Public names of one entry file. Handles multi-line `export { … } from`,
 * `export type { … }`, per-specifier `type` modifiers and `as` aliases (the
 * public name is the alias). Throws on `export *` / `export default` /
 * `export =`, which this guard cannot enumerate.
 */
function collectExportedNames(path: string): Set<string> {
    const source = ts.createSourceFile(
        path,
        readRepoFile(path),
        ts.ScriptTarget.Latest,
        true
    );
    const names = new Set<string>();
    for (const statement of source.statements) {
        if (ts.isExportDeclaration(statement)) {
            if (!statement.exportClause) {
                throw new Error(
                    `${path}: \`export *\` is not supported by this guard`
                );
            }
            if (ts.isNamespaceExport(statement.exportClause)) {
                names.add(statement.exportClause.name.text);
                continue;
            }
            for (const element of statement.exportClause.elements) {
                names.add(element.name.text);
            }
        } else if (ts.isExportAssignment(statement)) {
            throw new Error(
                `${path}: \`export default\` / \`export =\` is not supported`
            );
        } else if (hasExportModifier(statement)) {
            for (const name of declaredNames(statement)) names.add(name);
        }
    }
    return names;
}

function collectEntryExports(): Map<string, Set<string>> {
    return new Map(
        ENTRY_POINTS.map(path => [path, collectExportedNames(path)])
    );
}

/** `` `Name` `` or `` `Name( `` — an identifier prefix of a backticked span. */
const IDENTIFIER_MENTION = /`([A-Za-z_$][\w$]*)(?:`|\()/g;

function collectMentionedIdentifiers(doc: string): Set<string> {
    return new Set(
        [...doc.matchAll(IDENTIFIER_MENTION)].map(match => match[1])
    );
}

/**
 * Identifiers leading the first cell of an inventory table row:
 * `` | `a` / `b(x)` — description | … `` yields `a` and `b`. Prose after the
 * leading span chain is ignored, and `(참고)` note rows are skipped because
 * they do not start with a backtick.
 */
function leadingRowIdentifiers(row: string): string[] {
    const identifiers: string[] = [];
    let rest = row.slice('| '.length);
    for (;;) {
        const match = /^`([^`]+)`/.exec(rest);
        if (!match) break;
        const identifier = /^[A-Za-z_$][\w$]*/.exec(match[1]);
        if (identifier) identifiers.push(identifier[0]);
        rest = rest.slice(match[0].length);
        const separator = /^\s*\/\s*/.exec(rest);
        if (!separator) break;
        rest = rest.slice(separator[0].length);
    }
    return identifiers;
}

/** The inventory slice: from its heading up to (not including) the Internal subsection. */
function inventorySection(doc: string): string {
    const start = doc.indexOf(INVENTORY_HEADING);
    if (start === -1) throw new Error(`"${INVENTORY_HEADING}" not found`);
    const end = doc.indexOf('\n### Internal', start);
    if (end === -1)
        throw new Error('"### Internal" after the inventory not found');
    return doc.slice(start, end);
}

const TYPE_INDEX_HEADING = '**그 밖의 export 타입 색인**';
const SERVER_ONLY_LABEL = '(서버 entry 전용)';
const BOTH_ENTRIES_LABEL = '(양 entrypoint)';

interface TypeIndexEntry {
    readonly line: string;
    readonly names: readonly string[];
    readonly serverOnly: boolean;
}

/**
 * Bullets of the Tier 4 type index: `` - `file.ts` (label): `A`, `B`. `` The
 * names after the first `: ` are the indexed exports; the label says which
 * entry points expose them.
 */
function collectTypeIndexEntries(inventory: string): TypeIndexEntry[] {
    const start = inventory.indexOf(TYPE_INDEX_HEADING);
    if (start === -1) throw new Error(`${TYPE_INDEX_HEADING} not found`);
    return inventory
        .slice(start)
        .split('\n')
        .filter(line => line.startsWith('- `'))
        .map(line => {
            const colon = line.indexOf(': ');
            if (colon === -1)
                throw new Error(`index bullet without ": " — ${line}`);
            const serverOnly = line.slice(0, colon).includes(SERVER_ONLY_LABEL);
            if (
                !serverOnly &&
                !line.slice(0, colon).includes(BOTH_ENTRIES_LABEL)
            ) {
                throw new Error(
                    `index bullet without an entry label — ${line}`
                );
            }
            const names = [
                ...line.slice(colon).matchAll(/`([A-Za-z_$][\w$]*)`/g),
            ].map(match => match[1]);
            return { line, names, serverOnly };
        });
}

function collectInventoryRowIdentifiers(inventory: string): string[] {
    return inventory
        .split('\n')
        .filter(line => line.startsWith('| `'))
        .flatMap(leadingRowIdentifiers);
}

describe('docs/PUBLIC_API.md inventory', () => {
    const doc = readRepoFile('docs/PUBLIC_API.md');
    const entryExports = collectEntryExports();
    const allExports = new Set([...entryExports.values()].flatMap(s => [...s]));
    const inventory = inventorySection(doc);
    const serverExports = entryExports.get('src/index.ts') ?? new Set<string>();
    const clientExports =
        entryExports.get('src/index.client.ts') ?? new Set<string>();

    it('parses both entry points and finds exports', () => {
        for (const [path, names] of entryExports) {
            expect(names.size, path).toBeGreaterThan(100);
        }
    });

    it('mentions every exported name as a backticked identifier in the inventory', () => {
        const mentioned = collectMentionedIdentifiers(inventory);
        const undocumented = [...entryExports].flatMap(([path, names]) =>
            [...names]
                .filter(name => !mentioned.has(name))
                .map(name => `${name} (${path})`)
        );
        expect(undocumented).toEqual([]);
    });

    it('lists only exported names in inventory table rows', () => {
        const rowIdentifiers = collectInventoryRowIdentifiers(inventory);
        expect(rowIdentifiers.length).toBeGreaterThan(30);
        const unknown = [
            ...new Set(rowIdentifiers.filter(name => !allExports.has(name))),
        ];
        expect(unknown).toEqual([]);
    });

    it('lists only exported names, with the right entry label, in the Tier 4 type index', () => {
        const entries = collectTypeIndexEntries(inventory);
        expect(entries.length).toBeGreaterThan(10);
        const mismatched = entries.flatMap(({ names, serverOnly }) =>
            names
                .filter(name =>
                    serverOnly
                        ? !serverExports.has(name) || clientExports.has(name)
                        : !serverExports.has(name) || !clientExports.has(name)
                )
                .map(name => `${name} (${serverOnly ? 'server only' : 'both'})`)
        );
        expect(mismatched).toEqual([]);
    });
});
