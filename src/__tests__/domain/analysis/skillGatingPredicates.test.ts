import { describe, it, expect } from 'vitest';
import {
    isStateNotable,
    BOLLINGER_PCTB_BY_TF,
} from '@/domain/analysis/skillGatingPredicates';
import {
    CRSI_OVERBOUGHT,
    CRSI_OVERSOLD,
    EMPTY_INDICATOR_RESULT,
    MACDV_OVERBOUGHT,
} from '@/domain/indicators/constants';
import type {
    BollingerResult,
    BuySellVolumeResult,
    ChandelierResult,
    DonchianChannelResult,
    ElderRayResult,
    ImpulseColor,
    IndicatorResult,
    KeltnerChannelResult,
    RegressionResult,
    SkillSelectionContext,
    SkillStatePredicate,
    StochasticResult,
    StochRSIResult,
    Timeframe,
} from '@/domain/types';

// ── Deterministic fixtures ──────────────────────────────────────────────────
// A SkillSelectionContext carries an IndicatorResult; the state predicates only
// ever read the LAST entry of each series. The helpers below build a minimal
// indicator suite whose last values are exactly what each test needs.

interface CtxOverrides {
    timeframe?: Timeframe;
    price?: number;
    atr?: number | null;
    bollinger?: BollingerResult;
    keltner?: KeltnerChannelResult;
    donchian?: DonchianChannelResult;
    williamsR?: number | null;
    stochastic?: StochasticResult;
    stochRsi?: StochRSIResult;
    vwap?: number | null;
    buySellVolume?: BuySellVolumeResult;
    /** Make the relevant series empty to exercise the "no data" branch. */
    empty?: boolean;
}

const emptyIndicators = (): IndicatorResult => ({
    ...EMPTY_INDICATOR_RESULT,
});

const makeCtx = (o: CtxOverrides = {}): SkillSelectionContext => {
    const indicators = emptyIndicators();
    // Distinguish "atr omitted" (default 1) from "atr explicitly null" — `?? 1`
    // would wrongly coerce an intentional null to 1.
    const atrLast = 'atr' in o ? (o.atr ?? null) : 1;
    if (!o.empty) {
        indicators.atr = [atrLast];
        if (o.bollinger) indicators.bollinger = [o.bollinger];
        if (o.keltner) indicators.keltnerChannel = [o.keltner];
        if (o.donchian) indicators.donchianChannel = [o.donchian];
        if (o.williamsR !== undefined) indicators.williamsR = [o.williamsR];
        if (o.stochastic) indicators.stochastic = [o.stochastic];
        if (o.stochRsi) indicators.stochRsi = [o.stochRsi];
        if (o.vwap !== undefined) indicators.vwap = [o.vwap];
        if (o.buySellVolume) indicators.buySellVolume = [o.buySellVolume];
    }
    const price = o.price ?? 100;
    return {
        indicators,
        signals: [],
        timeframe: o.timeframe ?? '1Day',
        detectedCandles: [],
        price,
        atrPercent: atrLast !== null && price > 0 ? (atrLast / price) * 100 : 0,
    };
};

const P = (
    feature: SkillStatePredicate['feature'],
    predicate: SkillStatePredicate['predicate'],
    extra: Partial<SkillStatePredicate> = {}
): SkillStatePredicate => ({ feature, predicate, ...extra });

// Pro-indicator predicates read directly from `ctx.indicators.<field>`, so build
// the context by spreading the empty suite and overriding only the field under
// test. `price`/`timeframe` are irrelevant to these features but kept valid.
const ctxWithIndicators = (
    indicators: Partial<IndicatorResult>
): SkillSelectionContext => ({
    indicators: { ...EMPTY_INDICATOR_RESULT, ...indicators },
    signals: [],
    timeframe: '1Day',
    detectedCandles: [],
    price: 100,
    atrPercent: 1,
});

const elderRay = (
    bullPower: number | null,
    bearPower: number | null
): ElderRayResult => ({ bullPower, bearPower });

const chandelier = (trend: ChandelierResult['trend']): ChandelierResult => ({
    longStop: trend === 'long' ? 90 : null,
    shortStop: trend === 'short' ? 110 : null,
    trend,
});

const regression = (r2: number | null): RegressionResult => ({
    slope: 1,
    r2,
});

// Bollinger band that yields a given %B at a given price: %B = (price-lower)/(upper-lower).
const bollForPctB = (
    pctB: number,
    lower = 90,
    upper = 110
): { price: number; bollinger: BollingerResult } => ({
    price: lower + pctB * (upper - lower),
    bollinger: { lower, middle: (lower + upper) / 2, upper },
});

