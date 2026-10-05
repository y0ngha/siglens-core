import { describe, expect, it } from 'vitest';
import {
    deriveMacroRegime,
    withComputedRegime,
} from '@/domain/economy/deriveMacroRegime';
import type {
    EconomicIndicatorSeries,
    EconomySnapshot,
    MacroBriefingResponse,
} from '@/domain/economy/types';

type Pair = readonly [latest: number, previous: number] | null;

function series(name: string, pair: Pair): EconomicIndicatorSeries {
    return {
        name,
        latest: pair === null ? null : { date: '2026-09-01', value: pair[0] },
        previous: pair === null ? null : { date: '2026-08-01', value: pair[1] },
        trend: [],
    };
}

interface Rows {
    unemployment?: Pair;
    /** Raw FMP thousands: [159_044, 159_015] is +29,000 persons. */
    payroll?: Pair;
    recession?: Pair;
    production?: Pair;
    inflation?: Pair;
    /** 2s10s inputs; omitted → no treasury row. */
    treasury?: { year2: number; year10: number } | null;
}

/** Healthy baseline month: payroll +150,000, flat unemployment, low recession probability, positive curve. */
const HEALTHY: Required<Rows> = {
    unemployment: [4.1, 4.1],
    payroll: [159_150, 159_000],
    recession: [0.6, 0.7],
    production: [103.5, 103.0],
    inflation: [2.3, 2.3],
    treasury: { year2: 4.0, year10: 4.45 },
};

function snapshot(overrides: Rows = {}): EconomySnapshot {
    const rows = { ...HEALTHY, ...overrides };
    const indicators: EconomicIndicatorSeries[] = [
        series('unemploymentRate', rows.unemployment),
        series('totalNonfarmPayroll', rows.payroll),
        series('smoothedUSRecessionProbabilities', rows.recession),
        series('industrialProductionTotalIndex', rows.production),
        series('inflationRate', rows.inflation),
    ];
    return {
        indicators,
        treasury:
            rows.treasury === null
                ? null
                : { date: '2026-09-30', ...rows.treasury },
        calendar: [],
    };
}

