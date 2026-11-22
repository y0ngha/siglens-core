import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    benchmarkBarsOf,
    loadSetData,
    parseFieldsEvalArgs,
    readHtfBaseline,
    riskLevelPairs,
    type RunData,
    runFieldsEval,
    type FieldsEvalArgs,
    type FieldsEvalDeps,
} from '../../../../scripts/replay/analysisFieldsEval';
import type {
    RenderInput,
    Rendered,
} from '../../../../scripts/replay/analysisFieldsEvalRender';
import { writeSet } from '../../../../scripts/replay/buildSet';
import type { HtfCaseData } from '../../../../scripts/replay/htfEvalGates';
import { selectRunCases } from '../../../../scripts/replay/run';
import { barsFingerprint } from '../../../../scripts/replay/setIntegrity';
import {
    backdropBlockText,
    higherBlockText,
    promptOf,
    weeklyRowsSection,
} from './htfFixtures';
import { makeTempDir, tradingBars, writeBarsDir } from './replayFixtures';

const temps = new Set<() => void>();
afterEach(() => {
    [...temps].forEach(remove => remove());
    temps.clear();
});

const closeOf = (base: number, step: number) => (i: number) =>
    base + step * i + 7 * Math.sin(i / 9);

interface World {
    dir: string;
    setDir: string;
    benchDir: string;
}

/** NVDA, SPY (US) and a Korean listing in a frozen set, and the KOSPI bars in a sidecar directory. */
function makeWorld(): World {
    const { dir, remove } = makeTempDir();
    temps.add(remove);
    const srcDir = join(dir, 'src');
    writeBarsDir(srcDir, [
        {
            symbol: 'NVDA',
            bars: tradingBars({
                symbol: 'NVDA',
                startIso: '2020-01-02',
                count: 700,
                close: closeOf(100, 0.3),
            }),
        },
        {
            symbol: 'SPY',
            bars: tradingBars({
                symbol: 'SPY',
                startIso: '2020-01-02',
                count: 700,
                close: closeOf(300, 0.4),
            }),
        },
        {
            symbol: '005930.KS',
            bars: tradingBars({
                symbol: '005930.KS',
                startIso: '2020-01-02',
                count: 700,
                close: closeOf(60_000, 90),
            }),
        },
    ]);
    const setDir = join(dir, 'set');
    writeSet(srcDir, setDir, {
        createdAt: 'x',
        allowPartial: true,
        force: false,
    });
    const benchDir = join(dir, 'bench');
    writeBarsDir(benchDir, [
        {
            symbol: 'KS11',
            bars: tradingBars({
                symbol: '005930.KS',
                startIso: '2020-01-02',
                count: 700,
                close: closeOf(2_000, 1.2),
            }),
        },
        {
            symbol: 'KQ11',
            bars: tradingBars({
                symbol: '005930.KS',
                startIso: '2020-01-02',
                count: 700,
                close: closeOf(800, 0.5),
            }),
        },
    ]);
    return { dir, setDir, benchDir };
}

const baseArgs = (overrides: Partial<FieldsEvalArgs>): FieldsEvalArgs => ({
    mode: 'htf',
    set: null,
    bars: null,
    out: '',
    arm: 'test',
    run: null,
    before: null,
    memberRun: null,
    labels: null,
    skills: '/skills',
    limit: null,
    gate: null,
    allowSkippedCases: false,
    noisePp: 0,
    tier: null,
    baseline: null,
    repeat: null,
    lang: 'ko',
    restate: false,
    legacyZone: false,
    timeframe: null,
    benchmarkBars: null,
    stride: 1,
    selfCheck: false,
    ...overrides,
});

type Damage = (kind: 'daily' | 'weekly', text: string) => string;