describe('isStateNotable — bollinger pctB (TF-aware)', () => {
    it('fires above hi on 15Min (0.92 threshold)', () => {
        const { price, bollinger } = bollForPctB(0.93);
        const ctx = makeCtx({ timeframe: '15Min', price, bollinger });
        expect(isStateNotable(P('bollinger', 'pctB'), ctx)).toBe(true);
    });
    it('does NOT fire at 0.91 on 15Min', () => {
        const { price, bollinger } = bollForPctB(0.91);
        const ctx = makeCtx({ timeframe: '15Min', price, bollinger });
        expect(isStateNotable(P('bollinger', 'pctB'), ctx)).toBe(false);
    });
    it('does NOT fire at 0.93 on 1Day (needs 0.98)', () => {
        const { price, bollinger } = bollForPctB(0.93);
        const ctx = makeCtx({ timeframe: '1Day', price, bollinger });
        expect(isStateNotable(P('bollinger', 'pctB'), ctx)).toBe(false);
    });
    it('fires at 0.99 on 1Day', () => {
        const { price, bollinger } = bollForPctB(0.99);
        const ctx = makeCtx({ timeframe: '1Day', price, bollinger });
        expect(isStateNotable(P('bollinger', 'pctB'), ctx)).toBe(true);
    });
    it('fires below lo (oversold) on 1Hour (0.05 threshold)', () => {
        const { price, bollinger } = bollForPctB(0.04);
        const ctx = makeCtx({ timeframe: '1Hour', price, bollinger });
        expect(isStateNotable(P('bollinger', 'pctB'), ctx)).toBe(true);
    });
    it('honors explicit hi/lo override', () => {
        const { price, bollinger } = bollForPctB(0.6);
        const ctx = makeCtx({ timeframe: '1Day', price, bollinger });
        expect(
            isStateNotable(P('bollinger', 'pctB', { hi: 0.5, lo: 0.1 }), ctx)
        ).toBe(true);
    });
    it('falls back to daily thresholds for an unmapped timeframe', () => {
        const { price, bollinger } = bollForPctB(0.93);
        const ctx = makeCtx({ timeframe: '4Hour', price, bollinger });
        expect(isStateNotable(P('bollinger', 'pctB'), ctx)).toBe(false);
    });
    it('returns false when bollinger series is empty', () => {
        const ctx = makeCtx({ empty: true });
        expect(isStateNotable(P('bollinger', 'pctB'), ctx)).toBe(false);
    });
    it('returns false when a band is null', () => {
        const ctx = makeCtx({
            bollinger: { lower: null, middle: 100, upper: 110 },
        });
        expect(isStateNotable(P('bollinger', 'pctB'), ctx)).toBe(false);
    });
    it('returns false on a degenerate (zero-width) band', () => {
        const ctx = makeCtx({
            price: 100,
            bollinger: { lower: 100, middle: 100, upper: 100 },
        });
        expect(isStateNotable(P('bollinger', 'pctB'), ctx)).toBe(false);
    });
    // Boundary-equality: %B exactly at each TF's hi bound must fire (isOutsideBounds uses >=).
    // The bound is read from the source constant (not a literal) so a threshold change
    // surfaces here. A band [0,1] makes %B = (price-0)/(1-0) = price = hi exactly.
    const hiBound = (tf: Timeframe): number => {
        const bounds = BOLLINGER_PCTB_BY_TF[tf];
        if (!bounds) throw new Error(`no %B bound configured for ${tf}`);
        return bounds.hi;
    };
    const firesAtHiBoundary = (tf: Timeframe): boolean => {
        const hi = hiBound(tf);
        const ctx = makeCtx({
            timeframe: tf,
            price: hi,
            bollinger: { lower: 0, middle: hi / 2, upper: 1 },
        });
        return isStateNotable(P('bollinger', 'pctB'), ctx);
    };
    it('fires exactly at the 1Day hi boundary (pctB === hi)', () => {
        expect(firesAtHiBoundary('1Day')).toBe(true);
    });
    it('fires exactly at the 1Hour hi boundary (pctB === hi)', () => {
        expect(firesAtHiBoundary('1Hour')).toBe(true);
    });
    it('fires exactly at the 15Min hi boundary (pctB === hi)', () => {
        expect(firesAtHiBoundary('15Min')).toBe(true);
    });
});

