import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    KNOWN_BARS_FINGERPRINTS,
    barsFingerprintOf,
    generateBenchmarkFiles,
    parseBenchmarkArgs,
    perTradeCsv,
    runBacktestBenchmarks,
    tradesSha256,
    type BenchmarkArgs,
    type BenchmarkDeps,
} from '../../../../scripts/replay/backtestBenchmarks';
import { REPO_ROOT } from '../../../../scripts/replay/fsUtil';
import {
    T1,
    T2,
    T3,
    aaaClose,
    bbbClose,
    fixtureBars,
    fixtureInput,
} from './backtestBenchmarkFixtures';
import { makeTempDir } from './replayFixtures';

const temps = new Set<() => void>();
afterEach(() => {
    [...temps].forEach(remove => remove());
    temps.clear();
});

interface Workspace {
    args: BenchmarkArgs;
    deps: BenchmarkDeps;
    logs: string[];
}

/** A run directory with the two fixture tickers' bars and the page data, plus clean-checkout deps. */
function workspace(overrides: Partial<BenchmarkDeps> = {}): Workspace {
    const { dir, remove } = makeTempDir('backtest-bench-');
    temps.add(remove);
    const run = join(dir, 'run');
    mkdirSync(join(run, 'data', 'bars'), { recursive: true });
    const input = fixtureInput();
    writeFileSync(
        join(run, 'data', 'bars', 'AAA.json'),
        JSON.stringify({ bars: fixtureBars(aaaClose) })
    );
    writeFileSync(
        join(run, 'data', 'bars', 'BBB.json'),
        JSON.stringify({ bars: fixtureBars(bbbClose) })
    );
    const pageData = join(dir, 'data.json');
    writeFileSync(
        pageData,
        JSON.stringify({
            run: input.run,
            baselines: input.baselines,
            trades: input.trades,
        })
    );
    const logs: string[] = [];
    return {
        args: { run, pageData, out: join(dir, 'out'), allowDirty: false },
        deps: {
            gitSha: () => 'a'.repeat(40),
            dirtyDiffSha256: () => null,
            knownFingerprints: [barsFingerprintOf(run, ['AAA', 'BBB'])],
            log: line => {
                logs.push(line);
            },
            ...overrides,
        },
        logs,
    };
}

const read = (args: BenchmarkArgs, name: string): string =>
    readFileSync(join(args.out, name), 'utf-8');

describe('parseBenchmarkArgs', () => {
    it('requires --run, --page-data and --out', () => {
        expect(() => parseBenchmarkArgs([])).toThrow(
            'missing --run, --page-data, --out'
        );
    });

    it('resolves the paths and reads --allow-dirty', () => {
        expect(
            parseBenchmarkArgs([
                '--run',
                '/r',
                '--page-data',
                '/p.json',
                '--out',
                '/o',
                '--allow-dirty',
            ])
        ).toEqual({
            run: '/r',
            pageData: '/p.json',
            out: '/o',
            allowDirty: true,
        });
        expect(
            parseBenchmarkArgs([
                '--run',
                '/r',
                '--page-data',
                '/p.json',
                '--out',
                '/o',
            ]).allowDirty
        ).toBe(false);
    });
});

