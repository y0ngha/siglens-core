import { describe, expect, it } from 'vitest';
import {
    INSIDER_CLUSTER_WINDOW_DAYS,
    KR_INSIDER_CLUSTER_DOMINANCE_MULTIPLE,
    KR_INSIDER_CLUSTER_MEMBER_MIN_RATIO_CHANGE_PCT,
    KR_INSIDER_CLUSTER_MIN_REPORTERS,
    KR_INSIDER_ROUTINE_MASS_FILING_MAX_REPORTERS,
    KR_MAJOR_HOLDER_CHANGE_STRONG_PCT,
    KR_WINDOW_DAYS,
} from '@/domain/investorFlows/constants';
import { evaluateKrInsiderAxis } from '@/domain/investorFlows/krInsiderAxis';
import { evaluateKrMajorHolderAxis } from '@/domain/investorFlows/krMajorHolderAxis';
import { parseDay } from '@/domain/investorFlows/scoreHelpers';
import type {
    InvestorFlowsAxisBase,
    KrInsiderReport,
    KrTradingPlan,
} from '@/domain/types';
import {
    AS_OF,
    daysBeforeAsOf,
    krInsiderReport,
    krMajorHolderReport,
    krTradingPlan,
} from '../../fixtures/investorFlows';

const AS_OF_DAY = parseDay(AS_OF);
/** Roughly a KOSPI mid cap: 50M shares outstanding. */
const SHARES_OUT = 50_000_000;

/** The pattern the US evaluators produce on Korean data: "sufficient", zero, no signals. */
function isFakeNeutral(axis: InvestorFlowsAxisBase): boolean {
    return (
        axis.sufficiency === 'sufficient' &&
        axis.score === 0 &&
        axis.signals.length === 0
    );
}