describe('isStateNotable — keltner bandDistAtr', () => {
    const kc: KeltnerChannelResult = { lower: 90, middle: 100, upper: 110 };
    it('fires when price is within 0.5*ATR of the upper band', () => {
        const ctx = makeCtx({ price: 109.6, atr: 1, keltner: kc });
        expect(isStateNotable(P('keltner', 'bandDistAtr'), ctx)).toBe(true);
    });
    it('fires when price is within 0.5*ATR of the lower band', () => {
        const ctx = makeCtx({ price: 90.4, atr: 1, keltner: kc });
        expect(isStateNotable(P('keltner', 'bandDistAtr'), ctx)).toBe(true);
    });
    it('fires when price breaks beyond the upper band', () => {
        const ctx = makeCtx({ price: 115, atr: 1, keltner: kc });
        expect(isStateNotable(P('keltner', 'bandDistAtr'), ctx)).toBe(true);
    });
    it('does NOT fire when price sits mid-channel', () => {
        const ctx = makeCtx({ price: 100, atr: 1, keltner: kc });
        expect(isStateNotable(P('keltner', 'bandDistAtr'), ctx)).toBe(false);
    });
    it('returns false when keltner series is empty', () => {
        const ctx = makeCtx({ empty: true });
        expect(isStateNotable(P('keltner', 'bandDistAtr'), ctx)).toBe(false);
    });
    it('returns false when a band is null', () => {
        const ctx = makeCtx({
            price: 109.6,
            keltner: { lower: 90, middle: 100, upper: null },
        });
        expect(isStateNotable(P('keltner', 'bandDistAtr'), ctx)).toBe(false);
    });
    it('returns false when ATR is unavailable', () => {
        const ctx = makeCtx({ price: 109.6, atr: null, keltner: kc });
        expect(isStateNotable(P('keltner', 'bandDistAtr'), ctx)).toBe(false);
    });
});

describe('isStateNotable — williamsR level', () => {
    it('fires at/above -20 (overbought)', () => {
        expect(
            isStateNotable(P('williamsR', 'level'), makeCtx({ williamsR: -15 }))
        ).toBe(true);
    });
    it('fires at/below -80 (oversold)', () => {
        expect(
            isStateNotable(P('williamsR', 'level'), makeCtx({ williamsR: -85 }))
        ).toBe(true);
    });
    it('does NOT fire mid-range', () => {
        expect(
            isStateNotable(P('williamsR', 'level'), makeCtx({ williamsR: -50 }))
        ).toBe(false);
    });
    it('returns false when williamsR is null', () => {
        expect(
            isStateNotable(
                P('williamsR', 'level'),
                makeCtx({ williamsR: null })
            )
        ).toBe(false);
    });
});

describe('isStateNotable — stochastic level', () => {
    it('fires when %K >= 80', () => {
        const ctx = makeCtx({ stochastic: { percentK: 82, percentD: 70 } });
        expect(isStateNotable(P('stochastic', 'level'), ctx)).toBe(true);
    });
    it('fires when %K <= 20', () => {
        const ctx = makeCtx({ stochastic: { percentK: 18, percentD: 25 } });
        expect(isStateNotable(P('stochastic', 'level'), ctx)).toBe(true);
    });
    it('does NOT fire mid-range', () => {
        const ctx = makeCtx({ stochastic: { percentK: 50, percentD: 50 } });
        expect(isStateNotable(P('stochastic', 'level'), ctx)).toBe(false);
    });
    it('returns false when %K is null', () => {
        const ctx = makeCtx({ stochastic: { percentK: null, percentD: 50 } });
        expect(isStateNotable(P('stochastic', 'level'), ctx)).toBe(false);
    });
});

describe('isStateNotable — stochRsi level', () => {
    it('fires when k >= 0.8', () => {
        const ctx = makeCtx({ stochRsi: { k: 0.85, d: 0.7 } });
        expect(isStateNotable(P('stochRsi', 'level'), ctx)).toBe(true);
    });
    it('fires when k <= 0.2', () => {
        const ctx = makeCtx({ stochRsi: { k: 0.15, d: 0.2 } });
        expect(isStateNotable(P('stochRsi', 'level'), ctx)).toBe(true);
    });
    it('does NOT fire mid-range', () => {
        const ctx = makeCtx({ stochRsi: { k: 0.5, d: 0.5 } });
        expect(isStateNotable(P('stochRsi', 'level'), ctx)).toBe(false);
    });
    it('returns false when k is null', () => {
        const ctx = makeCtx({ stochRsi: { k: null, d: 0.5 } });
        expect(isStateNotable(P('stochRsi', 'level'), ctx)).toBe(false);
    });
});

