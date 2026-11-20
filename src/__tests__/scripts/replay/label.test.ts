import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkPriceProvenance } from '@/domain/analysis/priceProvenance';
import { priceQuoting } from '@/domain/analysis/promptFormat';
import { OUTCOME_HORIZON_BARS } from '@/domain/outcomes/constants';
import { writeSet } from '../../../../scripts/replay/buildSet';
import { REPO_ROOT, readLabelRows } from '../../../../scripts/replay/fsUtil';
import {
    buildLabelRow,
    controlPrompts,
    labelRun,
    periodBaselinePct,
} from '../../../../scripts/replay/label';
import {
    executeJob,
    jobsFor,
    resultPath,
    type AnalyzeInput,
} from '../../../../scripts/replay/run';
import { JOINED_GENERATION_ERROR } from '../../../../scripts/replay/types';
import type {
    CaseResultFile,
    ReplayCase,
    StoredBars,
} from '../../../../scripts/replay/types';
import { evaluateAnalysisExchange } from '../../../../scripts/fixtures/evaluateAnalysisExchange';
import {
    makeTempDir,
    storedBars,
    tradingBars,
    writeBarsDir,
} from './replayFixtures';
import {
    ANALYSIS_EXCHANGE_FIXTURES,
    EXPECTED_EXCHANGES,
} from '../fixtures/loadAnalysisExchanges';

const temps = new Set<() => void>();

