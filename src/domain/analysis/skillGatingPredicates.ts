import { lastOf } from '@/domain/analysis/analysisUtils';
import type {
    SkillSelectionContext,
    SkillStatePredicate,
    Timeframe,
} from '@/domain/types';

// ── Textbook state thresholds (all named — no magic literals) ───────────────
// These encode the "notable state" boundaries from the Group F gating spec.
// A state predicate fires when the indicator's latest value reaches an extreme
// that a textbook analyst would flag (overbought/oversold, band proximity, …).

/** Timeframe-aware Bollinger %B overbought/oversold bounds. */
interface PctBBounds {
    readonly hi: number;
    readonly lo: number;
}

/**
 * Bollinger %B is stricter on higher timeframes: an extreme reading on a daily
 * chart is more meaningful, so it demands a tighter bound than a 15-minute one.
 */
const BOLLINGER_PCTB_BY_TF: Partial<Record<Timeframe, PctBBounds>> = {
    '1Day': { hi: 0.98, lo: 0.02 },
    '1Hour': { hi: 0.95, lo: 0.05 },
    '15Min': { hi: 0.92, lo: 0.08 },
};

/** Fallback %B bounds for timeframes without an explicit entry (daily-strict). */
const BOLLINGER_PCTB_DEFAULT: PctBBounds = { hi: 0.98, lo: 0.02 };

/** Keltner: price within this many ATRs of a band counts as "at the band". */
const KELTNER_BAND_PROXIMITY_ATR = 0.5;

/** VWAP: distance from VWAP at/above this many ATRs is notable (intraday only). */
const VWAP_DISTANCE_ATR = 1;

/** Williams %R overbought (>=) / oversold (<=) levels. */
const WILLIAMS_R_OVERBOUGHT = -20;
const WILLIAMS_R_OVERSOLD = -80;

/** Stochastic %K overbought (>=) / oversold (<=) levels. */
const STOCHASTIC_OVERBOUGHT = 80;
const STOCHASTIC_OVERSOLD = 20;

/** StochRSI overbought (>=) / oversold (<=) levels (0–1 scale). */
const STOCH_RSI_OVERBOUGHT = 0.8;
const STOCH_RSI_OVERSOLD = 0.2;

/**
 * Donchian: price within this fraction of the channel range from the high/low
 * (or beyond it) counts as channel proximity.
 */
const DONCHIAN_PROXIMITY_FRACTION = 0.05;

/** buySellVolume buy-ratio bullish (>=) / bearish (<=) thresholds. */
const BUY_SELL_RATIO_BULLISH = 0.65;
const BUY_SELL_RATIO_BEARISH = 0.35;

// ── Helpers ─────────────────────────────────────────────────────────────────

const INTRADAY_VWAP_DISABLED_TIMEFRAME: Timeframe = '1Day';

/** Latest finite value of a per-bar oscillator series, or null. */
const lastNumber = (series: (number | null)[]): number | null => {
    const v = lastOf(series);
    return v ?? null;
};

/** True when `value` sits at/above `hi` or at/below `lo`. */
const isOutsideBounds = (value: number, hi: number, lo: number): boolean =>
    value >= hi || value <= lo;

const isFiniteNumber = (value: number | null | undefined): value is number =>
    value !== null && value !== undefined && Number.isFinite(value);

// ── Per-feature predicate evaluators ────────────────────────────────────────

const bollingerPctBNotable = (
    p: SkillStatePredicate,
    ctx: SkillSelectionContext
): boolean => {
    const band = lastOf(ctx.indicators.bollinger);
    if (
        band === null ||
        !isFiniteNumber(band.upper) ||
        !isFiniteNumber(band.lower)
    ) {
        return false;
    }
    const width = band.upper - band.lower;
    if (width <= 0) return false;
    const pctB = (ctx.price - band.lower) / width;

    const tfBounds =
        BOLLINGER_PCTB_BY_TF[ctx.timeframe] ?? BOLLINGER_PCTB_DEFAULT;
    const hi = p.hi ?? tfBounds.hi;
    const lo = p.lo ?? tfBounds.lo;
    return isOutsideBounds(pctB, hi, lo);
};

const keltnerBandDistNotable = (ctx: SkillSelectionContext): boolean => {
    if (ctx.price <= 0) return false;
    const kc = lastOf(ctx.indicators.keltnerChannel);
    if (kc === null || !isFiniteNumber(kc.upper) || !isFiniteNumber(kc.lower)) {
        return false;
    }
    const atr = lastNumber(ctx.indicators.atr);
    if (!isFiniteNumber(atr) || atr <= 0) return false;

    // Beyond either band → breakout/breakdown; otherwise within proximity band.
    if (ctx.price >= kc.upper || ctx.price <= kc.lower) return true;
    const margin = KELTNER_BAND_PROXIMITY_ATR * atr;
    return kc.upper - ctx.price <= margin || ctx.price - kc.lower <= margin;
};

