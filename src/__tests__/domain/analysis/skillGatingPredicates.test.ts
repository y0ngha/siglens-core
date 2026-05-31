import { describe, it, expect } from 'vitest';
import { isStateNotable } from '@/domain/analysis/skillGatingPredicates';
import type {
    BollingerResult,
    BuySellVolumeResult,
    DonchianChannelResult,
    IndicatorResult,
    KeltnerChannelResult,
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
    macd: [],
    bollinger: [],
    dmi: [],
    stochastic: [],
    stochRsi: [],
    rsi: [],
    cci: [],
    vwap: [],
    ma: {},
    ema: {},
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
        swingHighs: [],
        swingLows: [],
        orderBlocks: [],
        fairValueGaps: [],
        equalHighs: [],
        equalLows: [],
        premiumZone: null,
        discountZone: null,
        equilibriumZone: null,
        structureBreaks: [],
    },
    squeezeMomentum: [],
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
