import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { ModuleKind, transpileModule } from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import {
    TABLE_PATH,
    generateTable,
    isEvalEvent,
    inputProblems,
    parseBaseRateTableArgs,
    readEngineInput,
    readLevelInput,
    runBaseRateTable,
    type BaseRateTableArgs,
} from '../../../../scripts/replay/baseRateTable';
import {
    BASE_RATE_MIN_N,
    candleTable,
    intervalP,
    patternTable,
    priceLevelFamilyTable,
    priceLevelRow,
    type BaseRateScope,
    type LevelSummaryInput,
} from '../../../../scripts/replay/baseRateTableCompute';
import { renderBaseRateTable } from '../../../../scripts/replay/baseRateTableRender';
import { summarizeArm } from '../../../../scripts/replay/engineEvalCompute';
import type {
    CandleEvent,
    EvalEvent,
    PatternEvent,
} from '../../../../scripts/replay/engineEvalTypes';
import { verdictOf } from '@/domain/analysis/baseRateVerdict';
import { makeTempDir } from './replayFixtures';
import { candleEvent, patternEvent } from './engineEvalFixtures';

const temps = new Set<() => void>();
afterEach(() => {
    [...temps].forEach(remove => remove());
    temps.clear();
});

const WEEKS = Array.from(
    { length: 52 },
    (_, i) => `2021-W${String(i + 1).padStart(2, '0')}`
);

const scope: BaseRateScope = {
    timeframe: '1Day',
    symbols: 2,
    from: '2021-01-04',
    to: '2021-12-30',
};

/** Where event `i` falls: spread over the weeks, alternating market and time half. */
const slotOf = (
    i: number
): { week: string; market: 'us' | 'kr'; half: 'early' | 'late' } => ({
    week: WEEKS[i % WEEKS.length],
    market: i % 2 === 0 ? 'us' : 'kr',
    half: Math.floor(i / 2) % 2 === 0 ? 'early' : 'late',
});

const patterns = (
    id: string,
    count: number,
    hit: (i: number) => boolean,
    placebo = 0.25
): PatternEvent[] =>
    Array.from({ length: count }, (_, i) =>
        patternEvent({
            id,
            target60: hit(i) ? 'hit' : 'inval',
            placeboTargetHit: placebo,
            ...slotOf(i),
        })
    );

const candles = (
    pattern: string,
    count: number,
    moves: (i: number) => boolean,
    placeboHit = 0.5
): CandleEvent[] =>
    Array.from({ length: count }, (_, i) => {
        const event = candleEvent({
            pattern,
            y: moves(i) ? 1 : -1,
            placeboY: 0,
            ...slotOf(i),
        });
        return {
            ...event,
            matched: event.matched && {
                ...event.matched,
                hit: { h1: placeboHit, h5: placeboHit, h10: placeboHit },
            },
        };
    });

describe('patternTable', () => {
    const events = [
        ...patterns('always_hits', 120, () => true),
        ...patterns('coin_flip', 120, i => i % 4 === 0, 0.25),
        ...patterns('one_market', 120, i => i % 2 === 0, 0.25),
        ...patterns('rare', 40, () => true),
    ];
    const table = patternTable(events, WEEKS, scope);
    const byKey = (key: string) => table.rows.find(r => r.family === key);

    it('beats the placebo when the target always comes first and the placebo says 25%', () => {
        const row = byKey('always_hits');
        expect(row?.row).toMatchObject({
            subject: 'chart_pattern',
            key: 'always_hits',
            n: 120,
            eventShare: 1,
            placeboShare: 0.25,
            verdict: 'beats_placebo',
            scope,
        });
        expect(row?.row.difference.mean).toBeCloseTo(0.75);
        expect(row?.holmP).toBeLessThan(0.05);
    });

    it('is no edge when the event hits as often as its placebo', () => {
        expect(byKey('coin_flip')?.row.verdict).toBe('no_edge');
    });

    it('is no edge when the gain holds in one market only', () => {
        // US events hit, Korean events never do: the pool is positive, the Korean split is not.
        expect(byKey('one_market')?.inputs.splits.kr).toBeLessThan(0);
        expect(byKey('one_market')?.row.verdict).toBe('no_edge');
    });

    it('gives a family below the floor the pooled figures under the key pooled', () => {
        const rare = byKey('rare');
        expect(rare?.row.key).toBe('pooled');
        expect(rare?.row.verdict).toBe('insufficient_sample');
        expect(rare?.row.n).toBe(table.pooled.row.n);
        expect(table.pooled.row.n).toBe(events.length);
    });

    it('lists families in key order and the pooled row with the same rule', () => {
        expect(table.rows.map(r => r.family)).toEqual([
            'always_hits',
            'coin_flip',
            'one_market',
            'rare',
        ]);
        expect(table.pooled.row.key).toBe('pooled');
        expect(table.pooled.row.eventShare).toBeCloseTo(
            events.filter(e => e.target60 === 'hit').length / events.length
        );
    });

    it('refuses a row it cannot compute instead of writing a 0', () => {
        expect(() => patternTable([], WEEKS, scope)).toThrow(
            'is not computable'
        );
    });
});

