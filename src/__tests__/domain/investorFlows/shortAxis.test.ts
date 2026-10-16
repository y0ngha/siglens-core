import { describe, expect, it } from 'vitest';
import {
    DAYS_TO_COVER_MODERATE,
    DAYS_TO_COVER_WEAK,
    SHORT_INTEREST_PCT_FLOAT_MODERATE,
    SHORT_INTEREST_MAX_AGE_DAYS,
    SHORT_INTEREST_PCT_FLOAT_WEAK,
    SHORT_INTEREST_TREND_MIN_CHANGE_PCT,
    SHORT_INTEREST_TREND_MODERATE_CHANGE_PCT,
    SHORT_INTEREST_TREND_STRONG_CHANGE_PCT,
    SHORT_VOLUME_BASELINE_DAYS,
    SHORT_VOLUME_MAX_AGE_DAYS,
    SHORT_VOLUME_MIN_BASELINE_DAYS,
    SHORT_VOLUME_Z_MODERATE,
    SHORT_VOLUME_Z_WEAK,
    SQUEEZE_MIN_DAYS_TO_COVER,
    SQUEEZE_MIN_SHORT_INTEREST_PCT_FLOAT,
    SQUEEZE_STRONG_DAYS_TO_COVER,
    SQUEEZE_STRONG_SHORT_INTEREST_PCT_FLOAT,
} from '@/domain/investorFlows/constants';
import { parseDay } from '@/domain/investorFlows/scoreHelpers';
import { evaluateShortAxis } from '@/domain/investorFlows/shortAxis';
import type {
    InvestorFlowsSignal,
    InvestorFlowsSignalId,
    InvestorFlowsSignalStrength,
    ShortInterestPoint,
    ShortVolumePoint,
} from '@/domain/types';
import {
    AS_OF,
    ageShortInterest,
    ageShortVolume,
    baselineStandardDeviation,
    BASELINE_RATIO_MEAN,
    daysBeforeAsOf,
    shortInterestPoint,
    shortInterestSeries,
    shortVolumeSeries,
} from '../../fixtures/investorFlows';

const FLOAT = 100_000_000;

function signalOf(
    signals: readonly InvestorFlowsSignal[],
    id: InvestorFlowsSignalId
): InvestorFlowsSignal | undefined {
    return signals.find(s => s.id === id);
}

/** Short interest of `pct` percent of the float, one settlement. */
function levelAt(pct: number, daysToCover: number | null = 1) {
    return evaluateShortAxis(
        [shortInterestPoint({ shortQty: (pct / 100) * FLOAT, daysToCover })],
        null,
        FLOAT
    );
}

describe('evaluateShortAxis — short interest % of float', () => {
    const cases: ReadonlyArray<
        [string, number, InvestorFlowsSignalStrength | null]
    > = [
        ['just below weak', SHORT_INTEREST_PCT_FLOAT_WEAK - 0.01, null],
        ['at weak', SHORT_INTEREST_PCT_FLOAT_WEAK, 'weak'],
        [
            'just below moderate',
            SHORT_INTEREST_PCT_FLOAT_MODERATE - 0.01,
            'weak',
        ],
        ['at moderate', SHORT_INTEREST_PCT_FLOAT_MODERATE, 'moderate'],
        ['far above moderate (capped)', 80, 'moderate'],
    ];

    it.each(cases)('%s', (_name, pct, strength) => {
        const signal = signalOf(levelAt(pct).signals, 'short_interest_level');
        expect(signal?.strength).toBe(strength ?? undefined);
        if (signal !== undefined) expect(signal.direction).toBe('bearish');
    });

    it('reports the percentage and its inputs', () => {
        const axis = levelAt(12.34);
        expect(axis.metrics.shortInterestPctFloat).toBe(12.34);
        expect(
            signalOf(axis.signals, 'short_interest_level')?.evidence
        ).toEqual({
            shortInterestPctFloat: 12.34,
            shortQty: 12_340_000,
            floatShares: FLOAT,
        });
    });

    it.each([
        ['null', null],
        ['zero', 0],
        ['negative', -5],
    ])('skips the percentage when the float is %s', (_name, floatShares) => {
        const axis = evaluateShortAxis(
            [shortInterestPoint({ daysToCover: 6 })],
            null,
            floatShares
        );
        expect(axis.metrics.shortInterestPctFloat).toBeNull();
        expect(axis.metrics.daysToCover).toBe(6);
        // days to cover is context only; with no float there is no directional input
        expect(axis.sufficiency).toBe('insufficient');
        expect(axis.score).toBeNull();
    });
});

