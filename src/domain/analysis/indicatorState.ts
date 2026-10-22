// All AI-facing prompt strings must be in English — Korean reduces analysis quality.

import {
    RSI_OVERBOUGHT_LEVEL,
    RSI_OVERSOLD_LEVEL,
    STOCHASTIC_OVERBOUGHT_LEVEL,
    STOCHASTIC_OVERSOLD_LEVEL,
} from '@/domain/indicators/constants';
import { rsiZone } from '@/domain/indicators/rsiZone';
import { GAP_MIN_ATR_MULT } from '@/domain/signals/constants';
import { ADX_TRENDING_THRESHOLD } from '@/domain/analysis/marketReferenceConstants';
import {
    formatNullableNumber,
    formatQuotedPrice,
    formatSignedNumber,
    type PriceQuoting,
} from '@/domain/analysis/promptFormat';
import { classifyStackOrder } from '@/domain/analysis/trendStructure';
import type {
    BollingerResult,
    DMIResult,
    IchimokuResult,
    MACDResult,
    ParabolicSARResult,
    StochasticResult,
    SupertrendResult,
} from '@/domain/types';

/**
 * @internal
 * ADX below this reads as a weak/non-trending regime. Paired with
 * {@link ADX_TRENDING_THRESHOLD} (≥25 trending); the band between the two is
 * "between" rather than forced into one side.
 */
export const ADX_WEAK_THRESHOLD = 20;

/** @internal Section header — exported so callers/tests reference the exact string. */
export const INDICATOR_STATE_SECTION_HEADER = '## Indicator State (computed)';

const PCT_DP = 2;
const PERCENT_FACTOR = 100;

function isFinite(n: number | null | undefined): n is number {
    return typeof n === 'number' && Number.isFinite(n);
}

function isFinitePositive(n: number | null | undefined): n is number {
    return isFinite(n) && n > 0;
}

/**
 * @internal `above by x.xx%` / `below by x.xx%` of `price` vs a positive
 * `level`, or `null` when either input cannot support a ratio (null rule).
 * `price` must itself be positive too — a
 * non-finite or ≤ 0 price/quote is an unknown reference, not a real "below"
 * reading.
 */
function distanceFromLevel(
    price: number | null | undefined,
    level: number | null | undefined
): string | null {
    if (!isFinitePositive(price) || !isFinitePositive(level)) return null;
    const pct = ((price - level) / level) * PERCENT_FACTOR;
    const side = pct >= 0 ? 'above' : 'below';
    return `${side} by ${formatNullableNumber(Math.abs(pct), PCT_DP)}%`;
}

/**
 * @internal Last non-null, finite value of a warm-up-padded series, or
 * `null` (a `NaN` in the series must not read as
 * a real "last value").
 */
function lastValueOf(series: (number | null)[] | undefined): number | null {
    if (!series) return null;
    return series.findLast(isFinite) ?? null;
}

function maEmaLine(
    label: 'MA' | 'EMA',
    price: number | null | undefined,
    periods: readonly number[],
    series: Record<number, (number | null)[]>
): string {
    const parts = periods.map(p => {
        const dist = distanceFromLevel(price, lastValueOf(series[p]));
        return `${label}(${p}) ${dist ?? 'N/A'}`;
    });
    return `- Price vs ${label}: ${parts.join(' / ')}`;
}

/**
 * @internal `bullish (MA5>MA20>MA60>MA120)` / `bearish (…<…)` /
 * `mixed (MA20>MA200>MA60…)`, or `'N/A'` when fewer than 2 of `periods` have
 * a value. Only periods with a value are included. `bullish`/`bearish` keep
 * the caller's period order; `mixed` lists the MAs from highest to lowest
 * value, so the model reads the actual order instead of inferring one — a
 * bare `mixed` was narrated as "정배열" (MSTR, 2026-10-02).
 */
function stackLine(
    label: 'MA' | 'EMA',
    periods: readonly number[],
    series: Record<number, (number | null)[]>
): string {
    const points = periods
        .map(p => ({ p, v: lastValueOf(series[p]) }))
        .filter((x): x is { p: number; v: number } => x.v !== null);
    const verdict = classifyStackOrder(points.map(x => x.v));
    if (verdict === null) return `- ${label} stack: N/A`;
    if (verdict === 'mixed') {
        const byValue = points.toSorted((a, b) => b.v - a.v);
        return `- ${label} stack: mixed (${byValue.map(x => `${label}${x.p}`).join('>')})`;
    }
    const labels = points.map(x => `${label}${x.p}`);
    const joiner = verdict === 'bullish' ? '>' : '<';
    return `- ${label} stack: ${verdict} (${labels.join(joiner)})`;
}