/** A render that prints what a correct core would print; `damage` edits it per timeframe. */
function fakeRender(
    set: ReturnType<typeof loadSetData>,
    damage: Damage = (_, t) => t,
    /** Whether the prompt carries the two registered blocks (core-2) or not (core-1 and before). */
    blocks = true
): FieldsEvalDeps['render'] {
    return async (input: RenderInput): Promise<Rendered> => {
        const timeframe = input.timeframe ?? '1Day';
        const weekly = String(timeframe) === '1Week';
        return {
            catalog: [
                { name: 'RSI', group: 'g', alwaysOn: true, injected: true },
            ],
            samples: input.cases.flatMap(replayCase =>
                (input.tiers ?? (['free', 'member'] as const)).map(tier => {
                    const stored = set.storedOf.get(replayCase.symbol);
                    const data: HtfCaseData = {
                        replayCase,
                        bars: stored?.bars ?? [],
                        benchmarks: input.benchmarks ?? new Map(),
                    };
                    const tf = weekly ? '1Week' : '1Day';
                    const text = promptOf(
                        weekly
                            ? 'Timeframe: Weekly\nTimeframe interpretation: Weekly chart built by SIGLENS from daily bars: each bar is one ISO week (Monday start).'
                            : 'Timeframe: Daily\nTimeframe interpretation: Daily chart.',
                        weeklyRowsSection(data),
                        blocks
                            ? `${higherBlockText(data, tf)}\n${backdropBlockText(data)}`
                            : '',
                        '## Fear & Greed Index (Reference)\nIndex 55'
                    );
                    return {
                        caseId: replayCase.caseId,
                        tier,
                        stable: '### RSI [x]',
                        dynamic: damage(weekly ? 'weekly' : 'daily', text),
                    };
                })
            ),
        };
    };
}

function makeDeps(
    render: FieldsEvalDeps['render'],
    gitSha = 'abc123',
    skills = 'skills-sha'
): FieldsEvalDeps & { lines: () => string } {
    const log = vi.fn<(line: string) => void>();
    return {
        log,
        gitSha: () => gitSha,
        dirtyDiffSha256: () => null,
        skillsSha256: () => skills,
        render,
        schemaAsksIndicatorResults: async () => false,
        lines: () => log.mock.calls.map(([line]) => line).join('\n'),
    };
}

interface SummaryFile {
    summary: {
        htf?: Record<
            string,
            {
                samples: number;
                passed: number;
                failed: number;
                notComputable: number;
            } | null
        >;
        k1?: { samples: number; failed: number };
    };
    gates: { id: string; pass: boolean | null }[];
}
const readSummary = (out: string): SummaryFile =>
    JSON.parse(readFileSync(join(out, 'summary.json'), 'utf-8'));
const gateOf = (s: SummaryFile, id: string): boolean | null | undefined =>
    s.gates.find(g => g.id === id)?.pass;

describe('parseFieldsEvalArgs: the WP-19 modes', () => {
    const parse = (...argv: string[]) =>
        parseFieldsEvalArgs(['--out', '/o', ...argv]);

    it('htf needs a set and a skills directory and reads its options', () => {
        expect(() => parse('--mode', 'htf', '--set', '/s')).toThrow(
            /--set and --skills/
        );
        const args = parse(
            '--mode',
            'htf',
            '--set',
            '/s',
            '--skills',
            '/a/skills',
            '--timeframe',
            '1Week',
            '--benchmark-bars',
            '/b',
            '--baseline',
            '/base',
            '--tier',
            'free'
        );
        expect(args).toMatchObject({
            timeframe: '1Week',
            benchmarkBars: '/b',
            baseline: '/base',
            tier: 'free',
        });
        expect(() =>
            parse(
                '--mode',
                'htf',
                '--set',
                '/s',
                '--skills',
                '/k',
                '--before',
                '/b'
            )
        ).toThrow(/do not apply/);
    });

    it('refuses a timeframe core does not know, naming the known ones', () => {
        expect(() =>
            parse(
                '--mode',
                'htf',
                '--set',
                '/s',
                '--skills',
                '/k',
                '--timeframe',
                '3Week'
            )
        ).toThrow(/must be one of .*1Day/);
    });

    it('keeps the options of one mode out of the others', () => {
        expect(() =>
            parse(
                '--mode',
                'gating',
                '--set',
                '/s',
                '--skills',
                '/k',
                '--timeframe',
                '1Day'
            )
        ).toThrow(/htf only/);
        expect(() =>
            parse(
                '--mode',
                'gating',
                '--set',
                '/s',
                '--skills',
                '/k',
                '--benchmark-bars',
                '/b'
            )
        ).toThrow(/htf only/);
        expect(() =>
            parse(
                '--mode',
                'zone',
                '--set',
                '/s',
                '--run',
                '/r',
                '--stride',
                '3'
            )
        ).toThrow(/htf-forward only/);
        expect(() =>
            parse(
                '--mode',
                'zone',
                '--set',
                '/s',
                '--run',
                '/r',
                '--baseline',
                '/b'
            )
        ).toThrow('zone: --baseline applies to gating and htf only');
        expect(() =>
            parse(
                '--mode',
                'zone',
                '--set',
                '/s',
                '--run',
                '/r',
                '--tier',
                'free'
            )
        ).toThrow(
            'zone: --tier applies to gating, htf and weekly-hygiene only'
        );
    });

    it('htf-forward takes a set and a stride only', () => {
        expect(() => parse('--mode', 'htf-forward')).toThrow(
            /--set is required/
        );
        expect(() =>
            parse('--mode', 'htf-forward', '--set', '/s', '--skills', '/k')
        ).toThrow(/only --set/);
        expect(
            parse('--mode', 'htf-forward', '--set', '/s', '--stride', '5')
                .stride
        ).toBe(5);
    });

    it('weekly-hygiene needs a set and skills, and the two runs together', () => {
        expect(() => parse('--mode', 'weekly-hygiene', '--set', '/s')).toThrow(
            /--set and --skills/
        );
        expect(() =>
            parse(
                '--mode',
                'weekly-hygiene',
                '--set',
                '/s',
                '--skills',
                '/k',
                '--run',
                '/r'
            )
        ).toThrow(
            'weekly-hygiene: --run (weekly) and --before (daily) must be given together'
        );
        expect(
            parse(
                '--mode',
                'weekly-hygiene',
                '--set',
                '/s',
                '--skills',
                '/k',
                '--run',
                '/r',
                '--before',
                '/b'
            ).before
        ).toBe('/b');
    });

    it('validates the gate ids of the new modes', () => {
        expect(() =>
            parse(
                '--mode',
                'htf',
                '--set',
                '/s',
                '--skills',
                '/k',
                '--gate',
                'K1'
            )
        ).toThrow(/not in mode htf/);
        expect(
            parse(
                '--mode',
                'weekly-hygiene',
                '--set',
                '/s',
                '--skills',
                '/k',
                '--gate',
                'K1,K2'
            ).gate
        ).toEqual(['K1', 'K2']);
    });
});