describe('candleTable', () => {
    const events = [
        ...candles('hammer', 120, () => true),
        ...candles('shooting_star', 120, i => i % 2 === 0),
        ...candles('rare_one', 30, () => true),
        ...Array.from({ length: 10 }, (_, i) => ({
            ...candleEvent(slotOf(i)),
            status: 'neutral' as const,
            y: null,
            pct: null,
            matched: null,
            unmatched: null,
        })),
    ];
    const table = candleTable(events, WEEKS, scope);
    const byKey = (key: string) => table.rows.find(r => r.family === key);

    it('reads the hit share of the next five bars against the matched placebo, and keeps the ATR edge', () => {
        const hammer = byKey('hammer');
        expect(hammer?.row).toMatchObject({
            subject: 'candle_pattern',
            n: 120,
            eventShare: 1,
            placeboShare: 0.5,
            verdict: 'beats_placebo',
        });
        expect(hammer?.row.difference.mean).toBeCloseTo(0.5);
        expect(hammer?.atrEdge?.mean).toBeCloseTo(1);
    });

    it('is no edge for half hits, insufficient below the floor, and ignores untested events', () => {
        expect(byKey('shooting_star')?.row.verdict).toBe('no_edge');
        expect(byKey('rare_one')?.row.key).toBe('pooled');
        expect(byKey('rare_one')?.row.verdict).toBe('insufficient_sample');
        expect(table.pooled.row.n).toBe(270);
    });
});

describe('priceLevelRow', () => {
    const group = (
        share: number,
        n: number,
        mean: number | null,
        low: number | null
    ) => ({
        held: { n, share },
        transplant: { n: n * 3, share: share - (mean ?? 0) },
        difference: { mean, low, high: low === null ? null : low + 0.02 },
    });
    const summary = (
        over: Partial<LevelSummaryInput> = {}
    ): LevelSummaryInput => ({
        overall: group(0.4965, 550171, -0.0005, -0.007),
        tables: {
            market: {
                us: group(0.5, 1000, -0.001, -0.01),
                kr: group(0.5, 1000, 0.002, -0.01),
            },
            half: {
                'pre-2022': group(0.5, 1000, 0.003, -0.01),
                '2022+': group(0.5, 1000, -0.003, -0.01),
            },
            family: {},
        },
        ...over,
    });

    it('records the held rate against the placebo and says no edge today', () => {
        const row = priceLevelRow(summary(), scope);
        expect(row.row).toMatchObject({
            subject: 'price_level',
            key: 'pooled',
            n: 550171,
            eventShare: 0.4965,
            verdict: 'no_edge',
        });
        expect(row.row.placeboShare).toBeCloseTo(0.497);
    });

    it('would beat the placebo with a positive interval that holds in every market and half', () => {
        const positive = group(0.55, 550171, 0.03, 0.01);
        const row = priceLevelRow(
            summary({
                overall: positive,
                tables: {
                    market: { us: positive, kr: positive },
                    half: { 'pre-2022': positive, '2022+': positive },
                    family: {},
                },
            }),
            scope
        );
        expect(row.row.verdict).toBe('beats_placebo');
    });

    it('refuses a level run without a computable held rate', () => {
        expect(() =>
            priceLevelRow(
                summary({ overall: group(0.5, 0, null, null) }),
                scope
            )
        ).toThrow('is not computable');
    });
});