describe('evaluateShortAxis — days to cover', () => {
    const cases: ReadonlyArray<
        [string, number, InvestorFlowsSignalStrength | null]
    > = [
        ['just below weak', DAYS_TO_COVER_WEAK - 0.01, null],
        ['at weak', DAYS_TO_COVER_WEAK, 'weak'],
        ['just below moderate', DAYS_TO_COVER_MODERATE - 0.01, 'weak'],
        ['at moderate', DAYS_TO_COVER_MODERATE, 'moderate'],
    ];

    it.each(cases)('%s', (_name, dtc, strength) => {
        const signal = signalOf(levelAt(1, dtc).signals, 'days_to_cover_high');
        expect(signal?.strength).toBe(strength ?? undefined);
        if (signal !== undefined) {
            // crowding is not a direction
            expect(signal.direction).toBe('neutral');
        }
    });

    it('computes it from the average daily volume when none is published', () => {
        const axis = evaluateShortAxis(
            [
                shortInterestPoint({
                    shortQty: 30_000_000,
                    avgDailyVolume: 5_000_000,
                    daysToCover: null,
                }),
            ],
            null,
            FLOAT
        );
        expect(axis.metrics.daysToCover).toBe(6);
    });

    it('has none without a published value or a usable volume', () => {
        const axis = evaluateShortAxis(
            [
                shortInterestPoint({
                    daysToCover: null,
                    avgDailyVolume: 0,
                }),
            ],
            null,
            FLOAT
        );
        expect(axis.metrics.daysToCover).toBeNull();
    });
});