describe('isStateNotable — donchian channelProximity', () => {
    const dc: DonchianChannelResult = { lower: 90, middle: 100, upper: 110 };
    it('fires when price hugs the channel high', () => {
        const ctx = makeCtx({ price: 109.9, donchian: dc });
        expect(isStateNotable(P('donchian', 'channelProximity'), ctx)).toBe(
            true
        );
    });
    it('fires when price hugs the channel low', () => {
        const ctx = makeCtx({ price: 90.1, donchian: dc });
        expect(isStateNotable(P('donchian', 'channelProximity'), ctx)).toBe(
            true
        );
    });
    it('fires when price breaks the channel', () => {
        const ctx = makeCtx({ price: 120, donchian: dc });
        expect(isStateNotable(P('donchian', 'channelProximity'), ctx)).toBe(
            true
        );
    });
    it('does NOT fire mid-channel', () => {
        const ctx = makeCtx({ price: 100, donchian: dc });
        expect(isStateNotable(P('donchian', 'channelProximity'), ctx)).toBe(
            false
        );
    });
    it('returns false when donchian series is empty', () => {
        const ctx = makeCtx({ empty: true });
        expect(isStateNotable(P('donchian', 'channelProximity'), ctx)).toBe(
            false
        );
    });
    it('returns false when a band is null', () => {
        const ctx = makeCtx({
            price: 109.9,
            donchian: { lower: 90, middle: 100, upper: null },
        });
        expect(isStateNotable(P('donchian', 'channelProximity'), ctx)).toBe(
            false
        );
    });
    it('returns false on a degenerate (zero-width) channel', () => {
        const ctx = makeCtx({
            price: 100,
            donchian: { lower: 100, middle: 100, upper: 100 },
        });
        expect(isStateNotable(P('donchian', 'channelProximity'), ctx)).toBe(
            false
        );
    });
    it('returns false when price is non-positive', () => {
        const ctx = makeCtx({
            price: 0,
            donchian: { lower: 90, middle: 100, upper: 110 },
        });
        expect(isStateNotable(P('donchian', 'channelProximity'), ctx)).toBe(
            false
        );
    });
});

describe('isStateNotable — vwap bandDistAtr (intraday only)', () => {
    it('fires when |price - vwap| >= 1*ATR on an intraday timeframe', () => {
        const ctx = makeCtx({
            timeframe: '15Min',
            price: 102,
            atr: 1,
            vwap: 100,
        });
        expect(isStateNotable(P('vwap', 'bandDistAtr'), ctx)).toBe(true);
    });
    it('does NOT fire when distance is under 1*ATR', () => {
        const ctx = makeCtx({
            timeframe: '15Min',
            price: 100.5,
            atr: 1,
            vwap: 100,
        });
        expect(isStateNotable(P('vwap', 'bandDistAtr'), ctx)).toBe(false);
    });
    it('always returns false on the 1Day timeframe', () => {
        const ctx = makeCtx({
            timeframe: '1Day',
            price: 110,
            atr: 1,
            vwap: 100,
        });
        expect(isStateNotable(P('vwap', 'bandDistAtr'), ctx)).toBe(false);
    });
    it('returns false when vwap is null', () => {
        const ctx = makeCtx({ timeframe: '15Min', vwap: null, atr: 1 });
        expect(isStateNotable(P('vwap', 'bandDistAtr'), ctx)).toBe(false);
    });
    it('returns false when ATR is unavailable', () => {
        const ctx = makeCtx({
            timeframe: '15Min',
            price: 110,
            atr: null,
            vwap: 100,
        });
        expect(isStateNotable(P('vwap', 'bandDistAtr'), ctx)).toBe(false);
    });
});

describe('isStateNotable — buySellVolume ratio', () => {
    it('fires when buy ratio >= 0.65', () => {
        const ctx = makeCtx({
            buySellVolume: { buyVolume: 70, sellVolume: 30 },
        });
        expect(isStateNotable(P('buySellVolume', 'ratio'), ctx)).toBe(true);
    });
    it('fires when buy ratio <= 0.35', () => {
        const ctx = makeCtx({
            buySellVolume: { buyVolume: 30, sellVolume: 70 },
        });
        expect(isStateNotable(P('buySellVolume', 'ratio'), ctx)).toBe(true);
    });
    it('does NOT fire on a balanced book', () => {
        const ctx = makeCtx({
            buySellVolume: { buyVolume: 50, sellVolume: 50 },
        });
        expect(isStateNotable(P('buySellVolume', 'ratio'), ctx)).toBe(false);
    });
    it('returns false when total volume is zero', () => {
        const ctx = makeCtx({
            buySellVolume: { buyVolume: 0, sellVolume: 0 },
        });
        expect(isStateNotable(P('buySellVolume', 'ratio'), ctx)).toBe(false);
    });
    it('returns false when buySellVolume series is empty', () => {
        const ctx = makeCtx({ empty: true });
        expect(isStateNotable(P('buySellVolume', 'ratio'), ctx)).toBe(false);
    });
});