describe('priceLevelFamilyTable', () => {
    const FAMILIES = ['vwap', 'fib', 'ma', 'band', 'rare'];
    /** Standard errors of the difference for a two-sided normal p (0.5, 0.2, 0.03, 0.001, 0.0001). */
    const Z = {
        p50: 0.67449,
        p20: 1.28155,
        p03: 2.17009,
        p001: 3.29053,
        p0001: 3.89059,
    };
    const SE = 0.01;
    /** A level group whose difference is `z` standard errors from zero, with a 95% interval. */
    const groupWithZ = (z: number, n = 5000) => {
        const m = z * SE;
        return {
            held: { n, share: 0.5 + m },
            transplant: { n: n * 3, share: 0.5 },
            difference: {
                mean: m,
                low: m - 1.959964 * SE,
                high: m + 1.959964 * SE,
            },
        };
    };
    const summaryOf = (
        family: LevelSummaryInput['tables']['family']
    ): LevelSummaryInput => ({
        overall: groupWithZ(Z.p50, 550171),
        tables: {
            market: { us: groupWithZ(Z.p50), kr: groupWithZ(Z.p50) },
            half: {
                'pre-2022': groupWithZ(Z.p50),
                '2022+': groupWithZ(Z.p50),
            },
            family,
        },
    });

    it('has a row per family in key order, the pooled row beside it, with n and scope', () => {
        const table = priceLevelFamilyTable(
            summaryOf({
                fib: groupWithZ(Z.p50),
                ma: groupWithZ(Z.p50),
                band: groupWithZ(Z.p50),
            }),
            scope,
            FAMILIES
        );
        expect(table.rows.map(r => r.family)).toEqual([
            'band',
            'fib',
            'ma',
            'rare',
            'vwap',
        ]);
        expect(table.pooled.row).toMatchObject({
            key: 'pooled',
            n: 550171,
            subject: 'price_level',
        });
        expect(table.rows[1].row).toMatchObject({
            subject: 'price_level',
            key: 'fib',
            n: 5000,
            scope,
        });
        // The same held/transplant definitions as the pooled row: share is `held.share`.
        expect(table.rows[1].row.eventShare).toBeCloseTo(
            groupWithZ(Z.p50).held.share
        );
        expect(table.rows[1].row.placeboShare).toBe(0.5);
    });

    it('gives a family below the floor, or with no levels, the pooled figures as insufficient', () => {
        const table = priceLevelFamilyTable(
            summaryOf({
                fib: groupWithZ(Z.p50),
                rare: groupWithZ(Z.p001, BASE_RATE_MIN_N - 1),
            }),
            scope,
            FAMILIES
        );
        const byKey = (key: string) => table.rows.find(r => r.family === key);
        expect(byKey('rare')?.row).toMatchObject({
            key: 'pooled',
            verdict: 'insufficient_sample',
            n: table.pooled.row.n,
        });
        expect(byKey('rare')?.inputs.n).toBe(BASE_RATE_MIN_N - 1);
        expect(byKey('vwap')?.row.verdict).toBe('insufficient_sample');
        expect(byKey('vwap')?.inputs.n).toBe(0);
        expect(byKey('fib')?.row.verdict).toBe('no_edge');
        expect(byKey('rare')?.holmP).toBeNull();
    });

    it('applies Holm across the families, not a per-family test (falsified)', () => {
        // Three families with p = 0.03 each. Tested one by one each rejects zero; across the
        // three, Holm lifts the smallest to 0.09 and none does.
        const table = priceLevelFamilyTable(
            summaryOf({
                fib: groupWithZ(Z.p03),
                ma: groupWithZ(Z.p03),
                band: groupWithZ(Z.p03),
            }),
            scope,
            ['fib', 'ma', 'band']
        );
        table.rows.forEach(r => {
            expect(
                intervalP({
                    mean: r.row.difference.mean,
                    low: r.row.difference.low,
                    high: r.row.difference.high,
                })
            ).toBeCloseTo(0.03, 3);
            expect(r.holmP).toBeCloseTo(0.09, 2);
            expect(r.inputs.significant).toBe(false);
        });
        // A lone family at the same p is significant: the correction counts the families.
        const lone = priceLevelFamilyTable(
            summaryOf({ fib: groupWithZ(Z.p03) }),
            scope,
            ['fib']
        );
        expect(lone.rows[0].holmP).toBeCloseTo(0.03, 3);
        expect(lone.rows[0].inputs.significant).toBe(true);
    });

    it('counts only the families at or above the floor in the Holm correction', () => {
        const table = priceLevelFamilyTable(
            summaryOf({
                fib: groupWithZ(Z.p03),
                ma: groupWithZ(Z.p03, BASE_RATE_MIN_N - 1),
                band: groupWithZ(Z.p03, BASE_RATE_MIN_N - 1),
            }),
            scope,
            ['fib', 'ma', 'band']
        );
        expect(table.rows.find(r => r.family === 'fib')?.holmP).toBeCloseTo(
            0.03,
            3
        );
    });

    it('never reads beats_placebo while a family has no market and half breakdown', () => {
        const table = priceLevelFamilyTable(
            summaryOf({ fib: groupWithZ(Z.p0001) }),
            scope,
            ['fib']
        );
        const fib = table.rows[0];
        expect(fib.inputs.significant).toBe(true);
        expect(fib.inputs.low).toBeGreaterThan(0);
        expect(fib.inputs.splits).toEqual({
            early: null,
            late: null,
            us: null,
            kr: null,
        });
        expect(fib.row.verdict).toBe('no_edge');
    });

    it('stores the verdict the shared rule gives the inputs it keeps', () => {
        const table = priceLevelFamilyTable(
            summaryOf({
                fib: groupWithZ(Z.p50),
                ma: groupWithZ(Z.p001),
                band: groupWithZ(-Z.p20),
            }),
            scope,
            FAMILIES
        );
        table.rows.forEach(r => {
            expect(r.row.verdict).toBe(verdictOf(r.inputs));
        });
    });

    it('refuses a family whose difference it cannot compute', () => {
        expect(() =>
            priceLevelFamilyTable(
                summaryOf({
                    fib: {
                        held: { n: 5000, share: 0.5 },
                        transplant: { n: 15000, share: 0.5 },
                        difference: { mean: null, low: null, high: null },
                    },
                }),
                scope,
                ['fib']
            )
        ).toThrow('is not computable');
    });
});