describe('evaluateShortAxis — short-interest trend', () => {
    const FIRST = 10_000_000;
    const toward = (pct: number) => Math.round(FIRST * (1 + pct / 100));
    const trendOf = (latest: number, first = FIRST) =>
        evaluateShortAxis(shortInterestSeries(first, latest), null, FLOAT);

    const rising: ReadonlyArray<
        [string, number, InvestorFlowsSignalStrength | null]
    > = [
        [
            'just below the minimum',
            SHORT_INTEREST_TREND_MIN_CHANGE_PCT - 0.01,
            null,
        ],
        ['at the minimum', SHORT_INTEREST_TREND_MIN_CHANGE_PCT, 'weak'],
        [
            'just below moderate',
            SHORT_INTEREST_TREND_MODERATE_CHANGE_PCT - 0.01,
            'weak',
        ],
        ['at moderate', SHORT_INTEREST_TREND_MODERATE_CHANGE_PCT, 'moderate'],
        [
            'just below strong',
            SHORT_INTEREST_TREND_STRONG_CHANGE_PCT - 0.01,
            'moderate',
        ],
        ['at strong', SHORT_INTEREST_TREND_STRONG_CHANGE_PCT, 'strong'],
    ];

    it.each(rising)('rising %s', (_name, pct, strength) => {
        const axis = trendOf(toward(pct));
        const signal = signalOf(axis.signals, 'short_interest_trend');
        expect(signal?.strength).toBe(strength ?? undefined);
        if (signal !== undefined) expect(signal.direction).toBe('bearish');
        expect(axis.metrics.shortInterestTrend).toBe(
            strength === null ? 'flat' : 'rising'
        );
    });

    it('reads falling short interest as bullish with the same thresholds', () => {
        const axis = trendOf(toward(-SHORT_INTEREST_TREND_MODERATE_CHANGE_PCT));
        expect(axis.metrics.shortInterestTrend).toBe('falling');
        expect(signalOf(axis.signals, 'short_interest_trend')).toMatchObject({
            direction: 'bullish',
            strength: 'moderate',
        });
    });

    it('requires strictly monotonic settlements: equal consecutive values are flat', () => {
        const axis = evaluateShortAxis(
            [
                shortInterestPoint({
                    settlementDate: daysBeforeAsOf(40),
                    shortQty: 10_000_000,
                }),
                shortInterestPoint({
                    settlementDate: daysBeforeAsOf(25),
                    shortQty: 10_000_000,
                }),
                shortInterestPoint({
                    settlementDate: daysBeforeAsOf(10),
                    shortQty: 12_000_000,
                }),
            ],
            null,
            FLOAT
        );
        expect(axis.metrics.shortInterestChangePct).toBe(20);
        expect(axis.metrics.shortInterestTrend).toBe('flat');
        expect(axis.signals.map(s => s.id)).not.toContain(
            'short_interest_trend'
        );
    });

    it('reads a non-monotonic move as flat even when the net change is large', () => {
        const axis = evaluateShortAxis(
            [
                shortInterestPoint({
                    settlementDate: daysBeforeAsOf(40),
                    shortQty: 10_000_000,
                }),
                shortInterestPoint({
                    settlementDate: daysBeforeAsOf(25),
                    shortQty: 14_000_000,
                }),
                shortInterestPoint({
                    settlementDate: daysBeforeAsOf(10),
                    shortQty: 12_000_000,
                }),
            ],
            null,
            FLOAT
        );
        expect(axis.metrics.shortInterestChangePct).toBe(20);
        expect(axis.metrics.shortInterestTrend).toBe('flat');
        expect(signalOf(axis.signals, 'short_interest_trend')).toBeUndefined();
    });

    it('needs three settlements and uses only the last three', () => {
        const two = evaluateShortAxis(
            shortInterestSeries(10_000_000, 15_000_000).slice(1),
            null,
            FLOAT
        );
        expect(two.metrics.shortInterestTrend).toBeNull();
        expect(two.metrics.shortInterestChangePct).toBeNull();

        const four = evaluateShortAxis(
            [
                shortInterestPoint({
                    settlementDate: daysBeforeAsOf(70),
                    shortQty: 1_000_000,
                }),
                ...shortInterestSeries(10_000_000, 12_000_000),
            ],
            null,
            FLOAT
        );
        expect(four.metrics.shortInterestChangePct).toBe(20);
    });

    it('reports the trend window endpoints and the latest one-settlement change', () => {
        // 10.0M → 11.0M → 12.0M at 40, 25 and 10 days back.
        const axis = evaluateShortAxis(
            shortInterestSeries(10_000_000, 12_000_000),
            null,
            FLOAT
        );
        expect(axis.metrics.shortInterestChangeFromDate).toBe(
            daysBeforeAsOf(40)
        );
        expect(axis.metrics.shortInterestChangeToDate).toBe(daysBeforeAsOf(10));
        expect(axis.metrics.shortInterestLatestChangePct).toBe(9.09);
        expect(axis.metrics.shortInterestLatestChangeFromDate).toBe(
            daysBeforeAsOf(25)
        );
        expect(axis.metrics.shortInterestLatestChangeToDate).toBe(
            daysBeforeAsOf(10)
        );
        expect(signalOf(axis.signals, 'short_interest_trend')?.subject).toBe(
            `${daysBeforeAsOf(40)} to ${daysBeforeAsOf(10)}`
        );
    });

    it('reports the latest change with two settlements, before a trend exists', () => {
        const two = evaluateShortAxis(
            shortInterestSeries(10_000_000, 15_000_000).slice(1),
            null,
            FLOAT
        );
        // 12.5M → 15.0M.
        expect(two.metrics.shortInterestLatestChangePct).toBe(20);
        expect(two.metrics.shortInterestChangeFromDate).toBeNull();
    });

    it('has no latest change with one settlement', () => {
        const one = evaluateShortAxis(
            shortInterestSeries(10_000_000, 15_000_000).slice(2),
            null,
            FLOAT
        );
        expect(one.metrics.shortInterestLatestChangePct).toBeNull();
        expect(one.metrics.shortInterestLatestChangeFromDate).toBeNull();
    });

    it('sorts settlements itself, so input order does not matter', () => {
        const axis = evaluateShortAxis(
            shortInterestSeries(10_000_000, 12_000_000).toReversed(),
            null,
            FLOAT
        );
        expect(axis.metrics.shortInterestTrend).toBe('rising');
    });

    it('has no trend when the oldest settlement is zero (no percentage exists)', () => {
        const axis = trendOf(5_000_000, 0);
        expect(axis.metrics.shortInterestTrend).toBeNull();
    });
});