describe('benchmarkBarsOf', () => {
    it("holds the set's symbols and the sidecar files, and refuses a duplicate or an empty file", () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const all = benchmarkBarsOf(set, world.benchDir);
        expect([...all.keys()].toSorted()).toEqual([
            '005930.KS',
            'KQ11',
            'KS11',
            'NVDA',
            'SPY',
        ]);
        expect(benchmarkBarsOf(set, null).has('KS11')).toBe(false);
        writeBarsDir(join(world.dir, 'dup'), [
            {
                symbol: 'SPY',
                bars: tradingBars({
                    symbol: 'SPY',
                    startIso: '2020-01-02',
                    count: 5,
                }),
            },
        ]);
        expect(() => benchmarkBarsOf(set, join(world.dir, 'dup'))).toThrow(
            /already a symbol of the set/
        );
        mkdirSync(join(world.dir, 'empty'));
        writeFileSync(
            join(world.dir, 'empty', 'X.json'),
            JSON.stringify({ bars: [] })
        );
        expect(() => benchmarkBarsOf(set, join(world.dir, 'empty'))).toThrow(
            /has no bars/
        );
    });

    describe('fails closed on bars that are not bars or not oldest first', () => {
        const goodBar = (time: number) => ({
            time,
            open: 1,
            high: 2,
            low: 0.5,
            close: 1.5,
            volume: 10,
        });
        const sidecar = (world: World, bars: readonly unknown[]): string => {
            const dir = join(world.dir, 'sidecar');
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'IDX.json'), JSON.stringify({ bars }));
            return dir;
        };

        it('accepts strictly ascending finite bars', () => {
            const world = makeWorld();
            const set = loadSetData(world.setDir);
            const dir = sidecar(world, [goodBar(1), goodBar(2)]);
            expect(benchmarkBarsOf(set, dir).get('IDX')).toHaveLength(2);
        });

        it.each([
            [
                'a duplicate time',
                [goodBar(2), goodBar(2)],
                /strictly ascending \(bar 1 does not follow bar 0\)/,
            ],
            [
                'a descending time',
                [goodBar(1), goodBar(3), goodBar(2)],
                /strictly ascending \(bar 2 does not follow bar 1\)/,
            ],
            [
                'a missing field',
                [goodBar(1), { time: 2, open: 1 }],
                /bar 1 .*\("high"\)/,
            ],
            [
                'a non-numeric field',
                [{ ...goodBar(1), close: '1.5' }],
                /bar 0 .*\("close"\)/,
            ],
            [
                'a null field (NaN stored as JSON)',
                [{ ...goodBar(1), volume: null }],
                /bar 0 .*\("volume"\)/,
            ],
            [
                'an entry that is not an object',
                [goodBar(1), 7],
                /bar 1 is not a bar/,
            ],
        ] as const)('refuses %s in a sidecar file', (_name, bars, message) => {
            const world = makeWorld();
            const set = loadSetData(world.setDir);
            expect(() => benchmarkBarsOf(set, sidecar(world, bars))).toThrow(
                message
            );
        });

        it("refuses the set's own bars when they are out of order", () => {
            const world = makeWorld();
            const set = loadSetData(world.setDir);
            const stored = set.storedOf.get('NVDA');
            if (stored === undefined) throw new Error('NVDA missing');
            const swapped = { ...stored, bars: stored.bars.toReversed() };
            const broken = {
                ...set,
                storedOf: new Map([...set.storedOf, ['NVDA', swapped]]),
            };
            expect(() => benchmarkBarsOf(broken, null)).toThrow(
                /set bars of NVDA: bar times must be strictly ascending/
            );
        });
    });
});