describe('intervalP', () => {
    it('is 0.05 at the edge of a 95% interval, 1 at a zero difference, symmetric in sign', () => {
        expect(intervalP({ mean: 0.0196, low: 0, high: 0.0392 })).toBeCloseTo(
            0.05,
            3
        );
        expect(intervalP({ mean: 0, low: -0.01, high: 0.01 })).toBeCloseTo(
            1,
            6
        );
        expect(intervalP({ mean: -0.0196, low: -0.0392, high: 0 })).toBeCloseTo(
            0.05,
            3
        );
    });

    it('is null for a missing or zero-width interval', () => {
        expect(intervalP({ mean: null, low: 0, high: 1 })).toBeNull();
        expect(intervalP({ mean: 0.1, low: null, high: 1 })).toBeNull();
        expect(intervalP({ mean: 0.1, low: 0.1, high: 0.1 })).toBeNull();
    });
});

const flatLevelSummary: LevelSummaryInput = {
    overall: {
        held: { n: 1000, share: 0.5 },
        transplant: { n: 3000, share: 0.5 },
        difference: { mean: 0, low: -0.01, high: 0.01 },
    },
    tables: {
        market: {},
        half: {},
        family: {
            fib: {
                held: { n: 500, share: 0.52 },
                transplant: { n: 1500, share: 0.5 },
                difference: { mean: 0.02, low: -0.01, high: 0.05 },
            },
        },
    },
};

describe('renderBaseRateTable', () => {
    it('writes the header, the types and one record entry per row', () => {
        const pattern = patternTable(
            [
                ...patterns('a', 120, () => true),
                ...patterns('b', 20, () => true),
            ],
            WEEKS,
            scope
        );
        const candle = candleTable(
            candles('hammer', 120, () => true),
            WEEKS,
            scope
        );
        const source = renderBaseRateTable({
            header: {
                setId: 'replay-v1',
                fingerprint: 'f'.repeat(64),
                coreSha: 'a'.repeat(40),
                definitions: 'labels v1',
                date: '2026-11-22',
                command: 'cmd',
            },
            patterns: pattern,
            candles: candle,
            priceLevel: priceLevelRow(flatLevelSummary, scope).row,
            priceLevelFamilies: priceLevelFamilyTable(flatLevelSummary, scope, [
                'fib',
                'vwap',
            ]),
        });
        expect(source).toContain(
            'GENERATED by scripts/replay/baseRateTable.ts'
        );
        expect(source).toContain(
            `export const BASE_RATE_MIN_N = ${BASE_RATE_MIN_N};`
        );
        expect(source).toContain("'a': {");
        expect(source).toContain("'b': {");
        expect(source).toContain("verdict: 'insufficient_sample'");
        expect(source).toContain('export function measuredBaseRateFor(');
        expect(source).toContain("if (timeframe !== '1Day') return null;");
        expect(source).toContain('export const PRICE_LEVEL_FAMILY_BASE_RATES');
        expect(source).toContain("'fib': {");
        expect(source).toContain("'vwap': {");
        expect(source).toContain(
            'export function priceLevelFamilyBaseRateFor('
        );
        expect(source).toContain('not the bootstrap p');
    });

    it('gives every exported symbol its own doc, never a doc that belongs to the next one', () => {
        const row = priceLevelRow(flatLevelSummary, scope).row;
        const pattern = patternTable(
            patterns('a', 120, () => true),
            WEEKS,
            scope
        );
        const source = renderBaseRateTable({
            header: {
                setId: 's',
                fingerprint: 'f',
                coreSha: 'a',
                definitions: 'd',
                date: '2026-11-22',
                command: 'cmd',
            },
            patterns: pattern,
            candles: candleTable(
                candles('hammer', 120, () => true),
                WEEKS,
                scope
            ),
            priceLevel: row,
            priceLevelFamilies: priceLevelFamilyTable(flatLevelSummary, scope, [
                'fib',
                'vwap',
            ]),
        });
        // No doc block is directly followed by another declaration's doc or by a blank line,
        // and the two union types each carry a doc about themselves.
        expect(source).not.toMatch(/\*\/\n\s*\/\*\*/);
        expect(source).toMatch(
            /\/\*\* What a base-rate row measures[^\n]*\*\/\nexport type BaseRateSubject =/
        );
        expect(source).toMatch(
            /\/\*\* Whether a row beats its placebo[^\n]*\*\/\nexport type BaseRateVerdict =/
        );
    });
});