describe('evaluateShortAxis — off-exchange short-volume z-score', () => {
    const axisFor = (volume: ShortVolumePoint[]) =>
        evaluateShortAxis(null, volume, FLOAT);

    const cases: ReadonlyArray<
        [string, number, InvestorFlowsSignalStrength | null]
    > = [
        ['just below weak', SHORT_VOLUME_Z_WEAK - 0.01, null],
        ['at weak', SHORT_VOLUME_Z_WEAK, 'weak'],
        ['just below moderate', SHORT_VOLUME_Z_MODERATE - 0.01, 'weak'],
        ['at moderate', SHORT_VOLUME_Z_MODERATE, 'moderate'],
        ['far above moderate (capped)', 8, 'moderate'],
    ];

    it.each(cases)('high ratio %s', (_name, z, strength) => {
        const axis = axisFor(shortVolumeSeries(z));
        const signal = signalOf(axis.signals, 'off_exchange_short_ratio_z');
        expect(signal?.strength).toBe(strength ?? undefined);
        if (signal !== undefined) expect(signal.direction).toBe('bearish');
    });

    it('reads a low ratio as bullish', () => {
        const axis = axisFor(shortVolumeSeries(-SHORT_VOLUME_Z_MODERATE));
        expect(
            signalOf(axis.signals, 'off_exchange_short_ratio_z')
        ).toMatchObject({ direction: 'bullish', strength: 'moderate' });
        expect(axis.metrics.shortVolumeRatioZ).toBe(-SHORT_VOLUME_Z_MODERATE);
    });

    it('compares the latest day against the days before it, not itself', () => {
        const axis = axisFor(shortVolumeSeries(3));
        const expectedRatio =
            BASELINE_RATIO_MEAN + 3 * baselineStandardDeviation(60);
        expect(axis.metrics.shortVolumeRatio).toBeCloseTo(expectedRatio, 4);
        expect(axis.metrics.shortVolumeRatioZ).toBe(3);
        expect(axis.metrics.shortVolumeBaselineDays).toBe(60);
    });

    it('stops the baseline at SHORT_VOLUME_BASELINE_DAYS', () => {
        const withOutliers = axisFor(
            shortVolumeSeries(2, SHORT_VOLUME_BASELINE_DAYS, 20)
        );
        expect(withOutliers.metrics.shortVolumeBaselineDays).toBe(
            SHORT_VOLUME_BASELINE_DAYS
        );
        expect(withOutliers.metrics.shortVolumeRatioZ).toBe(2);
    });

    it('needs SHORT_VOLUME_MIN_BASELINE_DAYS days of baseline', () => {
        const enough = axisFor(
            shortVolumeSeries(2, SHORT_VOLUME_MIN_BASELINE_DAYS)
        );
        const tooFew = axisFor(
            shortVolumeSeries(2, SHORT_VOLUME_MIN_BASELINE_DAYS - 1)
        );
        expect(enough.metrics.shortVolumeRatioZ).not.toBeNull();
        expect(tooFew.metrics.shortVolumeRatioZ).toBeNull();
        expect(tooFew.metrics.shortVolumeRatio).not.toBeNull();
        expect(tooFew.sufficiency).toBe('insufficient');
    });

    it('has no z-score against a constant baseline (zero spread)', () => {
        const flat = Array.from({ length: 40 }, (_, i) => ({
            date: daysBeforeAsOf(40 - i),
            shortVolume: 450_000,
            totalVolume: 1_000_000,
        }));
        const axis = axisFor([
            ...flat,
            {
                date: daysBeforeAsOf(0),
                shortVolume: 600_000,
                totalVolume: 1_000_000,
            },
        ]);
        expect(axis.metrics.shortVolumeRatioZ).toBeNull();
        expect(axis.metrics.shortVolumeBaselineDays).toBeNull();
    });

    it.each([
        ['zero total volume', { shortVolume: 1, totalVolume: 0 }],
        ['short above total', { shortVolume: 2, totalVolume: 1 }],
        ['negative short volume', { shortVolume: -1, totalVolume: 10 }],
        ['NaN volume', { shortVolume: Number.NaN, totalVolume: 10 }],
    ])('drops a day with %s', (_name, bad) => {
        const volume = shortVolumeSeries(2);
        const axis = axisFor([...volume, { date: daysBeforeAsOf(-1), ...bad }]);
        expect(axis.metrics.shortVolumeRatioZ).toBe(2);
    });
});