describe('riskLevelPairs', () => {
    const resultOf = (caseId: string, riskLevel: unknown, repeat = 1) => ({
        caseId,
        symbol: 'X',
        asOf: '2024-01-02',
        repeat,
        unfilteredResult: { riskLevel },
        promptVersion: null,
        promptHashes: null,
        promptDynamic: null,
        usage: null,
        exchangeCount: 0,
        latencyMs: 0,
        error: null,
    });
    const runOf = (results: RunData['results']): RunData => ({
        dir: '/r',
        meta: {} as RunData['meta'],
        results,
        labels: null,
    });

    it('pairs the first repeat of each weekly case with the daily case of the same id', () => {
        const weekly = runOf([
            resultOf('a', 'high'),
            resultOf('a', 'low', 2),
            resultOf('b', 'low'),
            resultOf('c', 'medium'),
        ]);
        const daily = runOf([resultOf('a', 'high'), resultOf('b', 'high')]);
        expect(riskLevelPairs(weekly, daily)).toEqual([
            { caseId: 'a', weekly: 'high', daily: 'high' },
            { caseId: 'b', weekly: 'low', daily: 'high' },
            { caseId: 'c', weekly: 'medium', daily: undefined },
        ]);
    });

    it('reads the daily run once, not once per case', () => {
        const weekly = runOf(
            Array.from({ length: 50 }, (_, i) => resultOf(`c${i}`, 'low'))
        );
        const reads = vi.fn();
        const daily = {
            ...runOf([]),
            get results() {
                reads();
                return [resultOf('c0', 'low')];
            },
        };
        riskLevelPairs(weekly, daily);
        expect(reads).toHaveBeenCalledTimes(1);
    });
});