describe('isStateNotable — empty indicator series (no throw)', () => {
    // Regression: predicates dereference the LAST element of an indicator
    // series. For an empty array that last element is undefined, so a guard
    // that only checks `=== null` would let undefined slip through to a
    // property access (TypeError). Every (feature, predicate) pair must return
    // false — not throw — when its backing series is empty.
    const pairs: ReadonlyArray<
        [SkillStatePredicate['feature'], SkillStatePredicate['predicate']]
    > = [
        ['bollinger', 'pctB'],
        ['keltner', 'bandDistAtr'],
        ['williamsR', 'level'],
        ['stochastic', 'level'],
        ['stochRsi', 'level'],
        ['donchian', 'channelProximity'],
        ['vwap', 'bandDistAtr'],
        ['buySellVolume', 'ratio'],
    ];
    it.each(pairs)(
        'returns false (no throw) for feature=%s predicate=%s on an empty suite',
        (feature, predicate) => {
            // timeframe 15Min so the intraday-only vwap path is actually exercised.
            const ctx = makeCtx({ empty: true, timeframe: '15Min' });
            expect(() =>
                isStateNotable(P(feature, predicate), ctx)
            ).not.toThrow();
            expect(isStateNotable(P(feature, predicate), ctx)).toBe(false);
        }
    );
});

describe('isStateNotable — mismatched feature/predicate pairs', () => {
    // Every feature carries exactly one valid predicate kind; supplying any
    // other kind must take the safe `false` arm rather than throwing.
    const mismatches: ReadonlyArray<
        [SkillStatePredicate['feature'], SkillStatePredicate['predicate']]
    > = [
        ['bollinger', 'level'],
        ['keltner', 'pctB'],
        ['williamsR', 'pctB'],
        ['stochastic', 'pctB'],
        ['stochRsi', 'pctB'],
        ['donchian', 'level'],
        ['vwap', 'pctB'],
        ['buySellVolume', 'pctB'],
    ];
    it.each(mismatches)(
        'returns false for feature=%s with wrong predicate=%s',
        (feature, predicate) => {
            const ctx = makeCtx({ williamsR: -15 });
            expect(isStateNotable(P(feature, predicate), ctx)).toBe(false);
        }
    );
    it('returns false for an unknown feature (default arm)', () => {
        const unknown = {
            feature: 'totallyUnknown',
            predicate: 'level',
        } as unknown as SkillStatePredicate;
        expect(isStateNotable(unknown, makeCtx())).toBe(false);
    });
    it('returns false when price is non-positive for a price-based predicate', () => {
        const ctx = makeCtx({
            price: 0,
            keltner: { lower: 90, middle: 100, upper: 110 },
        });
        expect(isStateNotable(P('keltner', 'bandDistAtr'), ctx)).toBe(false);
    });
});

// ── Pro-indicators Phase 3 (advisory / regime / volatility) ───────────────────

describe('isStateNotable — macdV level', () => {
    it('fires in the +150 overbought risk zone', () => {
        const ctx = ctxWithIndicators({ macdV: [MACDV_OVERBOUGHT + 5] });
        expect(isStateNotable(P('macdV', 'level'), ctx)).toBe(true);
    });
    it('fires in the -150 oversold risk zone', () => {
        const ctx = ctxWithIndicators({ macdV: [-(MACDV_OVERBOUGHT + 5)] });
        expect(isStateNotable(P('macdV', 'level'), ctx)).toBe(true);
    });
    it('does NOT fire inside the ±150 band', () => {
        const ctx = ctxWithIndicators({ macdV: [50] });
        expect(isStateNotable(P('macdV', 'level'), ctx)).toBe(false);
    });
    it('returns false when latest is null', () => {
        const ctx = ctxWithIndicators({ macdV: [100, null] });
        expect(isStateNotable(P('macdV', 'level'), ctx)).toBe(false);
    });
    it('returns false on an empty series', () => {
        const ctx = ctxWithIndicators({ macdV: [] });
        expect(isStateNotable(P('macdV', 'level'), ctx)).toBe(false);
    });
});

describe('isStateNotable — connorsRsi level', () => {
    it('fires at/below the oversold threshold', () => {
        const ctx = ctxWithIndicators({ connorsRsi: [CRSI_OVERSOLD - 1] });
        expect(isStateNotable(P('connorsRsi', 'level'), ctx)).toBe(true);
    });
    it('fires at/above the overbought threshold', () => {
        const ctx = ctxWithIndicators({ connorsRsi: [CRSI_OVERBOUGHT + 1] });
        expect(isStateNotable(P('connorsRsi', 'level'), ctx)).toBe(true);
    });
    it('does NOT fire mid-range', () => {
        const ctx = ctxWithIndicators({ connorsRsi: [50] });
        expect(isStateNotable(P('connorsRsi', 'level'), ctx)).toBe(false);
    });
    it('returns false when latest is null', () => {
        const ctx = ctxWithIndicators({ connorsRsi: [5, null] });
        expect(isStateNotable(P('connorsRsi', 'level'), ctx)).toBe(false);
    });
    it('returns false on an empty series', () => {
        const ctx = ctxWithIndicators({ connorsRsi: [] });
        expect(isStateNotable(P('connorsRsi', 'level'), ctx)).toBe(false);
    });
});