// ─── The runs it reads ────────────────────────────────────────────────────────

const FINGERPRINT = 'b'.repeat(64);
const SHA = 'c'.repeat(40);

function writeEngineRun(
    dir: string,
    options: {
        gate: 'geometry' | 'c9';
        events: readonly EvalEvent[];
        sha?: string;
        diff?: string | null;
        fingerprint?: string;
        only?: string | null;
        summaryEvents?: number;
        symbols?: readonly string[];
    }
): void {
    mkdirSync(dir, { recursive: true });
    const patternEvents = options.events.filter(e => e.kind === 'pattern');
    const candleEvents = options.events.filter(e => e.kind === 'candle');
    const summary = summarizeArm({
        arm: options.gate,
        weeks: WEEKS,
        gate: options.gate,
        candleEvents: options.gate === 'c9' ? candleEvents : null,
        patternEvents: options.gate === 'geometry' ? patternEvents : null,
        patternCounters: options.gate === 'geometry' ? { days: 10 } : null,
        caseLines: null,
    });
    const fixed =
        options.summaryEvents === undefined
            ? summary
            : {
                  ...summary,
                  patterns: summary.patterns && {
                      ...summary.patterns,
                      events: options.summaryEvents,
                  },
              };
    writeFileSync(
        join(dir, 'run.json'),
        JSON.stringify({
            tool: 'engineEval',
            arm: options.gate,
            coreGitSha: options.sha ?? SHA,
            dirtyDiffSha256: options.diff ?? null,
            source: {
                kind: 'set',
                fingerprint: options.fingerprint ?? FINGERPRINT,
                symbols: options.symbols ?? ['NVDA', '005930.KS'],
            },
            only: options.only ?? null,
            gate: options.gate,
            constants: { seed: 1 },
        })
    );
    writeFileSync(join(dir, 'summary.json'), JSON.stringify(fixed));
    writeFileSync(
        join(dir, 'events.jsonl'),
        options.events.map(e => `${JSON.stringify(e)}\n`).join('')
    );
}

function writeLevelRun(
    dir: string,
    options: {
        sha?: string;
        reference?: boolean;
        fingerprint?: string;
        l0?: boolean | null;
        disagreements?: number;
        symbols?: readonly string[];
    } = {}
): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, 'run.json'),
        JSON.stringify({
            tool: 'levelEval',
            coreGitSha: options.sha ?? SHA,
            dirtyDiffSha256: null,
            source: {
                fingerprint: options.fingerprint ?? FINGERPRINT,
                symbols: options.symbols ?? ['NVDA', '005930.KS'],
            },
            referencePopulation: options.reference ?? true,
            constants: { seed: 2 },
        })
    );
    const group = {
        held: { n: 1000, share: 0.5 },
        transplant: { n: 3000, share: 0.5 },
        difference: { mean: 0, low: -0.01, high: 0.01 },
    };
    writeFileSync(
        join(dir, 'summary.json'),
        JSON.stringify({
            scope,
            labelAgreement: { disagreements: options.disagreements ?? 0 },
            gates: [
                {
                    id: 'L0',
                    pass: options.l0 === undefined ? true : options.l0,
                },
            ],
            overall: group,
            tables: {
                market: { us: group, kr: group },
                half: { 'pre-2022': group, '2022+': group },
                family: { fib: group, ma: group },
            },
        })
    );
}

interface World {
    dir: string;
    args: BaseRateTableArgs;
}