describe('runFieldsEval: htf', () => {
    const run = async (
        world: World,
        overrides: Partial<FieldsEvalArgs>,
        render: FieldsEvalDeps['render'],
        name = 'out',
        sha = 'code-current',
        skills = 'skills-sha'
    ) => {
        const deps = makeDeps(render, sha, skills);
        const out = join(world.dir, name);
        const code = await runFieldsEval(
            baseArgs({
                set: world.setDir,
                out,
                benchmarkBars: world.benchDir,
                limit: 6,
                ...overrides,
            }),
            deps
        );
        return { code, out, deps };
    };

    it('passes a daily render whose block and backdrop are what the stored bars give, and exits 0 under --gate', async () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const { code, out } = await run(
            world,
            { gate: ['H1', 'H4', 'H4k'] },
            fakeRender(set)
        );
        expect(code).toBe(0);
        const s = readSummary(out);
        expect(gateOf(s, 'H1')).toBe(true);
        expect(gateOf(s, 'H4')).toBe(true);
        expect(gateOf(s, 'H4k')).toBe(true);
        // weekly gates do not apply to a daily render: not computable, never a pass
        expect(gateOf(s, 'W1')).toBeNull();
    });

    it('fails H1 and H4 when one printed figure is wrong, and exits 2', async () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const damage: Damage = (_, text) =>
            text
                .replace(/RSI\(14\) \S+/, 'RSI(14) 1.0;')
                .replace(/last 20 sessions: \S+%/, 'last 20 sessions: +99.9%');
        const { code, out } = await run(
            world,
            { gate: ['H1', 'H4'] },
            fakeRender(set, damage)
        );
        expect(code).toBe(2);
        const s = readSummary(out);
        expect(gateOf(s, 'H1')).toBe(false);
        expect(gateOf(s, 'H4')).toBe(false);
    });

    it('cannot judge the Korean backdrop without its index bars', async () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const { code, out } = await run(
            world,
            { benchmarkBars: null, gate: ['H4k'] },
            fakeRender(set)
        );
        expect(code).toBe(2);
        expect(gateOf(readSummary(out), 'H4k')).toBeNull();
    });

    it('measures a weekly render (W1, W2, H1, H4) once core lists the timeframe', async () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const { code, out } = await run(
            world,
            { timeframe: '1Week', gate: ['W1', 'W2', 'H1', 'H4', 'H4k'] },
            fakeRender(set)
        );
        expect(code).toBe(0);
        const s = readSummary(out);
        ['W1', 'W2', 'H1', 'H4', 'H4k'].forEach(id =>
            expect(gateOf(s, id)).toBe(true)
        );
        const rows = readFileSync(join(out, 'rows.jsonl'), 'utf-8')
            .trim()
            .split('\n')
            .map(l => JSON.parse(l));
        expect(rows).toHaveLength(12);
        expect(rows[0]).toMatchObject({ timeframe: '1Week' });
    });

    it('fails W1 when a weekly row differs and W2 when the tag is missing', async () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const damage: Damage = (_, text) =>
            text
                .replace(/ \(week in progress[^)]*\)/, '')
                .replace(/(\[ts:\d+\][^\n]*? L:\S+ )C:\S+/, '$1C:1.00');
        // enough cases that some of them sit in an unfinished week
        const { out } = await run(
            world,
            { timeframe: '1Week', limit: 24, gate: ['W1', 'W2'] },
            fakeRender(set, damage)
        );
        const s = readSummary(out);
        expect(gateOf(s, 'W1')).toBe(false);
        expect(gateOf(s, 'W2')).toBe(false);
    });

    it('core-1 stage: a render without the blocks is judged by H2a, H2b is deferred', async () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const before = await run(
            world,
            {},
            fakeRender(set, undefined, false),
            'before',
            'code-before'
        );
        expect(before.code).toBe(0);
        const after = await run(
            world,
            { baseline: before.out, gate: 'all' },
            fakeRender(set, undefined, false),
            'after'
        );
        const summary = readSummary(after.out) as SummaryFile & {
            deferred: { id: string; reason: string }[];
        };
        expect(gateOf(summary, 'H2a')).toBe(true);
        expect(summary.deferred.find(d => d.id === 'H2b')?.reason).toBe(
            'identical to H2a before the blocks exist'
        );
        // the render has no block, so H1 and H4 fail by design here: this stage gates H2a
        const gated = await run(
            world,
            { baseline: before.out, gate: ['H2a'] },
            fakeRender(set, undefined, false),
            'gated'
        );
        expect(gated.code).toBe(0);
        const changed = await run(
            world,
            { baseline: before.out, gate: ['H2a'] },
            fakeRender(
                set,
                (_, t) => `${t}
extra`,
                false
            ),
            'changed'
        );
        expect(changed.code).toBe(2);
    });

    it('core-2 stage: a render with the blocks is judged by H2b, H2a is deferred, and a correct baseline exits 0 under --gate all', async () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const before = await run(
            world,
            {},
            fakeRender(set, undefined, false),
            'before',
            'code-before'
        );
        const after = await run(
            world,
            { baseline: before.out, gate: 'all' },
            fakeRender(set),
            'after'
        );
        const summary = readSummary(after.out) as SummaryFile & {
            deferred: { id: string; reason: string }[];
        };
        expect(after.code).toBe(0);
        expect(gateOf(summary, 'H2b')).toBe(true);
        expect(summary.deferred.map(d => d.id)).toEqual([
            'W1',
            'W2',
            'H1b',
            'H2a',
        ]);
        expect(summary.deferred.find(d => d.id === 'H2a')?.reason).toBe(
            'render carries the registered blocks: H2b applies'
        );
        const damaged = await run(
            world,
            { baseline: before.out, gate: ['H2b'] },
            fakeRender(set, (_, t) => `${t}\nextra`),
            'damaged'
        );
        expect(damaged.code).toBe(2);
        await expect(
            run(
                world,
                { baseline: before.out, limit: 4 },
                fakeRender(set),
                'other'
            )
        ).rejects.toThrow(/not comparable/);
        expect(() =>
            readHtfBaseline(world.setDir, {
                fingerprint: 'x',
                timeframe: '1Day',
                tiers: ['free'],
                limit: null,
                current: {
                    coreGitSha: 'x',
                    dirtyDiffSha256: null,
                    skillsSha256: 'x',
                },
            })
        ).toThrow();
    });

    it('H2b is not computable against a baseline that already carries the blocks', async () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const before = await run(
            world,
            {},
            fakeRender(set),
            'before',
            'code-before'
        );
        const after = await run(
            world,
            { baseline: before.out, gate: ['H2b'] },
            fakeRender(set),
            'after'
        );
        expect(after.code).toBe(2);
        expect(gateOf(readSummary(after.out), 'H2b')).toBeNull();
        expect(JSON.stringify(readSummary(after.out).gates)).toContain(
            'baseline already carries the registered blocks'
        );
    });

    it('refuses a baseline made by the same code, and prints both identities beside H2a and H2b', async () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const first = await run(world, {}, fakeRender(set), 'first', 'code-a');
        const same = run(
            world,
            { baseline: first.out },
            fakeRender(set),
            'second',
            'code-a'
        );
        await expect(same).rejects.toThrow(
            /made by the same code as this run \(code-a/
        );
        // a change of the skills alone is a different identity, so it is allowed
        const skillsOnly = await run(
            world,
            { baseline: first.out, gate: ['H2a'] },
            fakeRender(set),
            'skills-only',
            'code-a',
            'skills-two'
        );
        expect(skillsOnly.deps.lines()).toMatch(
            /baseline: code-a, skills skills-sha/
        );
        const other = await run(
            world,
            { baseline: first.out, gate: ['H2a'] },
            fakeRender(set),
            'third',
            'code-b'
        );
        expect(other.code).toBe(0);
        expect(other.deps.lines()).toMatch(
            /htf identity: current: code-b, skills skills-sha; baseline: code-a, skills skills-sha/
        );
        const gate = JSON.parse(
            readFileSync(join(other.out, 'summary.json'), 'utf-8')
        ).gates.find((g: { id: string }) => g.id === 'H2a');
        expect(gate.value).toContain('baseline: code-a');
        const inputs = JSON.parse(
            readFileSync(join(other.out, 'run.json'), 'utf-8')
        ).inputs;
        expect(inputs.identity).toEqual({
            coreGitSha: 'code-b',
            dirtyDiffSha256: null,
            skillsSha256: 'skills-sha',
        });
        expect(inputs.baselineIdentity.coreGitSha).toBe('code-a');
    });

    it('refuses a baseline that records no identity', async () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const first = await run(world, {}, fakeRender(set), 'first', 'code-a');
        const runJson = JSON.parse(
            readFileSync(join(first.out, 'run.json'), 'utf-8')
        );
        delete runJson.coreGitSha;
        writeFileSync(join(first.out, 'run.json'), JSON.stringify(runJson));
        await expect(
            run(
                world,
                { baseline: first.out },
                fakeRender(set),
                'second',
                'code-b'
            )
        ).rejects.toThrow(/records no code identity/);
    });

    it('resolves --gate all by timeframe and supplied inputs, and records what it left out', async () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const daily = await run(
            world,
            { benchmarkBars: null, gate: 'all' },
            fakeRender(set),
            'daily'
        );
        // a daily render with no baseline, run or KR index bars decides H1 and H4 only
        expect(daily.code).toBe(0);
        const dailySummary = readSummary(daily.out) as SummaryFile & {
            deferred: { id: string; reason: string }[];
        };
        expect(dailySummary.deferred.map(d => d.id)).toEqual([
            'W1',
            'W2',
            'H1b',
            'H2a',
            'H2b',
            'H4k',
        ]);
        expect(dailySummary.deferred.find(d => d.id === 'H4k')?.reason).toBe(
            'no KR index bars (orchestrator decision 2026-11-22; final combined A/B)'
        );
        expect(daily.deps.lines()).toMatch(
            /--gate all left out: W1 .*H4k \(no KR index bars/
        );
        const runJson = JSON.parse(
            readFileSync(join(daily.out, 'run.json'), 'utf-8')
        );
        expect(runJson.deferred).toHaveLength(6);

        // with a baseline the identity gate rejoins; a weekly render adds W1 and W2
        const base = await run(
            world,
            { timeframe: '1Week' },
            fakeRender(set, undefined, false),
            'wbase',
            'code-before'
        );
        const weekly = await run(
            world,
            { timeframe: '1Week', baseline: base.out, gate: 'all' },
            fakeRender(set),
            'weekly'
        );
        const weeklySummary = readSummary(weekly.out) as SummaryFile & {
            deferred: { id: string }[];
        };
        expect(weeklySummary.deferred.map(d => d.id)).toEqual(['H1b', 'H2a']);
        expect(weekly.deps.lines()).not.toMatch(/H4k \(/);
        expect(weekly.code).toBe(0);
    });

    it('applies H4 at 1Week: a weekly analysis prints the backdrop line, and a wrong or missing one fails it', async () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const ok = await run(
            world,
            { timeframe: '1Week', gate: ['H4', 'H4k'] },
            fakeRender(set)
        );
        expect(ok.code).toBe(0);
        expect(gateOf(readSummary(ok.out), 'H4')).toBe(true);
        const damage: Damage = (_, text) =>
            text.replace(/last 60 sessions: \S+%/, 'last 60 sessions: +99.9%');
        const bad = await run(
            world,
            { timeframe: '1Week', gate: ['H4'] },
            fakeRender(set, damage),
            'bad'
        );
        expect(bad.code).toBe(2);
        const none = await run(
            world,
            { timeframe: '1Week', gate: ['H4'] },
            fakeRender(set, (_, t) =>
                t.replace(/### Market Backdrop[\s\S]*?(?=\n\n## )/, '')
            ),
            'none'
        );
        expect(none.code).toBe(2);
    });

    it('--self-check renders twice and reports the hash equality without gating on it', async () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const stable = await run(
            world,
            { selfCheck: true, limit: 4 },
            fakeRender(set),
            'stable'
        );
        const summary = readSummary(stable.out) as SummaryFile & {
            summary: {
                htf: { selfCheck: { samples: number; identical: number } };
            };
        };
        expect(summary.summary.htf.selfCheck).toMatchObject({
            samples: 8,
            identical: 8,
        });
        expect(stable.deps.lines()).toContain(
            'htf self-check: 8/8 samples hash alike'
        );
        const calls = { n: 0 };
        const render = fakeRender(set);
        const drifting: FieldsEvalDeps['render'] = async input => {
            const rendered = await render(input);
            calls.n += 1;
            return calls.n === 2
                ? {
                      ...rendered,
                      samples: rendered.samples.map(s => ({
                          ...s,
                          dynamic: `${s.dynamic} x`,
                      })),
                  }
                : rendered;
        };
        const drift = await run(
            world,
            { selfCheck: true, limit: 4, gate: ['H1'] },
            drifting,
            'drift'
        );
        expect(drift.deps.lines()).toContain(
            'htf self-check: 0/8 samples hash alike'
        );
        expect(drift.code).toBe(0);
        const off = await run(world, { limit: 4 }, fakeRender(set), 'off');
        expect(
            (
                readSummary(off.out) as SummaryFile & {
                    summary: { htf: { selfCheck: unknown } };
                }
            ).summary.htf.selfCheck
        ).toBeNull();
    });

    it('refuses a run of another timeframe', async () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const dailyRun = writeRiskRun(
            world,
            'dailyRun',
            '1Day',
            6,
            () => 'low'
        );
        await expect(
            run(world, { timeframe: '1Week', run: dailyRun }, fakeRender(set))
        ).rejects.toThrow(/dailyRun is a 1Day run, not 1Week/);
    });
});