describe('replay labelling', () => {
    afterEach(() => {
        [...temps].forEach(remove => remove());
        temps.clear();
    });
    function temp(): string {
        const { dir, remove } = makeTempDir();
        temps.add(remove);
        return dir;
    }

    const ANCHOR_INDEX = 100;
    const FORWARD = 30;

    /** Flat at 100 up to the anchor bar, then +1% a bar. */
    const risingAfterAnchor = (i: number): number =>
        i <= ANCHOR_INDEX ? 100 : 100 * 1.01 ** (i - ANCHOR_INDEX);

    function usBars(
        symbol = 'NVDA',
        count = ANCHOR_INDEX + 1 + FORWARD,
        close = risingAfterAnchor
    ): StoredBars {
        return storedBars(
            symbol,
            tradingBars({ symbol, startIso: '2024-01-02', count, close })
        );
    }

    const dateOf = (stored: StoredBars, index: number): string =>
        new Date(stored.bars[index].time * 1000).toISOString().slice(0, 10);

    function caseAt(
        stored: StoredBars,
        index: number,
        symbol = 'NVDA'
    ): ReplayCase {
        const asOf = dateOf(stored, index);
        return {
            caseId: `${symbol}|${asOf}`,
            symbol,
            timeframe: '1Day',
            asOf,
            regime: 'range',
            variance: false,
        };
    }

    /** An analysis the labeller can read: zone 99..100, stop 90, targets 101.5 and 105. */
    function analysis(
        stored: StoredBars,
        index: number,
        overrides: Record<string, unknown> = {}
    ): Record<string, unknown> {
        return {
            trend: 'bullish',
            riskLevel: 'low',
            dataAsOf: {
                barTime: stored.bars[index].time,
                close: stored.bars[index].close,
            },
            actionRecommendation: {
                entryRecommendation: 'enter',
                entryPrices: [99, 100],
                stopLoss: 90,
                takeProfitPrices: [101.5, 105],
            },
            keyLevels: {
                support: [{ price: 97 }],
                resistance: [{ price: 103 }],
            },
            priceTargets: {
                bullish: { targets: [] },
                bearish: { targets: [] },
            },
            patternSummaries: [],
            ...overrides,
        };
    }

    function resultFile(
        c: ReplayCase,
        unfilteredResult: unknown,
        overrides: Partial<CaseResultFile> = {}
    ): CaseResultFile {
        return {
            caseId: c.caseId,
            symbol: c.symbol,
            asOf: c.asOf,
            repeat: 1,
            unfilteredResult,
            promptVersion: 'p34',
            promptHashes: null,
            promptDynamic: 'prompt text',
            usage: null,
            exchangeCount: 0,
            latencyMs: 1,
            error: null,
            ...overrides,
        };
    }

    describe('periodBaselinePct', () => {
        it('is the mean h-bar return over every start bar, in percent, per horizon', () => {
            const baseline = periodBaselinePct([100, 110, 121]);
            expect(baseline['1']).toBeCloseTo(10, 10);
            expect(Object.keys(baseline)).toEqual(
                OUTCOME_HORIZON_BARS.map(String)
            );
        });

        it('is null for a horizon the bars do not cover', () => {
            const baseline = periodBaselinePct([100, 110, 121]);
            expect(baseline['5']).toBeNull();
            expect(baseline['20']).toBeNull();
        });

        it('averages over all start bars, not just the first', () => {
            // returns over h=1: +100% then -50%: mean +25%
            expect(periodBaselinePct([100, 200, 100])['1']).toBeCloseTo(25, 10);
        });
    });

    describe('buildLabelRow: a labelled result', () => {
        const stored = usBars();
        const c = caseAt(stored, ANCHOR_INDEX);
        const row = buildLabelRow({
            case: c,
            result: resultFile(c, analysis(stored, ANCHOR_INDEX)),
            stored,
            controlPrompt: null,
        });

        it('labels the result against the bars after the asOf bar', () => {
            expect(row.status).toBe('labelled');
            expect(row.labels).toMatchObject({
                anchorSource: 'prompt_bar',
                anchorForming: false,
                adjFactor: 1,
                referencePrice: 100,
            });
            expect(row.labels?.plan).toMatchObject({
                outcome: 'target_first',
                exitOffset: 1,
                target: 101.5,
            });
            expect(row.labels?.plan.returnPct).toBeCloseTo(1.5, 10);
        });

        it('carries the case identity and the market of the symbol', () => {
            expect(row).toMatchObject({
                caseId: c.caseId,
                symbol: 'NVDA',
                market: 'us',
                regime: 'range',
                repeat: 1,
                error: null,
            });
        });

        it('keeps the subject the labels were computed from', () => {
            expect(row.subject?.plan).toMatchObject({
                recommendation: 'enter',
                entryLow: 99,
                entryHigh: 100,
                stop: 90,
                targets: [101.5, 105],
            });
        });

        it('confirms the result named the asOf bar', () => {
            expect(row.dataAsOfMatches).toBe(true);
        });

        it('carries the period baseline of the whole bars file', () => {
            expect(Object.keys(row.periodBaselinePct)).toEqual(
                OUTCOME_HORIZON_BARS.map(String)
            );
            expect(row.periodBaselinePct['1']).toBeGreaterThan(0);
        });

        it('survives the JSON round trip of labels.jsonl', () => {
            expect(JSON.parse(JSON.stringify(row))).toEqual(row);
        });
    });

    describe('buildLabelRow: rows that are not labelled', () => {
        const stored = usBars();
        const c = caseAt(stored, ANCHOR_INDEX);
        const build = (result: CaseResultFile, bars = stored, replayCase = c) =>
            buildLabelRow({
                case: replayCase,
                result,
                stored: bars,
                controlPrompt: null,
            });

        it('does not label a result stored without the prompt it was generated from (it joined another generation)', () => {
            const row = build(
                resultFile(c, analysis(stored, ANCHOR_INDEX), {
                    promptDynamic: null,
                })
            );
            expect(row).toMatchObject({
                status: 'failed',
                error: JOINED_GENERATION_ERROR,
                labels: null,
                subject: null,
                provenance: null,
            });
        });

        it('masks key-shaped text in the stored error of an old result', () => {
            const hexRun = 'f0e1'.repeat(10);
            const row = build(
                resultFile(c, null, {
                    error: `401 Bearer sk-abcdef0123456789abcdef ${hexRun}`,
                })
            );
            expect(row.status).toBe('failed');
            expect(row.error).toContain('[redacted]');
            expect(row.error).not.toContain(hexRun);
            expect(row.error).not.toContain('abcdef0123456789abcdef');
        });

        it('keeps a failed call with its error', () => {
            const row = build(resultFile(c, null, { error: 'provider down' }));
            expect(row).toMatchObject({
                status: 'failed',
                error: 'provider down',
                labels: null,
                subject: null,
            });
        });

        it('treats a missing result without an error as failed too', () => {
            expect(build(resultFile(c, null))).toMatchObject({
                status: 'failed',
                error: 'no result',
            });
        });

        it('marks a result that is not an analysis as subject_invalid', () => {
            expect(build(resultFile(c, { summary: 'x' }))).toMatchObject({
                status: 'subject_invalid',
                labels: null,
            });
        });

        it('marks a case whose asOf bar is not in the bars file as anchor_missing', () => {
            const missing = {
                ...c,
                asOf: '2019-01-02',
                caseId: 'NVDA|2019-01-02',
            };
            expect(
                build(
                    resultFile(missing, analysis(stored, ANCHOR_INDEX)),
                    stored,
                    missing
                ).status
            ).toBe('anchor_missing');
        });

        it('marks a result whose seen close is not the bar close basis as anchor_mismatch', () => {
            const mismatched = analysis(stored, ANCHOR_INDEX, {
                dataAsOf: { barTime: stored.bars[ANCHOR_INDEX].time, close: 1 },
            });
            expect(build(resultFile(c, mismatched)).status).toBe(
                'anchor_mismatch'
            );
        });

        it('marks a window with fewer than 20 forward bars as insufficient_forward', () => {
            const short = usBars('NVDA', ANCHOR_INDEX + 6);
            expect(
                build(resultFile(c, analysis(short, ANCHOR_INDEX)), short)
                    .status
            ).toBe('insufficient_forward');
        });

        it('keeps the subject and the provenance of an unlabelled row that has them', () => {
            const short = usBars('NVDA', ANCHOR_INDEX + 6);
            const row = buildLabelRow({
                case: c,
                result: resultFile(c, analysis(short, ANCHOR_INDEX)),
                stored: short,
                controlPrompt: null,
            });
            expect(row.subject).not.toBeNull();
            expect(row.provenance).not.toBeNull();
            expect(row.labels).toBeNull();
        });

        it('flags a result that names a different dataAsOf bar', () => {
            const other = analysis(stored, ANCHOR_INDEX, {
                dataAsOf: {
                    barTime: stored.bars[ANCHOR_INDEX - 1].time,
                    close: 100,
                },
            });
            expect(build(resultFile(c, other)).dataAsOfMatches).toBe(false);
        });

        it('leaves dataAsOfMatches null when the result has no dataAsOf and labels from the bar close', () => {
            const { dataAsOf: _dropped, ...without } = analysis(
                stored,
                ANCHOR_INDEX
            );
            const row = build(resultFile(c, without));
            expect(row.dataAsOfMatches).toBeNull();
            expect(row.status).toBe('labelled');
        });
    });

    describe('buildLabelRow: checks', () => {
        it('lists the plan invariants the result breaks, once each', () => {
            const stored = usBars();
            const c = caseAt(stored, ANCHOR_INDEX);
            const bad = analysis(stored, ANCHOR_INDEX, {
                actionRecommendation: {
                    entryRecommendation: 'enter',
                    entryPrices: [99, 100],
                    stopLoss: 105,
                    takeProfitPrices: [110, 108],
                },
            });
            const row = buildLabelRow({
                case: c,
                result: resultFile(c, bad),
                stored,
                controlPrompt: null,
            });
            expect(row.invariants).toContain('stop_below_zone');
            expect(row.invariants).toContain('targets_ascending');
            expect(new Set(row.invariants).size).toBe(row.invariants.length);
        });

        it('has no invariants for a clean plan', () => {
            const stored = usBars();
            const c = caseAt(stored, ANCHOR_INDEX);
            const row = buildLabelRow({
                case: c,
                result: resultFile(c, analysis(stored, ANCHOR_INDEX)),
                stored,
                controlPrompt: null,
            });
            expect(
                row.invariants.filter(id => id !== 'plan_check_consistent')
            ).toEqual([]);
        });

        it('checks provenance against the result prompt and the control prompt separately', () => {
            const stored = usBars();
            const c = caseAt(stored, ANCHOR_INDEX);
            const prompt = 'levels 99.00 100.00 90.00 101.50 105.00';
            const row = buildLabelRow({
                case: c,
                result: resultFile(c, analysis(stored, ANCHOR_INDEX), {
                    promptDynamic: prompt,
                }),
                stored,
                controlPrompt: 'unrelated 12.34',
            });
            expect(row.provenance?.ungrounded.plan).toBe(0);
            expect(row.provenance?.checked.plan).toBeGreaterThan(0);
            expect(row.provenanceControl?.checked).toEqual(
                row.provenance?.checked
            );
            expect(row.provenanceControl?.ungrounded.plan).toBe(
                row.provenance?.checked.plan
            );
        });

        it('has no provenance for a result too malformed for the check, and still labels it', () => {
            const stored = usBars();
            const c = caseAt(stored, ANCHOR_INDEX);
            const { priceTargets: _dropped, ...malformed } = analysis(
                stored,
                ANCHOR_INDEX
            );
            const row = buildLabelRow({
                case: c,
                result: resultFile(c, malformed),
                stored,
                controlPrompt: 'other',
            });
            expect(row.provenance).toBeNull();
            expect(row.provenanceControl).toBeNull();
            expect(row.status).toBe('labelled');
        });

        it('has no control without a control prompt', () => {
            const stored = usBars();
            const c = caseAt(stored, ANCHOR_INDEX);
            const row = buildLabelRow({
                case: c,
                result: resultFile(c, analysis(stored, ANCHOR_INDEX)),
                stored,
                controlPrompt: null,
            });
            expect(row.provenance).not.toBeNull();
            expect(row.provenanceControl).toBeNull();
        });

        it('reads Korean prices with the won precision (whole numbers)', () => {
            const kr = storedBars(
                '005930.KS',
                tradingBars({
                    symbol: '005930.KS',
                    startIso: '2024-01-02',
                    count: 131,
                    close: () => 70_000,
                })
            );
            const c = caseAt(kr, ANCHOR_INDEX, '005930.KS');
            const krAnalysis = analysis(kr, ANCHOR_INDEX, {
                actionRecommendation: {
                    entryRecommendation: 'enter',
                    entryPrices: [70_000],
                    stopLoss: 70_000,
                    takeProfitPrices: [70_000],
                },
            });
            const row = buildLabelRow({
                case: c,
                result: resultFile(c, krAnalysis, {
                    symbol: '005930.KS',
                    promptDynamic: 'close 70000 won',
                }),
                stored: kr,
                controlPrompt: null,
            });
            expect(row.market).toBe('kr');
            expect(row.provenance?.checked.plan).toBe(3);
            expect(row.provenance?.ungrounded.plan).toBe(0);
        });
    });

    describe('buildLabelRow on the real stored analyses', () => {
        const fixtures = ANALYSIS_EXCHANGE_FIXTURES.map(
            fixture => [fixture.id, fixture] as const
        );

        it('has the committed fixtures to run on', () => {
            expect(fixtures.length).toBe(12);
        });

        it.each(fixtures)(
            '%s: provenance equals the pinned report of the same result',
            (id, fixture) => {
                const evaluation = evaluateAnalysisExchange(fixture);
                const stored = usBars(
                    fixture.ticker,
                    ANCHOR_INDEX + 1 + FORWARD,
                    () => fixture.lastClose
                );
                const c = caseAt(stored, ANCHOR_INDEX, fixture.ticker);
                const result = {
                    ...evaluation.result,
                    dataAsOf: {
                        barTime: stored.bars[ANCHOR_INDEX].time,
                        close: fixture.lastClose,
                    },
                };
                const row = buildLabelRow({
                    case: c,
                    result: resultFile(c, JSON.parse(JSON.stringify(result)), {
                        promptDynamic: fixture.dynamic,
                    }),
                    stored,
                    controlPrompt: null,
                });
                const pinned = EXPECTED_EXCHANGES[id].provenance;
                expect(row.provenance?.checked).toEqual(pinned.checked);
                expect(row.provenance?.ungrounded).toEqual({
                    plan: pinned.plan.length,
                    other: pinned.other.length,
                    keyPrices: pinned.keyPrices.length,
                });
            }
        );

        it('checks the control against the other prompt exactly as checkPriceProvenance does', () => {
            const [first, second] = ANALYSIS_EXCHANGE_FIXTURES;
            const evaluation = evaluateAnalysisExchange(first);
            const stored = usBars(
                first.ticker,
                ANCHOR_INDEX + 1 + FORWARD,
                () => first.lastClose
            );
            const c = caseAt(stored, ANCHOR_INDEX, first.ticker);
            const result = JSON.parse(
                JSON.stringify({
                    ...evaluation.result,
                    dataAsOf: {
                        barTime: stored.bars[ANCHOR_INDEX].time,
                        close: first.lastClose,
                    },
                })
            );
            const row = buildLabelRow({
                case: c,
                result: resultFile(c, result, { promptDynamic: first.dynamic }),
                stored,
                controlPrompt: second.dynamic,
            });
            const direct = checkPriceProvenance({
                promptDynamic: second.dynamic,
                result,
                priceDecimals: priceQuoting(
                    first.lastClose,
                    'USD',
                    'equity',
                    'share'
                ).dp,
            });
            expect(row.provenanceControl?.ungrounded.plan).toBe(
                direct.plan.length
            );
            expect(row.provenanceControl?.checked.plan).toBe(
                direct.checked.plan
            );
        });
    });

    describe('controlPrompts', () => {
        const result = (
            symbol: string,
            prompt: string | null
        ): CaseResultFile => ({
            ...resultFile(
                {
                    caseId: `${symbol}|x`,
                    symbol,
                    asOf: 'x',
                    timeframe: '1Day',
                    regime: 'range',
                    variance: false,
                },
                null
            ),
            promptDynamic: prompt,
        });

        it('takes the next result from another symbol, wrapping around', () => {
            const controls = controlPrompts([
                result('A', 'pa1'),
                result('A', 'pa2'),
                result('B', 'pb'),
                result('C', 'pc'),
            ]);
            expect(controls).toEqual(['pb', 'pb', 'pc', 'pa1']);
        });

        it('skips a result that has no prompt', () => {
            expect(
                controlPrompts([
                    result('A', 'pa'),
                    result('B', null),
                    result('C', 'pc'),
                ])
            ).toEqual(['pc', 'pc', 'pa']);
        });

        it('is null when no other symbol has a prompt', () => {
            expect(
                controlPrompts([result('A', 'pa'), result('A', 'pa2')])
            ).toEqual([null, null]);
            expect(
                controlPrompts([result('A', 'pa'), result('B', null)])
            ).toEqual([null, 'pa']);
        });

        it('is empty for no results', () => {
            expect(controlPrompts([])).toEqual([]);
        });
    });

    describe('labelRun', () => {
        function makeRun() {
            const root = temp();
            const barsDir = join(root, 'src');
            writeBarsDir(barsDir, [
                {
                    symbol: 'NVDA',
                    bars: tradingBars({
                        symbol: 'NVDA',
                        startIso: '2020-01-02',
                        count: 700,
                    }),
                },
                {
                    symbol: '005930.KS',
                    bars: tradingBars({
                        symbol: '005930.KS',
                        startIso: '2020-01-02',
                        count: 700,
                    }),
                },
            ]);
            const setDir = join(root, 'set');
            const manifest = writeSet(barsDir, setDir, {
                createdAt: 'x',
                allowPartial: true,
                force: false,
            });
            return { setDir, runDir: join(root, 'run'), manifest };
        }

        /** Writes a result for each case through the real `executeJob`, with a stub analyzer that makes a readable plan. */
        async function runStub(
            setDir: string,
            runDir: string,
            manifest: ReturnType<typeof makeRun>['manifest']
        ) {
            const analyze = async (input: AnalyzeInput) => {
                const asOfBar = input.stored.bars.find(bar =>
                    new Date(bar.time * 1000)
                        .toISOString()
                        .startsWith(input.case.asOf)
                );
                const close = asOfBar?.close ?? 1;
                return {
                    unfilteredResult: {
                        trend: 'neutral',
                        riskLevel: 'low',
                        dataAsOf: { barTime: asOfBar?.time, close },
                        actionRecommendation: {
                            entryRecommendation: 'wait',
                            entryPrices: [close * 0.98, close],
                            stopLoss: close * 0.8,
                            takeProfitPrices: [close * 1.2],
                        },
                        keyLevels: { support: [], resistance: [] },
                        priceTargets: {
                            bullish: { targets: [] },
                            bearish: { targets: [] },
                        },
                        patternSummaries: [],
                    },
                    prompt: {
                        system: 's',
                        stable: 't',
                        dynamic: `dyn ${input.case.symbol}`,
                        promptVersion: 'p34',
                    },
                    exchanges: [],
                    error: null,
                    latencyMs: 1,
                };
            };
            const stored = new Map(
                Object.entries(manifest.bars).map(([symbol, entry]) => [
                    symbol,
                    JSON.parse(
                        readFileSync(join(setDir, entry.file), 'utf-8')
                    ) as StoredBars,
                ])
            );
            await Promise.all(
                jobsFor(manifest.cases, 1).map(job =>
                    executeJob(job, {
                        deps: {
                            analyze,
                            identity: {
                                coreGitSha: 'x',
                                promptTemplateVersion: 'p34',
                                model: 'm',
                                tier: 'member',
                            },
                        },
                        runDir,
                        keepRaw: false,
                        stored,
                    })
                )
            );
        }

        it('writes one row per result to labels.jsonl and returns them', async () => {
            const { setDir, runDir, manifest } = makeRun();
            await runStub(setDir, runDir, manifest);
            const rows = labelRun(setDir, runDir);
            expect(rows).toHaveLength(manifest.cases.length);
            expect(readLabelRows(runDir)).toEqual(rows);
            expect(new Set(rows.map(r => r.caseId))).toEqual(
                new Set(manifest.cases.map(c => c.caseId))
            );
        });

        it('labels results of both markets from the case regime and market', async () => {
            const { setDir, runDir, manifest } = makeRun();
            await runStub(setDir, runDir, manifest);
            const rows = labelRun(setDir, runDir);
            expect(rows.filter(r => r.market === 'kr').length).toBeGreaterThan(
                0
            );
            expect(rows.filter(r => r.market === 'us').length).toBeGreaterThan(
                0
            );
            expect(rows.length).toBeGreaterThan(0);
            expect(rows.every(r => r.status === 'labelled')).toBe(true);
            expect(
                rows.every(r => r.labels?.anchorSource === 'prompt_bar')
            ).toBe(true);
            rows.forEach(row => {
                const source = manifest.cases.find(
                    c => c.caseId === row.caseId
                );
                expect(row.regime).toBe(source?.regime);
            });
        });

        it('gives every row a control prompt from another symbol', async () => {
            const { setDir, runDir, manifest } = makeRun();
            await runStub(setDir, runDir, manifest);
            const rows = labelRun(setDir, runDir);
            expect(rows.length).toBeGreaterThan(0);
            expect(rows.every(r => r.provenanceControl !== null)).toBe(true);
        });

        it('refuses a run directory inside the repository before writing labels.jsonl', async () => {
            const { setDir } = makeRun();
            expect(() => labelRun(setDir, join(REPO_ROOT, 'some-run'))).toThrow(
                'inside the repository'
            );
        });

        it('does not label results that joined another generation, and keeps them out of labels.jsonl as labelled rows', async () => {
            const { setDir, runDir, manifest } = makeRun();
            await runStub(setDir, runDir, manifest);
            const [job] = jobsFor(manifest.cases, 1);
            const path = resultPath(runDir, job);
            const written = JSON.parse(
                readFileSync(path, 'utf-8')
            ) as CaseResultFile;
            writeFileSync(
                path,
                JSON.stringify({ ...written, promptDynamic: null })
            );
            const rows = labelRun(setDir, runDir);
            const joined = rows.filter(r => r.caseId === job.case.caseId);
            expect(joined).toHaveLength(1);
            expect(joined[0]).toMatchObject({ status: 'failed', labels: null });
            expect(rows.filter(r => r.status === 'labelled')).toHaveLength(
                rows.length - 1
            );
            expect(readLabelRows(runDir)).toEqual(rows);
        });

        it('keeps a key-shaped provider error out of labels.jsonl', async () => {
            const { setDir, runDir, manifest } = makeRun();
            await runStub(setDir, runDir, manifest);
            const [job] = jobsFor(manifest.cases, 1);
            const path = resultPath(runDir, job);
            const written = JSON.parse(
                readFileSync(path, 'utf-8')
            ) as CaseResultFile;
            const secret = 'sk-0123456789abcdefghij';
            writeFileSync(
                path,
                JSON.stringify({
                    ...written,
                    unfilteredResult: null,
                    error: `bad key ${secret}`,
                })
            );
            labelRun(setDir, runDir);
            const text = readFileSync(join(runDir, 'labels.jsonl'), 'utf-8');
            expect(text).toContain('[redacted]');
            expect(text).not.toContain(secret);
        });

        it('refuses a set whose bars changed', async () => {
            const { setDir, runDir, manifest } = makeRun();
            await runStub(setDir, runDir, manifest);
            const file = join(setDir, manifest.bars.NVDA.file);
            writeFileSync(file, `${readFileSync(file, 'utf-8')} `);
            expect(() => labelRun(setDir, runDir)).toThrow('set hash mismatch');
        });

        it('refuses a result whose case is not in the set', async () => {
            const { setDir, runDir, manifest } = makeRun();
            await runStub(setDir, runDir, manifest);
            const [job] = jobsFor(manifest.cases, 1);
            const path = resultPath(runDir, job);
            const written = JSON.parse(
                readFileSync(path, 'utf-8')
            ) as CaseResultFile;
            mkdirSync(join(runDir, 'results'), { recursive: true });
            writeFileSync(
                path,
                JSON.stringify({ ...written, caseId: 'NVDA|1999-01-01' })
            );
            expect(() => labelRun(setDir, runDir)).toThrow('not in the set');
        });
    });
});
