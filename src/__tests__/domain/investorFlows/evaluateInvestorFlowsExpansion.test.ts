import { describe, expect, it } from 'vitest';
import {
    COMPOSITE_WEIGHTS,
    DILUTION_WINDOW_DAYS,
    INVESTOR_FLOWS_AXES,
    KR_WINDOW_DAYS,
} from '@/domain/investorFlows/constants';
import { evaluateInvestorFlows } from '@/domain/investorFlows/evaluateInvestorFlows';
import { evaluateSqueezeRisk } from '@/domain/investorFlows/squeezeRisk';
import type {
    InvestorFlowsAxisBase,
    InvestorFlowsScorecard,
    InvestorFlowsSnapshot,
} from '@/domain/types';
import {
    AS_OF,
    dailyBars,
    daysBeforeAsOf,
    emptySnapshot,
    ftdPoint,
    insiderTx,
    krInsiderReport,
    krMajorHolderReport,
    krTradingPlan,
    largeHolderFiling,
    offeringFiling,
    proposedSale,
    quarter,
    shortInterestSeries,
} from '../../fixtures/investorFlows';

const LISTED = {
    listed: true,
    consecutiveDays: 8,
    firstListedDate: daysBeforeAsOf(10),
    markets: ['Nasdaq'],
} as const;

function ids(axis: InvestorFlowsAxisBase): string[] {
    return axis.signals.map(s => s.id);
}

describe('evaluateInvestorFlows — dilution axis in the composite', () => {
    const card = evaluateInvestorFlows(
        emptySnapshot({
            insider: { transactions: [insiderTx({ value: 300_000 })] },
            offerings: [offeringFiling()],
        })
    );

    it('scores the dilution axis from the snapshot offerings', () => {
        expect(card.dilution.score).toBe(-35);
        expect(card.dilution.label).toBe('bearish');
    });

    it('weights dilution like any other axis', () => {
        const { insider: n, dilution: d } = COMPOSITE_WEIGHTS;
        expect(card.composite.axesUsed).toEqual(['insider', 'dilution']);
        expect(card.composite.score).toBeCloseTo(
            (35 * n - 35 * d) / (n + d),
            2
        );
    });

    it('lists dilution last in the canonical axis order', () => {
        expect(INVESTOR_FLOWS_AXES.at(-1)).toBe('dilution');
    });

    it('reports the dilution window in the freshness block', () => {
        expect(card.freshness.dilutionWindow).toEqual({
            from: daysBeforeAsOf(DILUTION_WINDOW_DAYS),
            to: AS_OF,
            days: DILUTION_WINDOW_DAYS,
        });
    });
});

describe('evaluateInvestorFlows — snapshots built before the expansion', () => {
    it('evaluates a snapshot with none of the new fields, dilution abstaining', () => {
        const card = evaluateInvestorFlows(
            emptySnapshot({
                insider: { transactions: [insiderTx()] },
                largeHolders: [largeHolderFiling()],
            })
        );
        expect(card.market).toBe('us');
        expect(card.dilution.sufficiency).toBe('insufficient');
        expect(card.squeezeRisk).toBeNull();
        expect(card.freshness.failsToDeliverLatestDate).toBeNull();
        expect(card.freshness.krDisclosureLatestDate).toBeNull();
        expect(card.composite.axesUsed).toEqual(['insider', 'largeHolders']);
    });
});

describe('evaluateInvestorFlows — new US inputs', () => {
    it('feeds Form 144 notices into the insider axis', () => {
        // 10,000 shares of a 10M-share company: 0.1% of outstanding, weak.
        const card = evaluateInvestorFlows(
            emptySnapshot({
                sharesOutstanding: 10_000_000,
                proposedSales: [proposedSale()],
            })
        );
        expect(ids(card.insider)).toContain('insider_proposed_sale');
        expect(card.insider.metrics?.proposedSalePctOutstanding).toBe(0.1);
    });

    it('feeds fails to deliver into the short axis and the freshness block', () => {
        const date = daysBeforeAsOf(18);
        const card = evaluateInvestorFlows(
            emptySnapshot({
                sharesOutstanding: 40_000_000,
                failsToDeliver: [
                    ftdPoint({ settlementDate: date, failsQty: 250_000 }),
                ],
            })
        );
        expect(ids(card.short)).toContain('fails_to_deliver_elevated');
        expect(card.freshness.failsToDeliverLatestDate).toBe(date);
    });

    it('reads the threshold list by default', () => {
        const card = evaluateInvestorFlows(
            emptySnapshot({ thresholdList: LISTED })
        );
        expect(ids(card.short)).toContain('reg_sho_threshold_listed');
    });

    it('ignores a threshold list the snapshot carries when includeExchangeLists is false', () => {
        const card = evaluateInvestorFlows(
            emptySnapshot({ thresholdList: LISTED }),
            { includeExchangeLists: false }
        );
        expect(ids(card.short)).not.toContain('reg_sho_threshold_listed');
        expect(card.short.metrics.thresholdListed).toBeNull();
    });
});