describe('evaluateShortAxis — squeeze risk', () => {
    /** Rising 20% over three settlements ending at `pct` of float. */
    const squeezeCase = (pct: number, dtc: number, first?: number) => {
        const latest = (pct / 100) * FLOAT;
        return evaluateShortAxis(
            shortInterestSeries(first ?? latest / 1.2, latest, dtc),
            null,
            FLOAT
        );
    };

    it('flags crowded, hard-to-cover, rising short interest as a moderate neutral signal', () => {
        const axis = squeezeCase(
            SQUEEZE_MIN_SHORT_INTEREST_PCT_FLOAT,
            SQUEEZE_MIN_DAYS_TO_COVER
        );
        expect(axis.metrics.squeezeRisk).toBe(true);
        expect(signalOf(axis.signals, 'short_squeeze_risk')).toMatchObject({
            direction: 'neutral',
            strength: 'moderate',
        });
    });

    it('contributes no score of its own', () => {
        const axis = squeezeCase(15, 5);
        const squeeze = signalOf(axis.signals, 'short_squeeze_risk');
        const others = axis.signals.filter(s => s !== squeeze);
        const expected = others.reduce(
            (sum, s) =>
                sum +
                (s.direction === 'neutral'
                    ? 0
                    : (s.direction === 'bullish' ? 1 : -1) *
                      { weak: 15, moderate: 35, strong: 60 }[s.strength]),
            0
        );
        expect(axis.score).toBe(expected);
    });

    it('needs short interest of at least the minimum % of float', () => {
        const axis = squeezeCase(
            SQUEEZE_MIN_SHORT_INTEREST_PCT_FLOAT - 0.01,
            SQUEEZE_MIN_DAYS_TO_COVER
        );
        expect(axis.metrics.squeezeRisk).toBe(false);
        expect(signalOf(axis.signals, 'short_squeeze_risk')).toBeUndefined();
    });

    it('needs days to cover of at least the minimum', () => {
        const axis = squeezeCase(
            SQUEEZE_MIN_SHORT_INTEREST_PCT_FLOAT,
            SQUEEZE_MIN_DAYS_TO_COVER - 0.01
        );
        expect(axis.metrics.squeezeRisk).toBe(false);
    });

    it('needs short interest to be rising', () => {
        const latest = 0.15 * FLOAT;
        const flat = evaluateShortAxis(
            shortInterestSeries(latest, latest + 1, 5),
            null,
            FLOAT
        );
        const falling = evaluateShortAxis(
            shortInterestSeries(latest * 1.2, latest, 5),
            null,
            FLOAT
        );
        expect(flat.metrics.squeezeRisk).toBe(false);
        expect(falling.metrics.squeezeRisk).toBe(false);
    });

    it('cannot flag a squeeze without the float (no % of float) or without a trend', () => {
        const noFloat = evaluateShortAxis(
            shortInterestSeries(12_500_000, 15_000_000, 6),
            null,
            null
        );
        const oneSettlement = levelAt(30, 9);
        expect(noFloat.metrics.squeezeRisk).toBe(false);
        expect(oneSettlement.metrics.squeezeRisk).toBe(false);
    });

    it('is strong only when both strong thresholds hold', () => {
        const strong = squeezeCase(
            SQUEEZE_STRONG_SHORT_INTEREST_PCT_FLOAT,
            SQUEEZE_STRONG_DAYS_TO_COVER
        );
        const lowPct = squeezeCase(
            SQUEEZE_STRONG_SHORT_INTEREST_PCT_FLOAT - 0.01,
            SQUEEZE_STRONG_DAYS_TO_COVER
        );
        const lowDtc = squeezeCase(
            SQUEEZE_STRONG_SHORT_INTEREST_PCT_FLOAT,
            SQUEEZE_STRONG_DAYS_TO_COVER - 0.01
        );
        expect(signalOf(strong.signals, 'short_squeeze_risk')?.strength).toBe(
            'strong'
        );
        expect(signalOf(lowPct.signals, 'short_squeeze_risk')?.strength).toBe(
            'moderate'
        );
        expect(signalOf(lowDtc.signals, 'short_squeeze_risk')?.strength).toBe(
            'moderate'
        );
    });
});