function makeWorld(
    over: {
        engine?: Partial<Parameters<typeof writeEngineRun>[1]>;
        candles?: Partial<Parameters<typeof writeEngineRun>[1]>;
        levels?: Parameters<typeof writeLevelRun>[1];
    } = {}
): World {
    const { dir, remove } = makeTempDir();
    temps.add(remove);
    const patternEvents = [
        ...patterns('always_hits', 120, () => true),
        ...patterns('rare', 30, () => false),
    ];
    const candleEvents = candles('hammer', 120, () => true);
    writeEngineRun(join(dir, 'runs', 'geometry'), {
        gate: 'geometry',
        events: patternEvents,
        ...over.engine,
    });
    writeEngineRun(join(dir, 'runs', 'c9'), {
        gate: 'c9',
        events: candleEvents,
        ...over.candles,
    });
    writeLevelRun(join(dir, 'runs', 'levels'), over.levels);
    return {
        dir,
        args: {
            engine: join(dir, 'runs', 'geometry'),
            candles: join(dir, 'runs', 'c9'),
            levels: join(dir, 'runs', 'levels'),
            out: join(dir, 'out', 'measuredBaseRates.ts'),
            json: join(dir, 'out', 'rates.json'),
            date: '2026-11-22',
            allowDirty: false,
        },
    };
}

const readInputs = (args: BaseRateTableArgs) => ({
    engine: readEngineInput(args.engine),
    candles: readEngineInput(args.candles),
    levels: readLevelInput(args.levels),
});

describe('parseBaseRateTableArgs', () => {
    it('needs every input and a well-formed date, and accepts a summary.json path', () => {
        expect(() => parseBaseRateTableArgs(['--engine', 'e'])).toThrow(
            'missing --candles, --levels, --out, --date'
        );
        const base = [
            '--engine',
            'e/summary.json',
            '--candles',
            'c',
            '--levels',
            'l',
            '--out',
            'o',
        ];
        expect(() =>
            parseBaseRateTableArgs([...base, '--date', 'today'])
        ).toThrow('--date must be YYYY-MM-DD');
        const parsed = parseBaseRateTableArgs([
            ...base,
            '--date',
            '2026-11-22',
            '--json',
            'j',
            '--allow-dirty',
        ]);
        expect(parsed.engine).toMatch(/\/e$/);
        expect(parsed.json).toMatch(/\/j$/);
        expect(parsed.allowDirty).toBe(true);
    });
});

describe('inputProblems', () => {
    const problems = (world: World, allowDirty = false) => {
        const { engine, candles: c, levels } = readInputs(world.args);
        return inputProblems(engine, c, levels, allowDirty);
    };

    it('finds nothing wrong with clean runs of one set and one commit', () => {
        expect(problems(makeWorld())).toEqual([]);
    });

    it('refuses a dirty checkout unless told to look anyway', () => {
        const world = makeWorld({
            engine: { sha: `${SHA}+dirty`, diff: 'd'.repeat(64) },
        });
        expect(problems(world).join('\n')).toContain(
            '--engine was made on a dirty checkout'
        );
        expect(problems(world, true).join('\n')).not.toContain(
            'dirty checkout'
        );
    });

    it('refuses runs of different bars or commits', () => {
        expect(
            problems(
                makeWorld({ levels: { fingerprint: 'e'.repeat(64) } })
            ).join('\n')
        ).toContain('different bars');
        expect(
            problems(makeWorld({ levels: { sha: 'd'.repeat(40) } })).join('\n')
        ).toContain('different core commits');
    });

    it('refuses a run of the wrong gate, a missing half and a level run that is not the reference population', () => {
        const wrongGate = makeWorld({
            candles: { gate: 'geometry', events: patterns('x', 5, () => true) },
        });
        expect(problems(wrongGate).join('\n')).toContain(
            '--candles must be a run with --gate c9'
        );
        const noPatterns = makeWorld({ engine: { only: 'candles' } });
        expect(problems(noPatterns).join('\n')).toContain(
            'did not measure the chart patterns'
        );
        expect(
            problems(makeWorld({ levels: { reference: false } })).join('\n')
        ).toContain('not the reference population');
    });

    it('refuses runs of a subset of the symbols, whichever run it is', () => {
        const subset = ['NVDA'];
        expect(
            problems(makeWorld({ engine: { symbols: subset } })).join('\n')
        ).toContain('different symbols');
        expect(
            problems(makeWorld({ candles: { symbols: subset } })).join('\n')
        ).toContain('different symbols');
        expect(
            problems(makeWorld({ levels: { symbols: subset } })).join('\n')
        ).toContain('different symbols');
    });

    it('refuses a level run that did not reproduce section 1 or whose evaluator drifted', () => {
        expect(
            problems(makeWorld({ levels: { l0: false } })).join('\n')
        ).toContain('did not pass its L0 gate');
        expect(
            problems(makeWorld({ levels: { l0: null } })).join('\n')
        ).toContain('did not pass its L0 gate');
        expect(
            problems(makeWorld({ levels: { disagreements: 4 } })).join('\n')
        ).toContain('counts 4 real levels');
    });

    it('refuses events that do not match their summary', () => {
        const world = makeWorld({ engine: { summaryEvents: 7 } });
        expect(problems(world).join('\n')).toContain('counts 7 pattern events');
    });
});

