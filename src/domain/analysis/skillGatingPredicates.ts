import { lastOf } from '@/domain/analysis/analysisUtils';
import { isIntraday } from '@/domain/constants/market';
import {
    formatNullableNumber,
    formatQuotedPrice,
} from '@/domain/analysis/promptFormat';
import {
    CRSI_OVERBOUGHT,
    CRSI_OVERSOLD,
    HURST_RANDOM_WALK,
    MACDV_OVERBOUGHT,
    REGRESSION_R2_SIGNIFICANT,
    STOCHASTIC_OVERBOUGHT_LEVEL,
    STOCHASTIC_OVERSOLD_LEVEL,
    VR_RANDOM_WALK,
    WILLIAMS_R_OVERBOUGHT_LEVEL,
    WILLIAMS_R_OVERSOLD_LEVEL,
} from '@/domain/indicators/constants';
import type {
    BollingerResult,
    IndicatorStateRead,
    StateRead,
    VolRegimeRead,
    ChandelierResult,
    ImpulseColor,
    IndicatorCardStates,
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
 * @internal Hurst is decisive only when it clears |H − 0.5| ≥ this margin — i.e.
 * far enough from the random-walk midpoint to lean trend-following (>0.5) or
 * mean-reversion (<0.5). Inside the margin the read is low-confidence noise, so
 * the skill stays dormant. Exported so boundary tests reference the exact
 * threshold instead of re-hardcoding it.
 */
export const HURST_DECISIVE_MARGIN = 0.1;

/**
 * @internal Variance Ratio is decisive only when |VR − 1| ≥ this margin (VR ≈ 1
 * = random walk; >1 trending, <1 mean-reverting). A fixed margin is a
 * simplification of the q-/sample-dependent robust Z* test (Lo & MacKinlay
 * 1988); it is a gating heuristic, not a significance claim. Exported so
 * boundary tests reference the exact threshold.
 */
export const VR_DECISIVE_MARGIN = 0.2;

/**
 * Volatility-regime window + multipliers shared by Yang-Zhang and EWMA. A latest
 * read ≥ HIGH×mean (expansion / risk-on) or ≤ LOW×mean (compression / squeeze)
 * over the trailing window is notable; in between is an unremarkable regime.
 */
const VOL_REGIME_WINDOW = 20;
const VOL_REGIME_HIGH_MULT = 1.5;
const VOL_REGIME_LOW_MULT = 0.5;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Latest finite value of a per-bar oscillator series, or null. */
const lastNumber = (series: (number | null)[]): number | null => {
    const v = lastOf(series);
    // lastOf returns null for an empty array; `?? null` also folds a trailing
    // null element into null, so the result matches the number | null contract.
    return v ?? null;
};

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
 * The regime a volatility series is in when its latest finite read sits in the top (≥
 * HIGH×mean) or bottom (≤ LOW×mean) of its recent window — a vol-regime extreme — else `null`.
 * Shared by Yang-Zhang and EWMA. Null-safe: `null` when the latest read or the window mean is
 * missing/degenerate.
 */
const volRegimeOf = (series: (number | null)[]): VolRegimeRead | null => {
    const latest = lastNumber(series);
    if (!isFiniteNumber(latest)) return null;
    const mean = recentFiniteMean(series, VOL_REGIME_WINDOW);
    if (!isFiniteNumber(mean) || mean <= 0) return null;
    if (latest >= mean * VOL_REGIME_HIGH_MULT) {
        return { latest, state: 'high_volatility' };
    }
    return latest <= mean * VOL_REGIME_LOW_MULT
        ? { latest, state: 'low_volatility' }
        : null;
};

// ── Printed figures ─────────────────────────────────────────────────────────
// The band, VWAP and Bollinger predicates decide on the figures the prompt prints
// (DOM-8): a recomputation from the rendered text must reach the same state. KRX prices
// are printed on their tick, so a band edge a few won inside the raw value would
// otherwise put the gate and the line the model reads on opposite sides of a threshold.

/** `value` as the prompt prints a price-axis figure (unchanged without print settings). */
const printedPrice = (ctx: SkillSelectionContext, value: number): number =>
    ctx.print === undefined
        ? value
        : Number(formatQuotedPrice(value, ctx.print.quoting));

/** `value` as the prompt prints a bounded figure (`fmt`, two decimals; unchanged without print settings). */
const printedFigure = (ctx: SkillSelectionContext, value: number): number =>
    ctx.print === undefined ? value : Number(formatNullableNumber(value, 2));

/** `value` as the prompt prints a difference of prices (unchanged without print settings). */
const printedDifference = (
    ctx: SkillSelectionContext,
    value: number
): number =>
    ctx.print === undefined
        ? value
        : Number(formatNullableNumber(value, ctx.print.differenceDp));

// ── Per-feature state readers ───────────────────────────────────────────────
// Each reader returns what it found when the feature is notable — the state and the
// unrounded values it was decided on — or `null`. `isStateNotable` is `readIndicatorState`
// being non-null, so the gate that injects a skill and the card built for it read one rule.

/** The pairs `(bollinger, pctB)` reads: price-relative %B beyond the timeframe's bounds. */
export const readBollingerPctB = (
    p: SkillStatePredicate,
    ctx: SkillSelectionContext
): StateRead<
    IndicatorCardStates['bollinger'],
    'pctB' | 'upper' | 'lower'
> | null => {
    const band = lastOf(ctx.indicators.bollinger);
    const bounds =
        BOLLINGER_PCTB_BY_TF[ctx.timeframe] ?? BOLLINGER_PCTB_DEFAULT;
    const [hi, lo] = [p.hi ?? bounds.hi, p.lo ?? bounds.lo];
    // The engine's own %B is the figure the prompt prints (`## Pro-Indicator Agreement`), so the
    // state is decided on it, as printed (DOM-8). Recomputing %B from band edges the prompt
    // rounded (a KRX tick moves an edge by up to half a tick) could land on the other side of
    // the bound than the line the model reads. Only a series without it (a hand-built
    // context) falls back to the price against the bands.
    const derived = lastOf(ctx.indicators.bollingerDerived)?.pctB ?? null;
    const pctB = isFiniteNumber(derived)
        ? printedFigure(ctx, derived)
        : pctBFromBands(band, ctx.price);
    if (pctB === null) return null;
    const raw = {
        pctB,
        upper: band?.upper ?? null,
        lower: band?.lower ?? null,
    };
    if (pctB >= hi) return { state: 'above_band_pctb', raw };
    return pctB <= lo ? { state: 'below_band_pctb', raw } : null;
};

/** `(price − lower) / (upper − lower)` of the latest band, or `null` when the band cannot give one. */
const pctBFromBands = (
    band: BollingerResult | null | undefined,
    price: number
): number | null => {
    // `!band` covers both null and the undefined returned for an empty series.
    if (!band || !isFiniteNumber(band.upper) || !isFiniteNumber(band.lower)) {
        return null;
    }
    const width = band.upper - band.lower;
    return width <= 0 ? null : (price - band.lower) / width;
};

/**
 * The side a price sits on a channel `[lower, upper]`: beyond a band, or within `margin` of
 * one (the nearer band when it is within `margin` of both). `null` anywhere else.
 */
const bandSide = (
    price: number,
    upper: number,
    lower: number,
    margin: number
): IndicatorCardStates['keltner'] | null => {
    if (price >= upper) return 'beyond_upper';
    if (price <= lower) return 'beyond_lower';
    const toUpper = upper - price;
    const toLower = price - lower;
    if (toUpper > margin && toLower > margin) return null;
    return toUpper <= toLower ? 'near_upper' : 'near_lower';
};

export const readKeltnerBand = (
    ctx: SkillSelectionContext
): StateRead<
    IndicatorCardStates['keltner'],
    'upper' | 'lower' | 'atr'
> | null => {
    if (ctx.price <= 0) return null;
    const kc = lastOf(ctx.indicators.keltnerChannel);
    // `!kc` covers both null and the undefined returned for an empty series.
    if (!kc || !isFiniteNumber(kc.upper) || !isFiniteNumber(kc.lower)) {
        return null;
    }
    const rawAtr = lastNumber(ctx.indicators.atr);
    if (!isFiniteNumber(rawAtr)) return null;
    const atr = printedDifference(ctx, rawAtr);
    if (atr <= 0) return null;

    // Beyond either band → breakout/breakdown; otherwise within proximity band.
    const [upper, lower] = [
        printedPrice(ctx, kc.upper),
        printedPrice(ctx, kc.lower),
    ];
    const state = bandSide(
        printedPrice(ctx, ctx.price),
        upper,
        lower,
        KELTNER_BAND_PROXIMITY_ATR * atr
    );
    return state === null ? null : { state, raw: { upper, lower, atr } };
};

export const readWilliamsRLevel = (
    ctx: SkillSelectionContext
): StateRead<IndicatorCardStates['williams_r'], 'williamsR'> | null => {
    const wr = lastNumber(ctx.indicators.williamsR);
    if (!isFiniteNumber(wr)) return null;
    if (wr >= WILLIAMS_R_OVERBOUGHT_LEVEL) {
        return { state: 'overbought', raw: { williamsR: wr } };
    }
    return wr <= WILLIAMS_R_OVERSOLD_LEVEL
        ? { state: 'oversold', raw: { williamsR: wr } }
        : null;
};

export const readStochasticLevel = (
    ctx: SkillSelectionContext
): StateRead<
    IndicatorCardStates['stochastic'],
    'percentK' | 'percentD'
> | null => {
    const st = lastOf(ctx.indicators.stochastic);
    // `!st` covers both null and the undefined returned for an empty series.
    if (!st || !isFiniteNumber(st.percentK)) return null;
    const raw = { percentK: st.percentK, percentD: st.percentD ?? null };
    if (st.percentK >= STOCHASTIC_OVERBOUGHT_LEVEL) {
        return { state: 'overbought', raw };
    }
    return st.percentK <= STOCHASTIC_OVERSOLD_LEVEL
        ? { state: 'oversold', raw }
        : null;
};

export const readStochRsiLevel = (
    ctx: SkillSelectionContext
): StateRead<IndicatorCardStates['stoch_rsi'], 'k' | 'd'> | null => {
    const sr = lastOf(ctx.indicators.stochRsi);
    // `!sr` covers both null and the undefined returned for an empty series.
    if (!sr || !isFiniteNumber(sr.k)) return null;
    const raw = { k: sr.k, d: sr.d ?? null };
    if (sr.k >= STOCH_RSI_OVERBOUGHT) return { state: 'overbought', raw };
    return sr.k <= STOCH_RSI_OVERSOLD ? { state: 'oversold', raw } : null;
};

export const readDonchianProximity = (
    ctx: SkillSelectionContext
): StateRead<IndicatorCardStates['donchian'], 'upper' | 'lower'> | null => {
    if (ctx.price <= 0) return null;
    const dc = lastOf(ctx.indicators.donchianChannel);
    // `!dc` covers both null and the undefined returned for an empty series.
    if (!dc || !isFiniteNumber(dc.upper) || !isFiniteNumber(dc.lower)) {
        return null;
    }
    const [upper, lower] = [
        printedPrice(ctx, dc.upper),
        printedPrice(ctx, dc.lower),
    ];
    const range = upper - lower;
    if (range <= 0) return null;

    const state = bandSide(
        printedPrice(ctx, ctx.price),
        upper,
        lower,
        DONCHIAN_PROXIMITY_FRACTION * range
    );
    return state === null ? null : { state, raw: { upper, lower } };
};

export const readVwapDistance = (
    ctx: SkillSelectionContext
): StateRead<IndicatorCardStates['vwap'], 'vwap' | 'atr'> | null => {
    // VWAP resets each session, so a "distance from VWAP" reading is only
    // meaningful intraday; on a daily or weekly chart it is never notable.
    if (!isIntraday(ctx.timeframe)) return null;
    const rawVwap = lastNumber(ctx.indicators.vwap);
    if (!isFiniteNumber(rawVwap)) return null;
    const rawAtr = lastNumber(ctx.indicators.atr);
    if (!isFiniteNumber(rawAtr)) return null;
    const [vwap, atr, price] = [
        printedPrice(ctx, rawVwap),
        printedDifference(ctx, rawAtr),
        printedPrice(ctx, ctx.price),
    ];
    if (atr <= 0 || Math.abs(price - vwap) < VWAP_DISTANCE_ATR * atr) {
        return null;
    }
    return { state: price > vwap ? 'above' : 'below', raw: { vwap, atr } };
};

export const readBuySellRatio = (
    ctx: SkillSelectionContext
): StateRead<IndicatorCardStates['buy_sell_volume'], 'buyRatio'> | null => {
    const bsv = lastOf(ctx.indicators.buySellVolume);
    // `!bsv` covers both null and the undefined returned for an empty series.
    if (!bsv) return null;
    const total = bsv.buyVolume + bsv.sellVolume;
    if (total <= 0) return null;
    const ratio = bsv.buyVolume / total;
    // Percent units, the way `## Volume Analysis (Buy/Sell)` prints it.
    const raw = { buyRatio: ratio * 100 };
    if (ratio >= BUY_SELL_RATIO_BULLISH) {
        return { state: 'buy_dominant', raw };
    }
    return ratio <= BUY_SELL_RATIO_BEARISH
        ? { state: 'sell_dominant', raw }
        : null;
};

// ── Pro-indicator readers (Phase 3) ──────────────────────────────────────────

/** MACD-V: notable when the latest read sits in the ±150 OB/OS risk zone. */
export const readMacdVLevel = (
    ctx: SkillSelectionContext
): StateRead<IndicatorCardStates['macd_v'], 'macdV'> | null => {
    const v = lastNumber(ctx.indicators.macdV);
    if (!isFiniteNumber(v) || Math.abs(v) < MACDV_OVERBOUGHT) return null;
    return {
        state: v > 0 ? 'high_positive' : 'high_negative',
        raw: { macdV: v },
    };
};

/** Connors RSI: notable at its fast-moving <10 / >90 extremes. */
export const readConnorsRsiLevel = (
    ctx: SkillSelectionContext
): StateRead<IndicatorCardStates['connors_rsi'], 'crsi'> | null => {
    const v = lastNumber(ctx.indicators.connorsRsi);
    if (!isFiniteNumber(v)) return null;
    if (v >= CRSI_OVERBOUGHT) return { state: 'overbought', raw: { crsi: v } };
    return v <= CRSI_OVERSOLD ? { state: 'oversold', raw: { crsi: v } } : null;
};

/**
 * Force Index: notable on a sign flip vs the previous finite read — a 0-line
 * cross marks the momentum turn the indicator is built to surface. A flat read
 * landing exactly on zero is not a flip.
 */
export const readForceIndexLevel = (
    ctx: SkillSelectionContext
): StateRead<IndicatorCardStates['force_index'], 'forceIndex'> | null => {
    const pair = lastTwoFinite(ctx.indicators.forceIndex);
    if (pair === null) return null;
    const [prev, latest] = pair;
    if (Math.sign(prev) === Math.sign(latest) || latest === 0) return null;
    return {
        state: latest > 0 ? 'turned_positive' : 'turned_negative',
        raw: { forceIndex: latest },
    };
};

/**
 * Elder-Ray: notable on Elder's two core turn conditions vs the previous bar —
 * bear power negative but rising (best-buy setup) OR bull power positive but
 * falling (selling pressure entering a rally). Null on missing / insufficient bars.
 */
export const readElderRayLevel = (
    ctx: SkillSelectionContext
): StateRead<
    IndicatorCardStates['elder_ray'],
    'bullPower' | 'bearPower'
> | null => {
    const series = ctx.indicators.elderRay;
    const n = series.length;
    if (n < 2) return null;
    const prev = series[n - 2];
    const cur = series[n - 1];
    if (!prev || !cur) return null;

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
    if (!bearTurningUp && !bullTurningDown) return null;
    return {
        state:
            bearTurningUp && bullTurningDown
                ? 'both'
                : bearTurningUp
                  ? 'bear_power_rising'
                  : 'bull_power_falling',
        raw: { bullPower: cur.bullPower, bearPower: cur.bearPower },
    };
};

/**
 * Elder Impulse: notable when the latest bar carries a colour AND that colour is
 * a permission change worth surfacing — either it flipped vs the previous
 * coloured bar, or it is not 'blue' (green/red actively forbid one side).
 */
export const readElderImpulseLevel = (
    ctx: SkillSelectionContext
): {
    readonly state: IndicatorCardStates['elder_impulse'];
    readonly flippedFrom: ImpulseColor | null;
} | null => {
    const series = ctx.indicators.elderImpulse;
    const latest = lastOf(series);
    if (!latest) return null;

    // Previous *coloured* bar (skip trailing nulls) to detect a flip. Predicate
    // excludes the last index without allocating an O(N) slice.
    const lastIdx = series.length - 1;
    const prev = series.findLast((c, i) => c !== null && i < lastIdx) ?? null;
    const flipped = prev !== null && prev !== latest;
    if (!flipped && latest === 'blue') return null;
    return { state: latest, flippedFrom: flipped ? prev : null };
};

/**
 * Chandelier Exit: notable when the `trend` side flipped within the last
 * CHANDELIER_FLIP_LOOKBACK bars (a regime change), not merely whenever a trend
 * exists. Reads the trailing window of non-null trends.
 */
export const readChandelierLevel = (
    ctx: SkillSelectionContext
): StateRead<IndicatorCardStates['chandelier'], 'stop'> | null => {
    const series: ChandelierResult[] = ctx.indicators.chandelierExit;
    const n = series.length;
    if (n < 2) return null;
    const latest = series[n - 1];
    if (!latest || latest.trend === null) return null;

    const from = Math.max(0, n - CHANDELIER_FLIP_LOOKBACK - 1);
    for (let i = n - 2; i >= from; i -= 1) {
        const item = series[i];
        if (!item || item.trend === null) continue;
        if (item.trend === latest.trend) return null;
        return latest.trend === 'long'
            ? { state: 'flipped_long', raw: { stop: latest.longStop } }
            : { state: 'flipped_short', raw: { stop: latest.shortStop } };
    }
    return null;
};

/** Hurst: notable when |H − 0.5| clears the decisive margin (off random walk). */
export const readHurstLevel = (
    ctx: SkillSelectionContext
): StateRead<IndicatorCardStates['hurst'], 'hurst'> | null => {
    const v = lastNumber(ctx.indicators.hurst);
    if (!isFiniteNumber(v)) return null;
    if (Math.abs(v - HURST_RANDOM_WALK) < HURST_DECISIVE_MARGIN) return null;
    return {
        state: v > HURST_RANDOM_WALK ? 'trending' : 'mean_reverting',
        raw: { hurst: v },
    };
};

/** Variance Ratio: notable when |VR − 1| clears the decisive margin. */
export const readVarianceRatioLevel = (
    ctx: SkillSelectionContext
): StateRead<IndicatorCardStates['variance_ratio'], 'varianceRatio'> | null => {
    const v = lastNumber(ctx.indicators.varianceRatio);
    if (!isFiniteNumber(v)) return null;
    if (Math.abs(v - VR_RANDOM_WALK) < VR_DECISIVE_MARGIN) return null;
    return {
        state: v > VR_RANDOM_WALK ? 'trending' : 'mean_reverting',
        raw: { varianceRatio: v },
    };
};

/** Regression: notable when the trend fit is clean (r² ≥ significance cutoff). */
export const readRegressionLevel = (
    ctx: SkillSelectionContext
): StateRead<IndicatorCardStates['regression'], 'r2'> | null => {
    // The regime line prints the R² of the last bar that has a slope, so the state is read
    // from that bar and that figure.
    const latest = ctx.indicators.regression.findLast(r => r.slope !== null);
    if (!latest || !isFiniteNumber(latest.r2)) return null;
    const r2 = printedFigure(ctx, latest.r2);
    if (r2 < REGRESSION_R2_SIGNIFICANT) return null;
    return {
        state: (latest.slope ?? 0) >= 0 ? 'strong_fit_up' : 'strong_fit_down',
        raw: { r2 },
    };
};

/**
 * Yang-Zhang: notable when realized vol is in a top/bottom regime extreme. `sigma` is the
 * per-bar σ in percent units, the way `## Market Regime & Risk Context` prints it.
 */
export const readYangZhangLevel = (
    ctx: SkillSelectionContext
): StateRead<IndicatorCardStates['yang_zhang'], 'sigma'> | null => {
    const regime = volRegimeOf(ctx.indicators.yangZhang);
    return regime === null
        ? null
        : { state: regime.state, raw: { sigma: regime.latest * 100 } };
};

/** EWMA: notable when reactive vol is in a top/bottom regime extreme (σ in percent units). */
export const readEwmaLevel = (
    ctx: SkillSelectionContext
): StateRead<IndicatorCardStates['ewma'], 'sigma'> | null => {
    const regime = volRegimeOf(ctx.indicators.ewmaVolatility);
    return regime === null
        ? null
        : { state: regime.state, raw: { sigma: regime.latest * 100 } };
};

/**
 * @internal
 * What a textbook *state* predicate found on the analyzed chart: the state it is in and the
 * unrounded values it was decided on, or `null` when the feature is not notable.
 *
 * Pure: reads only `predicate` and the already-computed values inside `ctx`
 * (the last entry of each indicator series plus `ctx.price` / `ctx.timeframe`).
 * Any missing / null / degenerate input yields `null` rather than throwing, so
 * an under-warmed indicator never spuriously loads a gated skill.
 *
 * @param predicate - The `(feature, predicate)` pair from a skill's `gating.state`.
 * @param ctx - Read-only chart selection context.
 * @returns The state when the feature has reached its textbook extreme, else `null`.
 */
export function readIndicatorState(
    predicate: SkillStatePredicate,
    ctx: SkillSelectionContext
): IndicatorStateRead | null {
    switch (predicate.feature) {
        case 'bollinger':
            return predicate.predicate === 'pctB'
                ? readBollingerPctB(predicate, ctx)
                : null;
        case 'keltner':
            return predicate.predicate === 'bandDistAtr'
                ? readKeltnerBand(ctx)
                : null;
        case 'williamsR':
            return predicate.predicate === 'level'
                ? readWilliamsRLevel(ctx)
                : null;
        case 'stochastic':
            return predicate.predicate === 'level'
                ? readStochasticLevel(ctx)
                : null;
        case 'stochRsi':
            return predicate.predicate === 'level'
                ? readStochRsiLevel(ctx)
                : null;
        case 'donchian':
            return predicate.predicate === 'channelProximity'
                ? readDonchianProximity(ctx)
                : null;
        case 'vwap':
            return predicate.predicate === 'bandDistAtr'
                ? readVwapDistance(ctx)
                : null;
        case 'buySellVolume':
            return predicate.predicate === 'ratio'
                ? readBuySellRatio(ctx)
                : null;
        // ── Pro-indicators Phase 3 — all gated on the generalized 'level' kind ─
        case 'macdV':
            return predicate.predicate === 'level' ? readMacdVLevel(ctx) : null;
        case 'connorsRsi':
            return predicate.predicate === 'level'
                ? readConnorsRsiLevel(ctx)
                : null;
        case 'forceIndex':
            return predicate.predicate === 'level'
                ? readForceIndexLevel(ctx)
                : null;
        case 'elderRay':
            return predicate.predicate === 'level'
                ? readElderRayLevel(ctx)
                : null;
        case 'elderImpulse':
            return predicate.predicate === 'level'
                ? readElderImpulseLevel(ctx)
                : null;
        case 'chandelier':
            return predicate.predicate === 'level'
                ? readChandelierLevel(ctx)
                : null;
        case 'hurst':
            return predicate.predicate === 'level' ? readHurstLevel(ctx) : null;
        case 'varianceRatio':
            return predicate.predicate === 'level'
                ? readVarianceRatioLevel(ctx)
                : null;
        case 'regression':
            return predicate.predicate === 'level'
                ? readRegressionLevel(ctx)
                : null;
        case 'yangZhang':
            return predicate.predicate === 'level'
                ? readYangZhangLevel(ctx)
                : null;
        case 'ewma':
            return predicate.predicate === 'level' ? readEwmaLevel(ctx) : null;
        default:
            return null;
    }
}

/**
 * @internal
 * Decide whether a textbook *state* predicate is currently notable for the
 * analyzed chart: {@link readIndicatorState} found a state. Any missing / null /
 * degenerate input yields `false` rather than throwing, so an under-warmed
 * indicator never spuriously loads a gated skill.
 *
 * @param predicate - The `(feature, predicate)` pair from a skill's `gating.state`.
 * @param ctx - Read-only chart selection context.
 * @returns `true` when the feature has reached its textbook extreme.
 */
export function isStateNotable(
    predicate: SkillStatePredicate,
    ctx: SkillSelectionContext
): boolean {
    return readIndicatorState(predicate, ctx) !== null;
}