describe('runBacktestBenchmarks', () => {
    it('writes the four files and returns 0', () => {
        const { args, deps } = workspace();
        expect(runBacktestBenchmarks(args, deps)).toBe(0);
        const benchmarks = JSON.parse(read(args, 'benchmarks.json'));
        expect(benchmarks.version).toBe(1);
        expect(benchmarks.coreSha).toBe('a'.repeat(40));
        expect(benchmarks.barsFingerprint).toBe(deps.knownFingerprints[0]);
        expect(benchmarks.tradesSha256).toBe(tradesSha256([T1, T2, T3]));
        expect(JSON.parse(read(args, 'perTicker.json'))).toHaveLength(2);
        expect(JSON.parse(read(args, 'diagnostics.json')).bracket.n).toBe(2);
        expect(read(args, 'per-trade.csv').split('\n')[0]).toBe(
            'ticker,decision_date,entry_date,return_pct,same_length_drift_pct,excess_pct'
        );
    });

    it('is deterministic: two runs write byte-identical files', () => {
        const { args, deps } = workspace();
        runBacktestBenchmarks(args, deps);
        const first = [
            'benchmarks.json',
            'per-trade.csv',
            'perTicker.json',
            'diagnostics.json',
        ].map(n => read(args, n));
        runBacktestBenchmarks(args, deps);
        expect(
            [
                'benchmarks.json',
                'per-trade.csv',
                'perTicker.json',
                'diagnostics.json',
            ].map(n => read(args, n))
        ).toEqual(first);
    });

    it('writes one csv row per trade in the input order', () => {
        const { args, deps } = workspace();
        runBacktestBenchmarks(args, deps);
        const rows = read(args, 'per-trade.csv').trim().split('\n').slice(1);
        expect(rows.map(r => r.split(',').slice(0, 3))).toEqual([
            ['AAA', T1.decisionDate, T1.entryDate],
            ['BBB', T2.decisionDate, T2.entryDate],
            ['AAA', T3.decisionDate, T3.entryDate],
        ]);
        expect(rows[0].split(',')[3]).toBe('6.00');
    });

    it('refuses a dirty checkout with exit 2 and writes nothing', () => {
        const { args, deps, logs } = workspace({
            gitSha: () => `${'a'.repeat(40)}+dirty`,
        });
        expect(runBacktestBenchmarks(args, deps)).toBe(2);
        expect(logs.join('\n')).toContain('the checkout is dirty');
        expect(() => read(args, 'benchmarks.json')).toThrow();
    });

    it('refuses uncommitted changes the sha does not show', () => {
        const { args, deps } = workspace({ dirtyDiffSha256: () => 'deadbeef' });
        expect(runBacktestBenchmarks(args, deps)).toBe(2);
    });

    it('--allow-dirty inspects a dirty checkout and keeps the +dirty sha', () => {
        const { args, deps } = workspace({
            gitSha: () => `${'a'.repeat(40)}+dirty`,
        });
        expect(runBacktestBenchmarks({ ...args, allowDirty: true }, deps)).toBe(
            0
        );
        expect(JSON.parse(read(args, 'benchmarks.json')).coreSha).toBe(
            `${'a'.repeat(40)}+dirty`
        );
    });

    it('refuses a bars fingerprint it does not know', () => {
        const { args, deps, logs } = workspace({
            knownFingerprints: ['0'.repeat(64)],
        });
        expect(runBacktestBenchmarks(args, deps)).toBe(2);
        expect(logs.join('\n')).toContain('unknown bars fingerprint');
    });

    it('refuses an output path inside the repository', () => {
        const { args, deps, logs } = workspace();
        expect(
            runBacktestBenchmarks(
                { ...args, out: join(REPO_ROOT, 'tmp-benchmarks-out') },
                deps
            )
        ).toBe(2);
        expect(logs.join('\n')).toContain('inside the repository');
    });

    it('refuses a ticker whose bars file is missing', () => {
        const { args, deps, logs } = workspace();
        writeFileSync(
            args.pageData,
            JSON.stringify({
                ...fixtureInput(),
                run: { ...fixtureInput().run, tickers: ['AAA', 'BBB', 'CCC'] },
                bars: undefined,
                identity: undefined,
            })
        );
        expect(runBacktestBenchmarks(args, deps)).toBe(2);
        expect(logs.join('\n')).toContain('no bars file for CCC');
    });

    it('refuses a file that is not page data', () => {
        const { args, deps, logs } = workspace();
        writeFileSync(args.pageData, JSON.stringify({ hello: 'world' }));
        expect(runBacktestBenchmarks(args, deps)).toBe(2);
        expect(logs.join('\n')).toContain('not backtest page data');
    });

    it('refuses a run with no trades', () => {
        const { args, deps, logs } = workspace();
        writeFileSync(
            args.pageData,
            JSON.stringify({
                run: fixtureInput().run,
                baselines: fixtureInput().baselines,
                trades: [],
            })
        );
        expect(runBacktestBenchmarks(args, deps)).toBe(2);
        expect(logs.join('\n')).toContain('no trades');
    });

    it('lets an unexpected error through instead of exit 2', () => {
        const { args, deps } = workspace();
        writeFileSync(args.pageData, '{not json');
        expect(() => runBacktestBenchmarks(args, deps)).toThrow();
    });
});

describe('barsFingerprintOf and tradesSha256', () => {
    it('changes with the bars bytes and is stable otherwise', () => {
        const { args } = workspace();
        const before = barsFingerprintOf(args.run, ['AAA', 'BBB']);
        expect(barsFingerprintOf(args.run, ['BBB', 'AAA'])).toBe(before);
        writeFileSync(
            join(args.run, 'data', 'bars', 'AAA.json'),
            JSON.stringify({ bars: fixtureBars(aaaClose).slice(1) })
        );
        expect(barsFingerprintOf(args.run, ['AAA', 'BBB'])).not.toBe(before);
    });

    it('gives the same hash for the same trades with another key order, and another hash for a changed value', () => {
        const reordered = Object.fromEntries(Object.entries(T1).reverse());
        const nested = {
            ...T1,
            initialPlan: Object.fromEntries(
                Object.entries(T1.initialPlan).reverse()
            ),
        };
        expect(tradesSha256([reordered, T2])).toBe(tradesSha256([T1, T2]));
        expect(tradesSha256([nested, T2])).toBe(tradesSha256([T1, T2]));
        expect(tradesSha256([{ ...T1, returnPct: 6.01 }, T2])).not.toBe(
            tradesSha256([T1, T2])
        );
        expect(tradesSha256([T2, T1])).not.toBe(tradesSha256([T1, T2]));
    });

    it('hashes the serialized trades array', () => {
        expect(tradesSha256([])).toBe(
            '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
        );
        expect(tradesSha256([T1])).not.toBe(tradesSha256([T2]));
    });

    it('knows the fingerprint of the v8 run it was written for', () => {
        expect(KNOWN_BARS_FINGERPRINTS).toEqual([
            '4b8d0f13f34282105e901c961b841de787ae9ed82eb5b49c0ce19f095df8ad98',
        ]);
    });
});

describe('generateBenchmarkFiles and perTradeCsv', () => {
    it('renders each figure with fixed decimals', () => {
        expect(
            perTradeCsv([
                {
                    ticker: 'AAA',
                    decisionDate: '2025-01-07',
                    entryDate: '2025-01-08',
                    returnPct: 6,
                    sameLengthDriftPct: 0.123456,
                    excessPct: 5.876544,
                },
            ])
        ).toBe(
            'ticker,decision_date,entry_date,return_pct,same_length_drift_pct,excess_pct\nAAA,2025-01-07,2025-01-08,6.00,0.1235,5.8765\n'
        );
    });

    it('returns text per file without writing', () => {
        const { args, deps } = workspace();
        expect(Object.keys(generateBenchmarkFiles(args, deps))).toEqual([
            'benchmarks.json',
            'per-trade.csv',
            'perTicker.json',
            'diagnostics.json',
        ]);
    });
});