describe('evaluateInvestorFlows — squeeze context', () => {
    const crowded: InvestorFlowsSnapshot = emptySnapshot({
        sharesOutstanding: 40_000_000,
        floatShares: 30_000_000,
        shortInterest: shortInterestSeries(6_000_000, 9_000_000, 10),
        thresholdList: LISTED,
    });
    const rally = dailyBars({
        count: 25,
        firstClose: 10,
        lastClose: 16,
        recentVolume: 3_000_000,
    });

    it('attaches the same score evaluateSqueezeRisk returns', () => {
        const card = evaluateInvestorFlows(crowded, {
            squeezeContext: { dailyBars: rally },
        });
        expect(card.squeezeRisk).toEqual(
            evaluateSqueezeRisk(crowded, { dailyBars: rally })
        );
    });

    it('derives short_squeeze_risk from that score', () => {
        const card = evaluateInvestorFlows(crowded, {
            squeezeContext: { dailyBars: rally },
        });
        const signal = card.short.signals.find(
            s => s.id === 'short_squeeze_risk'
        );
        expect(card.squeezeRisk?.level).toBe('extreme');
        expect(signal?.strength).toBe('strong');
        expect(signal?.evidence.squeezeScore).toBe(card.squeezeRisk?.score);
        expect(card.short.metrics.squeezeRisk).toBe(true);
    });

    it('holds the level at elevated without FINRA positioning, so no squeeze signal fires', () => {
        // Same snapshot with FINRA off: only the threshold list and the rally remain.
        const card = evaluateInvestorFlows(crowded, {
            includeFinraData: false,
            squeezeContext: { dailyBars: rally },
        });
        expect(card.squeezeRisk?.levelCapped).toBe(true);
        expect(card.squeezeRisk?.level).toBe('elevated');
        expect(card.squeezeRisk?.includesFinra).toBe(false);
        expect(
            card.short.signals.find(s => s.id === 'short_squeeze_risk')
        ).toBeUndefined();
    });

    it('passes includeExchangeLists through to the score', () => {
        const card = evaluateInvestorFlows(crowded, {
            includeExchangeLists: false,
            squeezeContext: { dailyBars: rally },
        });
        expect(card.squeezeRisk?.includesExchangeLists).toBe(false);
    });

    it('keeps the price-free rule without a context', () => {
        const card = evaluateInvestorFlows(crowded);
        const signal = card.short.signals.find(
            s => s.id === 'short_squeeze_risk'
        );
        expect(card.squeezeRisk).toBeNull();
        expect(signal?.evidence).toEqual({
            shortInterestPctFloat: 30,
            daysToCover: 10,
            shortInterestChangePct: 50,
        });
    });
});

