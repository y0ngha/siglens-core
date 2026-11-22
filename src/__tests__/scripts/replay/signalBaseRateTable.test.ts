import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { ModuleKind, transpileModule } from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { writeSet } from '../../../../scripts/replay/buildSet';
import {
    FailClosedError,
    KNOWN_SET_FINGERPRINTS,
    SIGNAL_TABLE_PATH,
    generateSignalTable,
    parseSignalTableArgs,
    renderSignalTable,
    runSignalBaseRateTable,
    type SignalTableArgs,
    type SignalTableDeps,
} from '../../../../scripts/replay/signalBaseRateTable';
import {
    SIGNAL_TYPES,
    signalTable,
    type SignalEpisode,
} from '../../../../scripts/replay/signalBaseRateCompute';
import { barsFingerprint } from '../../../../scripts/replay/setIntegrity';
import { REPLAY_SET_ID } from '../../../../scripts/replay/types';
import { makeTempDir, tradingBars, writeBarsDir } from './replayFixtures';

const temps = new Set<() => void>();
afterEach(() => {
    [...temps].forEach(remove => remove());
    temps.clear();
});

const SHA = 'a'.repeat(40);
const logs: string[] = [];
const quietDeps = (
    overrides: Partial<SignalTableDeps> = {}
): SignalTableDeps => ({
    gitSha: () => SHA,
    dirtyDiffSha256: () => null,
    knownFingerprints: KNOWN_SET_FINGERPRINTS,
    log: line => {
        logs.push(line);
    },
    ...overrides,
});

describe('parseSignalTableArgs', () => {
    it('requires --set, --out and --date and a YYYY-MM-DD date', () => {
        expect(() => parseSignalTableArgs([])).toThrow(
            'missing --set, --out, --date'
        );
        expect(() =>
            parseSignalTableArgs([
                '--set',
                '/s',
                '--out',
                '/o',
                '--date',
                '23-11-2026',
            ])
        ).toThrow('--date must be YYYY-MM-DD');
    });

    it('resolves the paths and reads the flags', () => {
        expect(
            parseSignalTableArgs([
                '--set',
                '/s',
                '--out',
                '/o/table.ts',
                '--json',
                '/o/t.json',
                '--date',
                '2026-11-23',
                '--allow-dirty',
            ])
        ).toEqual({
            set: '/s',
            out: '/o/table.ts',
            json: '/o/t.json',
            date: '2026-11-23',
            allowDirty: true,
        });
        expect(
            parseSignalTableArgs([
                '--set',
                '/s',
                '--out',
                '/o',
                '--date',
                '2026-11-23',
            ])
        ).toMatchObject({ json: null, allowDirty: false });
    });
});

// ─── The rendered file ────────────────────────────────────────────────────────

const WEEKS = Array.from(
    { length: 52 },
    (_, i) => `2021-W${String(i + 1).padStart(2, '0')}`
);

const episodesFor = (
    type: SignalEpisode['type'],
    count: number
): SignalEpisode[] =>
    Array.from({ length: count }, (_, i) => ({
        symbol: 'AAA',
        market: i % 2 === 0 ? 'us' : 'kr',
        type,
        direction: 'bullish',
        index: 300 + i,
        date: '2021-06-15',
        week: WEEKS[i % WEEKS.length],
        half: Math.floor(i / 2) % 2 === 0 ? 'early' : 'late',
        outcomes: [1, 5, 10, 20].map(() => ({
            hit: Math.floor(i / 4) % 2 === 0 ? 0 : 1,
            placeboShare: 0.5,
        })),
    }));

const fixtureTable = (): ReturnType<typeof signalTable> =>
    signalTable(
        SIGNAL_TYPES.flatMap(type =>
            episodesFor(type, type === 'gap_down' ? 12 : 150)
        ),
        WEEKS,
        [
            { market: 'us', symbols: 2 },
            { market: 'kr', symbols: 1 },
        ]
    );

const render = (): string =>
    renderSignalTable({
        header: {
            setId: REPLAY_SET_ID,
            fingerprint: 'f'.repeat(64),
            coreSha: SHA,
            definitions: 'defs',
            date: '2026-11-23',
            command: 'cmd',
        },
        rows: fixtureTable().rows,
    });