/**
 * @internal `- MA spreads: MA5 above MA20 by x.xx% / MA60 below MA120 by …` —
 * each MA's distance from the next-longer one, adjacent pairs in period
 * order. The model has only price-vs-MA distances otherwise and turned
 * "price 36.1% above MA60" into "the MA20–MA60 gap is 36%" (MSTR,
 * 2026-10-02); giving the real MA-to-MA figure leaves nothing to derive.
 * Written as a sentence ("A below B by x%") rather than "A vs B below by x%":
 * the latter was read backwards ("MA60 대비 MA120 9.02% 아래") in the A/B run.
 * Pairs missing either value are skipped; `N/A` when no pair survives.
 */
function maSpreadLine(
    label: 'MA' | 'EMA',
    periods: readonly number[],
    series: Record<number, (number | null)[]>
): string {
    const parts = periods.slice(1).flatMap((longer, i) => {
        const shorter = periods[i];
        const dist = distanceFromLevel(
            lastValueOf(series[shorter]),
            lastValueOf(series[longer])
        );
        if (!dist) return [];
        // dist is `above by x%` / `below by x%` — put the other MA between side and amount
        const [side, amount] = dist.split(' by ');
        return [`${label}${shorter} ${side} ${label}${longer} by ${amount}`];
    });
    return `- ${label} spreads: ${parts.length ? parts.join(' / ') : 'N/A'}`;
}

/** @internal Histogram trend as already classified by the caller's own `detectTrend`. */
export type IndicatorTrendState = 'rising' | 'falling' | 'flat' | null;

function macdLine(
    macd: MACDResult | undefined,
    histogramTrend: IndicatorTrendState
): string {
    const vsSignal =
        macd && isFinite(macd.macd) && isFinite(macd.signal)
            ? macd.macd >= macd.signal
                ? 'above signal'
                : 'below signal'
            : 'signal N/A';
    const vsZero =
        macd && isFinite(macd.macd)
            ? macd.macd >= 0
                ? 'above zero'
                : 'below zero'
            : 'zero N/A';
    const histogram =
        histogramTrend === null
            ? 'histogram N/A'
            : `histogram ${histogramTrend}`;
    return `- MACD: ${vsSignal}, ${vsZero}, ${histogram}`;
}

function dmiLine(dmi: DMIResult | undefined): string {
    const vsMinus =
        dmi && isFinite(dmi.diPlus) && isFinite(dmi.diMinus)
            ? dmi.diPlus >= dmi.diMinus
                ? '+DI above -DI'
                : '+DI below -DI'
            : '+DI N/A';
    const adxLabel =
        dmi && isFinite(dmi.adx)
            ? dmi.adx >= ADX_TRENDING_THRESHOLD
                ? `ADX ${formatNullableNumber(dmi.adx, PCT_DP)} trending`
                : dmi.adx < ADX_WEAK_THRESHOLD
                  ? `ADX ${formatNullableNumber(dmi.adx, PCT_DP)} weak`
                  : `ADX ${formatNullableNumber(dmi.adx, PCT_DP)} between`
            : 'ADX N/A';
    return `- DMI: ${vsMinus}, ${adxLabel}`;
}

function stochasticLine(stochastic: StochasticResult | undefined): string {
    const vs =
        stochastic &&
        isFinite(stochastic.percentK) &&
        isFinite(stochastic.percentD)
            ? stochastic.percentK >= stochastic.percentD
                ? '%K above %D'
                : '%K below %D'
            : '%K N/A';
    const zone =
        stochastic && isFinite(stochastic.percentK)
            ? stochastic.percentK >= STOCHASTIC_OVERBOUGHT_LEVEL
                ? 'overbought'
                : stochastic.percentK <= STOCHASTIC_OVERSOLD_LEVEL
                  ? 'oversold'
                  : 'neutral'
            : 'N/A';
    return `- Stochastic: ${vs}, zone ${zone}`;
}