describe('runFieldsEval: weekly-hygiene', () => {
    it('measures hygiene on a render and fails a daily-only sentence', async () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const base = (overrides: Partial<FieldsEvalArgs>) =>
            baseArgs({
                mode: 'weekly-hygiene',
                set: world.setDir,
                limit: 4,
                tier: 'member',
                ...overrides,
            });
        // the fake render prints neither horizons nor pivots, so only what it prints can pass
        const clean = makeDeps(fakeRender(set));
        const code = await runFieldsEval(
            base({ out: join(world.dir, 'k'), gate: ['K3'] }),
            clean
        );
        expect(code).toBe(0);
        const s = readSummary(join(world.dir, 'k'));
        expect(gateOf(s, 'K3')).toBe(true);
        expect(s.summary.k1?.samples).toBe(4);
        const dirty = makeDeps(
            fakeRender(set, (kind, text) =>
                kind === 'weekly' ? `${text}\n- VWAP: 12.3` : text
            )
        );
        const dirtyCode = await runFieldsEval(
            base({ out: join(world.dir, 'k2'), gate: ['K1'] }),
            dirty
        );
        expect(dirtyCode).toBe(2);
        expect(
            readSummary(join(world.dir, 'k2')).gates.find(g => g.id === 'K1')
                ?.pass
        ).toBe(false);
        expect(gateOf(readSummary(join(world.dir, 'k2')), 'K2')).toBeNull();
    });
});

