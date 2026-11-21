import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeSet } from '../../../../scripts/replay/buildSet';
import {
    defaultDeps,
    dirtyDiffSha256,
    loadBarsDir,
    loadSet,
    parseStoredBars,
    InvalidBarsFileError,
    parseEngineEvalArgs,
    runEngineEval,
    type EngineEvalArgs,
} from '../../../../scripts/replay/engineEval';
import { patternWalkForSymbol } from '../../../../scripts/replay/engineEvalPatterns';
import { weeksOfTimes } from '../../../../scripts/replay/engineEvalStats';
import { PATTERN_METRICS } from '../../../../scripts/replay/engineEvalTypes';
import { REPO_ROOT } from '../../../../scripts/replay/fsUtil';
import { barsFingerprint } from '../../../../scripts/replay/setIntegrity';
import type { ReplayManifest } from '../../../../scripts/replay/types';
import { makeTempDir, tradingBars, writeBarsDir } from './replayFixtures';

const temps = new Set<() => void>();
afterEach(() => {
    [...temps].forEach(remove => remove());
    temps.clear();
});

const SYMBOLS = ['NVDA', '005930.KS'];

/** A two-symbol set (one US, one KR) long enough for event bars and one pattern window. */
function makeSet(): { dir: string; setDir: string; manifest: ReplayManifest } {
    const { dir, remove } = makeTempDir();
    temps.add(remove);
    writeBarsDir(
        join(dir, 'src'),
        SYMBOLS.map(symbol => ({
            symbol,
            bars: tradingBars({
                symbol,
                startIso: '2018-01-02',
                count: 620,
                close: i =>
                    100 +
                    0.05 * i +
                    12 * Math.sin(i / 5) +
                    4 * Math.sin(i / 1.7),
            }),
        }))
    );
    const setDir = join(dir, 'set');
    const manifest = writeSet(join(dir, 'src'), setDir, {
        createdAt: 'x',
        allowPartial: true,
        force: false,
    });
    return { dir, setDir, manifest };
}

const deps = (log = vi.fn<(line: string) => void>()) => ({
    log,
    gitSha: () => 'abc123+dirty',
    dirtyDiffSha256: () => 'f'.repeat(64),
});

const baseArgs = (overrides: Partial<EngineEvalArgs>): EngineEvalArgs => ({
    set: null,
    bars: null,
    out: '',
    arm: 'before',
    only: null,
    symbols: null,
    gate: null,
    ...overrides,
});

describe('parseEngineEvalArgs', () => {
    it('needs --out and exactly one data source', () => {
        expect(() => parseEngineEvalArgs(['--set', 'a'])).toThrow(
            '--out is required'
        );
        expect(() => parseEngineEvalArgs(['--out', 'o'])).toThrow(
            'exactly one of --set and --bars'
        );
        expect(() =>
            parseEngineEvalArgs(['--out', 'o', '--set', 'a', '--bars', 'b'])
        ).toThrow('exactly one of --set and --bars');
    });

    it('validates --only and splits --symbols', () => {
        expect(() =>
            parseEngineEvalArgs(['--out', 'o', '--set', 'a', '--only', 'x'])
        ).toThrow('--only must be');
        expect(() =>
            parseEngineEvalArgs(['--out', 'o', '--set', 'a', '--gate', 'x'])
        ).toThrow('--gate must be one of c9, pivots, geometry');
        const parsed = parseEngineEvalArgs([
            '--out',
            'o',
            '--bars',
            'b',
            '--arm',
            'after-c9',
            '--only',
            'candles',
            '--symbols',
            'A,B',
            '--gate',
            'c9',
        ]);
        expect(parsed).toMatchObject({
            set: null,
            arm: 'after-c9',
            only: 'candles',
            symbols: ['A', 'B'],
            gate: 'c9',
        });
        expect(parsed.bars).toMatch(/b$/);
        expect(parseEngineEvalArgs(['--out', 'o', '--set', 'a'])).toMatchObject(
            {
                arm: 'unnamed',
                only: null,
                symbols: null,
                bars: null,
                gate: null,
            }
        );
    });
});

