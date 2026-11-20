import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeSet } from '../../../../scripts/replay/buildSet';
import { labelRun } from '../../../../scripts/replay/label';
import {
    compareChecks,
    diffCell,
    diffStatCell,
    meanCell,
    pct,
    rateCell,
    renderReport,
    type ReportInput,
} from '../../../../scripts/replay/report';
import { computeFlipRates } from '../../../../scripts/replay/reportCompute';
import {
    parseRunArgs,
    runReplay,
    type AnalyzeInput,
    type RunDeps,
} from '../../../../scripts/replay/run';
import type { LabelRow, RunMeta } from '../../../../scripts/replay/types';
import {
    makeLabels,
    makeRow,
    makeTempDir,
    tradingBars,
    writeBarsDir,
} from './replayFixtures';

const temps = new Set<() => void>();

describe('replay report', () => {
    afterEach(() => {
        [...temps].forEach(remove => remove());
        temps.clear();
    });

    const input = (
        rows: readonly LabelRow[],
        extra: Partial<ReportInput> = {}
    ): ReportInput => ({
        title: 'A',
        rows,
        meta: null,
        compare: null,
        noise: { rows, source: 'this run' },
        ...extra,
    });

    describe('formatting', () => {
        it('prints a share as a percent and an empty one as a dash', () => {
            expect(pct(0.1234)).toBe('12.3%');
            expect(pct(null)).toBe('–');
        });

        it('prints a rate with its n, and n=0 explicitly', () => {
            expect(rateCell({ count: 3, n: 12, share: 0.25 })).toBe(
                '3/12 (25.0%)'
            );
            expect(rateCell({ count: 0, n: 0, share: null })).toBe('– (n=0)');
        });

        it('prints a mean with its standard error and n', () => {
            expect(meanCell({ n: 4, mean: 1.234, se: 0.456 })).toBe(
                '+1.23% ±0.46 (n=4)'
            );
            expect(meanCell({ n: 1, mean: -0.5, se: null }, '')).toBe(
                '-0.50 (n=1)'
            );
            expect(meanCell({ n: 0, mean: null, se: null })).toBe('– (n=0)');
        });
    });

    describe('diffCell', () => {
        const flips = computeFlipRates([
            makeRow({
                repeat: 1,
                labels: makeLabels({ plan: { outcome: 'target_first' } }),
            }),
            makeRow({
                repeat: 2,
                labels: makeLabels({ plan: { outcome: 'stop_first' } }),
            }),
        ]);

        it('marks a difference below the flip rate as within run-to-run noise', () => {
            expect(flips.planOutcome.rate).toBe(1);
            expect(diffCell(0.04, flips, 'planOutcome')).toBe(
                '+4.0pp (within run-to-run noise)'
            );
        });

        it('leaves a difference above the flip rate unmarked', () => {
            const calm = computeFlipRates([
                makeRow({ repeat: 1 }),
                makeRow({ repeat: 2 }),
            ]);
            expect(calm.planOutcome.rate).toBe(0);
            expect(diffCell(-0.04, calm, 'planOutcome')).toBe('-4.0pp');
        });

        it('says the noise floor is unknown without flip data or a label', () => {
            expect(diffCell(0.04, null, 'planOutcome')).toBe(
                '+4.0pp (noise floor unknown)'
            );
            expect(diffCell(0.04, flips, null)).toBe(
                '+4.0pp (noise floor unknown)'
            );
        });

        it('is a dash for no difference', () => {
            expect(diffCell(null, flips, 'planOutcome')).toBe('–');
        });
    });

    describe('renderReport', () => {
        const tf = (
            verdict: 'enter' | 'wait',
            outcome: 'target_first' | 'stop_first',
            caseId: string
        ) =>
            makeRow({
                caseId,
                labels: makeLabels({
                    plan: {
                        recommendation: verdict,
                        outcome,
                        rwNullTargetFirst: 0.5,
                        returnPct: 1,
                        gap: false,
                        baselineSameLengthPct: 0,
                    },
                }),
            });
        const rows = [
            tf('enter', 'target_first', 'A|1'),
            tf('enter', 'stop_first', 'B|1'),
            tf('wait', 'stop_first', 'C|1'),
        ];

        it('splits every plan table by recommendation and prints n', () => {
            const text = renderReport(input(rows));
            expect(text).toContain(
                '## 3. target_first against the random-walk null'
            );
            expect(text).toMatch(/\| all \| enter \| 2 \| 1\/2 \(50\.0%\) \|/);
            expect(text).toMatch(/\| all \| wait \| 1 \| 0\/1 \(0\.0%\) \|/);
        });

        it('states the all-triggered denominator and that non-triggered outcomes are never wins', () => {
            const text = renderReport(input(rows));
            expect(text).toContain('ALL triggered plans');
            expect(text).toContain('never counted as wins');
        });

        it('says the noise floor is unknown when no case has two runs, and never prints a within-noise note then', () => {
            const text = renderReport(
                input(rows, { compare: { title: 'B', rows, meta: null } })
            );
            expect(text).toContain('Noise floor unknown');
            expect(text).toContain('(noise floor unknown)');
            expect(text).not.toContain('within run-to-run noise)');
        });

        it('prints a small run-to-run difference as within run-to-run noise when repeats show flips', () => {
            const repeats = [
                makeRow({
                    caseId: 'V|1',
                    repeat: 1,
                    labels: makeLabels({
                        plan: {
                            outcome: 'target_first',
                            rwNullTargetFirst: 0.5,
                        },
                    }),
                }),
                makeRow({
                    caseId: 'V|1',
                    repeat: 2,
                    labels: makeLabels({
                        plan: { outcome: 'stop_first', rwNullTargetFirst: 0.5 },
                    }),
                }),
            ];
            const changed = rows.map((row, i) =>
                i === 1 ? tf('enter', 'target_first', 'B|1') : row
            );
            const text = renderReport(
                input(rows, {
                    compare: { title: 'B', rows: changed, meta: null },
                    noise: { rows: repeats, source: '/runs/variance' },
                })
            );
            expect(text).toContain(
                'measured on the repeated runs in /runs/variance'
            );
            expect(text).toContain('(within run-to-run noise)');
        });

        it('does not compare a model-minus-null difference with the run-to-run flip rate', () => {
            const text = renderReport(input(rows));
            expect(text).not.toContain('within run-to-run noise)');
            expect(text).toContain('+0.0pp ±50.0 (n=2)');
        });

        it('warns about anchors that cannot exist in a replay and keeps them out of the headline', () => {
            const odd = makeRow({
                caseId: 'G|1',
                labels: makeLabels({
                    anchorSource: 'generated_at',
                    plan: { outcome: 'target_first', rwNullTargetFirst: 0.5 },
                }),
            });
            const text = renderReport(input([...rows, odd]));
            expect(text).toContain(
                'WARNING: 1 rows are anchored on the generation time'
            );
            expect(text).toContain(
                'Excluded bucket (generated_at or unobserved anchor): 1 rows'
            );
            expect(text).toMatch(/\| all \| enter \| 2 \| 1\/2 \(50\.0%\) \|/);
        });

        it('warns when a result named another dataAsOf bar', () => {
            expect(
                renderReport(input([makeRow({ dataAsOfMatches: false })]))
            ).toContain('name a dataAsOf bar other than');
        });

        it('prints no warnings for a clean run', () => {
            expect(renderReport(input(rows))).toContain('No warnings.');
        });

        it('shows gap exits apart from level exits', () => {
            expect(renderReport(input(rows))).toContain('return, gap exits');
        });

        it('prints the level table against the placebo with the evaluated-pair n', () => {
            const withLevel = makeRow({
                labels: makeLabels({
                    levels: [
                        {
                            role: 'support',
                            price: 97,
                            outcome: 'respected',
                            skipReason: null,
                            distanceAtr: 1,
                            touchOffset: 1,
                            resolveOffset: 2,
                            gap: false,
                            placebo: [
                                {
                                    shiftAtr: 0.5,
                                    outcome: 'broken',
                                    skipReason: null,
                                    touchOffset: 1,
                                },
                                {
                                    shiftAtr: -0.5,
                                    outcome: 'respected',
                                    skipReason: null,
                                    touchOffset: 1,
                                },
                            ],
                        },
                    ],
                }),
            });
            const text = renderReport(input([withLevel]));
            expect(text).toMatch(
                /\| all \| enter \| \+0\.5 \| 1 \| 1\/1 \(100\.0%\) \| 0\/1 \(0\.0%\) \| \+100\.0pp/
            );
        });

        it('lists the forward-return baselines per horizon', () => {
            const text = renderReport(input(rows));
            expect(text).toContain('excess over window baseline');
            expect(text).toMatch(/\| all \| enter \| 20 \|/);
        });

        it('includes the comparison section only with a second run', () => {
            expect(renderReport(input(rows))).not.toContain(
                '## 10. Comparison'
            );
            const text = renderReport(
                input(rows, { compare: { title: 'B', rows, meta: null } })
            );
            expect(text).toContain('## 10. Comparison, B against A');
            expect(text).toContain('Pairs by case and repeat: 3');
        });

        it('prints the provenance control and the Korean tick-snap caveat', () => {
            const prov = {
                checked: { plan: 4, other: 0, keyPrices: 0 },
                ungrounded: { plan: 1, other: 0, keyPrices: 0 },
            };
            const text = renderReport(
                input([
                    makeRow({
                        provenance: prov,
                        provenanceControl: {
                            ...prov,
                            ungrounded: { plan: 3, other: 0, keyPrices: 0 },
                        },
                    }),
                ])
            );
            expect(text).toContain('control: same plans, other prompt');
            expect(text).toContain('1/4 (25.0%)');
            expect(text).toContain('3/4 (75.0%)');
            expect(text).toContain('tick-snapped');
        });

        it('includes the run identity when run.json is known', () => {
            const meta = {
                setId: 'replay-v1',
                setBarsSha256: 'bars',
                coreGitSha: 'abc',
                promptTemplateVersion: 'p34',
                model: 'm',
                tier: 'member',
                skillsSha256: 'f'.repeat(64),
                repeat: 1,
                subset: null,
                limit: null,
                startedAt: 'x',
            };
            expect(renderReport(input(rows, { meta }))).toContain(
                'core abc, prompt p34'
            );
            expect(renderReport(input(rows))).toContain('A: no run.json');
        });
    });

    describe('warnings look at every repeat', () => {
        it('reports a bad row in repeat 2 while the headline statistics stay on repeat 1', () => {
            const clean = makeRow({ caseId: 'A|1', repeat: 1 });
            const odd = makeRow({
                caseId: 'A|1',
                repeat: 2,
                dataAsOfMatches: false,
                labels: makeLabels({ anchorSource: 'generated_at' }),
            });
            const text = renderReport(input([clean, odd]));
            expect(text).toContain(
                'WARNING: 1 rows are anchored on the generation time'
            );
            expect(text).toContain('name a dataAsOf bar other than');
            expect(text).toContain(
                'Excluded bucket (generated_at or unobserved anchor): 1 rows'
            );
            expect(text).toContain(
                'repeat 1 of each case only (1 rows, 1 headline)'
            );
        });

        it('has no warning when only the clean repeats exist', () => {
            const rows = [1, 2].map(repeat =>
                makeRow({ caseId: 'A|1', repeat })
            );
            expect(renderReport(input(rows))).toContain('No warnings.');
        });
    });

    describe('repeats and headline counts', () => {
        it('counts each case once in the headline sections, whatever its repeats', () => {
            const repeats = [1, 2, 3].map(repeat =>
                makeRow({ caseId: 'A|1', repeat })
            );
            const text = renderReport(input(repeats));
            expect(text).toContain(
                'repeat 1 of each case only (1 rows, 1 headline)'
            );
            expect(text).toMatch(/\| all \| 1 \| 0\/1/);
            expect(text).not.toMatch(/\| all \| 3 \|/);
        });

        it('keeps all repeats in the variance section', () => {
            const repeats = [1, 2, 3].map(repeat =>
                makeRow({ caseId: 'A|1', repeat })
            );
            const text = renderReport(input(repeats));
            expect(text).toContain('Cases with at least two runs: 1');
            expect(text).toContain('1 cases with 3');
            expect(text).toContain(
                "A case with fewer runs than the run's repeat count is still used"
            );
        });
    });

    describe('diffStatCell', () => {
        it('prints the difference in pp with its sampling standard error and n', () => {
            expect(diffStatCell({ n: 12, mean: 0.0312, se: 0.0245 })).toBe(
                '+3.1pp ±2.5 (n=12)'
            );
        });

        it('omits the standard error for one observation and prints a dash for none', () => {
            expect(diffStatCell({ n: 1, mean: -0.2, se: null })).toBe(
                '-20.0pp (n=1)'
            );
            expect(diffStatCell({ n: 0, mean: null, se: null })).toBe(
                '– (n=0)'
            );
        });
    });

    describe('comparing runs', () => {
        const meta = (over: Partial<RunMeta> = {}): RunMeta => ({
            setId: 'replay-v1',
            setBarsSha256: 'bars',
            coreGitSha: 'a',
            promptTemplateVersion: 'p34',
            model: 'm',
            tier: 'member',
            skillsSha256: 's',
            repeat: 1,
            subset: null,
            limit: null,
            startedAt: 'x',
            ...over,
        });

        it('has no complaint about two runs on the same data with different code', () => {
            expect(compareChecks(meta(), meta({ coreGitSha: 'b' }))).toEqual({
                errors: [],
                warnings: [],
            });
        });

        it('fails when the sets or their bars differ', () => {
            expect(
                compareChecks(meta(), meta({ setId: 'other' })).errors
            ).toHaveLength(1);
            expect(
                compareChecks(meta(), meta({ setBarsSha256: 'other' })).errors
            ).toEqual([
                'the runs used different bars (set bars hashes differ)',
            ]);
        });

        it('warns, without failing, when the models differ', () => {
            const checks = compareChecks(
                meta(),
                meta({ coreGitSha: 'b', model: 'x' })
            );
            expect(checks.errors).toEqual([]);
            expect(checks.warnings).toEqual([
                'the runs used different models (m, x)',
            ]);
        });

        it('warns when core sha and prompt version are identical, and not when only one of them is', () => {
            expect(compareChecks(meta(), meta()).warnings).toHaveLength(1);
            expect(
                compareChecks(meta(), meta({ promptTemplateVersion: 'p35' }))
                    .warnings
            ).toEqual([]);
            expect(
                compareChecks(meta(), meta({ coreGitSha: 'b' })).warnings
            ).toEqual([]);
        });

        it('warns that nothing can be checked when a run.json is missing', () => {
            expect(compareChecks(null, meta()).warnings).toHaveLength(1);
            expect(compareChecks(meta(), null).errors).toEqual([]);
        });

        it('refuses to render a comparison of different sets', () => {
            const rows = [makeRow()];
            expect(() =>
                renderReport(
                    input(rows, {
                        meta: meta(),
                        compare: {
                            title: 'B',
                            rows,
                            meta: meta({ setBarsSha256: 'other' }),
                        },
                    })
                )
            ).toThrow('cannot compare: the runs used different bars');
        });

        it("prints B's run summary and the warnings in the report", () => {
            const rows = [makeRow()];
            const text = renderReport(
                input(rows, {
                    meta: meta(),
                    compare: { title: 'B (/b)', rows, meta: meta() },
                })
            );
            expect(text).toContain('B (/b): set replay-v1, core a, prompt p34');
            expect(text).toContain(
                'WARNING: core sha and prompt version are identical'
            );
        });

        it('compares repeat 1 of each case only', () => {
            const a = [1, 2, 3].map(repeat =>
                makeRow({ caseId: 'A|1', repeat })
            );
            const text = renderReport(
                input(a, { compare: { title: 'B', rows: a, meta: null } })
            );
            expect(text).toContain('Pairs by case and repeat: 1');
        });
    });

    describe('a synthetic run, end to end with a stubbed provider', () => {
        it('runs, labels and reports, with variance across repeats', async () => {
            const { dir, remove } = makeTempDir();
            temps.add(remove);
            const barsDir = join(dir, 'src');
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
            const setDir = join(dir, 'set');
            const manifest = writeSet(barsDir, setDir, {
                createdAt: 'x',
                allowPartial: true,
                force: false,
            });
            const skills = join(dir, 'app', 'skills');
            mkdirSync(skills, { recursive: true });
            writeFileSync(join(skills, 'a.md'), 'x');
            const runDir = join(dir, 'run');

            const seen = new Map<string, number>();
            const analyze = vi.fn(async (call: AnalyzeInput) => {
                seen.set(
                    call.case.caseId,
                    (seen.get(call.case.caseId) ?? 0) + 1
                );
                const bar = call.stored.bars.find(b =>
                    new Date(b.time * 1000)
                        .toISOString()
                        .startsWith(call.case.asOf)
                );
                const close = bar?.close ?? 1;
                // The second repeat disagrees on the trend: a flip the variance section must show.
                const repeatTwo = seen.get(call.case.caseId) === 2;
                return {
                    unfilteredResult: {
                        trend: repeatTwo ? 'bearish' : 'bullish',
                        riskLevel: 'low',
                        dataAsOf: { barTime: bar?.time, close },
                        actionRecommendation: {
                            entryRecommendation: 'enter',
                            entryPrices: [close * 0.98, close],
                            stopLoss: close * 0.8,
                            takeProfitPrices: [close * 1.02],
                        },
                        keyLevels: {
                            support: [{ price: close * 0.97 }],
                            resistance: [],
                        },
                        priceTargets: {
                            bullish: { targets: [] },
                            bearish: { targets: [] },
                        },
                        patternSummaries: [],
                    },
                    prompt: {
                        system: 's',
                        stable: 't',
                        dynamic: `dyn ${call.case.symbol}`,
                        promptVersion: 'p34',
                    },
                    exchanges: [],
                    error: null,
                    latencyMs: 1,
                };
            });
            const deps: RunDeps = {
                log: () => undefined,
                now: () => new Date('2026-11-21T12:00:00Z'),
                loadExecuteDeps: async () => ({
                    analyze,
                    identity: {
                        coreGitSha: 'x',
                        promptTemplateVersion: 'p34',
                        model: 'm',
                        tier: 'member',
                    },
                }),
            };
            const planned = manifest.cases.length * 2;
            const code = await runReplay(
                parseRunArgs([
                    '--set',
                    setDir,
                    '--out',
                    runDir,
                    '--skills',
                    skills,
                    '--repeat',
                    '2',
                    '--execute',
                    '--approved-calls',
                    String(planned),
                ]),
                deps
            );
            expect(code).toBe(0);
            expect(analyze).toHaveBeenCalledTimes(planned);

            const rows = labelRun(setDir, runDir);
            expect(rows).toHaveLength(planned);
            const text = renderReport({
                title: 'run',
                rows,
                meta: null,
                compare: null,
                noise: { rows, source: 'this run' },
            });
            expect(computeFlipRates(rows).trend).toEqual({
                flips: manifest.cases.length,
                n: manifest.cases.length,
                rate: 1,
            });
            expect(text).toContain('## 9. Variance across repeats');
            expect(text).toContain(
                `Cases with at least two runs: ${manifest.cases.length}`
            );
            expect(text).toContain('## 1. Rows, failures and missing plans');
            expect(text).toContain(`| all | ${manifest.cases.length} |`);
            expect(text).toContain(
                'the headline sections use repeat 1 of each case only'
            );
            expect(text).toContain(`${manifest.cases.length} cases with 2`);
            expect(text).toContain('No warnings.');
            expect(text).not.toContain('Noise floor unknown');
        });
    });
});