function ichimokuLine(
    ichimoku: IchimokuResult | undefined,
    price: number | null | undefined
): string {
    const cloudHigh =
        ichimoku && isFinite(ichimoku.senkouA) && isFinite(ichimoku.senkouB)
            ? Math.max(ichimoku.senkouA, ichimoku.senkouB)
            : null;
    const cloudLow =
        ichimoku && isFinite(ichimoku.senkouA) && isFinite(ichimoku.senkouB)
            ? Math.min(ichimoku.senkouA, ichimoku.senkouB)
            : null;
    const vsCloud =
        cloudHigh !== null && cloudLow !== null && isFinitePositive(price)
            ? price > cloudHigh
                ? 'above cloud'
                : price < cloudLow
                  ? 'below cloud'
                  : 'inside cloud'
            : 'N/A';
    const vsKijun =
        ichimoku && isFinite(ichimoku.tenkan) && isFinite(ichimoku.kijun)
            ? ichimoku.tenkan >= ichimoku.kijun
                ? 'tenkan above kijun'
                : 'tenkan below kijun'
            : 'tenkan N/A';
    return `- Ichimoku: price ${vsCloud}, ${vsKijun}`;
}

function bollingerLine(
    bollinger: BollingerResult | undefined,
    price: number | null | undefined
): string {
    if (
        !bollinger ||
        !isFinite(bollinger.upper) ||
        !isFinite(bollinger.middle) ||
        !isFinite(bollinger.lower) ||
        !isFinitePositive(price)
    ) {
        return '- Bollinger: N/A';
    }
    const position =
        price > bollinger.upper
            ? 'above upper'
            : price >= bollinger.middle
              ? 'upper half'
              : price >= bollinger.lower
                ? 'lower half'
                : 'below lower';
    return `- Bollinger: price position ${position}`;
}

function levelDistanceLine(
    label: string,
    level: number | null | undefined,
    price: number | null | undefined
): string {
    return `- ${label}: ${distanceFromLevel(price, level) ?? 'N/A'}`;
}

function atrPctLine(
    atr: number | null | undefined,
    price: number | null | undefined
): string {
    const pct =
        isFinite(atr) && isFinitePositive(price)
            ? (atr / price) * PERCENT_FACTOR
            : null;
    return `- ATR % of price: ${pct === null ? 'N/A' : `${formatNullableNumber(pct, PCT_DP)}%`}`;
}

// ─── MACD cycle (macd-cycle.md skill's data-source line) ──────────────────

/** @internal EMA periods the MACD-cycle line is built from (fixed by the skill design — never the configured MA_DEFAULT_PERIODS). */
const MACD_CYCLE_EMA_SHORT = 9;
const MACD_CYCLE_EMA_MID = 21;
const MACD_CYCLE_EMA_LONG = 60;

type Sign = 1 | -1 | 0;

/** @internal `0` is its own sign — the stage table below has no "exactly zero" row, so it must fall through to "no matching stage", never round into `+`/`-`. */
function signOf(n: number): Sign {
    if (n > 0) return 1;
    if (n < 0) return -1;
    return 0;
}

/** @internal The 6-stage sign table from macd-cycle.md, verbatim. */
const MACD_CYCLE_STAGES: readonly {
    upper: Sign;
    middle: Sign;
    lower: Sign;
    stage: number;
}[] = [
    { upper: 1, middle: 1, lower: 1, stage: 1 },
    { upper: -1, middle: 1, lower: 1, stage: 2 },
    { upper: -1, middle: -1, lower: 1, stage: 3 },
    { upper: -1, middle: -1, lower: -1, stage: 4 },
    { upper: 1, middle: -1, lower: -1, stage: 5 },
    { upper: 1, middle: 1, lower: -1, stage: 6 },
];

/**
 * `- MACD cycle (EMA9/21/60): upper (EMA9−EMA21) ±x, middle (EMA9−EMA60) ±y,
 * lower (EMA21−EMA60) ±z; stage N` — the exact line
 * `skills/strategies/macd-cycle.md` cites instead of computing MACD(상/중/하)
 * itself. `stage N/A (transition)` when the three signs match none of the
 * six table rows (two of the eight sign combinations are transition-only, by
 * design — see the skill file).
 */