describe('isStateNotable — forceIndex level (sign flip)', () => {
    it('fires when the sign flips negative → positive vs the previous finite read', () => {
        const ctx = ctxWithIndicators({ forceIndex: [-200, 150] });
        expect(isStateNotable(P('forceIndex', 'level'), ctx)).toBe(true);
    });
    it('fires when the sign flips positive → negative', () => {
        const ctx = ctxWithIndicators({ forceIndex: [200, -150] });
        expect(isStateNotable(P('forceIndex', 'level'), ctx)).toBe(true);
    });
    it('skips trailing nulls and compares the last two finite reads', () => {
        const ctx = ctxWithIndicators({ forceIndex: [-200, 150, null] });
        expect(isStateNotable(P('forceIndex', 'level'), ctx)).toBe(true);
    });
    it('does NOT fire without a sign flip', () => {
        const ctx = ctxWithIndicators({ forceIndex: [100, 200] });
        expect(isStateNotable(P('forceIndex', 'level'), ctx)).toBe(false);
    });
    it('returns false with fewer than two finite reads', () => {
        const ctx = ctxWithIndicators({ forceIndex: [null, 150] });
        expect(isStateNotable(P('forceIndex', 'level'), ctx)).toBe(false);
    });
    it('returns false on an empty series', () => {
        const ctx = ctxWithIndicators({ forceIndex: [] });
        expect(isStateNotable(P('forceIndex', 'level'), ctx)).toBe(false);
    });
});

describe('isStateNotable — elderRay level (turn vs previous bar)', () => {
    it('fires when bear power is negative but rising (best-buy setup)', () => {
        const ctx = ctxWithIndicators({
            elderRay: [elderRay(2, -5), elderRay(2, -3)],
        });
        expect(isStateNotable(P('elderRay', 'level'), ctx)).toBe(true);
    });
    it('fires when bull power is positive but falling', () => {
        const ctx = ctxWithIndicators({
            elderRay: [elderRay(8, -2), elderRay(5, -2)],
        });
        expect(isStateNotable(P('elderRay', 'level'), ctx)).toBe(true);
    });
    it('does NOT fire when neither power is turning', () => {
        const ctx = ctxWithIndicators({
            elderRay: [elderRay(5, -3), elderRay(5, -5)],
        });
        expect(isStateNotable(P('elderRay', 'level'), ctx)).toBe(false);
    });
    it('returns false when a power is null', () => {
        const ctx = ctxWithIndicators({
            elderRay: [elderRay(2, null), elderRay(2, null)],
        });
        expect(isStateNotable(P('elderRay', 'level'), ctx)).toBe(false);
    });
    it('returns false with fewer than two bars', () => {
        const ctx = ctxWithIndicators({ elderRay: [elderRay(2, -3)] });
        expect(isStateNotable(P('elderRay', 'level'), ctx)).toBe(false);
    });
    it('returns false on an empty series', () => {
        const ctx = ctxWithIndicators({ elderRay: [] });
        expect(isStateNotable(P('elderRay', 'level'), ctx)).toBe(false);
    });
});

describe('isStateNotable — elderImpulse level (permission)', () => {
    const C = (c: ImpulseColor | null): ImpulseColor | null => c;
    it('fires when the latest non-blue colour flips vs the previous coloured bar', () => {
        const ctx = ctxWithIndicators({ elderImpulse: [C('green'), C('red')] });
        expect(isStateNotable(P('elderImpulse', 'level'), ctx)).toBe(true);
    });
    it('fires when the latest colour is non-blue even without a flip', () => {
        const ctx = ctxWithIndicators({
            elderImpulse: [C('green'), C('green')],
        });
        expect(isStateNotable(P('elderImpulse', 'level'), ctx)).toBe(true);
    });
    it('fires when blue flips to a coloured bar', () => {
        const ctx = ctxWithIndicators({ elderImpulse: [C('blue'), C('red')] });
        expect(isStateNotable(P('elderImpulse', 'level'), ctx)).toBe(true);
    });
    it('does NOT fire when blue persists (no flip, blue)', () => {
        const ctx = ctxWithIndicators({
            elderImpulse: [C('blue'), C('blue')],
        });
        expect(isStateNotable(P('elderImpulse', 'level'), ctx)).toBe(false);
    });
    it('fires when a coloured bar flips to blue (permission opens)', () => {
        const ctx = ctxWithIndicators({ elderImpulse: [C('red'), C('blue')] });
        expect(isStateNotable(P('elderImpulse', 'level'), ctx)).toBe(true);
    });
    it('returns false when the latest colour is null', () => {
        const ctx = ctxWithIndicators({
            elderImpulse: [C('green'), C(null)],
        });
        expect(isStateNotable(P('elderImpulse', 'level'), ctx)).toBe(false);
    });
    it('returns false on an empty series', () => {
        const ctx = ctxWithIndicators({ elderImpulse: [] });
        expect(isStateNotable(P('elderImpulse', 'level'), ctx)).toBe(false);
    });
});