describe('generateTable and runBaseRateTable', () => {
    it('writes the table and its JSON companion, formatted and byte-identical on a rerun', async () => {
        const world = makeWorld();
        const code = await runBaseRateTable(world.args, () => undefined);
        expect(code).toBe(0);
        const first = readFileSync(world.args.out, 'utf-8');
        const companion = JSON.parse(
            readFileSync(world.args.json ?? '', 'utf-8')
        );
        expect(companion.chartPatterns.rows).toHaveLength(2);
        expect(companion.priceLevel.row.verdict).toBe('no_edge');
        expect(
            companion.priceLevelFamilies.rows.map(
                (r: { family: string }) => r.family
            )
        ).toEqual([
            'avwap',
            'band',
            'fib',
            'ichimoku',
            'ma',
            'pivot',
            'round',
            'supertrend',
            'swing',
            'vp',
            'vwap',
        ]);
        await runBaseRateTable(world.args, () => undefined);
        expect(readFileSync(world.args.out, 'utf-8')).toBe(first);
        const config = (await resolveConfig(TABLE_PATH)) ?? {};
        expect(await format(first, { ...config, parser: 'typescript' })).toBe(
            first
        );
        expect(first).toContain(`Core: ${SHA} (clean checkout)`);
        expect(first).toContain('--date 2026-11-22');
    });

    it('writes a measuredBaseRateFor that returns the row, the pooled row or null', async () => {
        const world = makeWorld();
        await runBaseRateTable(world.args, () => undefined);
        const { outputText } = transpileModule(
            readFileSync(world.args.out, 'utf-8'),
            { compilerOptions: { module: ModuleKind.CommonJS } }
        );
        const exported: Record<string, unknown> = {};
        new Function('exports', outputText)(exported);
        const lookup = (
            subject: string,
            key: string,
            timeframe: string
        ): { key: string; n: number; subject: string } | null =>
            Reflect.apply(
                exported.measuredBaseRateFor as () => never,
                undefined,
                [subject, key, timeframe]
            );
        expect(lookup('chart_pattern', 'always_hits', '1Day')).toMatchObject({
            key: 'always_hits',
            n: 120,
        });
        // A family under the floor, a key nobody measured: the pooled row.
        expect(lookup('chart_pattern', 'rare', '1Day')?.key).toBe('pooled');
        expect(lookup('chart_pattern', 'unknown_id', '1Day')).toMatchObject({
            key: 'pooled',
            n: 150,
            subject: 'chart_pattern',
        });
        expect(lookup('candle_pattern', 'hammer', '1Day')?.key).toBe('hammer');
        expect(lookup('candle_pattern', 'nothing', '1Day')?.subject).toBe(
            'candle_pattern'
        );
        // Nothing was measured off daily bars.
        expect(lookup('chart_pattern', 'always_hits', '1Hour')).toBeNull();
        expect(lookup('candle_pattern', 'hammer', '5Min')).toBeNull();
    });

    it('does not put the machine paths of the runs into the file', async () => {
        const world = makeWorld();
        await runBaseRateTable(world.args, () => undefined);
        expect(readFileSync(world.args.out, 'utf-8')).not.toContain(world.dir);
    });

    it('refuses untrustworthy inputs with every reason', async () => {
        const world = makeWorld({
            engine: { sha: `${SHA}+dirty` },
            levels: { reference: false },
        });
        const lines: string[] = [];
        await expect(
            runBaseRateTable(world.args, line => lines.push(line))
        ).resolves.toBe(2);
        expect(lines.join('\n')).toMatch(
            /^FAIL: the inputs cannot be trusted[\s\S]*dirty checkout[\s\S]*reference population|^FAIL: the inputs cannot be trusted[\s\S]*reference population[\s\S]*dirty/
        );
    });

    it.each([
        ['L0 did not pass', { l0: false }, /did not pass its L0 gate/],
        ['L0 was not computable', { l0: null }, /did not pass its L0 gate/],
        ['labels disagree', { disagreements: 4 }, /counts 4 real levels/],
        [
            'runs are of different bars',
            { fingerprint: 'e'.repeat(64) },
            /different bars/,
        ],
        [
            'runs are of different commits',
            { sha: 'd'.repeat(40) },
            /different core commits/,
        ],
    ] as const)(
        'exits 2 and writes nothing when the levels run is not comparable: %s',
        async (_name, levels, message) => {
            const world = makeWorld({ levels });
            const lines: string[] = [];
            await expect(
                runBaseRateTable(world.args, line => lines.push(line))
            ).resolves.toBe(2);
            expect(lines.join('\n')).toMatch(message);
            expect(existsSync(world.args.out)).toBe(false);
        }
    );

    it('writes outside the repository only, except the committed path, and never a dirty table there', async () => {
        const world = makeWorld();
        await expect(
            runBaseRateTable({
                ...world.args,
                out: join(process.cwd(), 'x.ts'),
            })
        ).rejects.toThrow('is inside the repository');
        await expect(
            runBaseRateTable({
                ...world.args,
                out: TABLE_PATH,
                allowDirty: true,
            })
        ).rejects.toThrow('--allow-dirty cannot write the committed table');
        await expect(
            runBaseRateTable({
                ...world.args,
                json: join(process.cwd(), 'j.json'),
            })
        ).rejects.toThrow('is inside the repository');
    });

    it('rejects an events file that holds a line which is not an event', () => {
        const world = makeWorld();
        writeFileSync(
            join(world.args.engine, 'events.jsonl'),
            '{"kind":"other"}\n'
        );
        expect(() => readEngineInput(world.args.engine)).toThrow(
            'line 1 is not an event'
        );
    });

    it('rejects an event that lacks a field the table reads', () => {
        const events = [
            candleEvent({ pattern: 'hammer' }),
            patternEvent({ id: 'a' }),
        ];
        expect(events.every(isEvalEvent)).toBe(true);
        const without = (event: object, field: string): unknown =>
            Object.fromEntries(
                Object.entries(event).filter(([key]) => key !== field)
            );
        expect(isEvalEvent(without(events[1], 'target60'))).toBe(false);
        expect(isEvalEvent(without(events[1], 'week'))).toBe(false);
        expect(isEvalEvent({ ...events[1], market: 'jp' })).toBe(false);
        expect(isEvalEvent({ ...events[1], placeboTargetHit: 'x' })).toBe(
            false
        );
        expect(isEvalEvent(without(events[0], 'pattern'))).toBe(false);
        expect(isEvalEvent({ ...events[0], matched: null })).toBe(false);
        expect(
            isEvalEvent({ ...events[0], y: { h1: 1, h5: Number.NaN, h10: 1 } })
        ).toBe(false);
        // A neutral candle needs no outcome.
        expect(
            isEvalEvent({
                ...events[0],
                status: 'neutral',
                y: null,
                matched: null,
            })
        ).toBe(true);
        expect(isEvalEvent(null)).toBe(false);
        expect(isEvalEvent({ kind: 'other' })).toBe(false);
    });

    it('lets a dirty run through for inspection and keeps the sha in the header', async () => {
        const world = makeWorld({
            engine: { sha: `${SHA}+dirty` },
            candles: { sha: `${SHA}+dirty` },
            levels: { sha: `${SHA}+dirty` },
        });
        const generated = await generateTable(
            { ...world.args, allowDirty: true },
            readInputs(world.args)
        );
        expect(generated.source).toContain(
            `Core: ${SHA}+dirty (DIRTY checkout: do not commit)`
        );
    });
});