function macdCycleLine(
    ema: Record<number, (number | null)[]>,
    diffDp: number
): string {
    const short = lastValueOf(ema[MACD_CYCLE_EMA_SHORT]);
    const mid = lastValueOf(ema[MACD_CYCLE_EMA_MID]);
    const long = lastValueOf(ema[MACD_CYCLE_EMA_LONG]);
    const label = `MACD cycle (EMA${MACD_CYCLE_EMA_SHORT}/${MACD_CYCLE_EMA_MID}/${MACD_CYCLE_EMA_LONG})`;
    if (short === null || mid === null || long === null) {
        return `- ${label}: N/A`;
    }

    const upper = short - mid;
    const middle = short - long;
    const lower = mid - long;
    const match = MACD_CYCLE_STAGES.find(
        s =>
            s.upper === signOf(upper) &&
            s.middle === signOf(middle) &&
            s.lower === signOf(lower)
    );
    const stageLabel = match
        ? `stage ${match.stage}`
        : 'stage N/A (transition)';

    return `- ${label}: upper (EMA${MACD_CYCLE_EMA_SHORT}−EMA${MACD_CYCLE_EMA_MID}) ${formatSignedNumber(upper, diffDp)}, middle (EMA${MACD_CYCLE_EMA_SHORT}−EMA${MACD_CYCLE_EMA_LONG}) ${formatSignedNumber(middle, diffDp)}, lower (EMA${MACD_CYCLE_EMA_MID}−EMA${MACD_CYCLE_EMA_LONG}) ${formatSignedNumber(lower, diffDp)}; ${stageLabel}`;
}

// ─── Volume vs 20-bar average ──────────────────────────────────────────────

/** @internal Exported so callers can size how much history to pass through `priorVolumes`. */
export const VOLUME_AVG_WINDOW = 20;

/**
 * `- Volume: last bar x.xx× 20-bar average` — `N/A` unless the trailing
 * {@link VOLUME_AVG_WINDOW} bars (from whatever history `priorVolumes`
 * carries) are all finite and their average is > 0 (null rule).
 *
 * Slices its own window from `priorVolumes` —
 * this used to require the CALLER to pass exactly 20 already-sliced
 * elements, coupling `prompt.ts` to this module's window size; now the
 * caller can pass raw history and this module owns the slicing.
 */
function volumeLine(
    lastVolume: number | null | undefined,
    priorVolumes: readonly (number | null | undefined)[]
): string {
    if (!isFinite(lastVolume)) return '- Volume: N/A';
    const window = priorVolumes.slice(-VOLUME_AVG_WINDOW);
    const usable =
        window.length === VOLUME_AVG_WINDOW &&
        window.every((v): v is number => isFinite(v));
    if (!usable) return '- Volume: N/A';
    const average =
        window.reduce((sum: number, v) => sum + (v as number), 0) /
        VOLUME_AVG_WINDOW;
    if (!(average > 0)) return '- Volume: N/A';
    const ratio = lastVolume / average;
    return `- Volume: last bar ${formatNullableNumber(ratio, PCT_DP)}× 20-bar average`;
}

/** MA periods of the 이동평균선 대순환 (MA cycle) strategy: short, medium, long. */
const MA_CYCLE_PERIODS = { short: 5, medium: 20, long: 60 } as const;

type MaCycleRole = keyof typeof MA_CYCLE_PERIODS;

type MaCycleOrder =
    | 'short>medium>long'
    | 'medium>short>long'
    | 'medium>long>short'
    | 'long>medium>short'
    | 'long>short>medium'
    | 'short>long>medium';

/** MA cycle stage by top-to-bottom role order (skills/strategies/ma-cycle.md stage table). */
const MA_CYCLE_STAGE: Readonly<Record<MaCycleOrder, number>> = {
    'short>medium>long': 1,
    'medium>short>long': 2,
    'medium>long>short': 3,
    'long>medium>short': 4,
    'long>short>medium': 5,
    'short>long>medium': 6,
};

function isMaCycleOrder(key: string): key is MaCycleOrder {
    return Object.hasOwn(MA_CYCLE_STAGE, key);
}

const MA_CYCLE_LABEL = `- MA cycle (${(['short', 'medium', 'long'] as const)
    .map(role => `MA${MA_CYCLE_PERIODS[role]}`)
    .join('/')})`;

