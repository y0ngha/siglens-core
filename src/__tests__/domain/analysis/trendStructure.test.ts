import { describe, expect, it } from 'vitest';
import {
    efficiencyRatio,
    classifyEmaStack,
    classifyMaStack,
    classifyStackOrder,
    classifySwingStructure,
} from '@/domain/analysis/trendStructure';
import type { IndicatorResult } from '@/domain/types';

/** Only `ma` is read by `classifyMaStack`; the rest of the result is irrelevant. */
const withMa = (ma: Record<number, (number | null)[]>): IndicatorResult =>
    ({ ma }) as unknown as IndicatorResult;

describe('trendStructure helpers', () => {
    it('efficiencyRatio is 1 for a perfectly monotonic path', () => {
        expect(efficiencyRatio([1, 2, 3, 4, 5], 4)).toBeCloseTo(1, 6);
    });
    it('efficiencyRatio is low for a round trip', () => {
        expect(efficiencyRatio([1, 5, 1], 2)).toBeCloseTo(0, 6);
    });
    it('classifies aligned-up EMA stack', () => {
        expect(classifyEmaStack(30, 25, 20)).toBe('aligned_up'); // price>ema9>ema20
    });
    it('classifies HH_HL from ascending swings', () => {
        expect(classifySwingStructure([100, 110], [90, 95])).toBe('HH_HL');
    });
    it('classifies LH_LL from descending swings', () => {
        expect(classifySwingStructure([110, 100], [95, 90])).toBe('LH_LL');
    });

    it('efficiencyRatio returns null when closes are shorter than period+1', () => {
        expect(efficiencyRatio([1, 2], 5)).toBeNull();
    });

    it('efficiencyRatio returns null for a flat (zero-volatility) path', () => {
        expect(efficiencyRatio([3, 3, 3, 3], 3)).toBeNull();
    });

    it('classifies aligned-down EMA stack', () => {
        // price<ema9<ema20
        expect(classifyEmaStack(10, 15, 20)).toBe('aligned_down');
    });

    it('classifies a mixed EMA stack when alignment is broken', () => {
        // price above short EMA but short below long EMA -> neither aligned
        expect(classifyEmaStack(30, 25, 28)).toBe('mixed');
    });

    it('classifies mixed swing structure with too few swings', () => {
        expect(classifySwingStructure([100], [90])).toBe('mixed');
    });

    it('classifies mixed swing structure when highs and lows disagree', () => {
        // higher high but lower low -> neither HH_HL nor LH_LL
        expect(classifySwingStructure([100, 110], [95, 90])).toBe('mixed');
    });
});

describe('classifyStackOrder', () => {
    it('is bullish for strictly decreasing values', () => {
        expect(classifyStackOrder([30, 20, 10])).toBe('bullish');
    });
    it('is bearish for strictly increasing values', () => {
        expect(classifyStackOrder([10, 20, 30])).toBe('bearish');
    });
    it('is mixed for interleaved values or ties', () => {
        expect(classifyStackOrder([30, 10, 20])).toBe('mixed');
        expect(classifyStackOrder([20, 20])).toBe('mixed');
    });
    it('is null for fewer than two values', () => {
        expect(classifyStackOrder([])).toBeNull();
        expect(classifyStackOrder([42])).toBeNull();
    });
});

describe('classifyMaStack', () => {
    it('is bullish when the latest MAs strictly decrease as the period grows', () => {
        const ind = withMa({
            5: [1, 150],
            20: [1, 140],
            60: [1, 130],
            120: [1, 120],
            200: [1, 110],
        });
        expect(classifyMaStack(ind)).toBe('bullish');
    });

    it('is bearish when the latest MAs strictly increase as the period grows', () => {
        const ind = withMa({
            5: [110],
            20: [120],
            60: [130],
            120: [140],
            200: [150],
        });
        expect(classifyMaStack(ind)).toBe('bearish');
    });

    it('is mixed when the ordering is broken', () => {
        const ind = withMa({
            5: [150],
            20: [130],
            60: [140],
            120: [120],
            200: [110],
        });
        expect(classifyMaStack(ind)).toBe('mixed');
    });

    it('is mixed when two adjacent periods tie', () => {
        expect(classifyMaStack(withMa({ 5: [100], 20: [100] }))).toBe('mixed');
    });

    it('reads only the last element, not an earlier value', () => {
        // Earlier bars were bearish-ordered; only the latest bar counts.
        const ind = withMa({ 5: [10, 30], 20: [20, 20], 60: [30, 10] });
        expect(classifyMaStack(ind)).toBe('bullish');
    });

    it('is null when fewer than two periods have a finite latest value', () => {
        expect(classifyMaStack(withMa({}))).toBeNull();
        expect(classifyMaStack(withMa({ 5: [100] }))).toBeNull();
        expect(
            classifyMaStack(
                withMa({ 5: [100], 20: [null], 60: [Number.NaN], 120: [] })
            )
        ).toBeNull();
    });

    it('drops null / NaN / Infinity latest values without falling back to earlier ones', () => {
        const ind = withMa({
            5: [150],
            20: [999, null], // latest is null → dropped (999 is NOT used)
            60: [130],
            120: [Number.NaN],
            200: [Number.POSITIVE_INFINITY],
        });
        // Remaining: MA5=150 > MA60=130 → bullish.
        expect(classifyMaStack(ind)).toBe('bullish');
    });

    it('ignores series for periods outside the configured set', () => {
        // MA10 would break the order but is not in MA_DEFAULT_PERIODS.
        const ind = withMa({ 5: [150], 10: [500], 20: [140] });
        expect(classifyMaStack(ind)).toBe('bullish');
    });

    it('honours custom periods and their order', () => {
        const ind = withMa({ 10: [100], 50: [110], 5: [200], 20: [90] });
        expect(classifyMaStack(ind, [10, 50])).toBe('bearish');
        expect(classifyMaStack(ind, [5, 20])).toBe('bullish');
        expect(classifyMaStack(ind, [5, 10, 50])).toBe('mixed');
        expect(classifyMaStack(ind, [10])).toBeNull();
        expect(classifyMaStack(ind, [])).toBeNull();
    });
});