const williamsRLevelNotable = (ctx: SkillSelectionContext): boolean => {
    const wr = lastNumber(ctx.indicators.williamsR);
    if (!isFiniteNumber(wr)) return false;
    return wr >= WILLIAMS_R_OVERBOUGHT || wr <= WILLIAMS_R_OVERSOLD;
};

const stochasticLevelNotable = (ctx: SkillSelectionContext): boolean => {
    const st = lastOf(ctx.indicators.stochastic);
    if (st === null || !isFiniteNumber(st.percentK)) return false;
    return isOutsideBounds(
        st.percentK,
        STOCHASTIC_OVERBOUGHT,
        STOCHASTIC_OVERSOLD
    );
};

const stochRsiLevelNotable = (ctx: SkillSelectionContext): boolean => {
    const sr = lastOf(ctx.indicators.stochRsi);
    if (sr === null || !isFiniteNumber(sr.k)) return false;
    return isOutsideBounds(sr.k, STOCH_RSI_OVERBOUGHT, STOCH_RSI_OVERSOLD);
};

const donchianProximityNotable = (ctx: SkillSelectionContext): boolean => {
    if (ctx.price <= 0) return false;
    const dc = lastOf(ctx.indicators.donchianChannel);
    if (dc === null || !isFiniteNumber(dc.upper) || !isFiniteNumber(dc.lower)) {
        return false;
    }
    const range = dc.upper - dc.lower;
    if (range <= 0) return false;

    if (ctx.price >= dc.upper || ctx.price <= dc.lower) return true;
    const margin = DONCHIAN_PROXIMITY_FRACTION * range;
    return dc.upper - ctx.price <= margin || ctx.price - dc.lower <= margin;
};

const vwapDistNotable = (ctx: SkillSelectionContext): boolean => {
    // VWAP resets each session, so a "distance from VWAP" reading is only
    // meaningful intraday; on a daily chart it is never notable.
    if (ctx.timeframe === INTRADAY_VWAP_DISABLED_TIMEFRAME) return false;
    const vwap = lastNumber(ctx.indicators.vwap);
    if (!isFiniteNumber(vwap)) return false;
    const atr = lastNumber(ctx.indicators.atr);
    if (!isFiniteNumber(atr) || atr <= 0) return false;
    return Math.abs(ctx.price - vwap) >= VWAP_DISTANCE_ATR * atr;
};

const buySellRatioNotable = (ctx: SkillSelectionContext): boolean => {
    const bsv = lastOf(ctx.indicators.buySellVolume);
    if (bsv === null) return false;
    const total = bsv.buyVolume + bsv.sellVolume;
    if (total <= 0) return false;
    const ratio = bsv.buyVolume / total;
    return ratio >= BUY_SELL_RATIO_BULLISH || ratio <= BUY_SELL_RATIO_BEARISH;
};

/**
 * Decide whether a textbook *state* predicate is currently notable for the
 * analyzed chart.
 *
 * Pure: reads only `predicate` and the already-computed values inside `ctx`
 * (the last entry of each indicator series plus `ctx.price` / `ctx.timeframe`).
 * Any missing / null / degenerate input yields `false` rather than throwing, so
 * an under-warmed indicator never spuriously loads a gated skill.
 *
 * @param predicate - The `(feature, predicate)` pair from a skill's `gating.state`.
 * @param ctx - Read-only chart selection context.
 * @returns `true` when the feature has reached its textbook extreme.
 */
export function isStateNotable(
    predicate: SkillStatePredicate,
    ctx: SkillSelectionContext
): boolean {
    switch (predicate.feature) {
        case 'bollinger':
            return predicate.predicate === 'pctB'
                ? bollingerPctBNotable(predicate, ctx)
                : false;
        case 'keltner':
            return predicate.predicate === 'bandDistAtr'
                ? keltnerBandDistNotable(ctx)
                : false;
        case 'williamsR':
            return predicate.predicate === 'level'
                ? williamsRLevelNotable(ctx)
                : false;
        case 'stochastic':
            return predicate.predicate === 'level'
                ? stochasticLevelNotable(ctx)
                : false;
        case 'stochRsi':
            return predicate.predicate === 'level'
                ? stochRsiLevelNotable(ctx)
                : false;
        case 'donchian':
            return predicate.predicate === 'channelProximity'
                ? donchianProximityNotable(ctx)
                : false;
        case 'vwap':
            return predicate.predicate === 'bandDistAtr'
                ? vwapDistNotable(ctx)
                : false;
        case 'buySellVolume':
            return predicate.predicate === 'ratio'
                ? buySellRatioNotable(ctx)
                : false;
        default:
            return false;
    }
}
