import { describe, expect, it } from 'vitest';
import {
    FTD_BASELINE_TRADING_DAYS,
    FTD_MAX_AGE_DAYS,
    THRESHOLD_LIST_MAX_AGE_DAYS,
    FTD_MIN_QTY,
    FTD_RECENT_WINDOW_DAYS,
    THRESHOLD_LIST_CLOSE_OUT_DAYS,
} from '@/domain/investorFlows/constants';
import { parseDay } from '@/domain/investorFlows/scoreHelpers';
import { evaluateShortAxis } from '@/domain/investorFlows/shortAxis';
import type {
    FailsToDeliverPoint,
    InvestorFlowsSignal,
    InvestorFlowsSignalId,
    ThresholdListStatus,
} from '@/domain/types';
import {
    AS_OF,
    daysBeforeAsOf,
    ftdPoint,
    shortInterestSeries,
} from '../../fixtures/investorFlows';

const AS_OF_DAY = parseDay(AS_OF);
/** A 40M-share small cap: 0.5% of it is the Reg SHO threshold level (200,000 shares). */
const SHARES_OUT = 40_000_000;
const FLOAT = 36_000_000;

function axisWith(
    failsToDeliver: readonly FailsToDeliverPoint[] | null,
    thresholdList: ThresholdListStatus | null = null
) {
    return evaluateShortAxis(null, null, FLOAT, AS_OF_DAY, {
        failsToDeliver,
        sharesOutstanding: SHARES_OUT,
        thresholdList,
    });
}

function signalOf(
    signals: readonly InvestorFlowsSignal[],
    id: InvestorFlowsSignalId
): InvestorFlowsSignal | undefined {
    return signals.find(s => s.id === id);
}

/** A quiet baseline: `qty` fails on each of 10 days between 35 and 80 days ago. */
function baseline(qty: number): FailsToDeliverPoint[] {
    return Array.from({ length: 10 }, (_, i) =>
        ftdPoint({ settlementDate: daysBeforeAsOf(35 + i * 5), failsQty: qty })
    );
}

describe('evaluateShortAxis — fails to deliver', () => {
    it('reads a 250,000-share spike on a 40M-share stock as moderate, neutral context', () => {
        const axis = axisWith([
            ...baseline(20_000),
            ftdPoint({ settlementDate: daysBeforeAsOf(18), failsQty: 250_000 }),
            ftdPoint({ settlementDate: daysBeforeAsOf(17), failsQty: 90_000 }),
        ]);
        const multiple =
            Math.round(
                (250_000 / ((10 * 20_000) / FTD_BASELINE_TRADING_DAYS)) * 100
            ) / 100;
        expect(signalOf(axis.signals, 'fails_to_deliver_elevated')).toEqual({
            id: 'fails_to_deliver_elevated',
            axis: 'short',
            direction: 'neutral',
            strength: 'moderate',
            evidence: {
                peakFailsQty: 250_000,
                pctOfSharesOutstanding: 0.625,
                baselineMultiple: multiple,
                recentWindowDays: FTD_RECENT_WINDOW_DAYS,
            },
        });
        expect(axis.metrics.failsToDeliverPeakQty).toBe(250_000);
        expect(axis.metrics.failsToDeliverMultiple).toBe(multiple);
    });

    it('keeps a weak level (0.1–0.5% of outstanding) weak', () => {
        const axis = axisWith([ftdPoint({ failsQty: 60_000 })]);
        expect(
            signalOf(axis.signals, 'fails_to_deliver_elevated')?.strength
        ).toBe('weak');
    });

    it('holds a chronic peak (under 2x its baseline) at weak', () => {
        // 250k peak against ~310k average daily fails over the baseline: chronic, not new.
        const axis = axisWith([
            ...baseline(1_300_000),
            ftdPoint({ failsQty: 250_000 }),
        ]);
        const signal = signalOf(axis.signals, 'fails_to_deliver_elevated');
        expect(signal?.strength).toBe('weak');
        expect(signal?.evidence.baselineMultiple).toBeLessThan(2);
    });

    it('reports a new peak without a baseline (multiple null) at its level strength', () => {
        const axis = axisWith([ftdPoint({ failsQty: 250_000 })]);
        const signal = signalOf(axis.signals, 'fails_to_deliver_elevated');
        expect(signal?.strength).toBe('moderate');
        expect(signal?.evidence.baselineMultiple).toBeNull();
    });

    it('ignores fails under the Reg SHO 10,000-share floor', () => {
        // 9,999 shares of a 4M-share micro cap is 0.25% but below the floor.
        const axis = evaluateShortAxis(null, null, null, AS_OF_DAY, {
            failsToDeliver: [ftdPoint({ failsQty: FTD_MIN_QTY - 1 })],
            sharesOutstanding: 4_000_000,
        });
        expect(
            signalOf(axis.signals, 'fails_to_deliver_elevated')
        ).toBeUndefined();
    });

    it('ignores fails older than the recent window', () => {
        const axis = axisWith([
            ftdPoint({
                settlementDate: daysBeforeAsOf(FTD_RECENT_WINDOW_DAYS + 1),
                failsQty: 400_000,
            }),
        ]);
        expect(axis.metrics.failsToDeliverPeakQty).toBe(0);
        expect(
            signalOf(axis.signals, 'fails_to_deliver_elevated')
        ).toBeUndefined();
    });

    it('drops future-dated fails', () => {
        const axis = axisWith([
            ftdPoint({ settlementDate: '2026-10-20', failsQty: 400_000 }),
        ]);
        expect(axis.metrics.failsToDeliverPeakQty).toBe(0);
    });

    it('treats a feed whose newest fail day is over FTD_MAX_AGE_DAYS old as stale (null metrics)', () => {
        const axis = axisWith([
            ftdPoint({
                settlementDate: daysBeforeAsOf(FTD_MAX_AGE_DAYS + 1),
                failsQty: 400_000,
            }),
        ]);
        expect(axis.metrics.failsToDeliverPeakQty).toBeNull();
    });

    it('reads an empty feed as present with no fails', () => {
        expect(axisWith([]).metrics.failsToDeliverPeakQty).toBe(0);
    });

    it('has no FTD metrics when the feed is unavailable', () => {
        const axis = axisWith(null);
        expect(axis.metrics.failsToDeliverPeakQty).toBeNull();
        expect(axis.metrics.failsToDeliverPctOutstanding).toBeNull();
    });

    it('cannot make the short axis sufficient on its own (neutral context)', () => {
        const axis = axisWith([ftdPoint({ failsQty: 250_000 })]);
        expect(axis.sufficiency).toBe('insufficient');
        expect(axis.score).toBeNull();
        expect(
            signalOf(axis.signals, 'fails_to_deliver_elevated')
        ).toBeDefined();
    });

    it('adds no points to a sufficient short axis', () => {
        const interest = shortInterestSeries(4_000_000, 4_000_000);
        const without = evaluateShortAxis(interest, null, FLOAT, AS_OF_DAY);
        const withFtd = evaluateShortAxis(interest, null, FLOAT, AS_OF_DAY, {
            failsToDeliver: [ftdPoint({ failsQty: 250_000 })],
            sharesOutstanding: SHARES_OUT,
        });
        expect(withFtd.score).toBe(without.score);
        expect(withFtd.signals.length).toBe(without.signals.length + 1);
    });
});