describe('evaluateShortAxis — sufficiency and score', () => {
    it.each([
        ['both feeds off (null)', null, null],
        ['empty feeds', [], []],
    ])('is insufficient with %s', (_name, interest, volume) => {
        const axis = evaluateShortAxis(interest, volume, FLOAT);
        expect(axis).toMatchObject({
            score: null,
            label: 'insufficient',
            sufficiency: 'insufficient',
            signals: [],
        });
        expect(axis.metrics.squeezeRisk).toBe(false);
    });

    it('is insufficient when a single settlement has neither a float nor days to cover', () => {
        const axis = evaluateShortAxis(
            [shortInterestPoint({ daysToCover: null, avgDailyVolume: null })],
            null,
            null
        );
        expect(axis.sufficiency).toBe('insufficient');
    });

    it('does not let days to cover alone make the axis sufficient (it only emits a neutral signal)', () => {
        const axis = evaluateShortAxis(
            [shortInterestPoint({ daysToCover: 12 })],
            null,
            null
        );
        expect(axis).toMatchObject({
            score: null,
            label: 'insufficient',
            sufficiency: 'insufficient',
        });
        expect(axis.metrics.daysToCover).toBe(12);
    });

    it('is sufficient once a directional input exists: % of float', () => {
        const axis = evaluateShortAxis(
            [shortInterestPoint({ shortQty: 1_000_000, daysToCover: 12 })],
            null,
            FLOAT
        );
        expect(axis.sufficiency).toBe('sufficient');
    });

    it('is sufficient with a computable trend even when it is flat', () => {
        const axis = evaluateShortAxis(
            shortInterestSeries(10_000_000, 10_000_001),
            null,
            null
        );
        expect(axis.metrics.shortInterestTrend).toBe('flat');
        expect(axis.sufficiency).toBe('sufficient');
        expect(axis.score).toBe(0);
    });

    it('is sufficient from short volume alone', () => {
        expect(
            evaluateShortAxis(null, shortVolumeSeries(0), null).sufficiency
        ).toBe('sufficient');
    });

    it('drops settlements with unusable dates or quantities', () => {
        const bad: ShortInterestPoint[] = [
            shortInterestPoint({ settlementDate: 'garbage' }),
            shortInterestPoint({ shortQty: -1 }),
            shortInterestPoint({ shortQty: Number.NaN }),
        ];
        expect(evaluateShortAxis(bad, null, FLOAT).sufficiency).toBe(
            'insufficient'
        );
    });

    it('adds level, trend and z-score points, clamped and labelled', () => {
        const axis = evaluateShortAxis(
            shortInterestSeries(15_000_000, 22_000_000, 6),
            shortVolumeSeries(2.6),
            FLOAT
        );
        // level 22% moderate(-35), trend +46.7% strong(-60), z 2.6 moderate(-35)
        expect(axis.score).toBe(-100);
        expect(axis.label).toBe('strong_bearish');
    });

    it('scores falling short interest as bullish', () => {
        const axis = evaluateShortAxis(
            shortInterestSeries(5_000_000, 3_000_000),
            null,
            FLOAT
        );
        expect(axis.score).toBe(60);
        expect(axis.label).toBe('strong_bullish');
    });
});

