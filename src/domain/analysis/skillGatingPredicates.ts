import { lastOf } from '@/domain/analysis/analysisUtils';
import {
    CRSI_OVERBOUGHT,
    CRSI_OVERSOLD,
    HURST_RANDOM_WALK,
    MACDV_OVERBOUGHT,
    VR_RANDOM_WALK,
} from '@/domain/indicators/constants';
import type {
    ChandelierResult,
    ImpulseColor,
    RegressionResult,
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
 * @internal Exported only so boundary tests read each timeframe's exact %B bound
 * instead of re-hardcoding the literal (a false-positive guard if it changes).
 *
 * Bollinger %B is stricter on higher timeframes: an extreme reading on a daily
 * chart is more meaningful, so it demands a tighter bound than a 15-minute one.
 */
export const BOLLINGER_PCTB_BY_TF: Partial<Record<Timeframe, PctBBounds>> = {
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

// ── Pro-indicator state thresholds (Phase 3 — advisory / regime / volatility) ─
// Reuse the indicator-layer constants where one already encodes the same bound
// (MACD-V ±150 risk zone, Connors RSI <10 / >90) so the gate and the prompt
// annotation never drift apart. The remaining margins are gating-only and named
// here. Rationale per feature: research/2026-06-05-pro-indicators-phase3.

/** How many bars back a Chandelier `trend` flip still counts as "just flipped". */
const CHANDELIER_FLIP_LOOKBACK = 3;

/**
 * Hurst is decisive only when it clears |H − 0.5| ≥ this margin — i.e. far enough
 * from the random-walk midpoint to lean trend-following (>0.5) or mean-reversion
 * (<0.5). Inside the margin the read is low-confidence noise, so the skill stays
 * dormant.
 */
const HURST_DECISIVE_MARGIN = 0.1;

/**
 * Variance Ratio is decisive only when |VR − 1| ≥ this margin (VR ≈ 1 = random
 * walk; >1 trending, <1 mean-reverting). A fixed margin is a simplification of
 * the q-/sample-dependent robust Z* test (Lo & MacKinlay 1988); it is a gating
 * heuristic, not a significance claim.
 */
const VR_DECISIVE_MARGIN = 0.2;

/**
 * Regression trend is "clean enough to flag" at r² ≥ this cutoff. A fixed cutoff
 * is a deliberate simplification of the window-scaled critical-R² table (which
 * tightens as the window shrinks); 0.3 is a conservative pick for the default
 * REGRESSION_PERIOD window (~20 bars, whose 95% critical-R² ≈ 0.20). See the
 * research dossier (section 10) for the full table.
 */
const REGRESSION_R2_SIGNIFICANT = 0.3;

/**
 * Volatility-regime window + multipliers shared by Yang-Zhang and EWMA. A latest
 * read ≥ HIGH×mean (expansion / risk-on) or ≤ LOW×mean (compression / squeeze)
 * over the trailing window is notable; in between is an unremarkable regime.
 */
const VOL_REGIME_WINDOW = 20;
const VOL_REGIME_HIGH_MULT = 1.5;
const VOL_REGIME_LOW_MULT = 0.5;

// ── Helpers ─────────────────────────────────────────────────────────────────

const INTRADAY_VWAP_DISABLED_TIMEFRAME: Timeframe = '1Day';

/** Latest finite value of a per-bar oscillator series, or null. */
const lastNumber = (series: (number | null)[]): number | null => {
    const v = lastOf(series);
    // lastOf returns null for an empty array; `?? null` also folds a trailing
    // null element into null, so the result matches the number | null contract.
    return v ?? null;
};

/** True when `value` sits at/above `hi` or at/below `lo`. */
const isOutsideBounds = (value: number, hi: number, lo: number): boolean =>
    value >= hi || value <= lo;

const isFiniteNumber = (value: number | null | undefined): value is number =>
    value !== null && value !== undefined && Number.isFinite(value);

/**
 * The two most-recent finite values of a per-bar series, oldest-first
 * (`[prev, latest]`), or `null` when fewer than two finite values exist. Scans
 * from the tail so trailing `null` warm-up entries (or interspersed nulls) are
 * skipped — a sign/colour flip is measured against the last *finite* read, not
 * a raw neighbour that might be null.
 */
const lastTwoFinite = (series: (number | null)[]): [number, number] | null => {
    let latest: number | null = null;
    for (let i = series.length - 1; i >= 0; i -= 1) {
        const v = series[i];
        if (!isFiniteNumber(v)) continue;
        if (latest === null) {
            latest = v;
            continue;
        }
        return [v, latest];
    }
    return null;
};

/** Mean of the last `window` finite values, or `null` when none are finite. */
const recentFiniteMean = (
    series: (number | null)[],
    window: number
): number | null => {
    let sum = 0;
    let count = 0;
    for (let i = series.length - 1; i >= 0 && count < window; i -= 1) {
        const v = series[i];
        if (!isFiniteNumber(v)) continue;
        sum += v;
        count += 1;
    }
    return count > 0 ? sum / count : null;
};

/**
 * Notable when the latest finite volatility read sits in the top (≥ HIGH×mean)
 * or bottom (≤ LOW×mean) of its recent window — a vol-regime extreme. Shared by
 * Yang-Zhang and EWMA. Null-safe: returns `false` when the latest read or the
 * window mean is missing/degenerate.
 */
const volRegimeNotable = (series: (number | null)[]): boolean => {
    const latest = lastNumber(series);
    if (!isFiniteNumber(latest)) return false;
    const mean = recentFiniteMean(series, VOL_REGIME_WINDOW);
    if (!isFiniteNumber(mean) || mean <= 0) return false;
    return (
        latest >= mean * VOL_REGIME_HIGH_MULT ||
        latest <= mean * VOL_REGIME_LOW_MULT
    );
};

// ── Per-feature predicate evaluators ────────────────────────────────────────

const bollingerPctBNotable = (
    p: SkillStatePredicate,
    ctx: SkillSelectionContext
): boolean => {
    const band = lastOf(ctx.indicators.bollinger);
    // `!band` covers both null and the undefined returned for an empty series.
    if (!band || !isFiniteNumber(band.upper) || !isFiniteNumber(band.lower)) {
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
    // `!kc` covers both null and the undefined returned for an empty series.
    if (!kc || !isFiniteNumber(kc.upper) || !isFiniteNumber(kc.lower)) {
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
    // `!st` covers both null and the undefined returned for an empty series.
    if (!st || !isFiniteNumber(st.percentK)) return false;
    return isOutsideBounds(
        st.percentK,
        STOCHASTIC_OVERBOUGHT,
        STOCHASTIC_OVERSOLD
    );
};

const stochRsiLevelNotable = (ctx: SkillSelectionContext): boolean => {
    const sr = lastOf(ctx.indicators.stochRsi);
    // `!sr` covers both null and the undefined returned for an empty series.
    if (!sr || !isFiniteNumber(sr.k)) return false;
    return isOutsideBounds(sr.k, STOCH_RSI_OVERBOUGHT, STOCH_RSI_OVERSOLD);
};

const donchianProximityNotable = (ctx: SkillSelectionContext): boolean => {
    if (ctx.price <= 0) return false;
    const dc = lastOf(ctx.indicators.donchianChannel);
    // `!dc` covers both null and the undefined returned for an empty series.
    if (!dc || !isFiniteNumber(dc.upper) || !isFiniteNumber(dc.lower)) {
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
    // `!bsv` covers both null and the undefined returned for an empty series.
    if (!bsv) return false;
    const total = bsv.buyVolume + bsv.sellVolume;
    if (total <= 0) return false;
    const ratio = bsv.buyVolume / total;
    return ratio >= BUY_SELL_RATIO_BULLISH || ratio <= BUY_SELL_RATIO_BEARISH;
};

// ── Pro-indicator evaluators (Phase 3) ───────────────────────────────────────

/** MACD-V: notable when the latest read sits in the ±150 OB/OS risk zone. */
const macdVLevelNotable = (ctx: SkillSelectionContext): boolean => {
    const v = lastNumber(ctx.indicators.macdV);
    if (!isFiniteNumber(v)) return false;
    return Math.abs(v) >= MACDV_OVERBOUGHT;
};

/** Connors RSI: notable at its fast-moving <10 / >90 extremes. */
const connorsRsiLevelNotable = (ctx: SkillSelectionContext): boolean => {
    const v = lastNumber(ctx.indicators.connorsRsi);
    if (!isFiniteNumber(v)) return false;
    return v <= CRSI_OVERSOLD || v >= CRSI_OVERBOUGHT;
};

/**
 * Force Index: notable on a sign flip vs the previous finite read — a 0-line
 * cross marks the momentum turn the indicator is built to surface. A flat read
 * landing exactly on zero is not a flip.
 */
const forceIndexLevelNotable = (ctx: SkillSelectionContext): boolean => {
    const pair = lastTwoFinite(ctx.indicators.forceIndex);
    if (pair === null) return false;
    const [prev, latest] = pair;
    return Math.sign(prev) !== Math.sign(latest) && latest !== 0;
};

/**
 * Elder-Ray: notable on Elder's two core turn conditions vs the previous bar —
 * bear power negative but rising (best-buy setup) OR bull power positive but
 * falling (selling pressure entering a rally). False on null / insufficient bars.
 */
const elderRayLevelNotable = (ctx: SkillSelectionContext): boolean => {
    const series = ctx.indicators.elderRay;
    if (series.length < 2) return false;
    const prev = series[series.length - 2];
    const cur = series[series.length - 1];
    if (!prev || !cur) return false;

    const bearTurningUp =
        isFiniteNumber(prev.bearPower) &&
        isFiniteNumber(cur.bearPower) &&
        cur.bearPower < 0 &&
        cur.bearPower > prev.bearPower;
    const bullTurningDown =
        isFiniteNumber(prev.bullPower) &&
        isFiniteNumber(cur.bullPower) &&
        cur.bullPower > 0 &&
        cur.bullPower < prev.bullPower;
    return bearTurningUp || bullTurningDown;
};

/**
 * Elder Impulse: notable when the latest bar carries a colour AND that colour is
 * a permission change worth surfacing — either it flipped vs the previous
 * coloured bar, or it is not 'blue' (green/red actively forbid one side).
 */
const elderImpulseLevelNotable = (ctx: SkillSelectionContext): boolean => {
    const series = ctx.indicators.elderImpulse;
    const latest = lastOf(series) as ImpulseColor | null;
    if (latest === null) return false;

    // Previous *coloured* bar (skip trailing nulls) to detect a flip.
    let prev: ImpulseColor | null = null;
    for (let i = series.length - 2; i >= 0; i -= 1) {
        const c = series[i];
        if (c !== null) {
            prev = c;
            break;
        }
    }
    const flipped = prev !== null && prev !== latest;
    return flipped || latest !== 'blue';
};

/**
 * Chandelier Exit: notable when the `trend` side flipped within the last
 * CHANDELIER_FLIP_LOOKBACK bars (a regime change), not merely whenever a trend
 * exists. Reads the trailing window of non-null trends.
 */
const chandelierLevelNotable = (ctx: SkillSelectionContext): boolean => {
    const series: ChandelierResult[] = ctx.indicators.chandelierExit;
    if (series.length < 2) return false;
    const latest = series[series.length - 1];
    if (!latest || latest.trend === null) return false;

    const from = Math.max(0, series.length - CHANDELIER_FLIP_LOOKBACK - 1);
    for (let i = series.length - 2; i >= from; i -= 1) {
        const t = series[i].trend;
        if (t === null) continue;
        return t !== latest.trend;
    }
    return false;
};

/** Hurst: notable when |H − 0.5| clears the decisive margin (off random walk). */
const hurstLevelNotable = (ctx: SkillSelectionContext): boolean => {
    const v = lastNumber(ctx.indicators.hurst);
    if (!isFiniteNumber(v)) return false;
    return Math.abs(v - HURST_RANDOM_WALK) >= HURST_DECISIVE_MARGIN;
};

/** Variance Ratio: notable when |VR − 1| clears the decisive margin. */
const varianceRatioLevelNotable = (ctx: SkillSelectionContext): boolean => {
    const v = lastNumber(ctx.indicators.varianceRatio);
    if (!isFiniteNumber(v)) return false;
    return Math.abs(v - VR_RANDOM_WALK) >= VR_DECISIVE_MARGIN;
};

/** Regression: notable when the trend fit is clean (r² ≥ significance cutoff). */
const regressionLevelNotable = (ctx: SkillSelectionContext): boolean => {
    const latest = lastOf(ctx.indicators.regression) as RegressionResult | null;
    if (!latest || !isFiniteNumber(latest.r2)) return false;
    return latest.r2 >= REGRESSION_R2_SIGNIFICANT;
};

/** Yang-Zhang: notable when realized vol is in a top/bottom regime extreme. */
const yangZhangLevelNotable = (ctx: SkillSelectionContext): boolean =>
    volRegimeNotable(ctx.indicators.yangZhang);

/** EWMA: notable when reactive vol is in a top/bottom regime extreme. */
const ewmaLevelNotable = (ctx: SkillSelectionContext): boolean =>
    volRegimeNotable(ctx.indicators.ewmaVolatility);

/**
 * @internal
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
        // ── Pro-indicators Phase 3 — all gated on the generalized 'level' kind ─
        case 'macdV':
            return predicate.predicate === 'level'
                ? macdVLevelNotable(ctx)
                : false;
        case 'connorsRsi':
            return predicate.predicate === 'level'
                ? connorsRsiLevelNotable(ctx)
                : false;
        case 'forceIndex':
            return predicate.predicate === 'level'
                ? forceIndexLevelNotable(ctx)
                : false;
        case 'elderRay':
            return predicate.predicate === 'level'
                ? elderRayLevelNotable(ctx)
                : false;
        case 'elderImpulse':
            return predicate.predicate === 'level'
                ? elderImpulseLevelNotable(ctx)
                : false;
        case 'chandelier':
            return predicate.predicate === 'level'
                ? chandelierLevelNotable(ctx)
                : false;
        case 'hurst':
            return predicate.predicate === 'level'
                ? hurstLevelNotable(ctx)
                : false;
        case 'varianceRatio':
            return predicate.predicate === 'level'
                ? varianceRatioLevelNotable(ctx)
                : false;
        case 'regression':
            return predicate.predicate === 'level'
                ? regressionLevelNotable(ctx)
                : false;
        case 'yangZhang':
            return predicate.predicate === 'level'
                ? yangZhangLevelNotable(ctx)
                : false;
        case 'ewma':
            return predicate.predicate === 'level'
                ? ewmaLevelNotable(ctx)
                : false;
        default:
            return false;
    }
}