describe('evaluateKrMajorHolderAxis', () => {
    it('reads a new 6.2% holder as a moderate bullish event', () => {
        const axis = evaluateKrMajorHolderAxis(
            [krMajorHolderReport()],
            AS_OF_DAY
        );
        expect(axis.id).toBe('largeHolders');
        expect(axis.signals).toEqual([
            {
                id: 'kr_major_holder_new',
                axis: 'largeHolders',
                direction: 'bullish',
                strength: 'moderate',
                evidence: {
                    ratioPct: 6.2,
                    priorRatioPct: 0,
                    ratioChangePct: 6.2,
                    sharesChange: 3_100_000,
                    reports: 1,
                    detailedReports: 0,
                },
                subject: '국민연금공단',
            },
        ]);
        expect(axis.score).toBe(35);
        expect(axis.metrics).toBeNull();
        expect(axis.krMetrics).toEqual({
            reports: 1,
            reporters: 1,
            detailedReports: 0,
            maxAbsRatioChangePct: 6.2,
            latestReceiptDate: daysBeforeAsOf(10),
        });
    });

    it('never goes strong because of the report form', () => {
        // A detailed (일반) 6.2% filing is still judged by its ratio only.
        const axis = evaluateKrMajorHolderAxis(
            [krMajorHolderReport({ reportForm: 'detailed' })],
            AS_OF_DAY
        );
        expect(axis.signals[0].strength).toBe('moderate');
        expect(axis.signals[0].evidence.detailedReports).toBe(1);
    });

    it('goes strong only on a control-level ratio move', () => {
        const axis = evaluateKrMajorHolderAxis(
            [
                krMajorHolderReport({
                    reporter: '행동주의펀드',
                    ratioPct: KR_MAJOR_HOLDER_CHANGE_STRONG_PCT + 1,
                    ratioChangePct: KR_MAJOR_HOLDER_CHANGE_STRONG_PCT + 1,
                }),
            ],
            AS_OF_DAY
        );
        expect(axis.signals[0].strength).toBe('strong');
    });

    it('reads a 1.05%p cut by an existing holder as a weak reduction', () => {
        // NPS trimming 7.35% → 6.30%.
        const axis = evaluateKrMajorHolderAxis(
            [
                krMajorHolderReport({
                    ratioPct: 6.3,
                    ratioChangePct: -1.05,
                    sharesChange: -525_000,
                    shares: 3_150_000,
                }),
            ],
            AS_OF_DAY
        );
        expect(axis.signals.map(s => [s.id, s.direction, s.strength])).toEqual([
            ['kr_major_holder_reduction', 'bearish', 'weak'],
        ]);
        expect(axis.signals[0].evidence.priorRatioPct).toBe(7.35);
    });

    it('reads an increase', () => {
        const axis = evaluateKrMajorHolderAxis(
            [krMajorHolderReport({ ratioPct: 9.5, ratioChangePct: 3.2 })],
            AS_OF_DAY
        );
        expect(axis.signals[0].id).toBe('kr_major_holder_increase');
        expect(axis.signals[0].strength).toBe('moderate');
    });

    it('reads dropping below 5% as an exit, weak when the step is small', () => {
        const axis = evaluateKrMajorHolderAxis(
            [krMajorHolderReport({ ratioPct: 4.6, ratioChangePct: -0.8 })],
            AS_OF_DAY
        );
        expect(axis.signals.map(s => [s.id, s.strength])).toEqual([
            ['kr_major_holder_exit', 'weak'],
        ]);
    });

    it('nets several reports from one reporter into one signal', () => {
        const axis = evaluateKrMajorHolderAxis(
            [
                krMajorHolderReport({
                    receiptDate: daysBeforeAsOf(60),
                    ratioPct: 6.2,
                    ratioChangePct: 1.1,
                }),
                krMajorHolderReport({
                    receiptDate: daysBeforeAsOf(20),
                    ratioPct: 7.4,
                    ratioChangePct: 1.2,
                }),
            ],
            AS_OF_DAY
        );
        expect(axis.signals).toHaveLength(1);
        expect(axis.signals[0].evidence.ratioChangePct).toBe(2.3);
        expect(axis.signals[0].evidence.ratioPct).toBe(7.4);
        expect(axis.signals[0].evidence.reports).toBe(2);
    });

    it('reads a sub-1%p re-filing as a measured neutral, not a fake one', () => {
        // A purpose-change re-filing: ratio essentially unchanged.
        const axis = evaluateKrMajorHolderAxis(
            [krMajorHolderReport({ ratioPct: 6.2, ratioChangePct: 0.1 })],
            AS_OF_DAY
        );
        expect(isFakeNeutral(axis)).toBe(false);
        expect(axis.sufficiency).toBe('sufficient');
        expect(axis.score).toBe(0);
        expect(axis.label).toBe('neutral');
        expect(axis.signals).toEqual([
            {
                id: 'kr_major_holder_no_material_change',
                axis: 'largeHolders',
                direction: 'neutral',
                strength: 'weak',
                evidence: {
                    reports: 1,
                    reporters: 1,
                    maxAbsRatioChangePct: 0.1,
                },
            },
        ]);
    });

    it("scores Samsung's 43 unchanged 5%+ holder reports as neutral 0 with evidence", () => {
        // 005930.KS: 43 대량보유 reports, every ratio change 0.00%p.
        const holders = ['삼성물산', '삼성생명', '국민연금공단', 'BlackRock'];
        const reports = Array.from({ length: 43 }, (_, i) =>
            krMajorHolderReport({
                receiptDate: daysBeforeAsOf(1 + (i % 80)),
                reporter: holders[i % holders.length],
                ratioPct: i % holders.length === 0 ? 19.69 : 7.5,
                ratioChangePct: 0,
                sharesChange: 0,
            })
        );
        const axis = evaluateKrMajorHolderAxis(reports, AS_OF_DAY);
        expect(axis.sufficiency).toBe('sufficient');
        expect(axis.score).toBe(0);
        expect(axis.label).toBe('neutral');
        expect(axis.signals.map(s => s.id)).toEqual([
            'kr_major_holder_no_material_change',
        ]);
        expect(axis.signals[0].evidence).toEqual({
            reports: 43,
            reporters: 4,
            maxAbsRatioChangePct: 0,
        });
        expect(axis.krMetrics).toEqual({
            reports: 43,
            reporters: 4,
            detailedReports: 0,
            maxAbsRatioChangePct: 0,
            latestReceiptDate: daysBeforeAsOf(1),
        });
    });

    it('is insufficient with a reason when every usable report is outside the window', () => {
        const axis = evaluateKrMajorHolderAxis(
            [
                krMajorHolderReport({
                    receiptDate: daysBeforeAsOf(KR_WINDOW_DAYS + 40),
                    ratioChangePct: 0,
                }),
                krMajorHolderReport({
                    receiptDate: daysBeforeAsOf(KR_WINDOW_DAYS + 1),
                }),
                krMajorHolderReport({ receiptDate: '2026-10-20' }),
            ],
            AS_OF_DAY
        );
        expect(axis.sufficiency).toBe('insufficient');
        expect(axis.score).toBeNull();
        expect(axis.signals).toEqual([]);
        expect(axis.krMetrics).toEqual({
            reports: 0,
            reporters: 0,
            detailedReports: 0,
            maxAbsRatioChangePct: null,
            latestReceiptDate: daysBeforeAsOf(KR_WINDOW_DAYS + 1),
        });
    });

    it('is insufficient without metrics when no report has usable ratios', () => {
        const axis = evaluateKrMajorHolderAxis(
            [
                krMajorHolderReport({ ratioChangePct: Number.NaN }),
                krMajorHolderReport({ ratioPct: Number.NaN }),
                krMajorHolderReport({ receiptDate: 'not a date' }),
                krMajorHolderReport({ receiptDate: '2026-10-20' }),
            ],
            AS_OF_DAY
        );
        expect(axis.sufficiency).toBe('insufficient');
        expect(axis.score).toBeNull();
        expect(axis.krMetrics).toBeUndefined();
    });

    it('is insufficient without a reference day', () => {
        expect(
            evaluateKrMajorHolderAxis([krMajorHolderReport()], null).score
        ).toBeNull();
    });
});