describe('evaluateShortAxis — freshness gates', () => {
    const AS_OF_DAY = parseDay(AS_OF);
    const interestAged = (age: number) =>
        ageShortInterest(
            shortInterestSeries(12_000_000, 14_000_000, 6),
            age - 10
        );
    const volumeAged = (age: number) =>
        ageShortVolume(shortVolumeSeries(2), age);
    const run = (
        interest: ShortInterestPoint[] | null,
        volume: ShortVolumePoint[] | null
    ) => evaluateShortAxis(interest, volume, FLOAT, AS_OF_DAY);

    it('scores a settlement exactly SHORT_INTEREST_MAX_AGE_DAYS old', () => {
        const axis = run(interestAged(SHORT_INTEREST_MAX_AGE_DAYS), null);
        expect(axis.sufficiency).toBe('sufficient');
        expect(signalOf(axis.signals, 'data_stale')).toBeUndefined();
    });

    it('does not score a settlement one day older, and says so with its date', () => {
        const aged = interestAged(SHORT_INTEREST_MAX_AGE_DAYS + 1);
        const axis = run(aged, null);
        expect(axis).toMatchObject({
            score: null,
            label: 'insufficient',
            sufficiency: 'insufficient',
        });
        expect(axis.signals).toEqual([
            {
                id: 'data_stale',
                axis: 'short',
                direction: 'neutral',
                strength: 'weak',
                evidence: {
                    ageDays: SHORT_INTEREST_MAX_AGE_DAYS + 1,
                    maxAgeDays: SHORT_INTEREST_MAX_AGE_DAYS,
                },
                subject: aged.at(-1)!.settlementDate,
            },
        ]);
        expect(axis.metrics.shortInterestPctFloat).toBeNull();
        expect(axis.metrics.daysToCover).toBeNull();
    });

    it('scores short volume exactly SHORT_VOLUME_MAX_AGE_DAYS old', () => {
        const axis = run(null, volumeAged(SHORT_VOLUME_MAX_AGE_DAYS));
        expect(axis.sufficiency).toBe('sufficient');
        expect(signalOf(axis.signals, 'data_stale')).toBeUndefined();
    });

    it('does not score short volume one day older, and says so with its date', () => {
        const aged = volumeAged(SHORT_VOLUME_MAX_AGE_DAYS + 1);
        const axis = run(null, aged);
        expect(axis.sufficiency).toBe('insufficient');
        expect(signalOf(axis.signals, 'data_stale')).toMatchObject({
            direction: 'neutral',
            subject: aged.at(-1)!.date,
            evidence: {
                ageDays: SHORT_VOLUME_MAX_AGE_DAYS + 1,
                maxAgeDays: SHORT_VOLUME_MAX_AGE_DAYS,
            },
        });
        expect(axis.metrics.shortVolumeRatioZ).toBeNull();
    });

    it('scores the fresh feed and flags the stale one when only one is stale', () => {
        const axis = run(
            interestAged(SHORT_INTEREST_MAX_AGE_DAYS + 1),
            volumeAged(0)
        );
        expect(axis.sufficiency).toBe('sufficient');
        expect(axis.metrics.shortVolumeRatioZ).toBe(2);
        expect(axis.metrics.shortInterestPctFloat).toBeNull();
        expect(axis.signals.filter(s => s.id === 'data_stale')).toHaveLength(1);
    });

    it('flags both feeds when both are stale', () => {
        const axis = run(
            interestAged(SHORT_INTEREST_MAX_AGE_DAYS + 1),
            volumeAged(SHORT_VOLUME_MAX_AGE_DAYS + 1)
        );
        expect(axis.sufficiency).toBe('insufficient');
        expect(axis.signals.filter(s => s.id === 'data_stale')).toHaveLength(2);
    });

    it('applies no freshness gate without a reference date', () => {
        const axis = evaluateShortAxis(
            interestAged(400),
            volumeAged(400),
            FLOAT
        );
        expect(axis.sufficiency).toBe('sufficient');
        expect(signalOf(axis.signals, 'data_stale')).toBeUndefined();
    });

    it('squeeze risk uses the days-to-cover level of the latest settlement, not its change', () => {
        const base = (daysToCover: number) => {
            const series = shortInterestSeries(
                12_500_000,
                15_000_000,
                daysToCover
            );
            // an earlier settlement with a much HIGHER days to cover must not matter
            return evaluateShortAxis(
                series.map((p, i) => ({
                    ...p,
                    daysToCover: i === series.length - 1 ? daysToCover : 40,
                })),
                null,
                FLOAT
            );
        };
        expect(base(SQUEEZE_MIN_DAYS_TO_COVER).metrics.squeezeRisk).toBe(true);
        expect(base(SQUEEZE_MIN_DAYS_TO_COVER - 0.5).metrics.squeezeRisk).toBe(
            false
        );
    });
});