interface Exported {
    MEASURED_SIGNAL_BASE_RATES: Record<
        string,
        { horizons: { h: number; n: number; eventShare: number | null }[] }
    >;
    measuredSignalBaseRateFor: (
        type: string,
        timeframe: string
    ) => { signalType: string } | null;
}

const evaluate = (source: string): Exported => {
    const { outputText } = transpileModule(source, {
        compilerOptions: { module: ModuleKind.CommonJS },
    });
    const exported: Record<string, unknown> = {};
    new Function('exports', outputText)(exported);
    // The module under test exports exactly these two names (asserted below).
    return exported as unknown as Exported;
};

describe('renderSignalTable', () => {
    it('writes a formatted module that holds every type with all four horizons', async () => {
        const source = render();
        const config = (await resolveConfig(SIGNAL_TABLE_PATH)) ?? {};
        const formatted = await format(source, {
            ...config,
            parser: 'typescript',
        });
        const exported = evaluate(formatted);
        expect(
            Object.keys(exported.MEASURED_SIGNAL_BASE_RATES).toSorted()
        ).toEqual([...SIGNAL_TYPES]);
        expect(
            Object.values(exported.MEASURED_SIGNAL_BASE_RATES).every(
                e => JSON.stringify(e.horizons.map(h => h.h)) === '[1,5,10,20]'
            )
        ).toBe(true);
        expect(formatted).toContain(`Core: ${SHA} (clean checkout)`);
        expect(formatted).toContain('Generated: 2026-11-23');
        // Below the floor nothing is stated: the share is null, not a small number.
        expect(
            exported.MEASURED_SIGNAL_BASE_RATES.gap_down.horizons.map(h => [
                h.n,
                h.eventShare,
            ])
        ).toEqual([
            [12, null],
            [12, null],
            [12, null],
            [12, null],
        ]);
        expect(
            exported.MEASURED_SIGNAL_BASE_RATES.gap_up.horizons[0].eventShare
        ).toBeCloseTo(74 / 150, 6);
    });

    it('marks a dirty checkout in the header', () => {
        const source = renderSignalTable({
            header: {
                setId: REPLAY_SET_ID,
                fingerprint: 'f',
                coreSha: `${SHA}+dirty`,
                definitions: 'd',
                date: '2026-11-23',
                command: 'c',
            },
            rows: fixtureTable().rows,
        });
        expect(source).toContain('DIRTY checkout: do not commit');
    });

    it('writes a lookup that returns the entry, or null off daily bars and for an unknown type', () => {
        const exported = evaluate(render());
        expect(
            exported.measuredSignalBaseRateFor('golden_cross', '1Day')
        ).toMatchObject({ signalType: 'golden_cross' });
        expect(
            exported.measuredSignalBaseRateFor('golden_cross', '1Hour')
        ).toBeNull();
        expect(
            exported.measuredSignalBaseRateFor('unknown_type', '1Day')
        ).toBeNull();
        expect(
            exported.measuredSignalBaseRateFor('rsi_bullish_divergence', '1Day')
        ).toBeNull();
    });

    it('stores no return figure and no machine path', () => {
        const source = render();
        expect(source).not.toMatch(/\b(return|pct|percent|meanReturn)\w*\s*:/i);
        expect(source).not.toContain('/Users/');
    });
});

// ─── The generator ────────────────────────────────────────────────────────────

function syntheticSet(): { dir: string; setDir: string; fingerprint: string } {
    const { dir, remove } = makeTempDir();
    temps.add(remove);
    const srcDir = join(dir, 'src');
    writeBarsDir(
        srcDir,
        ['NVDA', '005930.KS'].map(symbol => ({
            symbol,
            bars: tradingBars({
                symbol,
                startIso: '2020-01-02',
                count: 420,
                close: i => 100 + 0.2 * i + 6 * Math.sin(i / 7),
            }),
        }))
    );
    const setDir = join(dir, 'set');
    const manifest = writeSet(srcDir, setDir, {
        createdAt: 'x',
        allowPartial: true,
        force: false,
    });
    return { dir, setDir, fingerprint: barsFingerprint(manifest) };
}

const argsFor = (
    world: { dir: string; setDir: string },
    overrides: Partial<SignalTableArgs> = {}
): SignalTableArgs => ({
    set: world.setDir,
    out: join(world.dir, 'out', 'table.ts'),
    json: join(world.dir, 'out', 'table.json'),
    date: '2026-11-23',
    allowDirty: false,
    ...overrides,
});

