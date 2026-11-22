import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    assertComparableRuns,
    defaultDeps,
    loadRunData,
    liveSkillsInput,
    loadSetData,
    parseFieldsEvalArgs,
    readBaselineRows,
    runFieldsEval,
    splitCsvLine,
    trendRowsOfCsv,
    type FieldsEvalArgs,
    type FieldsEvalDeps,
} from '../../../../scripts/replay/analysisFieldsEval';
import {
    dynamicPrompt,
    STABLE,
    PATTERN_GUIDE_A,
    PATTERN_GUIDE_B,
    CANDLE_GUIDE_DOJI,
    CATALOG,
} from './wp16Fixtures';
import { wilderAtrSeries } from '../../../../scripts/replay/analysisFieldsEvalCompute';
import { renderWithCore } from '../../../../scripts/replay/analysisFieldsEvalRender';
import type {
    CatalogSkill,
    PromptSample,
    SkillTier,
} from '../../../../scripts/replay/analysisFieldsEvalSkills';
import { writeSet } from '../../../../scripts/replay/buildSet';
import { REPO_ROOT, sha256Hex } from '../../../../scripts/replay/fsUtil';
import { selectRunCases } from '../../../../scripts/replay/run';
import { barsFingerprint } from '../../../../scripts/replay/setIntegrity';
import type {
    CaseResultFile,
    LabelRow,
    ReplayManifest,
    RunMeta,
    StoredBars,
} from '../../../../scripts/replay/types';
import {
    makeRow,
    makeTempDir,
    tradingBars,
    writeBarsDir,
} from './replayFixtures';

const temps = new Set<() => void>();
afterEach(() => {
    [...temps].forEach(remove => remove());
    temps.clear();
    vi.restoreAllMocks();
});

interface World {
    dir: string;
    setDir: string;
    manifest: ReplayManifest;
    stored: ReadonlyMap<string, StoredBars>;
}

// `JSON.parse` returns `any`, so these typed returns need no cast.
const readStoredBars = (path: string): StoredBars =>
    JSON.parse(readFileSync(path, 'utf-8'));
const readManifest = (path: string): ReplayManifest =>
    JSON.parse(readFileSync(path, 'utf-8'));