describe('evaluateShortAxis — rows dated after the reference date', () => {
    const AS_OF_DAY = parseDay(AS_OF);
    const run = (
        interest: ShortInterestPoint[] | null,
        volume: ShortVolumePoint[] | null
    ) => evaluateShortAxis(interest, volume, FLOAT, AS_OF_DAY);

    it('is insufficient when every short-interest settlement is in the future, with no stale signal (negative age is not "old")', () => {
        const axis = run(
            ageShortInterest(
                shortInterestSeries(12_000_000, 14_000_000, 6),
                -60
            ),
            null
        );
        expect(axis).toMatchObject({
            score: null,
            label: 'insufficient',
            sufficiency: 'insufficient',
            signals: [],
        });
        expect(axis.metrics.shortInterestPctFloat).toBeNull();
    });

    it('is insufficient when every short-volume day is in the future', () => {
        const axis = run(null, ageShortVolume(shortVolumeSeries(2), -61));
        expect(axis.sufficiency).toBe('insufficient');
        expect(axis.metrics.shortVolumeRatioZ).toBeNull();
    });

    it('uses the newest settlement ON or before the reference date, ignoring later ones', () => {
        const visible = shortInterestSeries(12_000_000, 14_000_000, 6);
        const future = shortInterestPoint({
            settlementDate: daysBeforeAsOf(-5),
            shortQty: 90_000_000,
            daysToCover: 30,
        });
        const axis = run([...visible, future], null);
        expect(axis.metrics.shortInterestPctFloat).toBe(14);
        expect(axis.metrics.daysToCover).toBe(6);
        expect(axis.metrics.shortInterestChangePct).toBeCloseTo(16.67, 1);
    });

    it('does not let a future settlement hide that the visible feed is stale', () => {
        const stale = ageShortInterest(
            shortInterestSeries(12_000_000, 14_000_000, 6),
            SHORT_INTEREST_MAX_AGE_DAYS
        );
        const future = shortInterestPoint({
            settlementDate: daysBeforeAsOf(-5),
        });
        const axis = run([...stale, future], null);
        expect(signalOf(axis.signals, 'data_stale')).toBeDefined();
        expect(axis.sufficiency).toBe('insufficient');
    });

    it('ignores a future short-volume day when computing the latest ratio and z', () => {
        const visible = shortVolumeSeries(2);
        const future = {
            date: daysBeforeAsOf(-3),
            shortVolume: 999_000,
            totalVolume: 1_000_000,
        };
        const axis = run(null, [...visible, future]);
        expect(axis.metrics.shortVolumeRatioZ).toBe(2);
    });

    it('treats a settlement dated exactly on the reference day as visible', () => {
        const axis = run(
            [
                shortInterestPoint({
                    settlementDate: AS_OF,
                    shortQty: 10_000_000,
                }),
            ],
            null
        );
        expect(axis.metrics.shortInterestPctFloat).toBe(10);
    });
});