/**
 * @internal `- MA cycle (MA5/MA20/MA60): MA5>MA20>MA60; stage 1` — the
 * 이동평균선 대순환 stage, which is fixed by the order of the three MAs alone.
 * The model read the order off the values itself and wrote "MA5 44.24 >
 * MA60 39.97 > MA20 40.90" with the stage that order implies, in every IONQ
 * run of the 2026-10-02 A/B. `N/A` on a missing value or a tie.
 */
function maCycleLine(series: Record<number, (number | null)[]>): string {
    const pts = (['short', 'medium', 'long'] as const).map(role => ({
        role,
        p: MA_CYCLE_PERIODS[role],
        v: lastValueOf(series[MA_CYCLE_PERIODS[role]]),
    }));
    const valued = pts.filter(
        (x): x is { role: MaCycleRole; p: (typeof x)['p']; v: number } =>
            x.v !== null
    );
    if (valued.length < pts.length) return `${MA_CYCLE_LABEL}: N/A`;
    const sorted = valued.toSorted((a, b) => b.v - a.v);
    if (sorted[0].v === sorted[1].v || sorted[1].v === sorted[2].v)
        return `${MA_CYCLE_LABEL}: N/A (two MAs equal)`;
    const order = sorted.map(x => x.role).join('>');
    if (!isMaCycleOrder(order)) return `${MA_CYCLE_LABEL}: N/A`;
    const stage = MA_CYCLE_STAGE[order];
    return `${MA_CYCLE_LABEL}: ${sorted.map(x => `MA${x.p}`).join('>')}; stage ${stage}`;
}

/** @internal `- RSI(14): 64.83 neutral (overbought ≥ 70, oversold ≤ 30)` — so "과열" is never said of a sub-70 RSI. */
function rsiLine(rsi: number | null | undefined): string {
    if (!isFinite(rsi)) return '- RSI zone: N/A';
    const zone = rsiZone(rsi);
    return `- RSI zone: ${formatNullableNumber(rsi, PCT_DP)} ${zone} (overbought ≥ ${RSI_OVERBOUGHT_LEVEL}, oversold ≤ ${RSI_OVERSOLD_LEVEL})`;
}

/** @internal High/low of one bar, for the gap line. */
export interface BarRange {
    high: number;
    low: number;
}

/**
 * @internal `- Gap (last bar vs previous bar): up 3.52 = 0.39× ATR …` — the
 * same rule as the engine's `gap_up`/`gap_down` signals (last low above the
 * previous high, or last high below the previous low, by ≥ 0.25× ATR). The
 * gap skill used to leave this comparison to the model, which saw a 3.52
 * gap over a 2.25 minimum and called it "no gap" (MSTR, 2026-10-02 A/B).
 */
function gapLine(
    last: BarRange | undefined,
    prev: BarRange | undefined,
    atr: number | null | undefined,
    quoting: PriceQuoting,
    dp: number
): string {
    const label = '- Gap (last bar vs previous bar)';
    if (
        !last ||
        !prev ||
        ![last.high, last.low, prev.high, prev.low].every(isFinite)
    )
        return `${label}: N/A`;
    const up = last.low - prev.high;
    const down = prev.low - last.high;
    if (up <= 0 && down <= 0) return `${label}: none (the two bars overlap)`;
    const size = up > 0 ? up : down;
    // The bar prices print at the gap's own (difference) precision, as they
    // always have, but still on the listing's KRX tick table.
    const px = (n: number): string => formatQuotedPrice(n, { ...quoting, dp });
    const desc =
        up > 0
            ? `up — last low ${px(last.low)} above previous high ${px(prev.high)} by ${formatNullableNumber(size, dp)}`
            : `down — last high ${px(last.high)} below previous low ${px(prev.low)} by ${formatNullableNumber(size, dp)}`;
    if (!isFinitePositive(atr)) return `${label}: ${desc} (ATR N/A)`;
    const mult = size / atr;
    // Same comparison as `detectGapUp`/`detectGapDown` (size vs mult × ATR, not
    // the rounded ratio), so the line can never disagree with the engine signal
    // at the boundary.
    const counts =
        size >= GAP_MIN_ATR_MULT * atr
            ? `counts as a gap (≥ ${GAP_MIN_ATR_MULT}× ATR)`
            : `below the ${GAP_MIN_ATR_MULT}× ATR minimum — not a gap`;
    return `${label}: ${desc} = ${formatNullableNumber(mult, PCT_DP)}× ATR, ${counts}`;
}

