import { describe, expect, it } from 'vitest';
import { computeMarketReference } from '@/domain/analysis/marketReference';
import { HORIZON_WINDOWS_BY_TIMEFRAME } from '@/domain/analysis/marketReferenceConstants';
import type { Bar, IndicatorResult, SMCSwingPoint } from '@/domain/types';

const DAY_WINDOWS = HORIZON_WINDOWS_BY_TIMEFRAME['1Day'];

function makeBars(n: number): Bar[] {
    return Array.from({ length: n }, (_, i) => ({
        time: i,
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100 + i,
        volume: 1000,
    }));
}

/** Bars with a wide intrabar range so a window-local volume profile is non-degenerate. */
function makeVolatileBars(n: number): Bar[] {
    return Array.from({ length: n }, (_, i) => {
        const mid = 100 + (i % 7) * 3;
        return {
            time: i,
            open: mid,
            high: mid + 5,
            low: mid - 5,
            close: mid + (i % 2 === 0 ? 1 : -1),
            volume: 1000 + i,
        };
    });
}

const swing = (index: number, price: number): SMCSwingPoint =>
    ({ index, price, type: 'high' }) as unknown as SMCSwingPoint;

interface IndOverrides {
    swingHighs?: SMCSwingPoint[];
    swingLows?: SMCSwingPoint[];
    adx?: number | null;
    ma?: Record<number, (number | null)[]>;
    ema?: Record<number, (number | null)[]>;
}

const makeInd = (o: IndOverrides = {}): IndicatorResult =>
    ({
        macd: [],
        bollinger: [],
        dmi: [{ diPlus: 20, diMinus: 10, adx: o.adx ?? null }],
        stochastic: [],
        stochRsi: [],
        rsi: [],
        cci: [],
        vwap: [],
        ma: o.ma ?? {},
        ema: o.ema ?? {},
        volumeProfile: null,
        ichimoku: [],
        atr: [],
        obv: [],
        parabolicSar: [],
        williamsR: [],
        supertrend: [],
        mfi: [],
        keltnerChannel: [],
        cmf: [],
        donchianChannel: [],
        buySellVolume: [],
        smc: {
            swingHighs: o.swingHighs ?? [],
            swingLows: o.swingLows ?? [],
            structureBreaks: [],
        },
        squeezeMomentum: [],
    }) as unknown as IndicatorResult;

