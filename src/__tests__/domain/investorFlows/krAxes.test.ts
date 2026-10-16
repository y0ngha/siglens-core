import { describe, expect, it } from 'vitest';
import {
    INSIDER_CLUSTER_WINDOW_DAYS,
    KR_INSIDER_CLUSTER_MIN_REPORTERS,
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

    it('is insufficient, not a fake neutral, when no report moved the ratio', () => {
        // A purpose-change re-filing: ratio unchanged.
        const axis = evaluateKrMajorHolderAxis(
            [krMajorHolderReport({ ratioPct: 6.2, ratioChangePct: 0.1 })],
            AS_OF_DAY
        );
        expect(isFakeNeutral(axis)).toBe(false);
        expect(axis.sufficiency).toBe('insufficient');
        expect(axis.score).toBeNull();
        expect(axis.krMetrics?.reports).toBe(1);
    });

    it('is insufficient with only out-of-window, future or invalid reports', () => {
        const axis = evaluateKrMajorHolderAxis(
            [
                krMajorHolderReport({
                    receiptDate: daysBeforeAsOf(KR_WINDOW_DAYS + 1),
                }),
                krMajorHolderReport({ receiptDate: '2026-10-20' }),
                krMajorHolderReport({ ratioChangePct: Number.NaN }),
            ],
            AS_OF_DAY
        );
        expect(axis.sufficiency).toBe('insufficient');
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
        expect(one.sufficiency).toBe('insufficient');
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
        expect(axis.sufficiency).toBe('insufficient');
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
    });

    it('ignores out-of-window, future-dated and invalid reports', () => {
        const axis = axisOf([
            krInsiderReport({
                sharesChange: 1_000_000,
                receiptDate: daysBeforeAsOf(KR_WINDOW_DAYS + 1),
            }),
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
