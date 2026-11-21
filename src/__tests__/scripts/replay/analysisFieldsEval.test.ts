import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    assertComparableRuns,
    defaultDeps,
    loadRunData,
    loadSetData,
    parseFieldsEvalArgs,
    runFieldsEval,
    splitCsvLine,
    trendRowsOfCsv,
    type FieldsEvalArgs,
    type FieldsEvalDeps,
} from '../../../../scripts/replay/analysisFieldsEval';
import { wilderAtrSeries } from '../../../../scripts/replay/analysisFieldsEvalCompute';
import { renderWithCore } from '../../../../scripts/replay/analysisFieldsEvalRender';
import type {
    CatalogSkill,
    PromptSample,
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
            JSON.parse(
                readFileSync(join(setDir, manifest.bars[symbol].file), 'utf-8')
            ) as StoredBars,
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
                promptHashes: null,
                promptDynamic: 'support 100.00',
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
        lines: () => log.mock.calls.map(([line]) => line).join('\n'),
    };
}

const readOut = (out: string, file: string): unknown =>
    JSON.parse(readFileSync(join(out, file), 'utf-8'));

interface Summary {
    summary: Record<string, unknown>;
    gates: { id: string; pass: boolean | null; value: string | null }[];
}

describe('parseFieldsEvalArgs', () => {
    const trend = ['--mode', 'trend', '--out', 'o', '--set', 's'];

    it('needs a valid mode and an output directory', () => {
        expect(() => parseFieldsEvalArgs(['--out', 'o'])).toThrow(
            '--mode must be one of trend, skills, plan'
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
        const run = readOut(out, 'run.json') as Record<string, unknown>;
        expect(run).toMatchObject({
            tool: 'analysisFieldsEval',
            mode: 'trend',
            arm: 'before',
            coreGitSha: 'abc123+dirty',
            dirtyDiffSha256: 'f'.repeat(64),
        });
        const { summary, gates } = readOut(out, 'summary.json') as Summary;
        const plumbing = summary.plumbing as { n: number; equal: number };
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
        const inputs = (
            readOut(out, 'run.json') as { inputs: Record<string, number> }
        ).inputs;
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
        const manifest = JSON.parse(
            readFileSync(manifestPath, 'utf-8')
        ) as ReplayManifest;
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
        const { summary, gates } = readOut(out, 'summary.json') as Summary;
        const plumbing = summary.plumbing as {
            total: number;
            n: number;
            equal: number;
        };
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
        const { summary } = readOut(out, 'summary.json') as Summary;
        expect((summary.stored as { n: number }).n).toBe(3);
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
        const { summary } = readOut(
            join(world.dir, 'out'),
            'summary.json'
        ) as Summary;
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
        const run = readOut(out, 'run.json') as {
            inputs: { labelsSha256: string };
        };
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
        const { summary, gates } = readOut(out, 'summary.json') as Summary;
        const plan = summary.plan as {
            n: number;
            basis: string;
            positions: Record<string, { count: number }>;
        };
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
        const sample = summary.p7Sample as Record<string, string[]>;
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
        const { summary } = readOut(out, 'summary.json') as Summary;
        expect((summary.plan as { basis: string }).basis).toBe('headline');
        expect(summary.planAllResults).not.toBeNull();
        const outcomes = summary.outcomesByPosition as Record<
            string,
            { n: number }
        >;
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
        const { summary } = readOut(broken.out, 'summary.json') as Summary;
        const plan = summary.plan as { n: number };
        const all = summary.planAllResults as {
            n: number;
            stop: { mismatch: number };
        };
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
        const { summary } = readOut(out, 'summary.json') as Summary;
        const outcomes = summary.outcomesByPosition as Record<
            string,
            { n: number }
        >;
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
        const { summary, gates } = readOut(out, 'summary.json') as Summary;
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
                                ...(body.actionRecommendation as ResultBody),
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
        const { summary } = readOut(out, 'summary.json') as Summary;
        const plan = summary.plan as {
            stopBasis: Record<string, number>;
            recompute: { withStoredState: number };
        };
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
                                ...(body.actionRecommendation as ResultBody),
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
        const { summary } = readOut(out, 'summary.json') as Summary;
        const plan = summary.plan as { reasons: Record<string, number> };
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
        const { summary, gates } = readOut(out, 'summary.json') as Summary;
        expect((summary.skills as { cases: number }).cases).toBe(3);
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
        const { gates } = readOut(out, 'summary.json') as Summary;
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

describe('the default dependencies', () => {
    it('read the git state of this checkout', () => {
        expect(defaultDeps.gitSha()).toMatch(/^[0-9a-f]{40}(\+dirty)?$/);
        const dirty = defaultDeps.dirtyDiffSha256();
        expect(dirty === null || /^[0-9a-f]{64}$/.test(dirty)).toBe(true);
    });
});