describe('evaluateInvestorFlows — Korean snapshots', () => {
    /** A KOSPI name: a new 6.2% holder, three executives adding, one trading plan. */
    const kr: InvestorFlowsSnapshot = emptySnapshot({
        market: 'kr',
        sharesOutstanding: 50_000_000,
        floatShares: null,
        kr: {
            majorHolders: [krMajorHolderReport()],
            insiders: ['대표이사', '부사장', '전무'].map((position, i) =>
                krInsiderReport({
                    reporter: `임원${i}`,
                    position,
                    sharesChange: 15_000,
                    receiptDate: daysBeforeAsOf(5 + i * 5),
                })
            ),
            tradingPlans: [krTradingPlan()],
        },
        // US-shaped rows a provider might leave in: must be ignored.
        insider: { transactions: [insiderTx({ value: 5_000_000 })] },
        institutional: {
            quarters: [quarter()],
            topHolders: [],
            topHoldersPeriod: null,
        },
        offerings: [offeringFiling()],
    });
    const card: InvestorFlowsScorecard = evaluateInvestorFlows(kr, {
        squeezeContext: { dailyBars: dailyBars() },
    });

    it('is marked Korean and carries no squeeze score', () => {
        expect(card.market).toBe('kr');
        expect(card.squeezeRisk).toBeNull();
    });

    it('fills largeHolders and insider from DART, never as a fake neutral', () => {
        for (const axis of [card.largeHolders, card.insider]) {
            expect(axis.sufficiency).toBe('sufficient');
            expect(axis.score).not.toBe(0);
            expect(axis.signals.length).toBeGreaterThan(0);
        }
        expect(ids(card.largeHolders)).toEqual(['kr_major_holder_new']);
        expect(ids(card.insider)).toEqual([
            'kr_insider_cluster',
            'kr_insider_net_change',
            'kr_trading_plan',
        ]);
    });

    it('leaves the US-only axes insufficient even when US rows are present', () => {
        for (const axis of [card.institutional, card.short, card.dilution]) {
            expect(axis.sufficiency).toBe('insufficient');
            expect(axis.score).toBeNull();
            expect(axis.signals).toEqual([]);
        }
    });

    it('builds the composite from the two Korean axes only', () => {
        expect(card.composite.axesUsed).toEqual(['insider', 'largeHolders']);
        const { insider: n, largeHolders: l } = COMPOSITE_WEIGHTS;
        expect(card.composite.score).toBeCloseTo(
            ((card.insider.score ?? 0) * n +
                (card.largeHolders.score ?? 0) * l) /
                (n + l),
            2
        );
    });

    it('reports DART freshness and the Korean windows', () => {
        expect(card.freshness.krDisclosureLatestDate).toBe(daysBeforeAsOf(5));
        expect(card.freshness.insiderWindow.days).toBe(KR_WINDOW_DAYS);
        expect(card.freshness.insiderTransactionsInWindow).toBe(4);
        expect(card.freshness.institutionalPeriod).toBeNull();
    });

    it('is fully insufficient for a Korean snapshot without a DART block', () => {
        const empty = evaluateInvestorFlows(emptySnapshot({ market: 'kr' }));
        expect(INVESTOR_FLOWS_AXES.every(a => empty[a].score === null)).toBe(
            true
        );
        expect(empty.freshness.krDisclosureLatestDate).toBeNull();
    });

    it('computes the composite when both Korean axes are measured neutral or better (005930.KS)', () => {
        // 43 unchanged 5%+ holder reports used to leave largeHolders
        // insufficient, so the composite fell to "no data" despite a +15 insider axis.
        const samsung = evaluateInvestorFlows(
            emptySnapshot({
                market: 'kr',
                sharesOutstanding: 50_000_000,
                kr: {
                    majorHolders: Array.from({ length: 43 }, (_, i) =>
                        krMajorHolderReport({
                            receiptDate: daysBeforeAsOf(1 + (i % 80)),
                            reporter: i % 2 === 0 ? '삼성물산' : '국민연금공단',
                            ratioPct: i % 2 === 0 ? 19.69 : 7.5,
                            ratioChangePct: 0,
                            sharesChange: 0,
                        })
                    ),
                    insiders: [
                        krInsiderReport(),
                        krInsiderReport({
                            reporter: '김철수',
                            sharesChange: 10_000,
                        }),
                    ],
                    tradingPlans: [],
                },
            })
        );
        expect(samsung.largeHolders.sufficiency).toBe('sufficient');
        expect(samsung.largeHolders.score).toBe(0);
        expect(samsung.insider.score).toBe(15);
        expect(samsung.composite.axesUsed).toEqual(['insider', 'largeHolders']);
        const { insider: n, largeHolders: l } = COMPOSITE_WEIGHTS;
        expect(samsung.composite.score).toBeCloseTo((15 * n) / (n + l), 2);
        expect(samsung.composite.label).not.toBe('insufficient');
    });

    it('does not let the US insider rules read Korean rows', () => {
        // The US axis would need USD values; the KR one reads shares.
        expect(card.insider.metrics).toBeNull();
        expect(card.insider.krMetrics?.netSharesChange).toBe(45_000);
    });
});