describe('evaluateKrInsiderAxis', () => {
    function axisOf(
        insiders: readonly KrInsiderReport[],
        tradingPlans: readonly KrTradingPlan[] = [],
        sharesOutstanding: number | null = SHARES_OUT
    ) {
        return evaluateKrInsiderAxis(
            { insiders, tradingPlans },
            sharesOutstanding,
            AS_OF_DAY
        );
    }

    it('reads a 20,000-share executive increase on 50M shares as weak bullish', () => {
        // 20,000 / 50,000,000 = 0.04% — just under weak; two of them clear it.
        const one = axisOf([krInsiderReport()]);
        expect(one.sufficiency).toBe('sufficient');
        expect(one.score).toBe(0);
        expect(one.signals.map(s => s.id)).toEqual([
            'kr_insider_no_material_change',
        ]);
        const two = axisOf([
            krInsiderReport(),
            krInsiderReport({ reporter: '김철수', sharesChange: 10_000 }),
        ]);
        expect(two.signals).toEqual([
            {
                id: 'kr_insider_net_change',
                axis: 'insider',
                direction: 'bullish',
                strength: 'weak',
                evidence: {
                    netSharesChange: 30_000,
                    netChangePct: 0.06,
                    reporters: 2,
                    reports: 2,
                },
            },
        ]);
        expect(two.score).toBe(15);
        expect(two.metrics).toBeNull();
        expect(two.krMetrics).toEqual({
            reports: 2,
            reporters: 2,
            netSharesChange: 30_000,
            netChangePct: 0.06,
            tradingPlans: 0,
            latestReceiptDate: daysBeforeAsOf(10),
        });
    });

    it('caps a large net change at moderate (no cause is reported)', () => {
        // A major shareholder disposing 2.5M shares (5% of the company).
        const axis = axisOf([
            krInsiderReport({
                reporter: '최대주주',
                majorShareholder: true,
                position: null,
                sharesChange: -2_500_000,
            }),
        ]);
        expect(axis.signals[0].direction).toBe('bearish');
        expect(axis.signals[0].strength).toBe('moderate');
    });

    it('nets a gift between family members to zero instead of reading two moves', () => {
        const axis = axisOf([
            krInsiderReport({ reporter: '부', sharesChange: -500_000 }),
            krInsiderReport({ reporter: '자', sharesChange: 500_000 }),
        ]);
        expect(
            axis.signals.find(s => s.id === 'kr_insider_net_change')
        ).toBeUndefined();
        // Measured: two reports, net zero — a real "no material change".
        expect(axis.sufficiency).toBe('sufficient');
        expect(axis.score).toBe(0);
        expect(axis.label).toBe('neutral');
        expect(axis.signals).toEqual([
            {
                id: 'kr_insider_no_material_change',
                axis: 'insider',
                direction: 'neutral',
                strength: 'weak',
                evidence: { reports: 2, reporters: 2, netChangePct: 0 },
            },
        ]);
    });

    it('is insufficient when the net change cannot be measured', () => {
        // No shares outstanding and a missing ratio change: "no change" is not proven.
        const axis = axisOf(
            [krInsiderReport({ ratioChangePct: Number.NaN })],
            [],
            null
        );
        expect(axis.krMetrics?.netChangePct).toBeNull();
        expect(axis.sufficiency).toBe('insufficient');
        expect(axis.score).toBeNull();
        expect(
            axis.signals.some(s => s.id === 'kr_insider_no_material_change')
        ).toBe(false);
    });

    it('falls back to the summed ratio change without shares outstanding', () => {
        const axis = axisOf(
            [krInsiderReport({ ratioChangePct: 0.3 })],
            [],
            null
        );
        expect(axis.signals[0].evidence.netChangePct).toBe(0.3);
        expect(axis.signals[0].strength).toBe('moderate');
    });

    it('flags three reporters adding within 30 days as a moderate bullish cluster', () => {
        const axis = axisOf(
            ['A', 'B', 'C'].map((reporter, i) =>
                krInsiderReport({
                    reporter,
                    sharesChange: 1_000,
                    receiptDate: daysBeforeAsOf(5 + i * 10),
                })
            )
        );
        expect(axis.signals.find(s => s.id === 'kr_insider_cluster')).toEqual({
            id: 'kr_insider_cluster',
            axis: 'insider',
            direction: 'bullish',
            strength: 'moderate',
            evidence: {
                reporters: KR_INSIDER_CLUSTER_MIN_REPORTERS,
                windowDays: INSIDER_CLUSTER_WINDOW_DAYS,
            },
            subject: `${daysBeforeAsOf(25)} to ${daysBeforeAsOf(5)}`,
        });
        // tiny shares: the cluster alone makes the axis sufficient.
        expect(axis.sufficiency).toBe('sufficient');
        expect(axis.score).toBe(35);
    });

    it('flags a selling cluster as bearish', () => {
        const axis = axisOf(
            ['A', 'B', 'C'].map(reporter =>
                krInsiderReport({ reporter, sharesChange: -1_000 })
            )
        );
        expect(
            axis.signals.find(s => s.id === 'kr_insider_cluster')?.direction
        ).toBe('bearish');
    });

    it('does not cluster reporters spread over more than 30 days', () => {
        const axis = axisOf(
            ['A', 'B', 'C'].map((reporter, i) =>
                krInsiderReport({
                    reporter,
                    sharesChange: 1_000,
                    receiptDate: daysBeforeAsOf(5 + i * 20),
                })
            )
        );
        expect(
            axis.signals.find(s => s.id === 'kr_insider_cluster')
        ).toBeUndefined();
    });

    describe('cluster materiality', () => {
        /** Samsung Electronics' common shares outstanding (~5.97B). */
        const SAMSUNG_SHARES_OUT = 5_969_782_550;

        /**
         * A Samsung-like 30 days: hundreds of executives / employees filing
         * 100–3,000-share changes (DART ratio change `0`), a few dozen small
         * sellers, and one major shareholder's large addition.
         */
        function samsungLikeReports(): KrInsiderReport[] {
            const buyers = Array.from({ length: 700 }, (_, i) =>
                krInsiderReport({
                    reporter: `임원${i}`,
                    position: '상무',
                    registered: false,
                    shares: 1_000 + i,
                    sharesChange: 100 + (i % 30) * 100,
                    ratioPct: 0,
                    ratioChangePct: 0,
                    receiptDate: daysBeforeAsOf(60 + (i % 30)),
                })
            );
            const sellers = Array.from({ length: 31 }, (_, i) =>
                krInsiderReport({
                    reporter: `매도${i}`,
                    position: '상무',
                    registered: false,
                    shares: 2_000,
                    sharesChange: -(100 + i * 10),
                    ratioPct: 0,
                    ratioChangePct: 0,
                    receiptDate: daysBeforeAsOf(59 + (i % 30)),
                })
            );
            const major = krInsiderReport({
                reporter: '이재용',
                position: '회장',
                registered: false,
                majorShareholder: true,
                shares: 105_219_053,
                sharesChange: 7_667_100,
                ratioPct: 1.58,
                ratioChangePct: 0.14,
                receiptDate: daysBeforeAsOf(1),
            });
            return [...buyers, ...sellers, major];
        }

        it.each([
            ['with shares outstanding', SAMSUNG_SHARES_OUT],
            ['without shares outstanding', null],
        ])(
            'reads hundreds of tiny reports as a routine mass filing, not a cluster (%s)',
            (_label, sharesOutstanding) => {
                const axis = axisOf(
                    samsungLikeReports(),
                    [],
                    sharesOutstanding
                );
                expect(
                    axis.signals.filter(s => s.id === 'kr_insider_cluster')
                ).toEqual([]);
                const routine = axis.signals.find(
                    s => s.id === 'kr_insider_routine_mass_filing'
                );
                expect(routine).toMatchObject({
                    direction: 'neutral',
                    strength: 'weak',
                    evidence: {
                        windowDays: INSIDER_CLUSTER_WINDOW_DAYS,
                        ...(sharesOutstanding === null
                            ? { medianRatioChangePct: 0 }
                            : { medianChangePctOutstanding: 0 }),
                    },
                });
                expect(routine?.evidence.reporters).toBeGreaterThan(
                    KR_INSIDER_ROUTINE_MASS_FILING_MAX_REPORTERS
                );
                // The net change still reads the major shareholder's addition.
                expect(
                    axis.signals.find(s => s.id === 'kr_insider_net_change')
                        ?.direction
                ).toBe('bullish');
            }
        );

        it('scores a routine-only window as a measured neutral, with only the routine note', () => {
            // Hundreds of tiny grant filings with valid numbers are the
            // absence of a material insider move, not missing data.
            const axis = axisOf(
                samsungLikeReports().filter(r => r.reporter !== '이재용'),
                [],
                SAMSUNG_SHARES_OUT
            );
            expect(axis.signals.map(s => s.id)).toEqual([
                'kr_insider_routine_mass_filing',
            ]);
            expect(axis.sufficiency).toBe('sufficient');
            expect(axis.score).toBe(0);
            expect(axis.label).toBe('neutral');
        });

        it('still fires a genuine material cluster hidden in routine noise, without the routine note', () => {
            // 100,000 / 5.97B ≈ 0.0017% each, inside the tiny buyers' span.
            const material = [0, 1, 2, 3].map(i =>
                krInsiderReport({
                    reporter: `실매수${i}`,
                    sharesChange: 100_000,
                    ratioChangePct: 0,
                    receiptDate: daysBeforeAsOf(61 + i),
                })
            );
            const axis = axisOf(
                [...samsungLikeReports(), ...material],
                [],
                SAMSUNG_SHARES_OUT
            );
            expect(
                axis.signals.filter(s => s.id === 'kr_insider_cluster')
            ).toEqual([
                expect.objectContaining({
                    direction: 'bullish',
                    evidence: {
                        reporters: 4,
                        windowDays: INSIDER_CLUSTER_WINDOW_DAYS,
                    },
                    subject: `${daysBeforeAsOf(64)} to ${daysBeforeAsOf(61)}`,
                }),
            ]);
            expect(
                axis.signals.find(
                    s => s.id === 'kr_insider_routine_mass_filing'
                )
            ).toBeUndefined();
        });

        it('would cluster the routine filers without the member floor (the floor is what drops them)', () => {
            // Same 700 tiny buyers on a 1M-share company: each clears 0.001%.
            const axis = axisOf(
                samsungLikeReports().filter(r => r.sharesChange > 0),
                [],
                1_000_000
            );
            expect(
                axis.signals.find(s => s.id === 'kr_insider_cluster')?.evidence
                    .reporters
            ).toBeGreaterThan(KR_INSIDER_ROUTINE_MASS_FILING_MAX_REPORTERS);
        });

        /**
         * 32 reporters in one span: 16 tiny (1 share), plus 8 buyers and 8
         * sellers of `materialShares` each on 50M shares, which net out — so
         * no cluster survives and only the median decides the routine note.
         * The even-count median is the mean of a tiny change and the material one.
         */
        function straddle(materialShares: number) {
            const tiny = Array.from({ length: 16 }, (_, i) =>
                krInsiderReport({
                    reporter: `소액${i}`,
                    sharesChange: 1,
                    receiptDate: daysBeforeAsOf(5 + i),
                })
            );
            const buyers = Array.from({ length: 8 }, (_, i) =>
                krInsiderReport({
                    reporter: `매수${i}`,
                    sharesChange: materialShares,
                    receiptDate: daysBeforeAsOf(5 + i),
                })
            );
            const sellers = Array.from({ length: 8 }, (_, i) =>
                krInsiderReport({
                    reporter: `매도${i}`,
                    sharesChange: -materialShares,
                    receiptDate: daysBeforeAsOf(5 + i),
                })
            );
            return axisOf([...tiny, ...buyers, ...sellers]).signals;
        }

        it('compares the raw even-count median with the floor', () => {
            // (0.000002% + 0.0021%) / 2 ≈ 0.00105% ≥ 0.001%: not routine.
            const above = straddle(1_050);
            expect(above.map(s => s.id)).not.toContain('kr_insider_cluster');
            expect(above.map(s => s.id)).not.toContain(
                'kr_insider_routine_mass_filing'
            );
            // (0.000002% + 0.0019%) / 2 ≈ 0.00095% < 0.001%: routine, though
            // 4-decimal rounding would read it as 0.001 (the floor).
            const below = straddle(950);
            expect(below.map(s => s.id)).not.toContain('kr_insider_cluster');
            expect(
                below.find(s => s.id === 'kr_insider_routine_mass_filing')
                    ?.evidence
            ).toMatchObject({
                reporters: 32,
                medianChangePctOutstanding: 0.001,
            });
        });

        it('needs more than the reporter cap for the routine note', () => {
            const tiny = (count: number) =>
                Array.from({ length: count }, (_, i) =>
                    krInsiderReport({
                        reporter: `소액${i}`,
                        sharesChange: 1,
                        receiptDate: daysBeforeAsOf(5 + (i % 20)),
                    })
                );
            const has = (count: number) =>
                axisOf(tiny(count)).signals.some(
                    s => s.id === 'kr_insider_routine_mass_filing'
                );
            expect(has(KR_INSIDER_ROUTINE_MASS_FILING_MAX_REPORTERS)).toBe(
                false
            );
            expect(has(KR_INSIDER_ROUTINE_MASS_FILING_MAX_REPORTERS + 1)).toBe(
                true
            );
        });

        it('flags four small-cap executives buying meaningful amounts as a cluster', () => {
            // 20,000–50,000 shares on 50M = 0.04–0.1% each.
            const axis = axisOf(
                [20_000, 30_000, 40_000, 50_000].map((sharesChange, i) =>
                    krInsiderReport({
                        reporter: `임원${i}`,
                        sharesChange,
                        receiptDate: daysBeforeAsOf(3 + i * 5),
                    })
                )
            );
            expect(
                axis.signals.find(s => s.id === 'kr_insider_cluster')
            ).toMatchObject({
                direction: 'bullish',
                evidence: { reporters: 4 },
                subject: `${daysBeforeAsOf(18)} to ${daysBeforeAsOf(3)}`,
            });
            expect(
                axis.signals.find(
                    s => s.id === 'kr_insider_routine_mass_filing'
                )
            ).toBeUndefined();
        });

        it('keeps a cluster of many material reporters (the guard needs a tiny median)', () => {
            const axis = axisOf(
                Array.from({ length: 40 }, (_, i) =>
                    krInsiderReport({
                        reporter: `임원${i}`,
                        sharesChange: 5_000,
                        receiptDate: daysBeforeAsOf(3 + (i % 20)),
                    })
                )
            );
            expect(
                axis.signals.find(s => s.id === 'kr_insider_cluster')?.evidence
                    .reporters
            ).toBe(40);
            expect(
                axis.signals.find(
                    s => s.id === 'kr_insider_routine_mass_filing'
                )
            ).toBeUndefined();
        });

        it('does not cluster reporters whose own change is immaterial', () => {
            // 400 / 50M = 0.0008% < 0.001% each.
            const tiny = ['A', 'B', 'C'].map(reporter =>
                krInsiderReport({ reporter, sharesChange: 400 })
            );
            expect(
                axisOf(tiny).signals.find(s => s.id === 'kr_insider_cluster')
            ).toBeUndefined();
            // 500 / 50M = 0.001%: the floor itself counts.
            const atFloor = tiny.map(r => ({ ...r, sharesChange: 500 }));
            expect(
                axisOf(atFloor).signals.find(s => s.id === 'kr_insider_cluster')
            ).toBeDefined();
        });

        it('falls back to the ratio change without shares outstanding, excluding unusable ratios', () => {
            const reports = (ratioChangePct: number) =>
                ['A', 'B', 'C'].map(reporter =>
                    krInsiderReport({ reporter, ratioChangePct })
                );
            const cluster = (ratioChangePct: number) =>
                axisOf(reports(ratioChangePct), [], null).signals.find(
                    s => s.id === 'kr_insider_cluster'
                );
            expect(
                cluster(KR_INSIDER_CLUSTER_MEMBER_MIN_RATIO_CHANGE_PCT)
            ).toBeDefined();
            expect(cluster(0)).toBeUndefined();
            expect(cluster(Number.NaN)).toBeUndefined();
        });

        function opposite(buyShares: number, sellShares: number) {
            return axisOf([
                ...['A', 'B', 'C'].map(reporter =>
                    krInsiderReport({ reporter, sharesChange: buyShares })
                ),
                ...['D', 'E', 'F'].map(reporter =>
                    krInsiderReport({ reporter, sharesChange: -sellShares })
                ),
            ]).signals.filter(s => s.id === 'kr_insider_cluster');
        }

        it('suppresses a buying and a selling cluster of similar size', () => {
            expect(opposite(20_000, 15_000)).toEqual([]);
        });

        it('nets opposite clusters of unequal size by summed change, not reporter count', () => {
            const unequal = (sellShares: number) =>
                axisOf([
                    // 5 buyers × 10,000 = 0.1% in total.
                    ...['A', 'B', 'C', 'D', 'E'].map(reporter =>
                        krInsiderReport({ reporter, sharesChange: 10_000 })
                    ),
                    ...['F', 'G', 'H'].map(reporter =>
                        krInsiderReport({ reporter, sharesChange: -sellShares })
                    ),
                ]).signals.filter(s => s.id === 'kr_insider_cluster');
            // 3 sellers × 40,000 = 0.24% ≥ 2 × 0.1%: the smaller group wins.
            expect(unequal(40_000)).toEqual([
                expect.objectContaining({
                    direction: 'bearish',
                    evidence: {
                        reporters: 3,
                        windowDays: INSIDER_CLUSTER_WINDOW_DAYS,
                    },
                }),
            ]);
            // 3 sellers × 30,000 = 0.18% < 0.2% and 0.1% < 0.36%: neither.
            expect(unequal(30_000)).toEqual([]);
        });

        it('keeps only the clearly dominant side of opposite clusters', () => {
            expect(
                opposite(
                    20_000 * KR_INSIDER_CLUSTER_DOMINANCE_MULTIPLE,
                    20_000
                ).map(s => s.direction)
            ).toEqual(['bullish']);
            expect(
                opposite(
                    10_000,
                    10_000 * KR_INSIDER_CLUSTER_DOMINANCE_MULTIPLE
                ).map(s => s.direction)
            ).toEqual(['bearish']);
        });
    });

    it('reports trading plans as neutral context that cannot make the axis sufficient', () => {
        const axis = axisOf([], [krTradingPlan(), krTradingPlan()]);
        expect(axis.signals).toEqual([
            {
                id: 'kr_trading_plan',
                axis: 'insider',
                direction: 'neutral',
                strength: 'weak',
                evidence: { plans: 2, windowDays: KR_WINDOW_DAYS },
            },
        ]);
        expect(axis.sufficiency).toBe('insufficient');
        expect(axis.krMetrics?.tradingPlans).toBe(2);
        expect(axis.krMetrics?.latestReceiptDate).toBeNull();
    });

    it('is insufficient with a reason when every usable report is outside the window', () => {
        const axis = axisOf([
            krInsiderReport({
                receiptDate: daysBeforeAsOf(KR_WINDOW_DAYS + 1),
            }),
            krInsiderReport({
                receiptDate: daysBeforeAsOf(KR_WINDOW_DAYS + 30),
            }),
        ]);
        expect(axis.sufficiency).toBe('insufficient');
        expect(axis.score).toBeNull();
        expect(axis.signals).toEqual([]);
        expect(axis.krMetrics).toEqual({
            reports: 0,
            reporters: 0,
            netSharesChange: 0,
            netChangePct: 0,
            tradingPlans: 0,
            latestReceiptDate: daysBeforeAsOf(KR_WINDOW_DAYS + 1),
        });
    });

    it('ignores future-dated and invalid reports', () => {
        const axis = axisOf([
            krInsiderReport({
                sharesChange: 1_000_000,
                receiptDate: '2026-10-30',
            }),
            krInsiderReport({ sharesChange: Number.NaN }),
        ]);
        expect(axis.krMetrics).toBeUndefined();
        expect(axis.sufficiency).toBe('insufficient');
    });

    it('is insufficient without a reference day', () => {
        expect(
            evaluateKrInsiderAxis(
                { insiders: [krInsiderReport()], tradingPlans: [] },
                SHARES_OUT,
                null
            ).score
        ).toBeNull();
    });
});