/** A run of the world's first `limit` cases at `timeframe`, each result carrying `riskLevel(caseId)`. */
function writeRiskRun(
    world: World,
    name: string,
    timeframe: '1Day' | '1Week',
    limit: number,
    riskLevel: (caseId: string) => string
): string {
    const set = loadSetData(world.setDir);
    const dir = join(world.dir, name);
    mkdirSync(join(dir, 'results'), { recursive: true });
    const meta = {
        setId: 'replay-v1',
        setBarsSha256: barsFingerprint(set.manifest),
        coreGitSha: 'a',
        promptTemplateVersion: 'p',
        model: 'm',
        tier: 'member',
        timeframe,
        skillsSha256: 'x',
        repeat: 1,
        subset: null,
        limit,
        startedAt: 'x',
    };
    writeFileSync(join(dir, 'run.json'), JSON.stringify(meta));
    selectRunCases(set.manifest, { subset: null, limit }).forEach((c, i) =>
        writeFileSync(
            join(dir, 'results', `r${i}.json`),
            JSON.stringify({
                caseId: c.caseId,
                symbol: c.symbol,
                asOf: c.asOf,
                repeat: 1,
                unfilteredResult: { riskLevel: riskLevel(c.caseId) },
                promptVersion: 'p',
                promptHashes: null,
                promptDynamic: null,
                usage: null,
                exchangeCount: 1,
                latencyMs: 1,
                error: null,
            })
        )
    );
    return dir;
}