describe('generateSignalTable and runSignalBaseRateTable', () => {
    it('exits 2 on a dirty checkout and writes nothing', async () => {
        const world = syntheticSet();
        const args = argsFor(world);
        const code = await runSignalBaseRateTable(
            args,
            quietDeps({
                gitSha: () => `${SHA}+dirty`,
                knownFingerprints: [world.fingerprint],
            })
        );
        expect(code).toBe(2);
        expect(existsSync(args.out)).toBe(false);
        expect(logs.at(-1)).toContain('the checkout is dirty');
    });

    it('exits 2 on a dirty diff even when the sha looks clean', async () => {
        const world = syntheticSet();
        await expect(
            generateSignalTable(
                argsFor(world),
                quietDeps({
                    dirtyDiffSha256: () => 'abc',
                    knownFingerprints: [world.fingerprint],
                })
            )
        ).rejects.toThrow(FailClosedError);
    });

    it('exits 2 on a set whose bars fingerprint it does not know', async () => {
        const world = syntheticSet();
        const args = argsFor(world);
        expect(await runSignalBaseRateTable(args, quietDeps())).toBe(2);
        expect(existsSync(args.out)).toBe(false);
        expect(logs.at(-1)).toContain('unknown set fingerprint');
    });

    it('exits 2 when a signal type has no episode on the set', async () => {
        const world = syntheticSet();
        const args = argsFor(world, { allowDirty: true });
        const code = await runSignalBaseRateTable(
            args,
            quietDeps({ knownFingerprints: [world.fingerprint] })
        );
        expect(code).toBe(2);
        expect(existsSync(args.out)).toBe(false);
        expect(logs.at(-1)).toMatch(/no episode at all for .*not measurable/);
    });

    it('refuses to write inside the repository, and a dirty table at the committed path', async () => {
        const world = syntheticSet();
        await expect(
            runSignalBaseRateTable(
                argsFor(world, { out: join(process.cwd(), 'x.ts') }),
                quietDeps()
            )
        ).rejects.toThrow('is inside the repository');
        await expect(
            runSignalBaseRateTable(
                argsFor(world, { out: SIGNAL_TABLE_PATH, allowDirty: true }),
                quietDeps()
            )
        ).rejects.toThrow('--allow-dirty cannot write the committed table');
        await expect(
            runSignalBaseRateTable(
                argsFor(world, { json: join(process.cwd(), 'j.json') }),
                quietDeps()
            )
        ).rejects.toThrow('is inside the repository');
    });
});

// ─── Reproduction gate ────────────────────────────────────────────────────────

/**
 * The reproduction gate (TE-16): regenerates the table from the frozen replay set and
 * compares it with the committed file, everything below the header (the header carries the
 * commit the table was made on). The set lives outside the repository, so this runs only
 * when `SIGNAL_BASE_RATE_SET` names it:
 *
 *   SIGNAL_BASE_RATE_SET=<replay-v1 set dir> yarn test src/__tests__/scripts/replay/signalBaseRateTable.test.ts
 *
 * To regenerate the committed file (oracle: the pre-registered definitions in
 * `signalBaseRateCompute.ts`, run on a clean checkout):
 *
 *   npx tsx scripts/replay/signalBaseRateTable.ts --set <set dir> --date <YYYY-MM-DD> \
 *       --out src/domain/signals/measuredSignalBaseRates.ts
 */
const SET_DIR = process.env.SIGNAL_BASE_RATE_SET;

describe.skipIf(SET_DIR === undefined || SET_DIR === '')(
    'reproduction from the replay set',
    () => {
        const body = (source: string): string =>
            source.slice(source.indexOf('import type { BaseRateVerdict }'));

        it('regenerates the committed table, below its header, byte for byte', async () => {
            const generated = await generateSignalTable(
                {
                    set: SET_DIR ?? '',
                    out: '',
                    json: null,
                    date: '2000-01-01',
                    allowDirty: true,
                },
                { ...quietDeps(), log: () => undefined }
            );
            expect(body(generated.source)).toBe(
                body(readFileSync(SIGNAL_TABLE_PATH, 'utf-8'))
            );
        }, 3_600_000);
    }
);