describe('isStateNotable — chandelier level (trend flip)', () => {
    it('fires when the trend flipped within the lookback window', () => {
        const ctx = ctxWithIndicators({
            chandelierExit: [chandelier('long'), chandelier('short')],
        });
        expect(isStateNotable(P('chandelier', 'level'), ctx)).toBe(true);
    });
    it('skips a null trend bar inside the window to find the prior side', () => {
        const ctx = ctxWithIndicators({
            chandelierExit: [
                chandelier('long'),
                chandelier(null),
                chandelier('short'),
            ],
        });
        expect(isStateNotable(P('chandelier', 'level'), ctx)).toBe(true);
    });
    it('does NOT fire when the trend held steady', () => {
        const ctx = ctxWithIndicators({
            chandelierExit: [
                chandelier('long'),
                chandelier('long'),
                chandelier('long'),
            ],
        });
        expect(isStateNotable(P('chandelier', 'level'), ctx)).toBe(false);
    });
    it('does NOT fire when the flip is older than the lookback window', () => {
        const ctx = ctxWithIndicators({
            chandelierExit: [
                chandelier('short'),
                chandelier('long'),
                chandelier('long'),
                chandelier('long'),
                chandelier('long'),
            ],
        });
        expect(isStateNotable(P('chandelier', 'level'), ctx)).toBe(false);
    });
    it('returns false when the latest trend is null', () => {
        const ctx = ctxWithIndicators({
            chandelierExit: [chandelier('long'), chandelier(null)],
        });
        expect(isStateNotable(P('chandelier', 'level'), ctx)).toBe(false);
    });
    it('returns false with fewer than two bars', () => {
        const ctx = ctxWithIndicators({
            chandelierExit: [chandelier('long')],
        });
        expect(isStateNotable(P('chandelier', 'level'), ctx)).toBe(false);
    });
    it('returns false on an empty series', () => {
        const ctx = ctxWithIndicators({ chandelierExit: [] });
        expect(isStateNotable(P('chandelier', 'level'), ctx)).toBe(false);
    });
});

describe('isStateNotable — hurst level', () => {
    it('fires when H is decisively trending (>= 0.6)', () => {
        const ctx = ctxWithIndicators({ hurst: [0.65] });
        expect(isStateNotable(P('hurst', 'level'), ctx)).toBe(true);
    });
    it('fires when H is decisively mean-reverting (<= 0.4)', () => {
        const ctx = ctxWithIndicators({ hurst: [0.35] });
        expect(isStateNotable(P('hurst', 'level'), ctx)).toBe(true);
    });
    it('does NOT fire near the random-walk midpoint', () => {
        const ctx = ctxWithIndicators({ hurst: [0.52] });
        expect(isStateNotable(P('hurst', 'level'), ctx)).toBe(false);
    });
    it('returns false when latest is null', () => {
        const ctx = ctxWithIndicators({ hurst: [0.65, null] });
        expect(isStateNotable(P('hurst', 'level'), ctx)).toBe(false);
    });
    it('returns false on an empty series', () => {
        const ctx = ctxWithIndicators({ hurst: [] });
        expect(isStateNotable(P('hurst', 'level'), ctx)).toBe(false);
    });
});

describe('isStateNotable — varianceRatio level', () => {
    it('fires when VR is decisively trending (>= 1.2)', () => {
        const ctx = ctxWithIndicators({ varianceRatio: [1.25] });
        expect(isStateNotable(P('varianceRatio', 'level'), ctx)).toBe(true);
    });
    it('fires when VR is decisively mean-reverting (<= 0.8)', () => {
        const ctx = ctxWithIndicators({ varianceRatio: [0.75] });
        expect(isStateNotable(P('varianceRatio', 'level'), ctx)).toBe(true);
    });
    it('does NOT fire near the random-walk value of 1', () => {
        const ctx = ctxWithIndicators({ varianceRatio: [1.05] });
        expect(isStateNotable(P('varianceRatio', 'level'), ctx)).toBe(false);
    });
    it('returns false when latest is null', () => {
        const ctx = ctxWithIndicators({ varianceRatio: [1.25, null] });
        expect(isStateNotable(P('varianceRatio', 'level'), ctx)).toBe(false);
    });
    it('returns false on an empty series', () => {
        const ctx = ctxWithIndicators({ varianceRatio: [] });
        expect(isStateNotable(P('varianceRatio', 'level'), ctx)).toBe(false);
    });
});