describe('runFieldsEval: weekly-hygiene K2 and htf-forward', () => {
    const hygiene = (
        world: World,
        overrides: Partial<FieldsEvalArgs>,
        out: string
    ) =>
        runFieldsEval(
            baseArgs({
                mode: 'weekly-hygiene',
                set: world.setDir,
                limit: 4,
                tier: 'member',
                out,
                gate: ['K2'],
                ...overrides,
            }),
            makeDeps(fakeRender(loadSetData(world.setDir)))
        );

    it('compares the riskLevel of a weekly and a daily run case by case', async () => {
        const world = makeWorld();
        const weekly = writeRiskRun(world, 'wk', '1Week', 4, () => 'high');
        const same = writeRiskRun(world, 'dy', '1Day', 4, () => 'high');
        const other = writeRiskRun(world, 'dy2', '1Day', 4, id =>
            id.startsWith('NVDA') ? 'low' : 'high'
        );
        expect(
            await hygiene(
                world,
                { run: weekly, before: same },
                join(world.dir, 'k2a')
            )
        ).toBe(0);
        expect(
            await hygiene(
                world,
                { run: weekly, before: other },
                join(world.dir, 'k2b')
            )
        ).toBe(2);
        await expect(
            hygiene(
                world,
                { run: same, before: weekly },
                join(world.dir, 'k2c')
            )
        ).rejects.toThrow(/1Week run and --before a 1Day/);
        await expect(
            hygiene(
                world,
                {
                    run: weekly,
                    before: writeRiskRun(world, 'dy3', '1Day', 3, () => 'high'),
                },
                join(world.dir, 'k2d')
            )
        ).rejects.toThrow(/not comparable/);
    });

    it("htf-forward writes the case table and the forward measure, with the brief's figures beside them", async () => {
        const world = makeWorld();
        const out = join(world.dir, 'fwd');
        const deps = makeDeps(async () => {
            throw new Error('no render');
        });
        const code = await runFieldsEval(
            baseArgs({
                mode: 'htf-forward',
                set: world.setDir,
                skills: null,
                out,
                stride: 15,
                gate: ['M1'],
            }),
            deps
        );
        // an aligned cell is empty in this constructed world, so M1 cannot be
        // computed: a gate that cannot be computed exits 2, never 0
        expect(code).toBe(2);
        expect(deps.lines()).toContain('M1 NOT COMPUTABLE');
        const summary = JSON.parse(
            readFileSync(join(out, 'summary.json'), 'utf-8')
        ).summary;
        expect(summary.caseTable.cases).toBeGreaterThan(0);
        expect(summary.forward.days).toBeGreaterThan(0);
        expect(summary.reproduction.casesInProgress.brief).toBe(661);
        expect(
            summary.reproduction.differentLabelShare.measured
        ).toBeGreaterThanOrEqual(0);
        expect(
            readFileSync(join(out, 'rows.jsonl'), 'utf-8').trim().split('\n')
                .length
        ).toBe(summary.caseTable.cases);
        expect(readFileSync(join(out, 'run.json'), 'utf-8')).toContain(
            '"stride": 15'
        );
    });
});