/**
 * The reproduction gate (CONVENTIONS.md#TE-16): regenerates the table from the clean runs it
 * was made from and compares it with the committed file, everything below the header (the
 * header carries the date and the commit the runs were made on). The runs live outside the
 * repository, so this runs only when `BASE_RATE_RUNS` names a directory that holds the three
 * run directories `geometry`, `c9` and `levels`:
 *
 *   BASE_RATE_RUNS=<dir> yarn test src/__tests__/scripts/replay/baseRateTable.test.ts
 */
const RUNS_DIR = process.env.BASE_RATE_RUNS;

describe.skipIf(RUNS_DIR === undefined || RUNS_DIR === '')(
    'reproduction from the runs',
    () => {
        const body = (source: string): string =>
            source.slice(source.indexOf('import type { ChartPatternId'));

        it('regenerates the committed table, below its header, byte for byte', async () => {
            const dir = RUNS_DIR ?? '';
            const args: BaseRateTableArgs = {
                engine: join(dir, 'geometry'),
                candles: join(dir, 'c9'),
                levels: join(dir, 'levels'),
                out: '',
                json: null,
                date: '2000-01-01',
                allowDirty: true,
            };
            const generated = await generateTable(args, readInputs(args));
            expect(body(generated.source)).toBe(
                body(readFileSync(TABLE_PATH, 'utf-8'))
            );
        }, 3_600_000);
    }
);