describe('isStateNotable — regression level (r²)', () => {
    it('fires when r² is at/above the significance cutoff', () => {
        const ctx = ctxWithIndicators({ regression: [regression(0.4)] });
        expect(isStateNotable(P('regression', 'level'), ctx)).toBe(true);
    });
    it('does NOT fire below the cutoff (choppy)', () => {
        const ctx = ctxWithIndicators({ regression: [regression(0.1)] });
        expect(isStateNotable(P('regression', 'level'), ctx)).toBe(false);
    });
    it('returns false when r² is null (flat series)', () => {
        const ctx = ctxWithIndicators({ regression: [regression(null)] });
        expect(isStateNotable(P('regression', 'level'), ctx)).toBe(false);
    });
    it('returns false on an empty series', () => {
        const ctx = ctxWithIndicators({ regression: [] });
        expect(isStateNotable(P('regression', 'level'), ctx)).toBe(false);
    });
});

describe('isStateNotable — yangZhang level (vol regime)', () => {
    it('fires when the latest read is a high-vol expansion vs the window mean', () => {
        const ctx = ctxWithIndicators({ yangZhang: [10, 10, 10, 30] });
        expect(isStateNotable(P('yangZhang', 'level'), ctx)).toBe(true);
    });
    it('fires when the latest read is a low-vol compression', () => {
        const ctx = ctxWithIndicators({ yangZhang: [20, 20, 20, 4] });
        expect(isStateNotable(P('yangZhang', 'level'), ctx)).toBe(true);
    });
    it('does NOT fire for a steady vol regime', () => {
        const ctx = ctxWithIndicators({ yangZhang: [20, 21, 19, 20] });
        expect(isStateNotable(P('yangZhang', 'level'), ctx)).toBe(false);
    });
    it('returns false when latest is null', () => {
        const ctx = ctxWithIndicators({ yangZhang: [10, 10, null] });
        expect(isStateNotable(P('yangZhang', 'level'), ctx)).toBe(false);
    });
    it('returns false on an empty series', () => {
        const ctx = ctxWithIndicators({ yangZhang: [] });
        expect(isStateNotable(P('yangZhang', 'level'), ctx)).toBe(false);
    });
});

describe('isStateNotable — ewma level (vol regime)', () => {
    it('fires when reactive vol expands vs the window mean', () => {
        const ctx = ctxWithIndicators({ ewmaVolatility: [10, 10, 10, 30] });
        expect(isStateNotable(P('ewma', 'level'), ctx)).toBe(true);
    });
    it('fires when reactive vol contracts vs the window mean', () => {
        const ctx = ctxWithIndicators({ ewmaVolatility: [20, 20, 20, 4] });
        expect(isStateNotable(P('ewma', 'level'), ctx)).toBe(true);
    });
    it('does NOT fire for a steady vol regime', () => {
        const ctx = ctxWithIndicators({ ewmaVolatility: [20, 21, 19, 20] });
        expect(isStateNotable(P('ewma', 'level'), ctx)).toBe(false);
    });
    it('returns false when latest is null', () => {
        const ctx = ctxWithIndicators({ ewmaVolatility: [10, 10, null] });
        expect(isStateNotable(P('ewma', 'level'), ctx)).toBe(false);
    });
    it('returns false on an empty series', () => {
        const ctx = ctxWithIndicators({ ewmaVolatility: [] });
        expect(isStateNotable(P('ewma', 'level'), ctx)).toBe(false);
    });
});

describe('isStateNotable — pro-indicator mismatched predicate kinds', () => {
    // Every pro-indicator feature is gated on 'level'; any other kind must take
    // the safe `false` arm rather than throwing.
    const proFeatures: ReadonlyArray<SkillStatePredicate['feature']> = [
        'macdV',
        'connorsRsi',
        'forceIndex',
        'elderRay',
        'elderImpulse',
        'chandelier',
        'hurst',
        'varianceRatio',
        'regression',
        'yangZhang',
        'ewma',
    ];
    it.each(proFeatures)(
        'returns false for feature=%s with a non-level predicate',
        feature => {
            const ctx = ctxWithIndicators({});
            expect(isStateNotable(P(feature, 'pctB'), ctx)).toBe(false);
        }
    );
});