describe('loading', () => {
    it('loads a verified set with its cases and fingerprint', () => {
        const { setDir, manifest } = makeSet();
        const data = loadSet(setDir);
        expect(data.kind).toBe('set');
        expect(data.fingerprint).toBe(barsFingerprint(manifest));
        expect(data.symbols.map(s => [s.symbol, s.market])).toEqual([
            ['005930.KS', 'kr'],
            ['NVDA', 'us'],
        ]);
        expect(data.cases.length).toBeGreaterThan(0);
    });

    it('refuses a set whose bars changed', () => {
        const { setDir, manifest } = makeSet();
        const file = join(setDir, manifest.bars.NVDA.file);
        writeFileSync(file, `${readFileSync(file, 'utf-8')} `);
        expect(() => loadSet(setDir)).toThrow('set hash mismatch');
    });

    it('fingerprints a plain bars directory by file hash and reads the market from the symbol', () => {
        const { dir } = makeSet();
        const first = loadBarsDir(join(dir, 'src'));
        expect(first.kind).toBe('bars');
        expect(first.cases).toEqual([]);
        expect(first.symbols.map(s => [s.symbol, s.market])).toEqual([
            ['005930.KS', 'kr'],
            ['NVDA', 'us'],
        ]);
        expect(loadBarsDir(join(dir, 'src')).fingerprint).toBe(
            first.fingerprint
        );
        writeFileSync(
            join(dir, 'src', 'NVDA.json'),
            readFileSync(join(dir, 'src', 'NVDA.json'), 'utf-8') + ' '
        );
        expect(loadBarsDir(join(dir, 'src')).fingerprint).not.toBe(
            first.fingerprint
        );
    });
});

describe('runEngineEval', () => {
    it('writes run.json, events.jsonl and summary.json for a set', () => {
        const { dir, setDir, manifest } = makeSet();
        const out = join(dir, 'out');
        const log = vi.fn<(line: string) => void>();
        expect(runEngineEval(baseArgs({ set: setDir, out }), deps(log))).toBe(
            0
        );
        const run = JSON.parse(readFileSync(join(out, 'run.json'), 'utf-8'));
        expect(run).toMatchObject({
            tool: 'engineEval',
            arm: 'before',
            coreGitSha: 'abc123+dirty',
            dirtyDiffSha256: 'f'.repeat(64),
            only: null,
            gate: null,
            source: { kind: 'set', fingerprint: barsFingerprint(manifest) },
        });
        expect(run.source.symbols).toEqual(['005930.KS', 'NVDA']);
        expect(run.constants.seed).toBe(20261121);
        expect(run.constants.derived).toMatchObject({
            windowBars: 500,
            candleDetectionBars: 15,
            pivotReversalAtrMult: 1.5,
        });
        expect(run.horizons).toEqual({ h1: 1, h5: 5, h10: 10 });
        const summary = JSON.parse(
            readFileSync(join(out, 'summary.json'), 'utf-8')
        );
        expect(summary.arm).toBe('before');
        // 620 bars per symbol: a window ends on each of the last 120 bars.
        expect(summary.patterns.counters.days).toBe(240);
        expect(summary.caseLines.cases).toBe(manifest.cases.length);
        expect(summary.weeks).toEqual(
            weeksOfTimes(
                loadSet(setDir).symbols.flatMap(sym =>
                    sym.bars.map(bar => bar.time)
                )
            )
        );
        const events = readFileSync(join(out, 'events.jsonl'), 'utf-8')
            .split('\n')
            .filter(line => line !== '')
            .map(line => JSON.parse(line));
        expect(
            events.every(e => e.kind === 'candle' || e.kind === 'pattern')
        ).toBe(true);
        expect(events.filter(e => e.kind === 'candle')).toHaveLength(
            summary.candles.events
        );
        expect(events.filter(e => e.kind === 'pattern')).toHaveLength(
            summary.patterns.events
        );
        expect(
            log.mock.calls.flat().some(line => line.includes('005930.KS'))
        ).toBe(true);
    });

    it('is byte-identical on a rerun', () => {
        const { dir, setDir } = makeSet();
        runEngineEval(baseArgs({ set: setDir, out: join(dir, 'a') }), deps());
        runEngineEval(baseArgs({ set: setDir, out: join(dir, 'b') }), deps());
        ['events.jsonl', 'summary.json', 'run.json'].forEach(name => {
            expect(readFileSync(join(dir, 'a', name), 'utf-8')).toBe(
                readFileSync(join(dir, 'b', name), 'utf-8')
            );
        });
    });

    it('measures only the requested half and only the requested symbols', () => {
        const { dir, setDir } = makeSet();
        runEngineEval(
            baseArgs({
                set: setDir,
                out: join(dir, 'c'),
                only: 'candles',
                symbols: ['NVDA'],
            }),
            deps()
        );
        const candles = JSON.parse(
            readFileSync(join(dir, 'c', 'summary.json'), 'utf-8')
        );
        expect(candles.patterns).toBeNull();
        expect(candles.candles).not.toBeNull();
        expect(
            JSON.parse(readFileSync(join(dir, 'c', 'run.json'), 'utf-8')).source
                .symbols
        ).toEqual(['NVDA']);
        runEngineEval(
            baseArgs({ set: setDir, out: join(dir, 'p'), only: 'patterns' }),
            deps()
        );
        const patterns = JSON.parse(
            readFileSync(join(dir, 'p', 'summary.json'), 'utf-8')
        );
        expect(patterns.candles).toBeNull();
        expect(patterns.caseLines).toBeNull();
        expect(patterns.patterns).not.toBeNull();
    });

    it('evaluates a plain bars directory without the case lines', () => {
        const { dir } = makeSet();
        runEngineEval(
            baseArgs({
                bars: join(dir, 'src'),
                out: join(dir, 'bars-out'),
                only: 'candles',
            }),
            deps()
        );
        const summary = JSON.parse(
            readFileSync(join(dir, 'bars-out', 'summary.json'), 'utf-8')
        );
        expect(summary.caseLines).toBeNull();
        expect(
            JSON.parse(readFileSync(join(dir, 'bars-out', 'run.json'), 'utf-8'))
                .source.kind
        ).toBe('bars');
    });

    it('refuses an output path inside the repository and an empty symbol selection', () => {
        const { dir, setDir } = makeSet();
        expect(() =>
            runEngineEval(
                baseArgs({ set: setDir, out: join(REPO_ROOT, 'engine-out') }),
                deps()
            )
        ).toThrow('inside the repository');
        expect(() =>
            runEngineEval(
                baseArgs({
                    set: setDir,
                    out: join(dir, 'x'),
                    symbols: ['NOPE'],
                }),
                deps()
            )
        ).toThrow('no symbols to evaluate');
    });
});