/** @internal Input to {@link buildIndicatorStateSection}. Every field is nullable/optional per the null rule. */
export interface IndicatorStateInput {
    /** Last bar close. */
    price: number | null | undefined;
    /** MA series keyed by period (same shape as `IndicatorResult.ma`). */
    ma: Record<number, (number | null)[]>;
    /** EMA series keyed by period (same shape as `IndicatorResult.ema`). */
    ema: Record<number, (number | null)[]>;
    /** Periods rendered in `## Indicator Values` (`MA_DEFAULT_PERIODS`). */
    maPeriods: readonly number[];
    /** Periods rendered in `## Indicator Values` (`EMA_DEFAULT_PERIODS`). */
    emaPeriods: readonly number[];
    macd: MACDResult | undefined;
    /**
     * MACD histogram trend as already computed by the caller's `detectTrend`
     * — reused rather than re-derived, so the two renderings of
     * "rising/falling" can never disagree.
     */
    macdHistogramTrend: IndicatorTrendState;
    dmi: DMIResult | undefined;
    stochastic: StochasticResult | undefined;
    ichimoku: IchimokuResult | undefined;
    bollinger: BollingerResult | undefined;
    supertrend: SupertrendResult | undefined;
    parabolicSar: ParabolicSARResult | undefined;
    /** Latest ATR value. */
    atr: number | null | undefined;
    /** How prices are quoted (decimals and KRX tick table) — the gap line's bar prices. */
    quoting: PriceQuoting;
    /** Decimal places for the MACD-cycle upper/middle/lower differences (same "difference precision" the rest of the technical prompt uses). */
    diffDp: number;
    /** Last bar's volume. */
    lastVolume: number | null | undefined;
    /**
     * Bar volumes immediately before the last bar (oldest first) — any
     * length is fine; `volumeLine` slices its own trailing
     * {@link VOLUME_AVG_WINDOW}-bar window.
     * `N/A` when fewer than {@link VOLUME_AVG_WINDOW} are available.
     */
    priorVolumes: readonly (number | null | undefined)[];
    /** Latest RSI(14); `null`/`undefined` renders `N/A`. */
    rsi: number | null | undefined;
    /** Last and previous bar high/low for the gap line; `undefined` renders `N/A`. */
    lastBar: BarRange | undefined;
    prevBar: BarRange | undefined;
}

/**
 * @internal
 * Renders `## Indicator State (computed)` — every above/below, cross and
 * zone comparison the model used to work out from `## Indicator Values`
 * itself (price vs MA/EMA, MA stack, MACD vs signal/zero, DMI/ADX regime,
 * Stochastic zone, Ichimoku cloud position, Bollinger position,
 * Supertrend/PSAR distance, ATR % of price). Pure: no I/O, deterministic for
 * the same input. Every line is `N/A` when its inputs are missing or
 * non-finite.
 */
export function buildIndicatorStateSection(input: IndicatorStateInput): string {
    return [
        INDICATOR_STATE_SECTION_HEADER,
        maEmaLine('MA', input.price, input.maPeriods, input.ma),
        maEmaLine('EMA', input.price, input.emaPeriods, input.ema),
        stackLine('MA', input.maPeriods, input.ma),
        maSpreadLine('MA', input.maPeriods, input.ma),
        stackLine('EMA', input.emaPeriods, input.ema),
        maCycleLine(input.ma),
        rsiLine(input.rsi),
        macdLine(input.macd, input.macdHistogramTrend),
        dmiLine(input.dmi),
        stochasticLine(input.stochastic),
        ichimokuLine(input.ichimoku, input.price),
        bollingerLine(input.bollinger, input.price),
        levelDistanceLine(
            'Supertrend',
            input.supertrend?.supertrend,
            input.price
        ),
        levelDistanceLine(
            'Parabolic SAR',
            input.parabolicSar?.sar,
            input.price
        ),
        atrPctLine(input.atr, input.price),
        macdCycleLine(input.ema, input.diffDp),
        volumeLine(input.lastVolume, input.priorVolumes),
        gapLine(
            input.lastBar,
            input.prevBar,
            input.atr,
            input.quoting,
            input.diffDp
        ),
    ].join('\n');
}
