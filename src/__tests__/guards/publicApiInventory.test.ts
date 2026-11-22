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

type EntryScope = 'server-only' | 'both';

interface ScopedRows {
    readonly label: string;
    readonly scope: EntryScope;
    readonly identifiers: readonly string[];
}

/** Phrases that put every row of a block on `src/index.ts` only. */
const SERVER_ONLY_SCOPE =
    /서버 entry 전용|서버 전용|\(서버\) 전용|`src\/index\.ts`에만 export/;
/** Phrases that put every row of a block on both entry points. */
const BOTH_ENTRIES_SCOPE =
    /양 entrypoint|양쪽 노출|양 진입점|`index\.client\.ts`에도 노출/;
/**
 * A row whose description ends with the both-entries sentence right before its
 * Source cell (`… 양 entrypoint. | \`file.ts\` |`) overrides the section
 * scope for that row alone.
 */
const ROW_BOTH_ENTRIES = /양 entrypoint\.?\s*\|[^|]*\|\s*$/;
/** Any wording that talks about entry points — if it is not one of the forms above, the guard must not skip it. */
const SCOPE_VOCABULARY =
    /entry ?points?|서버 entry|양 entry|entry (전용|only)|진입점|index\.client|서버 전용/i;

/**
 * Every backticked identifier in the row's first cell: the text before the
 * ` — ` description, or before the trailing Source column when there is no
 * description. `` `Foo`·`Bar(x)` / `Baz`(3) `` yields Foo, Bar and Baz;
 * identifiers inside the description prose are not collected.
 */