describe('parseStoredBars', () => {
    const bar = { time: 1, open: 1, high: 2, low: 0, close: 1, volume: 5 };

    it('returns the bars of a well-formed file', () => {
        expect(
            parseStoredBars('A.json', JSON.stringify({ bars: [bar] }))
        ).toEqual([bar]);
    });

    it('names the file and the reason for a wrong shape', () => {
        const fails = (value: unknown, reason: string) => {
            const attempt = () =>
                parseStoredBars('A.json', JSON.stringify(value));
            expect(attempt).toThrow(InvalidBarsFileError);
            expect(attempt).toThrow(
                `A.json is not a stored-bars file: ${reason}`
            );
        };
        fails([], 'no `bars` array');
        fails(null, 'no `bars` array');
        fails({ bars: 'x' }, 'no `bars` array');
        fails({ bars: [bar, null] }, 'bar 1 lacks numeric');
        fails({ bars: [bar, { ...bar, close: '1' }] }, 'bar 1 lacks numeric');
        fails({ bars: [{ ...bar, volume: undefined }] }, 'bar 0 lacks numeric');
    });

    it('is applied to every file of a bars directory', () => {
        const { dir } = makeSet();
        writeFileSync(
            join(dir, 'src', 'NVDA.json'),
            JSON.stringify({ bars: [{ time: 1 }] })
        );
        expect(() => loadBarsDir(join(dir, 'src'))).toThrow(
            'NVDA.json is not a stored-bars file'
        );
    });
});

describe('exit code and skipped cases', () => {
    it('returns 0 without a gate and 2 when the gate did not pass', () => {
        const { dir, setDir } = makeSet();
        expect(
            runEngineEval(
                baseArgs({ set: setDir, out: join(dir, 'u') }),
                deps()
            )
        ).toBe(0);
        // The pattern half alone cannot score the candle gate.
        expect(
            runEngineEval(
                baseArgs({
                    set: setDir,
                    out: join(dir, 'g'),
                    only: 'patterns',
                    gate: 'c9',
                }),
                deps()
            )
        ).toBe(2);
    });

    it('returns 0 for a gate whose counters are all zero', () => {
        // 300 bars hold no 500-bar window: the geometry counters stay at 0.
        const { dir, remove } = makeTempDir();
        temps.add(remove);
        writeBarsDir(join(dir, 'short'), [
            {
                symbol: 'NVDA',
                bars: tradingBars({
                    symbol: 'NVDA',
                    startIso: '2018-01-02',
                    count: 300,
                }),
            },
        ]);
        const out = join(dir, 'z');
        const code = runEngineEval(
            baseArgs({
                bars: join(dir, 'short'),
                out,
                only: 'patterns',
                gate: 'geometry',
            }),
            deps()
        );
        expect(
            JSON.parse(readFileSync(join(out, 'summary.json'), 'utf-8')).g1.pass
        ).toBe(true);
        expect(code).toBe(0);
    });

    it('counts and warns about a case with no bar at its asOf date', () => {
        const { dir, setDir, manifest } = makeSet();
        const cases = manifest.cases.map((c, i) =>
            i === 0 ? { ...c, asOf: '2001-01-01' } : c
        );
        writeFileSync(
            join(setDir, 'manifest.json'),
            JSON.stringify({ ...manifest, cases })
        );
        const log = vi.fn<(line: string) => void>();
        const out = join(dir, 'skip');
        runEngineEval(baseArgs({ set: setDir, out }), deps(log));
        const summary = JSON.parse(
            readFileSync(join(out, 'summary.json'), 'utf-8')
        );
        expect(summary.caseLines.skipped).toBe(1);
        expect(summary.caseLines.cases).toBe(manifest.cases.length - 1);
        expect(
            log.mock.calls.flat().some(l => l.startsWith('WARNING: 1 case(s)'))
        ).toBe(true);
    });
});