describe('computeMarketReference', () => {
    it('returns three horizons with windows capped at bars.length', () => {
        const barCount = 30;
        const ref = computeMarketReference(
            makeBars(barCount),
            makeInd(),
            '1Day'
        );
        expect(ref.short.window.bars).toBe(
            Math.min(DAY_WINDOWS.short, barCount)
        );
        expect(ref.medium.window.bars).toBe(
            Math.min(DAY_WINDOWS.medium, barCount)
        );
        expect(ref.long.window.bars).toBe(Math.min(DAY_WINDOWS.long, barCount));
    });

    it('produces a regime descriptor for every horizon', () => {
        const ref = computeMarketReference(makeBars(250), makeInd(), '1Day');
        for (const h of [ref.short, ref.medium, ref.long]) {
            // monotonically rising closes -> efficiency ratio ~1 -> trending
            expect(h.structure.regime).toBe('trending');
        }
    });

    it('returns empty horizons with zero current price on empty bars', () => {
        const ref = computeMarketReference([], makeInd(), '1Day');
        for (const h of [ref.short, ref.medium, ref.long]) {
            expect(h.window.bars).toBe(0);
            expect(h.window.fromTime).toBeNull();
            expect(h.window.toTime).toBeNull();
            expect(h.levels).toEqual({ support: [], resistance: [] });
        }
    });

    it('emits standard + camarilla pivots from the prior window bar', () => {
        const ref = computeMarketReference(makeBars(40), makeInd(), '1Day');
        const all = [
            ...ref.short.levels.support,
            ...ref.short.levels.resistance,
        ];
        expect(all.some(l => l.kind === 'pivot_standard')).toBe(true);
        expect(all.some(l => l.kind === 'pivot_camarilla')).toBe(true);
    });

    it('emits no pivot levels when the window has a single bar', () => {
        // windowLen === 1 -> priorBar is null -> no standard/camarilla pivots.
        const ref = computeMarketReference(makeBars(1), makeInd(), '1Day');
        const all = [
            ...ref.short.levels.support,
            ...ref.short.levels.resistance,
        ];
        expect(all.some(l => l.kind === 'pivot_standard')).toBe(false);
        expect(all.some(l => l.kind === 'pivot_camarilla')).toBe(false);
    });

    it('emits fib levels and a window-local swing level from window swings', () => {
        // 60 bars, short window = 20 (indices 40-59), current price = close(59) = 159.
        // One isolated swing low placed just under price so it is the nearest support
        // and survives the per-side cap; one far swing high anchors the fib leg.
        const swingHighs = [swing(50, 220)];
        const swingLows = [swing(48, 158.9)];
        const ref = computeMarketReference(
            makeBars(60),
            makeInd({ swingHighs, swingLows }),
            '1Day'
        );
        const shortLevels = [
            ...ref.short.levels.support,
            ...ref.short.levels.resistance,
        ];
        expect(
            shortLevels.some(
                l => l.kind === 'swing_high' || l.kind === 'swing_low'
            )
        ).toBe(true);
        // a fib level should be produced for the long horizon (high 220 > low 158.9)
        const longLevels = [
            ...ref.long.levels.support,
            ...ref.long.levels.resistance,
        ];
        expect(
            longLevels.some(
                l => l.kind === 'fib_retracement' || l.kind === 'fib_extension'
            )
        ).toBe(true);
    });

    it('surfaces anchored-VWAP levels anchored to the window extreme swings', () => {
        // Flat bars at close 100 keep pivots/MAs at price (filtered out), leaving
        // room for AVWAP. A single high spike at index 45 and low dip at index 50
        // sit inside the short window (indices 40-59), so AVWAP anchored at those
        // extremes lands just off price: anchor 45 (high spike) -> ~100.89
        // (resistance), anchor 50 (low dip) -> ~98 (support).
        const makeFlatBars = (
            n: number,
            spikeIndex: number,
            dipIndex: number
        ): Bar[] =>
            Array.from({ length: n }, (_, i) => ({
                time: i,
                open: 100,
                high: i === spikeIndex ? 200 : 100,
                low: i === dipIndex ? 40 : 100,
                close: 100,
                volume: 1000,
            }));
        const ref = computeMarketReference(
            makeFlatBars(60, 45, 50),
            makeInd({
                swingHighs: [swing(45, 200)],
                swingLows: [swing(50, 40)],
            }),
            '1Day'
        );
        const shortLevels = [
            ...ref.short.levels.support,
            ...ref.short.levels.resistance,
        ];
        const avwap = shortLevels.filter(l => l.kind === 'avwap');
        expect(avwap.length).toBeGreaterThan(0);
        expect(avwap.some(l => l.label === 'AVWAP (swing high)')).toBe(true);
        expect(avwap.some(l => l.label === 'AVWAP (swing low)')).toBe(true);
    });

    it('excludes swings older than the window from the horizon structure', () => {
        // older swings (index 5/7) fall outside the short window (startIndex 40)
        // so the short horizon swingStructure is 'mixed' (too few window swings),
        // while the long horizon sees them.
        const swingHighs = [swing(5, 210), swing(6, 200)];
        const swingLows = [swing(7, 80), swing(8, 70)];
        const ref = computeMarketReference(
            makeBars(60),
            makeInd({ swingHighs, swingLows }),
            '1Day'
        );
        expect(ref.short.structure.swingStructure).toBe('mixed');
        expect(ref.long.structure.swingStructure).toBe('LH_LL');
    });

    it('labels a horizon trending when ADX is high (no efficiency ratio)', () => {
        const ref = computeMarketReference(
            makeBars(40),
            makeInd({ adx: 40 }),
            '1Day'
        );
        expect(ref.short.structure.regime).toBe('trending');
        expect(ref.short.structure.adx).toBe(40);
    });

    it('labels a horizon trending via efficiency ratio on a monotonic path', () => {
        // strictly increasing closes -> efficiency ratio ~1 -> trending even without ADX
        const ref = computeMarketReference(makeBars(60), makeInd(), '1Day');
        expect(ref.short.structure.efficiencyRatio).toBeGreaterThan(0.3);
        expect(ref.short.structure.regime).toBe('trending');
    });

    it('classifies priceVsMA and emaStack from latest indicator values', () => {
        const ref = computeMarketReference(
            makeBars(40),
            makeInd({
                ma: { 60: [10, 10], 200: [5, 5] },
                ema: { 9: [200, 200], 20: [210, 210] },
            }),
            '1Day'
        );
        // current price (~139) above both MAs
        expect(ref.short.structure.priceVsMA60).toBe('above');
        expect(ref.short.structure.priceVsMA200).toBe('above');
        // price(139) < ema9(200) and ema9(200) < ema20(210) -> aligned_down
        expect(ref.short.structure.emaStack).toBe('aligned_down');
    });

    it('reports priceVsMA as below when price sits under the moving averages', () => {
        const ref = computeMarketReference(
            makeBars(40),
            makeInd({
                // current price (~139) below both MAs
                ma: { 60: [500, 500], 200: [600, 600] },
            }),
            '1Day'
        );
        expect(ref.short.structure.priceVsMA60).toBe('below');
        expect(ref.short.structure.priceVsMA200).toBe('below');
    });

    it('differs between short and long horizons when recent swings differ from older ones', () => {
        // older swing (index 5) only in long window; newer swing (index 50) in both
        const swingHighs = [swing(5, 200), swing(50, 130)];
        const swingLows = [swing(7, 80), swing(48, 110)];
        const ref = computeMarketReference(
            makeVolatileBars(60),
            makeInd({ swingHighs, swingLows }),
            '1Day'
        );
        const shortPrices = [
            ...ref.short.levels.support,
            ...ref.short.levels.resistance,
        ]
            .map(l => l.price)
            .toSorted((a, b) => a - b);
        const longPrices = [
            ...ref.long.levels.support,
            ...ref.long.levels.resistance,
        ]
            .map(l => l.price)
            .toSorted((a, b) => a - b);
        expect(shortPrices).not.toEqual(longPrices);
    });
});