describe('deriveMacroRegime', () => {
    describe('contraction', () => {
        it('recession probability above 50% decides it, ahead of every other rule', () => {
            const r = deriveMacroRegime(snapshot({ recession: [55, 40] }));
            expect(r.regime).toBe('contraction');
            expect(r.firedRule).toBe('contraction:recessionHigh');
            expect(r.signals).toEqual(['recession probability high']);
        });

        it('exactly 50% is not above 50%', () => {
            expect(
                deriveMacroRegime(snapshot({ recession: [50, 45] })).regime
            ).not.toBe('contraction');
        });

        it('job losses together with rising unemployment', () => {
            const r = deriveMacroRegime(
                snapshot({
                    payroll: [158_950, 159_000],
                    unemployment: [4.3, 4.1],
                })
            );
            expect(r.regime).toBe('contraction');
            expect(r.firedRule).toBe('contraction:jobLossRisingUnemployment');
            expect(r.signals).toEqual([
                'payrolls shrinking',
                'unemployment rate rising',
            ]);
        });
    });

    describe('recovery', () => {
        const IMPROVING: Rows = {
            payroll: [159_150, 159_000],
            unemployment: [4.0, 4.2],
            recession: [12, 20],
        };

        it('needs prior distress plus improving rows', () => {
            const r = deriveMacroRegime(snapshot(IMPROVING));
            expect(r.regime).toBe('recovery');
            expect(r.firedRule).toBe('recovery');
            expect(r.signals).toContain('payrolls growing');
            expect(r.signals).toContain('unemployment rate falling');
        });

        it('counts the previous recession reading as distress too', () => {
            expect(
                deriveMacroRegime(
                    snapshot({ ...IMPROVING, recession: [8, 14] })
                ).regime
            ).toBe('recovery');
        });

        it('without prior distress the same improvement is an expansion, not a recovery', () => {
            const r = deriveMacroRegime(
                snapshot({ ...IMPROVING, recession: [2, 4] })
            );
            expect(r.regime).toBe('expansion');
        });

        it('a rising recession probability is not a recovery', () => {
            expect(
                deriveMacroRegime(
                    snapshot({ ...IMPROVING, recession: [20, 12] })
                ).regime
            ).not.toBe('recovery');
        });
    });

    describe('slowdown', () => {
        it('a payroll loss alone is enough, even with flat unemployment', () => {
            const r = deriveMacroRegime(
                snapshot({ payroll: [158_990, 159_000] })
            );
            expect(r.regime).toBe('slowdown');
            expect(r.firedRule).toBe('slowdown:payrollShrinking');
            expect(r.signals).toEqual(['payrolls shrinking']);
        });

        it('the 2026-10-05 snapshot shape (+29,000 jobs, unemployment 4.1→4.2, no previous production value) is a slowdown', () => {
            const r = deriveMacroRegime({
                indicators: [
                    series('federalFunds', [3.75, 3.63]),
                    series('inflationRate', [2.36, 2.36]),
                    series('CPI', null),
                    series('GDP', null),
                    {
                        name: 'industrialProductionTotalIndex',
                        latest: { date: '2026-08-01', value: 103.0682 },
                        previous: null,
                        trend: [],
                    },
                    {
                        name: 'smoothedUSRecessionProbabilities',
                        latest: { date: '2026-08-01', value: 0.62 },
                        previous: null,
                        trend: [],
                    },
                    series('unemploymentRate', [4.2, 4.1]),
                    series('totalNonfarmPayroll', [159_044, 159_015]),
                    series('initialClaims', [197_000, 198_000]),
                ],
                treasury: { date: '2026-10-05', year2: 4.0, year10: 4.45 },
                calendar: [],
            });
            expect(r.regime).toBe('slowdown');
            expect(r.firedRule).toBe('slowdown:multipleSignals');
            expect(r.signals).toEqual([
                'unemployment rate rising',
                'monthly job gains weak',
            ]);
        });

        it('two signals suffice: falling production plus an inverted curve', () => {
            const r = deriveMacroRegime(
                snapshot({
                    production: [102.0, 103.0],
                    treasury: { year2: 4.5, year10: 4.2 },
                })
            );
            expect(r.regime).toBe('slowdown');
            expect(r.signals).toEqual([
                'industrial production falling',
                'yield curve inverted',
            ]);
        });

        it('an elevated recession probability counts as a signal', () => {
            const r = deriveMacroRegime(
                snapshot({
                    recession: [11, 11],
                    treasury: { year2: 4.5, year10: 4.2 },
                })
            );
            expect(r.regime).toBe('slowdown');
            expect(r.signals).toContain('recession probability elevated');
        });

        it('the unemployment move is compared after rounding (4.5 − 4.4 is 0.0999… in floating point)', () => {
            const r = deriveMacroRegime(
                snapshot({
                    unemployment: [4.5, 4.4],
                    payroll: [159_020, 159_000],
                })
            );
            expect(r.signals).toContain('unemployment rate rising');
            expect(r.regime).toBe('slowdown');
        });
    });

    describe('expansion', () => {
        it('a healthy month (solid payroll gain, nothing slowing) is an expansion', () => {
            const r = deriveMacroRegime(snapshot());
            expect(r.regime).toBe('expansion');
            expect(r.firedRule).toBe('expansion');
            expect(r.signals).toEqual([
                'monthly job gains solid',
                'no slowdown signal on the available rows',
            ]);
        });

        it('exactly 50,000 jobs counts as solid', () => {
            expect(
                deriveMacroRegime(snapshot({ payroll: [159_050, 159_000] }))
                    .regime
            ).toBe('expansion');
        });

        it('has no inflation guard: FMP inflationRate.previous is the previous day, so its delta is ignored', () => {
            expect(
                deriveMacroRegime(snapshot({ inflation: [3.1, 2.3] })).regime
            ).toBe('expansion');
        });
    });

    describe('neutral', () => {
        it('exactly one slowdown signal with solid payroll is neutral', () => {
            const r = deriveMacroRegime(
                snapshot({ treasury: { year2: 4.5, year10: 4.2 } })
            );
            expect(r.regime).toBe('neutral');
            expect(r.firedRule).toBe('neutral');
            expect(r.signals).toEqual(['yield curve inverted']);
        });

        it('an empty snapshot is neutral with an explicit reason', () => {
            const r = deriveMacroRegime({
                indicators: [],
                treasury: null,
                calendar: [],
            });
            expect(r).toEqual({
                regime: 'neutral',
                firedRule: 'neutral',
                signals: ['rows are mixed or incomplete'],
            });
        });
    });

    describe('missing data (N/A semantics)', () => {
        it('a missing payroll row fails every condition that needs it, so a healthy rest is neutral, not expansion', () => {
            const r = deriveMacroRegime(snapshot({ payroll: null }));
            expect(r.regime).toBe('neutral');
        });

        it('a payroll row with no previous value cannot show a change', () => {
            const s = snapshot();
            const payroll = s.indicators.find(
                i => i.name === 'totalNonfarmPayroll'
            )!;
            payroll.previous = null;
            expect(deriveMacroRegime(s).regime).toBe('neutral');
        });

        it('negative conditions use only the rows that are present: a missing production row neither blocks nor triggers expansion', () => {
            expect(
                deriveMacroRegime(snapshot({ production: null })).regime
            ).toBe('expansion');
            expect(deriveMacroRegime(snapshot({ treasury: null })).regime).toBe(
                'expansion'
            );
        });

        it('a missing unemployment row cannot trigger a slowdown signal or a contraction', () => {
            const r = deriveMacroRegime(
                snapshot({ unemployment: null, payroll: [158_990, 159_000] })
            );
            // Payroll loss alone still decides a slowdown; contraction needed the unemployment row.
            expect(r.regime).toBe('slowdown');
        });

        it('a recession row with no previous value cannot prove recovery', () => {
            const s = snapshot({
                payroll: [159_150, 159_000],
                unemployment: [4.0, 4.2],
            });
            const recession = s.indicators.find(
                i => i.name === 'smoothedUSRecessionProbabilities'
            )!;
            recession.latest = { date: '2026-09-01', value: 12 };
            recession.previous = null;
            expect(deriveMacroRegime(s).regime).not.toBe('recovery');
        });

        it('ignores non-finite values', () => {
            const s = snapshot();
            const payroll = s.indicators.find(
                i => i.name === 'totalNonfarmPayroll'
            )!;
            payroll.latest = { date: '2026-09-01', value: Number.NaN };
            expect(deriveMacroRegime(s).regime).toBe('neutral');
        });
    });

    describe('threshold boundaries', () => {
        const INVERTED = { year2: 4.5, year10: 4.2 };

        it('recession probability of exactly 10% is elevated, 9.99% is not', () => {
            const at = deriveMacroRegime(
                snapshot({ recession: [10, 10], treasury: INVERTED })
            );
            expect(at.signals).toContain('recession probability elevated');
            expect(at.regime).toBe('slowdown');
            const below = deriveMacroRegime(
                snapshot({ recession: [9.99, 9.99], treasury: INVERTED })
            );
            expect(below.signals).not.toContain(
                'recession probability elevated'
            );
            expect(below.regime).toBe('neutral');
        });

        it('a previous recession reading of exactly 10% meets the recovery distress condition, 9.99% does not', () => {
            const improving: Rows = {
                payroll: [159_150, 159_000],
                unemployment: [4.0, 4.2],
            };
            expect(
                deriveMacroRegime(
                    snapshot({ ...improving, recession: [8, 10] })
                ).regime
            ).toBe('recovery');
            expect(
                deriveMacroRegime(
                    snapshot({ ...improving, recession: [8, 9.99] })
                ).regime
            ).toBe('expansion');
        });

        it('a 2s10s spread of exactly 0 is not inverted, -0.01 is', () => {
            const flat = deriveMacroRegime(
                snapshot({ treasury: { year2: 4.2, year10: 4.2 } })
            );
            expect(flat.signals).not.toContain('yield curve inverted');
            expect(flat.regime).toBe('expansion');
            const inverted = deriveMacroRegime(
                snapshot({ treasury: { year2: 4.21, year10: 4.2 } })
            );
            expect(inverted.signals).toEqual(['yield curve inverted']);
        });

        it('a payroll gain of 49,999 persons is weak, 50,000 is solid', () => {
            const weak = deriveMacroRegime(
                snapshot({ payroll: [159_049.999, 159_000] })
            );
            expect(weak.signals).toContain('monthly job gains weak');
            expect(weak.regime).toBe('neutral');
            const solid = deriveMacroRegime(
                snapshot({ payroll: [159_050, 159_000] })
            );
            expect(solid.regime).toBe('expansion');
        });

        it('a payroll change of exactly 0 is neither shrinking nor growing', () => {
            const r = deriveMacroRegime(
                snapshot({ payroll: [159_000, 159_000] })
            );
            expect(r.firedRule).not.toBe('slowdown:payrollShrinking');
            expect(r.signals).toEqual(['monthly job gains weak']);
            expect(r.regime).toBe('neutral');
            // Not growing, so it cannot be a recovery even with distress and falling unemployment.
            expect(
                deriveMacroRegime(
                    snapshot({
                        payroll: [159_000, 159_000],
                        unemployment: [4.0, 4.2],
                        recession: [12, 20],
                    })
                ).regime
            ).not.toBe('recovery');
        });

        it('recession probability of exactly 50% is not a contraction: it is one elevated-risk signal, so neutral', () => {
            const r = deriveMacroRegime(snapshot({ recession: [50, 45] }));
            expect(r.firedRule).not.toBe('contraction:recessionHigh');
            expect(r.signals).toEqual(['recession probability elevated']);
            expect(r.regime).toBe('neutral');
            expect(
                deriveMacroRegime(snapshot({ recession: [50.01, 45] })).regime
            ).toBe('contraction');
        });

        it('unemployment up exactly 0.1pp is rising, 0.09pp is not', () => {
            expect(
                deriveMacroRegime(snapshot({ unemployment: [4.2, 4.1] }))
                    .signals
            ).toContain('unemployment rate rising');
            expect(
                deriveMacroRegime(snapshot({ unemployment: [4.19, 4.1] }))
                    .signals
            ).not.toContain('unemployment rate rising');
        });
    });

    it('first match wins: a recession spike beats a payroll loss', () => {
        const r = deriveMacroRegime(
            snapshot({ recession: [60, 30], payroll: [158_900, 159_000] })
        );
        expect(r.firedRule).toBe('contraction:recessionHigh');
    });

    it('signals never contain digits (no thresholds leak into the prompt)', () => {
        const all = [
            snapshot({ recession: [55, 40] }),
            snapshot({ payroll: [158_990, 159_000] }),
            snapshot(),
            snapshot({ treasury: { year2: 4.5, year10: 4.2 } }),
        ].flatMap(s => deriveMacroRegime(s).signals);
        for (const signal of all) {
            expect(signal).not.toMatch(/\d/);
        }
    });
});

describe('withComputedRegime', () => {
    const MODEL: MacroBriefingResponse = {
        summary: '확장 국면이에요',
        highlights: ['고용 견조'],
        regime: 'expansion',
    };

    it('replaces the model regime with the computed one and keeps the prose', () => {
        const out = withComputedRegime(
            MODEL,
            snapshot({ payroll: [158_990, 159_000] })
        );
        expect(out.regime).toBe('slowdown');
        expect(out.summary).toBe(MODEL.summary);
        expect(out.highlights).toEqual(MODEL.highlights);
    });

    it('does not mutate its input', () => {
        const input = { ...MODEL };
        withComputedRegime(input, snapshot({ payroll: [158_990, 159_000] }));
        expect(input.regime).toBe('expansion');
    });
});