describe('gated runs', () => {
    it('scores the gate of the run and refuses to score a half that was not measured', () => {
        const { dir, setDir } = makeSet();
        const gated = (
            only: 'candles' | 'patterns' | null,
            gate: 'c9' | 'pivots'
        ) => {
            const out = join(dir, `${only ?? 'both'}-${gate}`);
            runEngineEval(baseArgs({ set: setDir, out, only, gate }), deps());
            return {
                run: JSON.parse(readFileSync(join(out, 'run.json'), 'utf-8')),
                g1: JSON.parse(readFileSync(join(out, 'summary.json'), 'utf-8'))
                    .g1,
            };
        };
        const patternsOnly = gated('patterns', 'c9');
        expect(patternsOnly.run.gate).toBe('c9');
        expect(patternsOnly.g1).toMatchObject({
            gate: 'c9',
            scoredHalfMeasured: false,
            pass: false,
        });
        const candlesOnly = gated('candles', 'pivots');
        expect(candlesOnly.g1).toMatchObject({
            gate: 'pivots',
            scoredHalfMeasured: false,
            pass: false,
        });
        const both = gated(null, 'c9');
        expect(both.g1.scoredHalfMeasured).toBe(true);
        expect(Object.keys(both.g1.scored)).toEqual([
            'context',
            'setupBody',
            'dojiSetup',
            'tweezersClose',
        ]);
    });

    it('resamples the same weeks whichever half was run', () => {
        const { dir, setDir } = makeSet();
        const weeksOf = (only: 'candles' | 'patterns' | null): string[] => {
            const out = join(dir, `weeks-${only ?? 'both'}`);
            runEngineEval(baseArgs({ set: setDir, out, only }), deps());
            return JSON.parse(readFileSync(join(out, 'summary.json'), 'utf-8'))
                .weeks;
        };
        expect(weeksOf('candles')).toEqual(weeksOf('patterns'));
        expect(weeksOf('candles')).toEqual(weeksOf(null));
    });
});

describe('patternWalkForSymbol on the real engine', () => {
    const bars = tradingBars({
        symbol: 'NVDA',
        startIso: '2018-01-02',
        count: 620,
        close: i =>
            100 + 0.05 * i + 12 * Math.sin(i / 5) + 4 * Math.sin(i / 1.7),
    });

    it('walks one window per bar from the window length on and keeps only known counters', () => {
        const { events, counters } = patternWalkForSymbol('NVDA', 'us', bars);
        expect(counters.days).toBe(120);
        const known = new Set<string>(PATTERN_METRICS);
        expect(
            Object.keys(counters).every(key => known.has(key.split(':')[0]))
        ).toBe(true);
        // Every first-appearance event is directed, dated and carries its label.
        events.forEach(event => {
            expect(['up', 'down']).toContain(event.direction);
            expect(event.index).toBeGreaterThanOrEqual(500);
            expect(event.label20.outcome).toBeDefined();
        });
        expect(counters.instances ?? 0).toBeGreaterThanOrEqual(events.length);
        expect(patternWalkForSymbol('NVDA', 'us', bars)).toEqual({
            events,
            counters,
        });
    });
});

describe('defaultDeps', () => {
    it('names the checkout by its commit, marking a dirty tree', () => {
        expect(defaultDeps.gitSha()).toMatch(/^[0-9a-f]{40}(\+dirty)?$/);
    });

    it('hashes the diff of a dirty tree and nothing for a clean one', () => {
        const hash = dirtyDiffSha256();
        expect(hash === null || /^[0-9a-f]{64}$/.test(hash)).toBe(true);
        expect(hash === null).toBe(
            defaultDeps.gitSha().endsWith('+dirty') === false
        );
    });
});