/** A frozen two-symbol set (one US, one KR) written by the real `writeSet`. */
function makeWorld(): World {
    const { dir, remove } = makeTempDir();
    temps.add(remove);
    const srcDir = join(dir, 'src');
    const symbols = ['NVDA', '005930.KS'];
    writeBarsDir(
        srcDir,
        symbols.map(symbol => ({
            symbol,
            bars: tradingBars({
                symbol,
                startIso: '2020-01-02',
                count: 700,
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
    const stored = new Map(
        symbols.map(symbol => [
            symbol,
            readStoredBars(join(setDir, manifest.bars[symbol].file)),
        ])
    );
    return { dir, setDir, manifest, stored };
}

type ResultBody = Record<string, unknown>;

interface RunOptions {
    name: string;
    tier?: string;
    /** Result body of a case; `null` writes a failed result. */
    body?: (c: {
        symbol: string;
        asOf: string;
        close: number;
    }) => ResultBody | null;
    meta?: Partial<RunMeta>;
    /** Cases to write results for (default: all). */
    take?: number;
    /** Write results for these case ids only (applied before `take`). */
    only?: readonly string[];
    extraResults?: readonly Partial<CaseResultFile>[];
    labels?: (rows: readonly CaseResultFile[]) => readonly LabelRow[];
    usage?: CaseResultFile['usage'];
    /** The stored dynamic prompt (default: a short fixed text). */
    prompt?: string;
    /** The stored prompt hashes (default: none). */
    hashes?: CaseResultFile['promptHashes'];
}

/** Writes `<dir>/<name>` as a run of the world's set and returns its path. */
function writeRun(world: World, options: RunOptions): string {
    const runDir = join(world.dir, options.name);
    mkdirSync(join(runDir, 'results'), { recursive: true });
    const meta: RunMeta = {
        setId: 'replay-v1',
        setBarsSha256: barsFingerprint(world.manifest),
        coreGitSha: 'abc',
        promptTemplateVersion: 'p34',
        model: 'deepseek-v4.1-flash',
        tier: options.tier ?? 'member',
        skillsSha256: 'x',
        repeat: 1,
        subset: null,
        limit: null,
        startedAt: '2026-11-21T00:00:00Z',
        ...options.meta,
    };
    writeFileSync(join(runDir, 'run.json'), JSON.stringify(meta));
    const results = world.manifest.cases
        .filter(
            c => options.only === undefined || options.only.includes(c.caseId)
        )
        .slice(0, options.take ?? world.manifest.cases.length)
        .map((c): CaseResultFile => {
            const bars = world.stored.get(c.symbol)?.bars ?? [];
            const asOfTime = Date.parse(`${c.asOf}T00:00:00Z`) / 1000;
            const bar = bars.find(b => b.time === asOfTime);
            const close = bar?.close ?? 0;
            const body = (options.body ?? defaultBody)({
                symbol: c.symbol,
                asOf: c.asOf,
                close,
            });
            return {
                caseId: c.caseId,
                symbol: c.symbol,
                asOf: c.asOf,
                repeat: 1,
                unfilteredResult:
                    body === null
                        ? null
                        : { dataAsOf: { barTime: asOfTime, close }, ...body },
                promptVersion: 'p34',
                promptHashes: options.hashes ?? null,
                promptDynamic: options.prompt ?? 'support 100.00',
                usage: options.usage ?? {
                    inputTokens: 1000,
                    outputTokens: 200,
                    cachedTokens: 400,
                },
                exchangeCount: 1,
                latencyMs: 100,
                error: body === null ? 'failed' : null,
            };
        });
    [...results, ...(options.extraResults ?? [])].forEach((result, i) =>
        writeFileSync(
            join(runDir, 'results', `r${i}.json`),
            JSON.stringify(result)
        )
    );
    if (options.labels !== undefined) {
        writeFileSync(
            join(runDir, 'labels.jsonl'),
            `${options
                .labels(results)
                .map(r => JSON.stringify(r))
                .join('\n')}\n`
        );
    }
    return runDir;
}

/** A neutral trend and a plan whose zone holds the close, with a stop 4% under it. */
function defaultBody(c: { close: number }): ResultBody {
    return {
        trend: 'neutral',
        riskLevel: 'medium',
        summary: '조용한 장입니다.',
        keyLevels: {
            support: [{ price: c.close * 0.97 }],
            resistance: [{ price: c.close * 1.05 }],
        },
        actionRecommendation: {
            entryRecommendation: 'wait',
            entryPrices: [c.close * 0.99, c.close * 1.0],
            stopLoss: c.close * 0.96,
            takeProfitPrices: [c.close * 1.1],
            planCheck: { riskRewardAtEntry: 2 },
        },
    };
}

/** One headline label row per result, with grounded plan prices. */
const labelsOf = (results: readonly CaseResultFile[]): readonly LabelRow[] =>
    results.map(r =>
        makeRow({
            caseId: r.caseId,
            symbol: r.symbol,
            market: r.symbol.endsWith('.KS') ? 'kr' : 'us',
            asOf: r.asOf,
            provenance: {
                checked: { plan: 4, other: 0, keyPrices: 0 },
                ungrounded: { plan: 0, other: 0, keyPrices: 0 },
            },
        })
    );

const baseArgs = (overrides: Partial<FieldsEvalArgs>): FieldsEvalArgs => ({
    mode: 'trend',
    set: null,
    bars: null,
    out: '',
    arm: 'test',
    run: null,
    before: null,
    memberRun: null,
    labels: null,
    skills: null,
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
    ...overrides,
});

const noRender = vi.fn(async () => {
    throw new Error('render must not be called');
});

function makeDeps(
    render: FieldsEvalDeps['render'] = noRender
): FieldsEvalDeps & { lines: () => string } {
    const log = vi.fn<(line: string) => void>();
    return {
        log,
        gitSha: () => 'abc123+dirty',
        dirtyDiffSha256: () => 'f'.repeat(64),
        render,
        schemaAsksIndicatorResults: async () => false,
        lines: () => log.mock.calls.map(([line]) => line).join('\n'),
    };
}

interface PlanOut {
    n: number;
    basis: string;
    positions: Record<string, { count: number }>;
    reasons: Record<string, number>;
    stopBasis: Record<string, number>;
    recompute: { withStoredState: number };
    stop: { mismatch: number };
}

/** The parts of `summary.json` these tests read; which exist depends on the mode. */
interface SummaryOut {
    skippedRows?: number;
    plumbing?: { total: number; n: number; equal: number };
    stored?: { n: number };
    plan?: PlanOut;
    planAllResults?: PlanOut | null;
    outcomesByPosition?: Record<string, { n: number }> | null;
    paired?: unknown;
    p7Sample?: Record<string, string[]>;
    skills?: { cases: number };
    claims?: {
        paired: number;
        unpaired: number;
        reliability: {
            before: { count: number };
            after: { count: number };
            diff: { high: number | null };
        };
    };
    zone?: {
        n: number;
        n3: { basis: string };
        positions: {
            tolerance: Record<string, { count: number }>;
            exact: Record<string, { count: number }>;
        };
        toleranceInZoneGeometry: Record<string, { count: number }>;
        n1Sample: Record<string, string[]>;
    };
    targetRoom?: { paired: number } | null;
}

interface Summary {
    summary: SummaryOut;
    gates: { id: string; pass: boolean | null; value: string | null }[];
}

interface RunFile {
    tool: string;
    inputs: Record<string, unknown>;
}

// `JSON.parse` returns `any`, so these typed returns need no cast.
const readSummary = (out: string): Summary =>
    JSON.parse(readFileSync(join(out, 'summary.json'), 'utf-8'));
const readRun = (out: string): RunFile =>
    JSON.parse(readFileSync(join(out, 'run.json'), 'utf-8'));

/** The value, or a thrown error naming the missing part: narrows without a cast. */
function need<T>(value: T | null | undefined, name: string): T {
    if (value === null || value === undefined) {
        throw new Error(`${name} is missing from the output`);
    }
    return value;
}

/** An object value as a record, for spreading a stored fixture part. */
function asBody(value: unknown): ResultBody {
    if (typeof value !== 'object' || value === null) {
        throw new Error('fixture part is not an object');
    }
    return Object.fromEntries(Object.entries(value));
}

describe('parseFieldsEvalArgs', () => {
    const trend = ['--mode', 'trend', '--out', 'o', '--set', 's'];

    it('needs a valid mode and an output directory', () => {
        expect(() => parseFieldsEvalArgs(['--out', 'o'])).toThrow(
            '--mode must be one of trend, skills, plan, gating, output'
        );
        expect(() =>
            parseFieldsEvalArgs(['--mode', 'x', '--out', 'o'])
        ).toThrow('--mode must be one of');
        expect(() =>
            parseFieldsEvalArgs(['--mode', 'trend', '--set', 's'])
        ).toThrow('--out is required');
    });

    it('resolves paths and reads every option', () => {
        const args = parseFieldsEvalArgs([
            ...trend,
            '--run',
            'r',
            '--arm',
            'before',
            '--gate',
            'T1,T3',
            '--allow-skipped-cases',
            '--noise-pp',
            '1.5',
        ]);
        expect(args).toMatchObject({
            mode: 'trend',
            arm: 'before',
            gate: ['T1', 'T3'],
            allowSkippedCases: true,
            noisePp: 1.5,
            bars: null,
            labels: null,
        });
        expect(args.run).toMatch(/\/r$/);
        expect(args.out).toMatch(/\/o$/);
    });

    it('defaults the gate selection to none and reads a bare --gate as all', () => {
        expect(parseFieldsEvalArgs(trend).gate).toBeNull();
        expect(parseFieldsEvalArgs([...trend, '--gate']).gate).toBe('all');
        expect(parseFieldsEvalArgs([...trend, '--gate', 'all']).gate).toBe(
            'all'
        );
    });

    it('rejects a gate id that belongs to another mode', () => {
        expect(() => parseFieldsEvalArgs([...trend, '--gate', 'P1'])).toThrow(
            '--gate ids not in mode trend: P1'
        );
    });

    it('trend takes exactly one data source and one label source', () => {
        expect(() =>
            parseFieldsEvalArgs(['--mode', 'trend', '--out', 'o'])
        ).toThrow('exactly one of --set and --bars');
        expect(() => parseFieldsEvalArgs([...trend, '--bars', 'b'])).toThrow(
            'exactly one of --set and --bars'
        );
        expect(() =>
            parseFieldsEvalArgs([...trend, '--run', 'r', '--labels', 'l'])
        ).toThrow('--run and --labels are alternatives');
        expect(() =>
            parseFieldsEvalArgs([
                '--mode',
                'trend',
                '--out',
                'o',
                '--bars',
                'b',
                '--run',
                'r',
            ])
        ).toThrow('--run needs --set');
        expect(() => parseFieldsEvalArgs([...trend, '--before', 'b'])).toThrow(
            '--before and --member-run do not apply'
        );
    });

    it('plan needs a set and a run and rejects the options of other modes', () => {
        const plan = ['--mode', 'plan', '--out', 'o'];
        expect(() => parseFieldsEvalArgs([...plan, '--run', 'r'])).toThrow(
            'plan: --set is required'
        );
        expect(() =>
            parseFieldsEvalArgs([...plan, '--set', 's', '--bars', 'b'])
        ).toThrow('plan: --set is required');
        expect(() => parseFieldsEvalArgs([...plan, '--set', 's'])).toThrow(
            'plan: --run is required'
        );
        expect(() =>
            parseFieldsEvalArgs([
                ...plan,
                '--set',
                's',
                '--run',
                'r',
                '--skills',
                'k',
            ])
        ).toThrow('plan: --member-run and --skills do not apply');
        expect(
            parseFieldsEvalArgs([
                ...plan,
                '--set',
                's',
                '--run',
                'r',
                '--before',
                'b',
            ]).before
        ).toMatch(/\/b$/);
    });

    it('skills needs a set and a skills directory, and live runs come as a pair', () => {
        const skills = ['--mode', 'skills', '--out', 'o', '--set', 's'];
        expect(() => parseFieldsEvalArgs(skills)).toThrow(
            'skills: --skills is required'
        );
        const ready = [...skills, '--skills', 'k'];
        expect(() => parseFieldsEvalArgs([...ready, '--run', 'r'])).toThrow(
            '--run and --before are given together'
        );
        expect(() =>
            parseFieldsEvalArgs([...ready, '--member-run', 'm'])
        ).toThrow('--member-run needs --run and --before');
        expect(
            parseFieldsEvalArgs([
                ...ready,
                '--run',
                'r',
                '--before',
                'b',
                '--limit',
                '5',
            ]).limit
        ).toBe(5);
    });

    it('validates --limit and --noise-pp', () => {
        expect(() => parseFieldsEvalArgs([...trend, '--limit', '0'])).toThrow(
            '--limit must be a positive integer (got "0")'
        );
        expect(() =>
            parseFieldsEvalArgs([...trend, '--noise-pp', '-1'])
        ).toThrow('--noise-pp must be a non-negative number');
        expect(() =>
            parseFieldsEvalArgs([...trend, '--noise-pp', 'abc'])
        ).toThrow('--noise-pp must be a non-negative number');
    });
});

describe('the labels file', () => {
    it('splits a line honouring quotes and doubled quotes', () => {
        expect(splitCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
        expect(splitCsvLine('"say ""hi""",x')).toEqual(['say "hi"', 'x']);
        expect(splitCsvLine('a,,b')).toEqual(['a', '', 'b']);
    });

    const header = 'date,ticker,kind,trend,close';

    it('reads the labelled rows and skips a row without a valid trend', () => {
        const rows = trendRowsOfCsv(
            [
                header,
                '2026-01-02,AAPL,entry,bullish,1',
                '2026-01-03,AAPL,review,,1',
                '2026-01-04,005930.KS,entry,bearish,1',
                '2026-01-05,AAPL,entry,sideways,1',
            ].join('\n')
        );
        expect(rows).toEqual([
            expect.objectContaining({
                caseId: 'AAPL|2026-01-02|entry',
                market: 'us',
                stored: 'bullish',
                regime: null,
            }),
            expect.objectContaining({
                caseId: '005930.KS|2026-01-04|entry',
                market: 'kr',
                stored: 'bearish',
            }),
        ]);
    });

    it('fails on an empty file and on a missing column', () => {
        expect(() => trendRowsOfCsv('')).toThrow('the labels file is empty');
        expect(() => trendRowsOfCsv('date,ticker,kind\nx,y,z')).toThrow(
            'no "trend" column'
        );
    });
});

describe('loading a set and a run', () => {
    it('refuses a set whose bars file changed since it was frozen', () => {
        const world = makeWorld();
        const file = join(world.setDir, world.manifest.bars.NVDA.file);
        writeFileSync(file, `${readFileSync(file, 'utf-8')} `);
        expect(() => loadSetData(world.setDir)).toThrow('set hash mismatch');
    });

    it('refuses a run made on other bars, one with no results and one with a case not in the set', () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const other = writeRun(world, {
            name: 'other',
            meta: { setBarsSha256: 'nope' },
        });
        expect(() => loadRunData(other, set)).toThrow('different bars');
        const empty = writeRun(world, { name: 'empty', take: 0 });
        expect(() => loadRunData(empty, set)).toThrow('has no results');
        const stray = writeRun(world, {
            name: 'stray',
            take: 1,
            extraResults: [{ caseId: 'ZZZ|2020-01-01', symbol: 'ZZZ' }],
        });
        expect(() => loadRunData(stray, set)).toThrow(
            'results of cases not in the set: ZZZ|2020-01-01'
        );
    });

    it('refuses to compare runs that differ in a named field', () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const a = loadRunData(writeRun(world, { name: 'a' }), set);
        const b = loadRunData(
            writeRun(world, { name: 'b', tier: 'free' }),
            set
        );
        expect(() => assertComparableRuns(a, b, ['tier', 'model'])).toThrow(
            'not comparable: tier differ'
        );
        expect(() => assertComparableRuns(a, b, ['model'])).not.toThrow();
    });

    it('does not mistake an unreadable labels.jsonl for an absent one', () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const run = writeRun(world, { name: 'a' });
        mkdirSync(join(run, 'labels.jsonl'));
        expect(() => loadRunData(run, set)).toThrow(/EISDIR/);
    });

    it('reads labels only when labels.jsonl exists', () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        expect(
            loadRunData(writeRun(world, { name: 'a' }), set).labels
        ).toBeNull();
        const withLabels = writeRun(world, {
            name: 'b',
            labels: results => results.map(r => makeRow({ caseId: r.caseId })),
        });
        expect(loadRunData(withLabels, set).labels).toHaveLength(
            world.manifest.cases.length
        );
    });
});

describe('runFieldsEval: trend', () => {
    it('writes run.json, summary.json and rows.jsonl for a run and checks its stored trend', async () => {
        const world = makeWorld();
        const out = join(world.dir, 'out');
        const deps = makeDeps();
        const code = await runFieldsEval(
            baseArgs({
                set: world.setDir,
                run: writeRun(world, { name: 'run' }),
                out,
                arm: 'before',
            }),
            deps
        );
        expect(code).toBe(0);
        const run = readRun(out);
        expect(run).toMatchObject({
            tool: 'analysisFieldsEval',
            mode: 'trend',
            arm: 'before',
            coreGitSha: 'abc123+dirty',
            dirtyDiffSha256: 'f'.repeat(64),
        });
        const { summary, gates } = readSummary(out);
        const plumbing = need(summary.plumbing, 'plumbing');
        expect(plumbing.n).toBe(world.manifest.cases.length);
        expect(gates.map(g => g.id)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5']);
        expect(
            readFileSync(join(out, 'rows.jsonl'), 'utf-8').trim().split('\n')
        ).toHaveLength(world.manifest.cases.length);
        expect(deps.lines()).toContain('wrote ');
    });

    it('counts failed results and ignores repeats beyond the first', async () => {
        const world = makeWorld();
        const out = join(world.dir, 'out');
        const failing = world.manifest.cases[0].caseId;
        await runFieldsEval(
            baseArgs({
                set: world.setDir,
                out,
                run: writeRun(world, {
                    name: 'run',
                    body: c =>
                        c.asOf === world.manifest.cases[0].asOf &&
                        c.symbol === world.manifest.cases[0].symbol
                            ? null
                            : defaultBody(c),
                    extraResults: [
                        {
                            caseId: failing,
                            symbol: world.manifest.cases[0].symbol,
                            asOf: world.manifest.cases[0].asOf,
                            repeat: 2,
                        },
                    ],
                }),
            }),
            makeDeps()
        );
        const inputs = readRun(out).inputs;
        expect(inputs.failedResults).toBe(1);
        expect(inputs.repeatsIgnored).toBe(1);
    });

    it('fails closed: an output path inside the repository', async () => {
        const world = makeWorld();
        await expect(
            runFieldsEval(
                baseArgs({
                    set: world.setDir,
                    out: join(REPO_ROOT, 'tmp-fields-eval-out'),
                }),
                makeDeps()
            )
        ).rejects.toThrow('inside the repository');
    });

    it('fails closed: a hash mismatch, a run of another set, an empty run', async () => {
        const world = makeWorld();
        const run = writeRun(world, { name: 'run' });
        const out = join(world.dir, 'out');
        await expect(
            runFieldsEval(
                baseArgs({
                    set: world.setDir,
                    out,
                    run: writeRun(world, {
                        name: 'other',
                        meta: { setBarsSha256: 'x' },
                    }),
                }),
                makeDeps()
            )
        ).rejects.toThrow('different bars');
        await expect(
            runFieldsEval(
                baseArgs({
                    set: world.setDir,
                    out,
                    run: writeRun(world, {
                        name: 'nolabels',
                        body: () => ({ riskLevel: 'low' }),
                    }),
                }),
                makeDeps()
            )
        ).rejects.toThrow('no stored trend label');
        const file = join(world.setDir, world.manifest.bars.NVDA.file);
        writeFileSync(file, `${readFileSync(file, 'utf-8')} `);
        await expect(
            runFieldsEval(baseArgs({ set: world.setDir, out, run }), makeDeps())
        ).rejects.toThrow('set hash mismatch');
    });

    it('fails closed: a result whose bar is not in the set', async () => {
        const world = makeWorld();
        const first = world.manifest.cases[0];
        await expect(
            runFieldsEval(
                baseArgs({
                    set: world.setDir,
                    out: join(world.dir, 'out'),
                    run: writeRun(world, {
                        name: 'run',
                        body: c =>
                            c.symbol === first.symbol && c.asOf === first.asOf
                                ? {
                                      ...defaultBody(c),
                                      dataAsOf: { barTime: 1 },
                                  }
                                : defaultBody(c),
                    }),
                }),
                makeDeps()
            )
        ).rejects.toThrow(`${first.caseId}: no bar on`);
    });

    it('fails closed: a run that does not cover the cases it was started for', async () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const short = writeRun(world, {
            name: 'short',
            take: world.manifest.cases.length - 1,
        });
        expect(() => loadRunData(short, set)).toThrow(
            /is incomplete: 1 result\(s\) missing/
        );
        // a repeat that was never run is a missing result too
        const repeats = writeRun(world, {
            name: 'repeats',
            meta: { repeat: 2 },
        });
        expect(() => loadRunData(repeats, set)).toThrow('is incomplete');
    });

    it('checks completeness against the limited selection, not the whole set', () => {
        const world = makeWorld();
        const set = loadSetData(world.setDir);
        const selected = selectRunCases(world.manifest, {
            subset: null,
            limit: 3,
        }).map(c => c.caseId);
        expect(selected).toHaveLength(3);
        expect(world.manifest.cases.length).toBeGreaterThan(3);
        // exactly the limited cases: complete, though the set has many more
        const complete = writeRun(world, {
            name: 'limited',
            meta: { limit: 3 },
            only: selected,
        });
        expect(loadRunData(complete, set).results).toHaveLength(3);
        // one of the three missing: incomplete, even with other cases present
        const missingOne = writeRun(world, {
            name: 'limited-missing',
            meta: { limit: 3 },
            only: world.manifest.cases
                .map(c => c.caseId)
                .filter(id => id !== selected[0]),
        });
        expect(() => loadRunData(missingOne, set)).toThrow(
            `is incomplete: 1 result(s) missing for its subset, limit and repeat (first: ${selected[0]}#1)`
        );
    });

    it('checks completeness against the variance subset, not the whole set', () => {
        const world = makeWorld();
        // the generated set flags every small case as variance: keep every other one
        const manifestPath = join(world.setDir, 'manifest.json');
        const manifest = readManifest(manifestPath);
        manifest.cases = manifest.cases.map((c, i) => ({
            ...c,
            variance: i % 2 === 0,
        }));
        writeFileSync(manifestPath, JSON.stringify(manifest));
        const set = loadSetData(world.setDir);
        const variance = manifest.cases
            .filter(c => c.variance)
            .map(c => c.caseId);
        expect(variance.length).toBeGreaterThan(0);
        expect(variance.length).toBeLessThan(manifest.cases.length);
        const complete = writeRun(world, {
            name: 'variance',
            meta: { subset: 'variance' },
            only: variance,
        });
        expect(loadRunData(complete, set).results).toHaveLength(
            variance.length
        );
        const missingOne = writeRun(world, {
            name: 'variance-missing',
            meta: { subset: 'variance' },
            only: variance.slice(1),
        });
        expect(() => loadRunData(missingOne, set)).toThrow(
            `is incomplete: 1 result(s) missing for its subset, limit and repeat (first: ${variance[0]}#1)`
        );
    });

    it('counts a result without a trend in the plumbing total and fails T1 on it', async () => {
        const world = makeWorld();
        const out = join(world.dir, 'out');
        const first = world.manifest.cases[0];
        await runFieldsEval(
            baseArgs({
                set: world.setDir,
                out,
                run: writeRun(world, {
                    name: 'run',
                    body: c =>
                        c.symbol === first.symbol && c.asOf === first.asOf
                            ? { riskLevel: 'low' }
                            : defaultBody(c),
                }),
            }),
            makeDeps()
        );
        const { summary, gates } = readSummary(out);
        const plumbing = need(summary.plumbing, 'plumbing');
        expect(plumbing.total).toBe(world.manifest.cases.length);
        expect(plumbing.n).toBe(world.manifest.cases.length - 1);
        expect(plumbing.equal).toBeLessThan(plumbing.total);
        const t1 = gates.find(g => g.id === 'T1');
        expect(t1?.pass).toBe(false);
        expect(t1?.value).toContain('excluded 1');
    });

    const csv = (rows: readonly string[]) =>
        ['date,ticker,kind,trend', ...rows].join('\n');

    it('reads a labels file against a bars directory', async () => {
        const world = makeWorld();
        const barsDir = join(world.dir, 'src');
        const nvda = world.stored.get('NVDA')?.bars ?? [];
        const day = (i: number) =>
            new Date(nvda[i].time * 1000).toISOString().slice(0, 10);
        const labels = join(world.dir, 'decisions.csv');
        writeFileSync(
            labels,
            csv([
                `${day(400)},NVDA,entry,neutral`,
                `${day(401)},NVDA,entry,neutral`,
                `${day(402)},NVDA,entry,bullish`,
            ])
        );
        const out = join(world.dir, 'out');
        const code = await runFieldsEval(
            baseArgs({ bars: barsDir, labels, out }),
            makeDeps()
        );
        expect(code).toBe(0);
        const { summary } = readSummary(out);
        expect(need(summary.stored, 'stored').n).toBe(3);
        expect(summary.plumbing).toBeNull();
    });

    it('fails closed: labels for a symbol without bars', async () => {
        const world = makeWorld();
        const labels = join(world.dir, 'decisions.csv');
        writeFileSync(labels, csv(['2024-01-02,ZZZ,entry,bullish']));
        await expect(
            runFieldsEval(
                baseArgs({
                    set: world.setDir,
                    labels,
                    out: join(world.dir, 'out'),
                }),
                makeDeps()
            )
        ).rejects.toThrow('labels for symbols without bars: ZZZ');
    });

    it('counts a label date without a bar and fails a gated run on it unless allowed', async () => {
        const world = makeWorld();
        const nvda = world.stored.get('NVDA')?.bars ?? [];
        const day = new Date(nvda[400].time * 1000).toISOString().slice(0, 10);
        const labels = join(world.dir, 'decisions.csv');
        writeFileSync(
            labels,
            csv([`${day},NVDA,entry,neutral`, '1999-01-04,NVDA,entry,neutral'])
        );
        const run = (extra: Partial<FieldsEvalArgs>) =>
            runFieldsEval(
                baseArgs({
                    set: world.setDir,
                    labels,
                    out: join(world.dir, 'out'),
                    ...extra,
                }),
                makeDeps()
            );
        expect(await run({})).toBe(0);
        const { summary } = readSummary(join(world.dir, 'out'));
        expect(summary.skippedRows).toBe(1);
        expect(await run({ gate: ['T3'] })).toBe(2);
        expect(await run({ gate: ['T3'], allowSkippedCases: true })).toBe(0);
    });

    it('exits 2 when a selected gate fails or cannot be computed, 0 when it passes', async () => {
        const world = makeWorld();
        const base = {
            set: world.setDir,
            out: join(world.dir, 'out'),
            run: writeRun(world, {
                name: 'run',
                // all neutral: never opposite to a rule label, but not equal to every rule label either
                body: defaultBody,
            }),
        };
        const deps = makeDeps();
        expect(
            await runFieldsEval(baseArgs({ ...base, gate: ['T3'] }), deps)
        ).toBe(0);
        expect(
            await runFieldsEval(baseArgs({ ...base, gate: ['T1'] }), deps)
        ).toBe(2);
        expect(deps.lines()).toContain('GATE T1 FAIL');
        // no run-less summary text in these results is opposite, but T5 has a summary: decided
        expect(
            await runFieldsEval(baseArgs({ ...base, gate: ['T5'] }), deps)
        ).toBe(0);
        const noSummary = writeRun(world, {
            name: 'run2',
            body: c => ({ ...defaultBody(c), summary: undefined }),
        });
        expect(
            await runFieldsEval(
                baseArgs({ ...base, run: noSummary, gate: ['T5'] }),
                deps
            )
        ).toBe(2);
        expect(deps.lines()).toContain('T5 NOT COMPUTABLE');
        // no selection: the same failures do not change the exit code
        expect(await runFieldsEval(baseArgs(base), deps)).toBe(0);
    });
});

describe('runFieldsEval: gate selection', () => {
    it('counts a selected gate the input did not produce as not computable', async () => {
        const world = makeWorld();
        const deps = makeDeps(async input => ({
            catalog: [
                { name: 'Core A', group: 'g', alwaysOn: true, injected: true },
            ],
            samples: input.cases.flatMap(c => [
                {
                    caseId: c.caseId,
                    tier: 'member' as const,
                    stable: '### Core A (x)',
                    dynamic: '',
                },
                {
                    caseId: c.caseId,
                    tier: 'free' as const,
                    stable: '### Core A (x)',
                    dynamic: '',
                },
            ]),
        }));
        const run = (gate: FieldsEvalArgs['gate']) =>
            runFieldsEval(
                baseArgs({
                    mode: 'skills',
                    set: world.setDir,
                    skills: join(world.dir, 'skills'),
                    limit: 2,
                    out: join(world.dir, 'out'),
                    gate,
                }),
                deps
            );
        // S1 and S3 pass here; S2 is vacuous (no gated skill), S5 and S6 have no run pair
        expect(await run(['S1', 'S3'])).toBe(0);
        expect(await run(['S5', 'S6'])).toBe(2);
        expect(deps.lines()).toContain('S5 NOT COMPUTABLE');
        expect(deps.lines()).toContain('S6 NOT COMPUTABLE');
        expect(await run('all')).toBe(2);
    });

    it('--gate all means every gate of the mode, so a bars-only trend run fails on T1 and T5', async () => {
        const world = makeWorld();
        const deps = makeDeps();
        const code = await runFieldsEval(
            baseArgs({
                set: world.setDir,
                out: join(world.dir, 'out'),
                gate: 'all',
            }),
            deps
        );
        expect(code).toBe(2);
        expect(deps.lines()).toContain('GATE T1 NOT COMPUTABLE');
        expect(deps.lines()).toContain('GATE T5 NOT COMPUTABLE');
    });

    it('says plainly that no gate decides the exit code when --gate is absent', async () => {
        const world = makeWorld();
        const deps = makeDeps();
        await runFieldsEval(
            baseArgs({ set: world.setDir, out: join(world.dir, 'out') }),
            deps
        );
        expect(deps.lines()).toContain('NOTICE: no --gate given');
        const gated = makeDeps();
        await runFieldsEval(
            baseArgs({
                set: world.setDir,
                out: join(world.dir, 'out2'),
                gate: ['T4'],
            }),
            gated
        );
        expect(gated.lines()).not.toContain('NOTICE');
    });

    it('records the hash of the labels file in run.json', async () => {
        const world = makeWorld();
        const nvda = world.stored.get('NVDA')?.bars ?? [];
        const day = new Date(nvda[400].time * 1000).toISOString().slice(0, 10);
        const labels = join(world.dir, 'decisions.csv');
        const text = `date,ticker,kind,trend\n${day},NVDA,entry,neutral`;
        writeFileSync(labels, text);
        const out = join(world.dir, 'out');
        await runFieldsEval(
            baseArgs({ set: world.setDir, labels, out }),
            makeDeps()
        );
        const run = readRun(out);
        expect(run.inputs.labelsSha256).toBe(sha256Hex(text));
    });
});

describe('runFieldsEval: plan', () => {
    it('measures every plan, writes the distributions and reports the gates', async () => {
        const world = makeWorld();
        const out = join(world.dir, 'out');
        const code = await runFieldsEval(
            baseArgs({
                mode: 'plan',
                set: world.setDir,
                run: writeRun(world, { name: 'run' }),
                out,
            }),
            makeDeps()
        );
        expect(code).toBe(0);
        const { summary, gates } = readSummary(out);
        const plan = need(summary.plan, 'plan');
        expect(plan.n).toBe(world.manifest.cases.length);
        expect(plan.basis).toBe('all');
        expect(
            Object.values(plan.positions).reduce((sum, p) => sum + p.count, 0)
        ).toBe(plan.n);
        expect(summary.outcomesByPosition).toBeNull();
        expect(summary.paired).toBeNull();
        expect(gates.map(g => g.id)).toEqual([
            'P1',
            'P2',
            'P3',
            'P4',
            'P5',
            'P6',
        ]);
        const sample = need(summary.p7Sample, 'p7Sample');
        expect(Object.values(sample).flat().length).toBeGreaterThan(0);
        expect(readdirSync(out).toSorted()).toEqual([
            'rows.jsonl',
            'run.json',
            'summary.json',
        ]);
    });

    it('uses the headline rows and labels outcomes by position when labels exist', async () => {
        const world = makeWorld();
        const out = join(world.dir, 'out');
        await runFieldsEval(
            baseArgs({
                mode: 'plan',
                set: world.setDir,
                run: writeRun(world, { name: 'run', labels: labelsOf }),
                out,
            }),
            makeDeps()
        );
        const { summary } = readSummary(out);
        expect(need(summary.plan, 'plan').basis).toBe('headline');
        expect(summary.planAllResults).not.toBeNull();
        const outcomes = need(summary.outcomesByPosition, 'outcomesByPosition');
        expect(Object.values(outcomes).reduce((sum, o) => sum + o.n, 0)).toBe(
            world.manifest.cases.length
        );
    });

    /**
     * A plan that satisfies every P1 check for its bar: zone ending at the close, a model
     * stop 2.5 ATR under the zone low, a target 2 ATR above, and the stored state to match.
     * `stopAtrBelowLow` moves the stop; below 1 it breaks the floor.
     */
    const cleanBody =
        (world: World, stopAtrBelowLow = 2) =>
        (c: { symbol: string; asOf: string; close: number }): ResultBody => {
            const bars = world.stored.get(c.symbol)?.bars ?? [];
            const asOfTime = Date.parse(`${c.asOf}T00:00:00Z`) / 1000;
            const atr = wilderAtrSeries(bars, 14)[
                bars.findIndex(b => b.time === asOfTime)
            ];
            if (atr === null) throw new Error('no ATR for the fixture bar');
            const low = c.close - 0.5 * atr;
            return {
                trend: 'neutral',
                riskLevel: 'medium',
                actionRecommendation: {
                    entryRecommendation: 'enter',
                    entryPrices: [low, c.close],
                    stopLoss: low - stopAtrBelowLow * atr,
                    takeProfitPrices: [c.close + 2 * atr],
                    planState: {
                        position: 'in_zone',
                        atr,
                        stopDistanceAtr: stopAtrBelowLow,
                        distanceAtr: 0,
                        stopBasis: 'model',
                    },
                },
            };
        };

    it('reads the stop check from every result: a non-headline plan that breaks the floor fails P1', async () => {
        const world = makeWorld();
        const odd = world.manifest.cases[0];
        const isOdd = (c: { symbol: string; asOf: string }) =>
            c.symbol === odd.symbol && c.asOf === odd.asOf;
        const labels =
            (oddHeadline: boolean) => (results: readonly CaseResultFile[]) =>
                labelsOf(results).map(row =>
                    row.caseId === odd.caseId && !oddHeadline
                        ? {
                              ...row,
                              status: 'insufficient_forward' as const,
                              labels: null,
                          }
                        : row
                );
        const run = async (
            name: string,
            breakFloor: boolean,
            oddHeadline: boolean
        ) => {
            const out = join(world.dir, `out-${name}`);
            const code = await runFieldsEval(
                baseArgs({
                    mode: 'plan',
                    set: world.setDir,
                    run: writeRun(world, {
                        name,
                        body: c =>
                            isOdd(c) && breakFloor
                                ? cleanBody(world, 0.4)(c)
                                : cleanBody(world)(c),
                        labels: labels(oddHeadline),
                    }),
                    before: writeRun(world, {
                        name: `${name}-before`,
                        body: cleanBody(world),
                        labels: labels(true),
                    }),
                    out,
                    gate: ['P1'],
                }),
                makeDeps()
            );
            return { code, out };
        };
        // control: every plan is clean, one of them is not a headline row
        expect((await run('clean', false, false)).code).toBe(0);
        // the same plan breaks the floor while being left out of the headline rows
        const broken = await run('broken', true, false);
        expect(broken.code).toBe(2);
        const { summary } = readSummary(broken.out);
        const plan = need(summary.plan, 'plan');
        const all = need(summary.planAllResults, 'planAllResults');
        expect(plan.n).toBe(world.manifest.cases.length - 1);
        expect(all.n).toBe(world.manifest.cases.length);
        expect(all.stop.mismatch).toBe(1);
    });

    it('relabels a no_setup plan as wait before counting its outcome', async () => {
        const world = makeWorld();
        const out = join(world.dir, 'out');
        const noRoom = (c: { close: number }): ResultBody => ({
            ...defaultBody(c),
            actionRecommendation: {
                entryRecommendation: 'enter',
                entryPrices: [c.close * 0.99, c.close],
                stopLoss: c.close * 0.9,
                // no target a full ATR above the zone top: no_setup
                takeProfitPrices: [c.close * 1.0001],
            },
        });
        await runFieldsEval(
            baseArgs({
                mode: 'plan',
                set: world.setDir,
                run: writeRun(world, {
                    name: 'run',
                    body: noRoom,
                    labels: results =>
                        results.map(r =>
                            makeRow({
                                caseId: r.caseId,
                                asOf: r.asOf,
                                symbol: r.symbol,
                            })
                        ),
                }),
                out,
            }),
            makeDeps()
        );
        const { summary } = readSummary(out);
        const outcomes = need(summary.outcomesByPosition, 'outcomesByPosition');
        expect(Object.keys(outcomes)).toEqual(['no_setup']);
        expect(outcomes.no_setup.n).toBe(world.manifest.cases.length);
    });

    it('compares with a before run and refuses a run of another tier', async () => {
        const world = makeWorld();
        const out = join(world.dir, 'out');
        const after = writeRun(world, { name: 'after', labels: labelsOf });
        const before = writeRun(world, { name: 'before', labels: labelsOf });
        const code = await runFieldsEval(
            baseArgs({
                mode: 'plan',
                set: world.setDir,
                run: after,
                before,
                out,
            }),
            makeDeps()
        );
        expect(code).toBe(0);
        const { summary, gates } = readSummary(out);
        expect(summary.paired).not.toBeNull();
        expect(gates.find(g => g.id === 'P6')?.pass).toBe(true);
        const pair = (name: string, extra: Partial<RunOptions>) =>
            runFieldsEval(
                baseArgs({
                    mode: 'plan',
                    set: world.setDir,
                    run: after,
                    before: writeRun(world, { name, ...extra }),
                    out,
                }),
                makeDeps()
            );
        await expect(pair('free', { tier: 'free' })).rejects.toThrow(
            'not comparable: tier differ'
        );
        await expect(pair('limited', { meta: { limit: 5 } })).rejects.toThrow(
            'not comparable: limit differ'
        );
        await expect(
            pair('variance', { meta: { subset: 'variance' } })
        ).rejects.toThrow('not comparable: subset differ');
        await expect(pair('twice', { meta: { repeat: 2 } })).rejects.toThrow(
            'is incomplete'
        );
    });

    it('--legacy-zone recomputes a run from before the exact-edge rule with its 1% band (P1)', async () => {
        const world = makeWorld();
        const clean = cleanBody(world);
        // A zone ending 0.5% under the close: the old rule stored in_zone, exact edges say above.
        const legacy = (c: { symbol: string; asOf: string; close: number }) => {
            const body = clean(c);
            const ar = body.actionRecommendation as Record<string, unknown>;
            const prices = ar.entryPrices as number[];
            const shifted = prices.map(p => p * 0.995);
            const stop = ar.stopLoss as number;
            return {
                ...body,
                actionRecommendation: {
                    ...ar,
                    entryPrices: shifted,
                    stopLoss: stop - (prices[0] - shifted[0]),
                },
            };
        };
        const run = writeRun(world, { name: 'legacy', body: legacy });
        const p1 = async (legacyZone: boolean) => {
            const out = join(world.dir, `out-${legacyZone}`);
            const deps = makeDeps();
            await runFieldsEval(
                baseArgs({
                    mode: 'plan',
                    set: world.setDir,
                    run,
                    out,
                    gate: ['P1'],
                    legacyZone,
                }),
                deps
            );
            return { lines: deps.lines(), inputs: readRun(out).inputs };
        };
        const exact = await p1(false);
        expect(exact.lines).toContain('state mismatch 14/14');
        expect(exact.inputs.zoneRule).toBe('exact edges');
        const legacyRun = await p1(true);
        expect(legacyRun.lines).toContain('state mismatch 0/14');
        expect(String(legacyRun.inputs.zoneRule)).toContain('legacy');
    });

    it('exits 2 for a selected gate that fails (no stored plan state to equal the recomputed one)', async () => {
        const world = makeWorld();
        const deps = makeDeps();
        const code = await runFieldsEval(
            baseArgs({
                mode: 'plan',
                set: world.setDir,
                run: writeRun(world, { name: 'run' }),
                out: join(world.dir, 'out'),
                gate: ['P1'],
            }),
            deps
        );
        expect(code).toBe(2);
        expect(deps.lines()).toContain('GATE P1 FAIL');
    });

    it('reads a stored plan state and its stop basis', async () => {
        const world = makeWorld();
        const out = join(world.dir, 'out');
        await runFieldsEval(
            baseArgs({
                mode: 'plan',
                set: world.setDir,
                run: writeRun(world, {
                    name: 'run',
                    body: c => {
                        const body = defaultBody(c);
                        return {
                            ...body,
                            actionRecommendation: {
                                ...asBody(body.actionRecommendation),
                                reconciledLevels: {
                                    stopLoss: c.close * 0.9,
                                    takeProfitPrices: [c.close * 1.2],
                                },
                                planState: {
                                    position: 'in_zone',
                                    atr: 1,
                                    stopDistanceAtr: 1,
                                    stopBasis: 'atr',
                                },
                            },
                        };
                    },
                }),
                out,
            }),
            makeDeps()
        );
        const { summary } = readSummary(out);
        const plan = need(summary.plan, 'plan');
        expect(plan.stopBasis).toEqual({ atr: world.manifest.cases.length });
        expect(plan.recompute.withStoredState).toBe(
            world.manifest.cases.length
        );
    });

    it('ignores a rejected reconciled stop', async () => {
        const world = makeWorld();
        const out = join(world.dir, 'out');
        await runFieldsEval(
            baseArgs({
                mode: 'plan',
                set: world.setDir,
                run: writeRun(world, {
                    name: 'run',
                    body: c => {
                        const body = defaultBody(c);
                        return {
                            ...body,
                            actionRecommendation: {
                                ...asBody(body.actionRecommendation),
                                reconciledLevels: {
                                    stopLoss: c.close * 0.9,
                                    stopLossRejected: true,
                                },
                            },
                        };
                    },
                }),
                out,
            }),
            makeDeps()
        );
        const { summary } = readSummary(out);
        const plan = need(summary.plan, 'plan');
        expect(plan.reasons).toEqual({ no_stop: world.manifest.cases.length });
    });

    it('fails closed on a run with no plan to measure', async () => {
        const world = makeWorld();
        await expect(
            runFieldsEval(
                baseArgs({
                    mode: 'plan',
                    set: world.setDir,
                    run: writeRun(world, {
                        name: 'run',
                        body: () => ({ trend: 'neutral' }),
                    }),
                    out: join(world.dir, 'out'),
                }),
                makeDeps()
            )
        ).rejects.toThrow('no result with a plan to measure');
    });
});

describe('liveSkillsInput', () => {
    const live = (
        world: World,
        runs: { run?: string; before?: string; memberRun?: string }
    ) =>
        liveSkillsInput(
            {
                run: runs.run ?? null,
                before: runs.before ?? null,
                memberRun: runs.memberRun ?? null,
                noisePp: 2,
            },
            loadSetData(world.setDir)
        );

    it('has no live input without a run pair', () => {
        const world = makeWorld();
        expect(live(world, {})).toBeNull();
        expect(
            live(world, { run: writeRun(world, { name: 'a', tier: 'free' }) })
        ).toBeNull();
    });

    it('reads the call statistics of both runs and the noise floor, with no overlap without a member run', () => {
        const world = makeWorld();
        const result = live(world, {
            run: writeRun(world, { name: 'after', tier: 'free' }),
            before: writeRun(world, { name: 'before', tier: 'free' }),
        });
        expect(result?.after.n).toBe(world.manifest.cases.length);
        expect(result?.before.n).toBe(world.manifest.cases.length);
        expect(result?.overlap).toBeNull();
        expect(result?.noiseFloor).toBe(0.02);
    });

    it('adds the level overlap with a member run', () => {
        const world = makeWorld();
        const result = live(world, {
            run: writeRun(world, { name: 'after', tier: 'free' }),
            before: writeRun(world, { name: 'before', tier: 'free' }),
            memberRun: writeRun(world, { name: 'member', tier: 'member' }),
        });
        // the same key levels in every run: every free level is near a member level
        expect(result?.overlap?.overlap.after.mean).toBe(1);
        expect(result?.overlap?.overlap.diff.mean).toBe(0);
    });

    it('refuses a run that is not free, a member run that is free, and runs that differ', () => {
        const world = makeWorld();
        const free = writeRun(world, { name: 'f', tier: 'free' });
        const member = writeRun(world, { name: 'm', tier: 'member' });
        expect(() => live(world, { run: member, before: member })).toThrow(
            'S5 and S6 are about free'
        );
        expect(() =>
            live(world, { run: free, before: free, memberRun: free })
        ).toThrow('must be a member run');
        expect(() => live(world, { run: free, before: member })).toThrow(
            'not comparable: tier differ'
        );
    });
});

describe('runFieldsEval: skills', () => {
    const catalog: CatalogSkill[] = [
        {
            name: 'Core A',
            group: 'indicator_guide',
            alwaysOn: true,
            injected: true,
        },
        { name: 'G1', group: 'pattern', alwaysOn: false, injected: true },
    ];
    const render = (free: readonly string[]) =>
        vi.fn<FieldsEvalDeps['render']>(async input => ({
            catalog,
            samples: input.cases.flatMap((c): PromptSample[] => [
                {
                    caseId: c.caseId,
                    tier: 'member',
                    stable: '### Core A (g)\nbody',
                    dynamic: '### G1 (g)\nbody',
                },
                {
                    caseId: c.caseId,
                    tier: 'free',
                    stable: free.map(n => `### ${n} (g)\nbody`).join('\n'),
                    dynamic: '### G1 (g)\nbody',
                },
            ]),
        }));

    it('renders the selected cases for both tiers and writes the skills summary', async () => {
        const world = makeWorld();
        const out = join(world.dir, 'out');
        const renderer = render(['Core A']);
        const code = await runFieldsEval(
            baseArgs({
                mode: 'skills',
                set: world.setDir,
                skills: join(world.dir, 'skills'),
                limit: 3,
                out,
            }),
            makeDeps(renderer)
        );
        expect(code).toBe(0);
        const input = renderer.mock.calls[0][0];
        expect(input.cases).toHaveLength(3);
        expect(input.skillsDir).toBe(join(world.dir, 'skills'));
        expect(input.storedOf('NVDA').ticker).toBe('NVDA');
        expect(() => input.storedOf('ZZZ')).toThrow('no bars for ZZZ');
        const { summary, gates } = readSummary(out);
        expect(need(summary.skills, 'skills').cases).toBe(3);
        expect(gates.map(g => g.id)).toEqual(['S1', 'S2', 'S3']);
        expect(
            readFileSync(join(out, 'rows.jsonl'), 'utf-8').trim().split('\n')
        ).toHaveLength(6);
    });

    it('exits 2 when a selected skills gate fails', async () => {
        const world = makeWorld();
        const deps = makeDeps(render([]));
        const code = await runFieldsEval(
            baseArgs({
                mode: 'skills',
                set: world.setDir,
                skills: join(world.dir, 'skills'),
                limit: 2,
                out: join(world.dir, 'out'),
                gate: ['S1'],
            }),
            deps
        );
        expect(code).toBe(2);
        expect(deps.lines()).toContain('GATE S1 FAIL');
    });

    it('adds S5 and S6 from a free run pair and a member run', async () => {
        const world = makeWorld();
        const out = join(world.dir, 'out');
        const after = writeRun(world, {
            name: 'after',
            tier: 'free',
            labels: labelsOf,
        });
        const before = writeRun(world, {
            name: 'before',
            tier: 'free',
            labels: labelsOf,
        });
        const member = writeRun(world, { name: 'member', tier: 'member' });
        const code = await runFieldsEval(
            baseArgs({
                mode: 'skills',
                set: world.setDir,
                skills: join(world.dir, 'skills'),
                limit: 2,
                run: after,
                before,
                memberRun: member,
                out,
            }),
            makeDeps(render(['Core A']))
        );
        expect(code).toBe(0);
        const { gates } = readSummary(out);
        expect(gates.map(g => g.id)).toEqual(['S1', 'S2', 'S3', 'S5', 'S6']);
        expect(gates.find(g => g.id === 'S5')?.pass).toBe(true);
        expect(gates.find(g => g.id === 'S6')?.pass).toBe(true);
    });

    it('refuses a live pair that is not free, and a member run that is free', async () => {
        const world = makeWorld();
        const run = (args: Partial<FieldsEvalArgs>) =>
            runFieldsEval(
                baseArgs({
                    mode: 'skills',
                    set: world.setDir,
                    skills: join(world.dir, 'skills'),
                    limit: 2,
                    out: join(world.dir, 'out'),
                    ...args,
                }),
                makeDeps(render(['Core A']))
            );
        const memberA = writeRun(world, { name: 'a', tier: 'member' });
        const memberB = writeRun(world, { name: 'b', tier: 'member' });
        await expect(run({ run: memberA, before: memberB })).rejects.toThrow(
            'S5 and S6 are about free'
        );
        const freeA = writeRun(world, { name: 'fa', tier: 'free' });
        const freeB = writeRun(world, { name: 'fb', tier: 'free' });
        await expect(
            run({
                run: freeA,
                before: freeB,
                memberRun: writeRun(world, { name: 'fc', tier: 'free' }),
            })
        ).rejects.toThrow('must be a member run');
        await expect(
            run({
                run: freeA,
                before: freeB,
                memberRun: writeRun(world, {
                    name: 'fd',
                    meta: { model: 'x' },
                }),
            })
        ).rejects.toThrow('not comparable: model differ');
    });

    it('fails closed when the renderer finds nothing', async () => {
        const world = makeWorld();
        await expect(
            runFieldsEval(
                baseArgs({
                    mode: 'skills',
                    set: world.setDir,
                    skills: join(world.dir, 'skills'),
                    out: join(world.dir, 'out'),
                }),
                makeDeps(async () => ({ catalog, samples: [] }))
            )
        ).rejects.toThrow('no prompt was rendered');
    });

    it('the core renderer refuses a skills path that is not a directory, before touching the process', async () => {
        const world = makeWorld();
        const cwd = process.cwd();
        await expect(
            renderWithCore({
                skillsDir: join(world.dir, 'missing', 'skills'),
                cases: [],
                storedOf: () => {
                    throw new Error('unused');
                },
                log: () => undefined,
            })
        ).rejects.toThrow();
        expect(process.cwd()).toBe(cwd);
    });
});

describe('the arguments of gating and output', () => {
    const gating = ['--mode', 'gating', '--out', 'o', '--set', 's'];
    const output = [
        '--mode',
        'output',
        '--out',
        'o',
        '--set',
        's',
        '--run',
        'r',
        '--before',
        'b',
        '--skills',
        'k',
    ];

    it('gating needs a set and a skills directory and reads --tier, --baseline and --limit', () => {
        expect(() => parseFieldsEvalArgs(gating)).toThrow(
            'gating: --skills is required'
        );
        const args = parseFieldsEvalArgs([
            ...gating,
            '--skills',
            'k',
            '--tier',
            'free',
            '--baseline',
            'g',
            '--limit',
            '4',
            '--gate',
            'D1,D2',
        ]);
        expect(args).toMatchObject({
            tier: 'free',
            limit: 4,
            gate: ['D1', 'D2'],
        });
        expect(args.baseline).toMatch(/\/g$/);
    });

    it('gating refuses runs, a bad tier, a missing set and gate ids of other modes', () => {
        expect(() =>
            parseFieldsEvalArgs([...gating, '--skills', 'k', '--run', 'r'])
        ).toThrow('gating: --run, --before and --member-run do not apply');
        expect(() =>
            parseFieldsEvalArgs([...gating, '--skills', 'k', '--tier', 'x'])
        ).toThrow('--tier must be free or member');
        expect(() =>
            parseFieldsEvalArgs([
                '--mode',
                'gating',
                '--out',
                'o',
                '--skills',
                'k',
            ])
        ).toThrow('gating: --set is required');
        expect(() =>
            parseFieldsEvalArgs([...gating, '--skills', 'k', '--gate', 'S1'])
        ).toThrow('--gate ids not in mode gating: S1');
    });

    it('output needs a set, both runs and a skills directory, and reads --repeat', () => {
        expect(() =>
            parseFieldsEvalArgs([
                '--mode',
                'output',
                '--out',
                'o',
                '--set',
                's',
                '--run',
                'r',
            ])
        ).toThrow('output: --run, --before and --skills are required');
        const args = parseFieldsEvalArgs([
            ...output,
            '--repeat',
            'p',
            '--gate',
            'O1,V5',
        ]);
        expect(args.repeat).toMatch(/\/p$/);
        expect(args.gate).toEqual(['O1', 'V5']);
    });

    it('output refuses --limit and --member-run, and the options of other modes are refused elsewhere', () => {
        expect(() => parseFieldsEvalArgs([...output, '--limit', '3'])).toThrow(
            'output: --member-run and --limit do not apply'
        );
        expect(() =>
            parseFieldsEvalArgs([...output, '--tier', 'free'])
        ).toThrow('output: --tier and --baseline apply to gating only');
        expect(() =>
            parseFieldsEvalArgs([
                '--mode',
                'skills',
                '--out',
                'o',
                '--set',
                's',
                '--skills',
                'k',
                '--repeat',
                'p',
            ])
        ).toThrow('skills: --repeat applies to output and claims only');
    });
});

describe('runFieldsEval: gating', () => {
    /** Renders every case with the given guides, qualified ids and candles. */
    const renderWith = (
        sampleOf: (tier: SkillTier) => { stable?: string; dynamic: string }
    ) =>
        vi.fn<FieldsEvalDeps['render']>(async input => ({
            catalog: CATALOG,
            samples: input.cases.flatMap(c =>
                (input.tiers ?? ['free', 'member']).map(
                    (tier): PromptSample => ({
                        caseId: c.caseId,
                        tier,
                        stable: sampleOf(tier).stable ?? STABLE,
                        dynamic: sampleOf(tier).dynamic,
                    })
                )
            ),
        }));
    const followed = dynamicPrompt({
        qualified: ['double_top'],
        candles: ['doji'],
        patternGuides: [PATTERN_GUIDE_A],
        candleGuides: [CANDLE_GUIDE_DOJI],
        indicatorRules: false,
        strategies: ['Strategy One'],
    });
    const gatingArgs = (world: World, over: Partial<FieldsEvalArgs>) =>
        baseArgs({
            mode: 'gating',
            set: world.setDir,
            skills: join(world.dir, 'skills'),
            out: join(world.dir, 'out'),
            ...over,
        });

    it('renders the selected cases and tiers and writes the gating summary and one row per prompt', async () => {
        const world = makeWorld();
        const renderer = renderWith(() => ({ dynamic: followed }));
        const code = await runFieldsEval(
            gatingArgs(world, {
                limit: 3,
                tier: 'member',
                gate: ['D1', 'D2', 'D9'],
            }),
            makeDeps(renderer)
        );
        expect(code).toBe(0);
        const input = renderer.mock.calls[0][0];
        expect(input.cases).toHaveLength(3);
        expect(input.tiers).toEqual(['member']);
        expect(input.storedOf('NVDA').ticker).toBe('NVDA');
        expect(() => input.storedOf('ZZZ')).toThrow('no bars for ZZZ');
        const out = join(world.dir, 'out');
        const { gates } = readSummary(out);
        expect(gates.map(g => g.id)).toEqual([
            'D1',
            'D2',
            'D3',
            'D5',
            'D6',
            'D8',
            'D9',
        ]);
        expect(readRun(out).inputs).toMatchObject({
            limit: 3,
            tiers: ['member'],
        });
        expect(
            readFileSync(join(out, 'rows.jsonl'), 'utf-8').trim().split('\n')
        ).toHaveLength(3);
    });

    it('renders both tiers by default and exits 2 when a selected gate fails', async () => {
        const world = makeWorld();
        const renderer = renderWith(() => ({
            dynamic: dynamicPrompt({
                patternGuides: [PATTERN_GUIDE_B],
                indicatorRules: false,
            }),
        }));
        const deps = makeDeps(renderer);
        const code = await runFieldsEval(
            gatingArgs(world, { limit: 2, gate: ['D1'] }),
            deps
        );
        expect(code).toBe(2);
        expect(renderer.mock.calls[0][0].tiers).toEqual(['free', 'member']);
        expect(deps.lines()).toContain('GATE D1 FAIL');
    });

    it('compares member prompts with the hashes of an earlier gating output (D3)', async () => {
        const world = makeWorld();
        const first = renderWith(() => ({
            dynamic: dynamicPrompt({
                qualified: ['double_top'],
                patternGuides: [PATTERN_GUIDE_A, PATTERN_GUIDE_B],
            }),
        }));
        await runFieldsEval(
            gatingArgs(world, { limit: 2, out: join(world.dir, 'first') }),
            makeDeps(first)
        );
        const run = async (dynamic: string) => {
            const out = join(
                world.dir,
                `second-${sha256Hex(dynamic).slice(0, 6)}`
            );
            const code = await runFieldsEval(
                gatingArgs(world, {
                    limit: 2,
                    out,
                    baseline: join(world.dir, 'first'),
                    gate: ['D3'],
                }),
                makeDeps(renderWith(() => ({ dynamic })))
            );
            return { code, gates: readSummary(out).gates };
        };
        const gated = await run(
            dynamicPrompt({
                qualified: ['double_top'],
                patternGuides: [PATTERN_GUIDE_A],
            })
        );
        expect(gated.code).toBe(0);
        expect(gated.gates.find(g => g.id === 'D3')?.pass).toBe(true);
        const changed = await run(
            dynamicPrompt({
                qualified: ['double_top'],
                patternGuides: [PATTERN_GUIDE_A],
            }).replace('Symbol: TEST', 'Symbol: OTHER')
        );
        expect(changed.code).toBe(2);
    });

    it('reads a baseline only from a gating output of the same set', () => {
        const world = makeWorld();
        const dir = join(world.dir, 'base');
        mkdirSync(dir);
        const write = (run: unknown, rows: readonly unknown[]) => {
            writeFileSync(join(dir, 'run.json'), JSON.stringify(run));
            writeFileSync(
                join(dir, 'rows.jsonl'),
                rows.map(r => `${JSON.stringify(r)}\n`).join('')
            );
        };
        const ok = {
            tool: 'analysisFieldsEval',
            mode: 'gating',
            inputs: { fingerprint: 'fp' },
        };
        const row = {
            caseId: 'C',
            tier: 'member',
            strippedSha256: 'a',
            stableSha256: 'b',
        };
        write(ok, [row]);
        expect(readBaselineRows(dir, 'fp')).toEqual([row]);
        write({ ...ok, mode: 'skills' }, [row]);
        expect(() => readBaselineRows(dir, 'fp')).toThrow(
            'not an analysisFieldsEval gating output'
        );
        write(ok, [row]);
        expect(() => readBaselineRows(dir, 'other')).toThrow('different set');
        write(ok, [{ ...row, strippedSha256: undefined }]);
        expect(() => readBaselineRows(dir, 'fp')).toThrow(
            'a row without hashes'
        );
        write(ok, [{ ...row, tier: 'x' }]);
        expect(() => readBaselineRows(dir, 'fp')).toThrow(
            'a row without hashes'
        );
    });

    it('computes the card gates from the cards of an assembled prompt and the case bars', async () => {
        const world = makeWorld();
        const tagged: readonly CatalogSkill[] = [
            ...CATALOG,
            {
                name: 'MA Signal Guide',
                group: 'indicator_guide',
                alwaysOn: true,
                injected: true,
                computedCard: 'ma',
            },
        ];
        const cardRender = vi.fn<FieldsEvalDeps['render']>(async input => ({
            catalog: tagged,
            samples: input.cases.map((c): PromptSample => ({
                caseId: c.caseId,
                tier: 'member',
                stable: `${STABLE}### MA Signal Guide [High Confidence]\nbody\n`,
                dynamic: dynamicPrompt({
                    stateLines: ['- MA: MA(5): 10', '- MA stack: mixed (x)'],
                    indicatorRules: false,
                }),
                cards: {
                    indicator: [
                        {
                            indicatorName: 'MA Signal Guide',
                            signals: [
                                {
                                    type: 'skill',
                                    description: 'MA Signal Guide: mixed.',
                                    trend: 'neutral',
                                    reading: {
                                        kind: 'ma',
                                        basis: 'always_on',
                                        state: 'mixed',
                                        values: {
                                            close: null,
                                            ma5: 10,
                                            ma20: null,
                                            ma60: null,
                                            ma120: null,
                                            ma200: null,
                                        },
                                        signals: [],
                                    },
                                },
                            ],
                        },
                    ],
                    cycle: [],
                },
            })),
        }));
        const out = join(world.dir, 'out');
        await runFieldsEval(
            gatingArgs(world, { limit: 2, tier: 'member', gate: ['D5', 'D6'] }),
            makeDeps(cardRender)
        );
        const { gates } = readSummary(out);
        expect(gates.find(g => g.id === 'D5')?.pass).toBe(true);
        expect(gates.find(g => g.id === 'D6')?.pass).toBe(true);
    });
});

describe('runFieldsEval: output', () => {
    const body =
        (summary: string, extra: ResultBody = {}) =>
        (c: { close: number }): ResultBody => ({
            ...asBody(defaultBody(c)),
            summary,
            indicatorResults: [],
            strategyResults: [],
            patternSummaries: [],
            candlePatterns: [],
            ...extra,
        });
    const prompt = dynamicPrompt({
        qualified: ['double_top'],
        strategies: ['Strategy One'],
    });
    const skills = (world: World): string => {
        const dir = join(world.dir, 'skills');
        mkdirSync(join(dir, 'patterns'), { recursive: true });
        writeFileSync(
            join(dir, 'patterns', 'double-top.md'),
            '---\nname: 이중천장\ntype: pattern\ngating:\n  tier: gated\n  triggers: [double_top]\n---\nbody'
        );
        writeFileSync(
            join(dir, 'patterns', 'double-bottom.md'),
            '---\nname: 이중바닥\ntype: pattern\ngating:\n  tier: gated\n  triggers: [double_bottom]\n---\nbody'
        );
        return dir;
    };
    const outputArgs = (world: World, over: Partial<FieldsEvalArgs>) =>
        baseArgs({
            mode: 'output',
            set: world.setDir,
            skills: skills(world),
            out: join(world.dir, 'out'),
            ...over,
        });

    it('pairs two runs case by case and writes the comparison, the gates and one row per case', async () => {
        const world = makeWorld();
        const after = writeRun(world, {
            name: 'after',
            prompt,
            usage: { inputTokens: 1000, outputTokens: 150, cachedTokens: 400 },
            labels: labelsOf,
            body: body('이중바닥이 보입니다'),
        });
        const before = writeRun(world, {
            name: 'before',
            prompt,
            labels: labelsOf,
            body: body('조용한 장입니다'),
        });
        const out = join(world.dir, 'out');
        const deps = makeDeps();
        const code = await runFieldsEval(
            outputArgs(world, { run: after, before, gate: ['O1', 'V5'] }),
            deps
        );
        expect(code).toBe(2);
        const { summary, gates } = readSummary(out);
        expect(gates.map(g => g.id)).toEqual([
            'D7',
            'O1',
            'O2',
            'F1',
            'F2',
            'L1',
            'L2',
            'V1',
            'V2',
            'V3',
            'V4',
            'V5',
        ]);
        expect(gates.find(g => g.id === 'O1')?.pass).toBe(true);
        expect(gates.find(g => g.id === 'V5')?.pass).toBe(false);
        expect(JSON.stringify(summary)).toContain('"ratio"');
        expect(
            readFileSync(join(out, 'rows.jsonl'), 'utf-8').trim().split('\n')
        ).toHaveLength(world.manifest.cases.length);
        expect(deps.lines()).toContain('GATE V5 FAIL');
        expect(readRun(out).inputs).toMatchObject({ repeat: null });
    });

    it('uses a repeat run as the noise floor and refuses one with other prompts under another catalog', async () => {
        const world = makeWorld();
        const hashes = (full: string) => ({
            system: 's',
            stable: 'a',
            dynamic: 'b',
            full,
        });
        const after = writeRun(world, {
            name: 'after',
            prompt,
            body: body('요약'),
        });
        const before = writeRun(world, {
            name: 'before',
            prompt,
            body: body('요약'),
            hashes: hashes('h1'),
        });
        const same = writeRun(world, {
            name: 'repeat-same',
            prompt,
            body: body('요약'),
            hashes: hashes('h1'),
            meta: { skillsSha256: 'y' },
        });
        const code = await runFieldsEval(
            outputArgs(world, {
                run: after,
                before,
                repeat: same,
                gate: ['L1'],
            }),
            makeDeps()
        );
        expect(code).toBe(0);
        expect(readRun(join(world.dir, 'out')).inputs.repeat).toMatchObject({
            dir: same,
        });
        const other = writeRun(world, {
            name: 'repeat-other',
            prompt,
            body: body('요약'),
            hashes: hashes('h2'),
            meta: { skillsSha256: 'y' },
        });
        await expect(
            runFieldsEval(
                outputArgs(world, { run: after, before, repeat: other }),
                makeDeps()
            )
        ).rejects.toThrow('not a repeat pair');
        const unhashed = writeRun(world, {
            name: 'repeat-unhashed',
            prompt,
            body: body('요약'),
            meta: { skillsSha256: 'y' },
        });
        await expect(
            runFieldsEval(
                outputArgs(world, { run: after, before, repeat: unhashed }),
                makeDeps()
            )
        ).rejects.toThrow('not a repeat pair');
    });

    it('refuses a run of an unknown tier', async () => {
        const world = makeWorld();
        const odd = writeRun(world, {
            name: 'odd',
            tier: 'paid',
            body: body('요약'),
        });
        await expect(
            runFieldsEval(
                outputArgs(world, { run: odd, before: odd }),
                makeDeps()
            )
        ).rejects.toThrow('"paid" is neither free nor member');
    });

    it('refuses runs of different tiers and a skills directory with no skill', async () => {
        const world = makeWorld();
        const member = writeRun(world, { name: 'member', body: body('요약') });
        const free = writeRun(world, {
            name: 'free',
            tier: 'free',
            body: body('요약'),
        });
        await expect(
            runFieldsEval(
                outputArgs(world, { run: member, before: free }),
                makeDeps()
            )
        ).rejects.toThrow('tier differ');
        mkdirSync(join(world.dir, 'empty'));
        await expect(
            runFieldsEval(
                outputArgs(world, {
                    run: member,
                    before: member,
                    skills: join(world.dir, 'empty'),
                }),
                makeDeps()
            )
        ).rejects.toThrow('no skill file found');
    });
});

describe('runFieldsEval: claims', () => {
    const body =
        (summary: string, cards: readonly string[]) =>
        (c: { close: number }): ResultBody => ({
            ...asBody(defaultBody(c)),
            summary,
            indicatorResults: [],
            strategyResults: [],
            patternSummaries: cards.map(text => ({
                detected: true,
                summary: text,
            })),
            candlePatterns: [],
        });
    const skills = (world: World): string => {
        const dir = join(world.dir, 'skills');
        mkdirSync(join(dir, 'patterns'), { recursive: true });
        writeFileSync(
            join(dir, 'patterns', 'double-top.md'),
            '---\nname: 이중천장\ntype: pattern\ngating:\n  tier: gated\n  triggers: [double_top]\n---\nbody'
        );
        return dir;
    };
    const claimsArgs = (world: World, over: Partial<FieldsEvalArgs>) =>
        baseArgs({
            mode: 'claims',
            set: world.setDir,
            skills: skills(world),
            out: join(world.dir, 'out'),
            ...over,
        });
    const claiming = body('강한 지지가 있습니다', ['신뢰도가 높은 편입니다']);
    const quiet = body('조용한 장입니다', ['모양이 보입니다']);

    it('compares the claim rates of an after and a before run and writes the claim gates beside the WP-18 form of the shared ones', async () => {
        const world = makeWorld();
        const after = writeRun(world, {
            name: 'after',
            body: quiet,
            usage: { inputTokens: 1000, outputTokens: 180, cachedTokens: 400 },
        });
        const before = writeRun(world, { name: 'before', body: claiming });
        const out = join(world.dir, 'out');
        const code = await runFieldsEval(
            claimsArgs(world, { run: after, before, gate: ['C1', 'C2', 'O1'] }),
            makeDeps()
        );
        expect(code).toBe(0);
        const { summary, gates } = readSummary(out);
        expect(gates.map(g => g.id)).toEqual([
            'C1',
            'C2',
            'F1',
            'F2',
            'L1',
            'O1',
            'V1',
        ]);
        const claims = need(summary.claims, 'claims');
        expect(claims.paired).toBe(world.manifest.cases.length);
        expect(claims.reliability.before.count).toBe(
            world.manifest.cases.length
        );
        expect(claims.reliability.after.count).toBe(0);
        expect(need(claims.reliability.diff.high, 'high')).toBeLessThan(0);
        expect(gates.find(g => g.id === 'O1')?.pass).toBe(true);
        expect(readRun(out).inputs.language).toBe('ko');
        expect(
            readFileSync(join(out, 'rows.jsonl'), 'utf-8').trim().split('\n')
        ).toHaveLength(world.manifest.cases.length);
    });

    it('fails C1 and C2 when the claims stay and O1 when the output grows', async () => {
        const world = makeWorld();
        const after = writeRun(world, {
            name: 'after',
            body: claiming,
            usage: { inputTokens: 1000, outputTokens: 400, cachedTokens: 400 },
        });
        const before = writeRun(world, { name: 'before', body: claiming });
        const code = await runFieldsEval(
            claimsArgs(world, { run: after, before, gate: ['C1', 'C2', 'O1'] }),
            makeDeps()
        );
        expect(code).toBe(2);
        const { gates } = readSummary(join(world.dir, 'out'));
        expect(gates.filter(g => g.pass === false).map(g => g.id)).toEqual([
            'C1',
            'C2',
            'O1',
        ]);
    });

    it('reads an English run with the English wording', async () => {
        const world = makeWorld();
        const english = (text: string) => body(text, [text]);
        const after = writeRun(world, {
            name: 'after',
            body: english('quiet market'),
        });
        const before = writeRun(world, {
            name: 'before',
            body: english('strong support, highly reliable'),
        });
        const code = await runFieldsEval(
            claimsArgs(world, {
                run: after,
                before,
                lang: 'en',
                gate: ['C1', 'C2'],
            }),
            makeDeps()
        );
        expect(code).toBe(0);
        expect(readRun(join(world.dir, 'out')).inputs.language).toBe('en');
    });

    it('refuses a run that does not cover its cases instead of pairing what is there', async () => {
        const world = makeWorld();
        const after = writeRun(world, { name: 'after', body: quiet, take: 2 });
        const before = writeRun(world, { name: 'before', body: claiming });
        await expect(
            runFieldsEval(
                claimsArgs(world, { run: after, before, gate: ['C1'] }),
                makeDeps()
            )
        ).rejects.toThrow('is incomplete');
    });
});

describe('runFieldsEval: zone', () => {
    /** A plan whose zone ends 0.5% under the close: the 1% rule calls it in_zone, exact edges above_zone. */
    const bandBody = (c: { close: number }): ResultBody => ({
        trend: 'neutral',
        riskLevel: 'medium',
        summary: '조용한 장입니다.',
        keyLevels: { support: [], resistance: [] },
        actionRecommendation: {
            entryRecommendation: 'enter',
            entryPrices: [c.close * 0.985, c.close * 0.995],
            stopLoss: c.close * 0.9,
            takeProfitPrices: [c.close * 1.5],
            entry: '눌림을 기다립니다',
            positionAnalysis: '현재 가격은 구간 위입니다',
            riskReward: '',
            planState: {
                position: 'in_zone',
                distanceAtr: 0,
                atr: 1,
                stopDistanceAtr: 1,
                stopBasis: 'model',
            },
        },
    });
    const zoneArgs = (world: World, over: Partial<FieldsEvalArgs>) =>
        baseArgs({
            mode: 'zone',
            set: world.setDir,
            out: join(world.dir, 'out'),
            ...over,
        });

    it('reads where the close sits and the plan state under both rules', async () => {
        const world = makeWorld();
        const out = join(world.dir, 'out');
        const run = writeRun(world, {
            name: 'run',
            body: bandBody,
            labels: labelsOf,
        });
        const code = await runFieldsEval(
            zoneArgs(world, { run, gate: ['Z1'] }),
            makeDeps()
        );
        const { summary, gates } = readSummary(out);
        const zone = need(summary.zone, 'zone');
        expect(zone.n).toBe(world.manifest.cases.length);
        expect(zone.n3.basis).toBe('stored');
        expect(zone.positions.tolerance.in_zone.count).toBe(zone.n);
        expect(zone.positions.exact.above_zone.count).toBe(zone.n);
        expect(zone.toleranceInZoneGeometry.band_above.count).toBe(zone.n);
        expect(gates.map(g => g.id)).toEqual(['Z1', 'Z2', 'N2', 'N3']);
        // The stored state says in_zone for plans that sit above their zone: Z1 fails by design.
        expect(gates.find(g => g.id === 'Z1')?.pass).toBe(false);
        expect(code).toBe(2);
        expect(
            readFileSync(join(out, 'rows.jsonl'), 'utf-8').trim().split('\n')
        ).toHaveLength(zone.n);
    });

    it('restates the positions with exact edges without a model call', async () => {
        const world = makeWorld();
        const run = writeRun(world, { name: 'run', body: bandBody });
        const code = await runFieldsEval(
            zoneArgs(world, { run, restate: true, gate: ['N3', 'Z2'] }),
            makeDeps()
        );
        const { summary, gates } = readSummary(join(world.dir, 'out'));
        expect(need(summary.zone, 'zone').n3.basis).toBe('exact');
        // Every plan is above its zone: more than 85% in one position fails N3.
        expect(gates.find(g => g.id === 'N3')?.pass).toBe(false);
        // No plan is in_zone under the exact rule, so the cue rate among them is not computable.
        expect(gates.find(g => g.id === 'Z2')?.pass).toBeNull();
        expect(code).toBe(2);
        expect(readRun(join(world.dir, 'out')).inputs.restate).toBe(true);
    });

    it('pairs with a before run for N2', async () => {
        const world = makeWorld();
        const after = writeRun(world, { name: 'after', body: bandBody });
        const before = writeRun(world, { name: 'before', body: bandBody });
        await runFieldsEval(
            zoneArgs(world, { run: after, before, gate: ['N2'] }),
            makeDeps()
        );
        const { summary, gates } = readSummary(join(world.dir, 'out'));
        expect(need(summary.targetRoom, 'targetRoom').paired).toBe(
            world.manifest.cases.length
        );
        expect(gates.find(g => g.id === 'N2')?.pass).toBe(true);
    });

    it('fails on a run with no plan', async () => {
        const world = makeWorld();
        const run = writeRun(world, {
            name: 'run',
            body: () => ({ trend: 'neutral' }),
        });
        await expect(
            runFieldsEval(zoneArgs(world, { run }), makeDeps())
        ).rejects.toThrow('the run has no plan');
    });
});

describe('the arguments of claims and zone', () => {
    const claims = [
        '--mode',
        'claims',
        '--set',
        's',
        '--skills',
        'k',
        '--run',
        'r',
        '--before',
        'b',
        '--out',
        'o',
    ];
    const zone = ['--mode', 'zone', '--set', 's', '--run', 'r', '--out', 'o'];

    it('accepts the documented forms and reads --lang and --restate', () => {
        expect(
            parseFieldsEvalArgs([...claims, '--repeat', 'x', '--lang', 'en'])
        ).toMatchObject({
            mode: 'claims',
            lang: 'en',
            restate: false,
        });
        expect(
            parseFieldsEvalArgs([
                ...zone,
                '--restate',
                'exact',
                '--before',
                'b',
            ])
        ).toMatchObject({
            mode: 'zone',
            restate: true,
            lang: 'ko',
        });
        expect(
            parseFieldsEvalArgs([...claims, '--gate', 'C1,O1']).gate
        ).toEqual(['C1', 'O1']);
    });

    it('reads --legacy-zone for plan mode only', () => {
        const plan = [
            '--mode',
            'plan',
            '--set',
            's',
            '--run',
            'r',
            '--out',
            'o',
        ];
        expect(parseFieldsEvalArgs(plan).legacyZone).toBe(false);
        expect(parseFieldsEvalArgs([...plan, '--legacy-zone']).legacyZone).toBe(
            true
        );
        expect(() => parseFieldsEvalArgs([...zone, '--legacy-zone'])).toThrow(
            '--legacy-zone applies to plan only'
        );
    });

    it('refuses what does not apply', () => {
        expect(() =>
            parseFieldsEvalArgs([
                '--mode',
                'claims',
                '--set',
                's',
                '--out',
                'o',
            ])
        ).toThrow('claims: --run, --before and --skills are required');
        expect(() =>
            parseFieldsEvalArgs(['--mode', 'zone', '--set', 's', '--out', 'o'])
        ).toThrow('zone: --run is required');
        expect(() => parseFieldsEvalArgs([...zone, '--skills', 'k'])).toThrow(
            'zone: --member-run, --skills and --limit do not apply'
        );
        expect(() => parseFieldsEvalArgs([...zone, '--repeat', 'x'])).toThrow(
            'zone: --repeat applies to output and claims only'
        );
        expect(() =>
            parseFieldsEvalArgs([...claims, '--restate', 'exact'])
        ).toThrow('claims: --restate applies to zone only');
        expect(() => parseFieldsEvalArgs([...zone, '--restate', 'x'])).toThrow(
            '--restate must be "exact"'
        );
        expect(() => parseFieldsEvalArgs([...zone, '--lang', 'fr'])).toThrow(
            '--lang must be ko or en'
        );
        expect(() => parseFieldsEvalArgs([...zone, '--gate', 'C1'])).toThrow(
            '--gate ids not in mode zone'
        );
        expect(() => parseFieldsEvalArgs([...claims, '--limit', '3'])).toThrow(
            'claims: --member-run and --limit do not apply'
        );
    });
});

describe('the default dependencies', () => {
    it('read the git state of this checkout', () => {
        expect(defaultDeps.gitSha()).toMatch(/^[0-9a-f]{40}(\+dirty)?$/);
        const dirty = defaultDeps.dirtyDiffSha256();
        expect(dirty === null || /^[0-9a-f]{64}$/.test(dirty)).toBe(true);
    });
});