describe('evaluateShortAxis — Reg SHO threshold list', () => {
    const listed = (consecutiveDays: number): ThresholdListStatus => ({
        listed: true,
        consecutiveDays,
        firstListedDate: daysBeforeAsOf(consecutiveDays + 2),
        markets: ['Nasdaq'],
    });

    it('reports a listing as weak neutral context', () => {
        const axis = axisWith(null, listed(6));
        expect(signalOf(axis.signals, 'reg_sho_threshold_listed')).toEqual({
            id: 'reg_sho_threshold_listed',
            axis: 'short',
            direction: 'neutral',
            strength: 'weak',
            evidence: {
                consecutiveDays: 6,
                closeOutDays: THRESHOLD_LIST_CLOSE_OUT_DAYS,
            },
            subject: 'Nasdaq',
        });
        expect(axis.metrics.thresholdListed).toBe(true);
        expect(axis.metrics.thresholdConsecutiveDays).toBe(6);
    });

    it('turns moderate on the mandatory close-out day', () => {
        const axis = axisWith(null, listed(THRESHOLD_LIST_CLOSE_OUT_DAYS));
        expect(
            signalOf(axis.signals, 'reg_sho_threshold_listed')?.strength
        ).toBe('moderate');
    });

    it('stays weak the day before close-out', () => {
        const axis = axisWith(null, listed(THRESHOLD_LIST_CLOSE_OUT_DAYS - 1));
        expect(
            signalOf(axis.signals, 'reg_sho_threshold_listed')?.strength
        ).toBe('weak');
    });

    it('emits nothing for a status that is not listed', () => {
        const axis = axisWith(null, {
            listed: false,
            consecutiveDays: 0,
            firstListedDate: null,
            markets: [],
        });
        expect(
            signalOf(axis.signals, 'reg_sho_threshold_listed')
        ).toBeUndefined();
        expect(axis.metrics.thresholdListed).toBe(false);
    });

    it('omits the subject when no market is named', () => {
        const axis = axisWith(null, { ...listed(3), markets: [] });
        expect(
            signalOf(axis.signals, 'reg_sho_threshold_listed')?.subject
        ).toBeUndefined();
    });

    it('drops a list dated more than THRESHOLD_LIST_MAX_AGE_DAYS before the reference day', () => {
        const axis = axisWith(null, {
            ...listed(6),
            asOf: daysBeforeAsOf(THRESHOLD_LIST_MAX_AGE_DAYS + 1),
        });
        expect(
            signalOf(axis.signals, 'reg_sho_threshold_listed')
        ).toBeUndefined();
        expect(axis.metrics.thresholdListed).toBeNull();
    });

    it('keeps a list dated within the max age', () => {
        const axis = axisWith(null, {
            ...listed(6),
            asOf: daysBeforeAsOf(1),
        });
        expect(axis.metrics.thresholdListed).toBe(true);
    });

    it('has null list metrics when the lists are excluded', () => {
        expect(axisWith(null, null).metrics.thresholdListed).toBeNull();
    });
});
