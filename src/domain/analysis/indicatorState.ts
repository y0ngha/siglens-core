// All AI-facing prompt strings must be in English — Korean reduces analysis quality.

import {
    STOCHASTIC_OVERBOUGHT_LEVEL,
    STOCHASTIC_OVERSOLD_LEVEL,
} from '@/domain/indicators/constants';
import { ADX_TRENDING_THRESHOLD } from '@/domain/analysis/marketReferenceConstants';
import {
    formatNullableNumber,
    formatSignedNumber,
} from '@/domain/analysis/promptFormat';
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
 * `price` must itself be positive too (spec 2026-09-18) — a
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
 * `null` (spec 2026-09-18 — a `NaN` in the series must not read as
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

type StackVerdict = 'bullish' | 'bearish' | 'mixed';

/**
 * @internal `bullish (MA5>MA20>MA60>MA120)` / `bearish (…<…)` / `mixed`, or
 * `'N/A'` when fewer than 2 of `periods` have a value. Only periods with a
 * value are included, in the caller's period order (spec §2.2).
 */
function stackLine(
    label: 'MA' | 'EMA',
    periods: readonly number[],
    series: Record<number, (number | null)[]>
): string {
    const points = periods
        .map(p => ({ p, v: lastValueOf(series[p]) }))
        .filter((x): x is { p: number; v: number } => x.v !== null);
    if (points.length < 2) return `- ${label} stack: N/A`;

    const decreasing = points.every((x, i) => i === 0 || x.v < points[i - 1].v);
    const increasing = points.every((x, i) => i === 0 || x.v > points[i - 1].v);
    const verdict: StackVerdict = decreasing
        ? 'bullish'
        : increasing
          ? 'bearish'
          : 'mixed';
    if (verdict === 'mixed') return `- ${label} stack: mixed`;
    const labels = points.map(x => `${label}${x.p}`);
    const joiner = verdict === 'bullish' ? '>' : '<';
    return `- ${label} stack: ${verdict} (${labels.join(joiner)})`;
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
 * Slices its own window from `priorVolumes` (spec 2026-09-18) —
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
     * — reused rather than re-derived (spec §2.2), so the two renderings of
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
    /** Decimal places for the MACD-cycle upper/middle/lower differences (same "difference precision" the rest of the technical prompt uses). */
    diffDp: number;
    /** Last bar's volume. */
    lastVolume: number | null | undefined;
    /**
     * Bar volumes immediately before the last bar (oldest first) — any
     * length is fine; `volumeLine` slices its own trailing
     * {@link VOLUME_AVG_WINDOW}-bar window (spec 2026-09-18).
     * `N/A` when fewer than {@link VOLUME_AVG_WINDOW} are available.
     */
    priorVolumes: readonly (number | null | undefined)[];
}

/**
 * @internal
 * Renders `## Indicator State (computed)` — every above/below, cross and
 * zone comparison the model used to work out from `## Indicator Values`
 * itself (price vs MA/EMA, MA stack, MACD vs signal/zero, DMI/ADX regime,
 * Stochastic zone, Ichimoku cloud position, Bollinger position,
 * Supertrend/PSAR distance, ATR % of price). Pure: no I/O, deterministic for
 * the same input. Every line is `N/A` when its inputs are missing or
 * non-finite (spec §0 null rule).
 */
export function buildIndicatorStateSection(input: IndicatorStateInput): string {
    return [
        INDICATOR_STATE_SECTION_HEADER,
        maEmaLine('MA', input.price, input.maPeriods, input.ma),
        maEmaLine('EMA', input.price, input.emaPeriods, input.ema),
        stackLine('MA', input.maPeriods, input.ma),
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
    ].join('\n');
}
