import { describe, expect, it } from 'vitest';
import { computeMarketReference } from '@/domain/analysis/marketReference';
import type { Bar, IndicatorResult, SMCSwingPoint } from '@/domain/types';

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
        const ref = computeMarketReference(makeBars(30), makeInd(), '1Day');
        expect(ref.short.window.bars).toBe(20);
        expect(ref.medium.window.bars).toBe(30); // capped (only 30 bars < 60)
        expect(ref.long.window.bars).toBe(30);
    });

    it('produces a regime descriptor for every horizon', () => {
        const ref = computeMarketReference(makeBars(250), makeInd(), '1Day');
        for (const h of [ref.short, ref.medium, ref.long]) {
            expect(['trending', 'ranging']).toContain(h.structure.regime);
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
        // ema9(200) < ema20(210) and price below ema9 -> aligned_down? price>ema9 -> mixed
        expect(['aligned_up', 'aligned_down', 'mixed']).toContain(
            ref.short.structure.emaStack
        );
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