function firstCellIdentifiers(row: string): string[] {
    const body = row.slice('| '.length);
    const dash = body.indexOf(' — ');
    const end = dash >= 0 ? dash : body.lastIndexOf(' | ');
    const head = end >= 0 ? body.slice(0, end) : body;
    return [...head.matchAll(/`([A-Za-z_$][\w$]*)/g)].map(match => match[1]);
}

/** The scope one sentence states, `null` when it states none; throws on a self-contradiction. */
function sentenceScope(text: string): EntryScope | null {
    const server = SERVER_ONLY_SCOPE.test(text);
    const both = BOTH_ENTRIES_SCOPE.test(text);
    if (server && both) {
        throw new Error(`sentence claims both server-only and both — ${text}`);
    }
    if (server) return 'server-only';
    return both ? 'both' : null;
}

/**
 * Splits the inventory into scope blocks. A block opens at a bold label line
 * (`**…**`) or a `### ` heading and runs to the next one. Its scope sentence is
 * the label line and/or the first prose line after it (before the table); the
 * two must not conflict. Blocks without table rows are ignored, and a block
 * with rows whose label or prose talks about entry points in a form this guard
 * does not recognise throws — a silent skip would let a new wording defeat the
 * check.
 */
function collectScopedRows(inventory: string): ScopedRows[] {
    const blocks: { label: string; prose: string | null; rows: string[] }[] =
        [];
    for (const line of inventory.split('\n')) {
        if (line.startsWith('**') || line.startsWith('### ')) {
            blocks.push({ label: line, prose: null, rows: [] });
            continue;
        }
        const block = blocks.at(-1);
        if (!block) continue;
        if (line.startsWith('| `')) {
            block.rows.push(line);
        } else if (
            line.trim() !== '' &&
            !line.startsWith('|') &&
            block.rows.length === 0 &&
            block.prose === null
        ) {
            block.prose = line;
        }
    }
    const scoped: ScopedRows[] = [];
    for (const { label, prose, rows } of blocks) {
        if (rows.length === 0) continue;
        const labelScope = sentenceScope(label);
        const proseScope = prose === null ? null : sentenceScope(prose);
        if (labelScope && proseScope && labelScope !== proseScope) {
            throw new Error(
                `label says ${labelScope} but its prose says ${proseScope} — ${label}`
            );
        }
        const scope = labelScope ?? proseScope;
        if (!scope) {
            if (
                SCOPE_VOCABULARY.test(label) ||
                SCOPE_VOCABULARY.test(prose ?? '')
            ) {
                throw new Error(
                    `unrecognised entry-scope sentence — ${label} / ${prose ?? ''}`
                );
            }
            continue;
        }
        scoped.push({
            label,
            scope,
            identifiers: rows
                .filter(row => !ROW_BOTH_ENTRIES.test(row))
                .flatMap(firstCellIdentifiers),
        });
        const overridden = rows.filter(row => ROW_BOTH_ENTRIES.test(row));
        if (overridden.length > 0) {
            scoped.push({
                label: `${label} (row override: 양 entrypoint)`,
                scope: 'both',
                identifiers: overridden.flatMap(firstCellIdentifiers),
            });
        }
    }
    return scoped;
}

/** `name (label)` for each row identifier whose real export contradicts its block's scope sentence. */
function scopeViolations(
    blocks: readonly ScopedRows[],
    serverExports: ReadonlySet<string>,
    clientExports: ReadonlySet<string>
): string[] {
    return blocks.flatMap(({ label, scope, identifiers }) =>
        identifiers
            .filter(name =>
                scope === 'server-only'
                    ? clientExports.has(name)
                    : !clientExports.has(name) || !serverExports.has(name)
            )
            .map(
                name =>
                    `${name} is ${scope === 'server-only' ? 'exported from index.client.ts' : 'missing from an entry point'} but the section says ${scope}: ${label.slice(0, 80)}`
            )
    );
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

    it('keeps each inventory section scope sentence consistent with index.client.ts', () => {
        const blocks = collectScopedRows(inventory);
        expect(blocks.length).toBeGreaterThan(10);
        expect(blocks.some(b => b.scope === 'server-only')).toBe(true);
        expect(blocks.some(b => b.scope === 'both')).toBe(true);
        expect(scopeViolations(blocks, serverExports, clientExports)).toEqual(
            []
        );
    });

    it('names a symbol documented as server-only that the client entry exports', () => {
        const fixture = [
            '**테스트 — 서버 entry 전용 (1)**',
            '| Symbol | Source |',
            '|---|---|',
            '| `calculateMA(bars, period)` — x | `domain/indicators/ma.ts` |',
        ].join('\n');
        const violations = scopeViolations(
            collectScopedRows(fixture),
            serverExports,
            clientExports
        );
        expect(violations).toHaveLength(1);
        expect(violations[0]).toContain('calculateMA');
    });

    it('names a symbol documented as on both entry points that the client entry lacks', () => {
        const fixture = [
            '**테스트 — 양 entrypoint (1)**',
            '| Symbol | Source |',
            '|---|---|',
            '| `findMaCrosses(bars)` — x | `domain/indicators/maCrosses.ts` |',
        ].join('\n');
        const violations = scopeViolations(
            collectScopedRows(fixture),
            serverExports,
            clientExports
        );
        expect(violations).toHaveLength(1);
        expect(violations[0]).toContain('findMaCrosses');
    });

    it('fails loudly on an unrecognised entry-scope sentence', () => {
        const fixture = [
            '**테스트 — 브라우저에서도 쓴다 (entrypoint 둘 다)**',
            '| Symbol | Source |',
            '| `calculateMA` — x | `a.ts` |',
        ].join('\n');
        expect(() => collectScopedRows(fixture)).toThrow(
            /unrecognised entry-scope sentence/
        );
    });

    it('classifies the Tier 1 heading from its prose sentence', () => {
        const tier1 = collectScopedRows(inventory).find(block =>
            block.label.startsWith('### Tier 1')
        );
        expect(tier1?.scope).toBe('server-only');
        expect(tier1?.identifiers).toContain('runAnalysis');
    });

    it('checks every identifier of a multi-symbol first cell', () => {
        const fixture = [
            '**테스트 — 서버 entry 전용 (2)**',
            '| Symbol | Source |',
            '|---|---|',
            '| `findMaCrosses`·`calculateMA` — x | `a.ts` |',
            '| `findMaCrosses` / `rsiZone`(3), `calculateMA` | `a.ts` |',
        ].join('\n');
        const violations = scopeViolations(
            collectScopedRows(fixture),
            serverExports,
            clientExports
        );
        expect(violations.map(v => v.split(' ')[0])).toEqual([
            'calculateMA',
            'rsiZone',
            'calculateMA',
        ]);
    });

    it('does not collect identifiers from the description prose', () => {
        const fixture = [
            '**테스트 — 서버 entry 전용 (1)**',
            '| Symbol | Source |',
            '|---|---|',
            '| `findMaCrosses` — `calculateMA`와 같은 입력 | `a.ts` |',
        ].join('\n');
        expect(collectScopedRows(fixture)[0].identifiers).toEqual([
            'findMaCrosses',
        ]);
    });

    it('reads the scope from the first prose line and rejects a conflicting label', () => {
        const prose = [
            '### 테스트',
            '',
            '이 함수는 모두 서버 전용이다.',
            '| `calculateMA` — x | `a.ts` |',
        ].join('\n');
        expect(collectScopedRows(prose)[0].scope).toBe('server-only');
        const conflict = [
            '**테스트 — 양 entrypoint (1)**',
            '이 함수는 모두 서버 전용이다.',
            '| `calculateMA` — x | `a.ts` |',
        ].join('\n');
        expect(() => collectScopedRows(conflict)).toThrow(/prose says/);
    });

    it('treats entry-point vocabulary case-insensitively', () => {
        const fixture = [
            '### Tier 9 — Some Entry Points',
            '| `calculateMA` — x | `a.ts` |',
        ].join('\n');
        expect(() => collectScopedRows(fixture)).toThrow(
            /unrecognised entry-scope sentence/
        );
    });

    it('does not read a trading "entry" heading as an entry-scope sentence', () => {
        const fixture = [
            '**Entry/Exit signals (1)**',
            'data entry 시점의 구간을 돌려준다.',
            '| `calculateMA` — x | `a.ts` |',
        ].join('\n');
        expect(() => collectScopedRows(fixture)).not.toThrow();
    });
});
