import { describe, expect, it } from 'vitest';
import type { Bar } from '@/domain/types';
import { buildDivergenceCandidates } from '@/domain/overlays/divergenceCandidates';
import { findRegularDivergencePair } from '@/domain/signals/anticipation';
import { DIVERGENCE_LOOKBACK_BARS } from '@/domain/signals/constants';

const FMT = { timeframe: '1Day' as const, quoting: { dp: 2, krxTick: null } };

/**
 * 20 bars: pivot low at index 4 (105) and a lower, fresher pivot low at
 * index 15 (103) — within `DIVERGENCE_FRESHNESS_BARS` (5) of the last bar
 * (index 19). RSI rises 25 → 32 across the two lows (regular bullish
 * divergence).
 */
function bullishSetup(): { bars: Bar[]; rsi: (number | null)[] } {
    const lows = [
        110, 109, 108, 107, 105, 107, 108, 109, 110, 109, 108, 107, 106, 105,
        106, 103, 105, 107, 109, 111,
    ];
    const bars = lows.map((low, i) => ({
        time: 1000 + i,
        open: low + 1,
        high: low + 2,
        low,
        close: low + 1,
        volume: 1,
    }));
    const rsi = lows.map((_, i) => (i === 4 ? 25 : i === 15 ? 32 : 50));
    return { bars, rsi };
}

/**
 * Mirror of `bullishSetup` (`high = 200 - low` — a monotonic-decreasing
 * transform, so the trough-shaped `lows` series becomes a peak-shaped
 * `highs` series at the SAME two bar indices): a higher high at index 15
 * (200-103=97) than index 4 (200-105=95), with RSI falling 70 -> 60 across
 * them (regular bearish divergence).
 */
function bearishSetup(): { bars: Bar[]; rsi: (number | null)[] } {
    const lows = [
        110, 109, 108, 107, 105, 107, 108, 109, 110, 109, 108, 107, 106, 105,
        106, 103, 105, 107, 109, 111,
    ];
    const highs = lows.map(low => 200 - low);
    const bars = highs.map((high, i) => ({
        time: 1000 + i,
        open: high - 1,
        high,
        low: high - 2,
        close: high - 1,
        volume: 1,
    }));
    const rsi = highs.map((_, i) => (i === 4 ? 70 : i === 15 ? 60 : 50));
    return { bars, rsi };
}

describe('buildDivergenceCandidates', () => {
    it("emits one bullish candidate with a price and an rsi segment; price segment uses bars' lows", () => {
        const { bars, rsi } = bullishSetup();
        expect(bars.length).toBeGreaterThanOrEqual(DIVERGENCE_LOOKBACK_BARS);
        const pair = findRegularDivergencePair(bars, rsi, 'bullish');
        expect(pair).not.toBeNull();
        const [c] = buildDivergenceCandidates(bars, rsi, FMT);
        expect(c.id).toBe(`div:rsi_bullish:${bars[pair!.second].time}`);
        expect(c.skill).toBe('divergence');
        expect(c.segments.map(s => s.pane)).toEqual(['price', 'rsi']);
        const priceSegment = c.segments[0];
        expect(priceSegment.from.price).toBe(bars[pair!.first].low);
        expect(priceSegment.to.price).toBe(bars[pair!.second].low);
        expect(c.segments[1].from.price).toBe(25);
        expect(c.segments[1].to.price).toBe(32);
    });

    it('emits nothing when no divergence fired', () => {
        const { bars } = bullishSetup();
        expect(
            buildDivergenceCandidates(
                bars,
                bars.map(() => 50),
                FMT
            )
        ).toEqual([]);
    });

    it("emits one bearish candidate whose price segment uses bars' highs", () => {
        const { bars, rsi } = bearishSetup();
        const pair = findRegularDivergencePair(bars, rsi, 'bearish');
        expect(pair).not.toBeNull();
        const [c] = buildDivergenceCandidates(bars, rsi, FMT);
        expect(c.id).toBe(`div:rsi_bearish:${bars[pair!.second].time}`);
        expect(c.segments.map(s => s.pane)).toEqual(['price', 'rsi']);
        const priceSegment = c.segments[0];
        expect(priceSegment.from.price).toBe(bars[pair!.first].high);
        expect(priceSegment.to.price).toBe(bars[pair!.second].high);
        expect(c.segments[1].from.price).toBe(70);
        expect(c.segments[1].to.price).toBe(60);
    });
});
