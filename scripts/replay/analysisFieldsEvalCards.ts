/**
 * The card checks of the `gating` mode and the card-trend baseline of the `output` mode
 * (WP-16 §9.1, D5 to D9): what a computed indicator card or cycle card must equal, recomputed
 * from the printed prompt lines and from OHLC. Every rule here is the instrument's own copy
 * (thresholds in `analysisFieldsEvalTypes.ts`); a card is only ever the thing compared with.
 *
 * A kind's state is recomputed from its own printed lines with the instrument's thresholds.
 * Where the state also needs history the prompt does not print (the previous Force Index
 * sign, the Elder-Ray turn, a Chandelier flip within three bars, a volatility regime against
 * its 20-bar mean), the reading carries every state the printed lines allow and is marked
 * `partial`: the card's state must be one of them (a necessary condition, not a recomputation).
 */
import { emaSeries } from './analysisFieldsEvalCompute';
import { lineStarting, numbersOnLine } from './analysisFieldsEvalPrompt';
import {
    FIELDS_EVAL_CONSTANTS as C,
    type TrendLabel,
} from './analysisFieldsEvalTypes';
import { MACD_CONVERGENCE_TYPES } from '@/domain/analysis/indicatorCards';
import { cciCrossHolds } from '@/domain/analysis/indicatorReadingsEvent';
import { findCciCross } from '@/domain/signals/confirmed';
import type { IndicatorGuideResult, RawStrategyResult } from '@/domain/types';

export const ALWAYS_ON_KINDS = [
    'ma',
    'ema',
    'adx',
    'atr',
    'obv',
    'volume_profile',
] as const;
export type AlwaysOnKind = (typeof ALWAYS_ON_KINDS)[number];

/** Indicator kinds fired by detected signals: the state is the type of a fired signal. */
export const EVENT_KINDS = [
    'rsi',
    'macd',
    'cci',
    'cmf',
    'dmi',
    'ichimoku',
    'mfi',
    'parabolic_sar',
    'squeeze_momentum',
    'supertrend',
    'bollinger_percent_b',
] as const;

/** Indicator kinds fired by a textbook extreme. */
export const STATE_KINDS = [
    'stochastic',
    'stoch_rsi',
    'williams_r',
    'connors_rsi',
    'bollinger',
    'keltner',
    'donchian',
    'vwap',
    'buy_sell_volume',
    'macd_v',
    'force_index',
    'elder_ray',
    'elder_impulse',
    'chandelier',
    'hurst',
    'variance_ratio',
    'regression',
    'yang_zhang',
    'ewma',
] as const;

export const CYCLE_KINDS = ['ma_cycle', 'macd_cycle'] as const;
export type CycleKind = (typeof CYCLE_KINDS)[number];

const isAlwaysOnKind = (kind: string): kind is AlwaysOnKind =>
    ALWAYS_ON_KINDS.some(k => k === kind);
const isEventKind = (kind: string): boolean =>
    EVENT_KINDS.some(k => k === kind);
export const isCycleKind = (kind: string): kind is CycleKind =>
    CYCLE_KINDS.some(k => k === kind);

/**
 * Skill names of the kinds D7 measured before the catalog carried `computed_card` tags
 * (core-0 baseline on main); a tagged catalog takes the kind of a skill from its tag.
 */
export const CARD_TREND_SKILLS: Readonly<Record<string, AlwaysOnKind>> = {
    'MA Signal Guide': 'ma',
    'EMA Signal Guide': 'ema',
    'ADX Signal Guide': 'adx',
    'OBV Signal Guide': 'obv',
};

export const CYCLE_STRATEGY_SKILLS: Readonly<Record<string, CycleKind>> = {
    '이동평균선 대순환 분석': 'ma_cycle',
    'MACD 대순환 분석': 'macd_cycle',
};

const STAGE_TREND: Readonly<Record<number, TrendLabel>> = {
    1: 'bullish',
    2: 'neutral',
    3: 'bearish',
    4: 'bearish',
    5: 'neutral',
    6: 'bullish',
};

// ─── Printed lines ────────────────────────────────────────────────────────────

const num = (text: string): number => Number(text.replaceAll(',', ''));

const NUM = '(-?\\d[\\d,]*(?:\\.\\d+)?|N/A)';

/** The numeric captures of a match (`null` for a printed `N/A`), or `null` when nothing matched. */
function captures(
    prompt: string,
    pattern: RegExp
): readonly (number | null)[] | null {
    const found = pattern.exec(prompt);
    return found === null
        ? null
        : found.slice(1).map(v => (v === 'N/A' ? null : num(v)));
}

const present = (values: readonly (number | null)[]): readonly number[] =>
    values.filter((v): v is number => v !== null);

export interface PrintedReading {
    /** The state the printed values give, with the instrument's own thresholds. */
    state: string;
    /** Other states the printed values allow (a `partial` reading), besides `state`. */
    alsoStates?: readonly string[];
    /** Numbers printed on the source lines (a card's non-null values must be among them). */
    numbers: readonly number[];
    /** The trend a card of this kind takes (WP-16 §3.4), `null` when the allowed states disagree on a side. */
    trend: TrendLabel | null;
    /** An event kind: the trigger types the printed signal lists name (the card's signals must be exactly these). */
    signalTypes?: readonly string[];
    /**
     * An event kind: the fired triggers the prompt lists as `Newly lit on this bar`. When there
     * are any, the card's state must be one of them (an older event never leads) and the trend
     * is read from them alone.
     */
    newlyLit?: readonly string[];
    /** `true` when the state can only be bounded from the printed lines, not recomputed. */
    partial?: boolean;
    /** Elder Impulse: the colour the line says it flipped from, `null` for "no flip". */
    flippedFrom?: string | null;
}

/** What a reader may need beyond the prompt text. */
export interface ReadContext {
    /** An event skill's trigger ids (`gating.triggers`). */
    triggers?: readonly string[];
    /**
     * The CCI series of the bars the prompt saw, oldest first. With it a fired CCI cross counts
     * toward the trend only while it still holds on the last bar (the card's rule); without it
     * every fired cross counts.
     */
    cci?: readonly (number | null)[];
}

/** The close the prompt printed (`## Analysis Snapshot`), or `null`. */
export function printedClose(prompt: string): number | null {
    return (
        captures(
            prompt,
            new RegExp(`^- Snapshot Price \\([^)]*\\): ${NUM}`, 'm')
        )?.[0] ?? null
    );
}

const sideOf = (word: string): TrendLabel =>
    word === 'bullish' ? 'bullish' : word === 'bearish' ? 'bearish' : 'neutral';

function stackOf(prompt: string, name: 'MA' | 'EMA'): PrintedReading | null {
    const stack = lineStarting(prompt, `- ${name} stack: `)?.match(
        /^- (?:MA|EMA) stack: (bullish|bearish|mixed)/
    );
    if (stack === null || stack === undefined) return null;
    const values = lineStarting(prompt, `- ${name}: `);
    const close = printedClose(prompt);
    return {
        state: stack[1] === 'mixed' ? 'mixed' : `${stack[1]}_stack`,
        numbers: [
            ...(values === null ? [] : numbersOnLine(values)),
            ...(close === null ? [] : [close]),
        ],
        trend: sideOf(stack[1]),
    };
}

/** An oscillator at or beyond a bound is overbought (bearish) or oversold (bullish). */
function levelReading(
    kind: string,
    value: number,
    hi: number,
    lo: number,
    numbers: readonly number[]
): PrintedReading {
    const state =
        value >= hi ? 'overbought' : value <= lo ? 'oversold' : 'between';
    return {
        state,
        numbers,
        trend: trendOfState(kind, state),
    };
}

/**
 * Kinds D7 measured as opposite to the model's own trend on more than 5% of at least 30
 * stored cards (member run `2026-11-22-wp15-c2-after2`; before the fallback: stochastic 20.5%,
 * williams_r 7.3%, stoch_rsi 6.4%, bollinger 41.6%, macd_v 34.2%, elder_ray 74.5%,
 * chandelier 7.3%). The pre-registered fallback maps them to `neutral`.
 */
const NEUTRAL_AFTER_D7: ReadonlySet<string> = new Set([
    'stochastic',
    'stoch_rsi',
    'williams_r',
    'bollinger',
    'macd_v',
    'elder_ray',
    'chandelier',
]);

/**
 * The instrument's own state-to-side table (WP-16 §3.4). Oscillator-like kinds read
 * overbought as bearish and oversold as bullish; a kind with a direction in its state takes it;
 * the regime and volatility kinds are neutral.
 */
function trendOfState(kind: string, state: string): TrendLabel {
    // D7's pre-registered fallback: these kinds' rule was opposite to the model's trend on
    // more than 5% of at least 30 stored cards, so a card of the kind is neutral.
    if (NEUTRAL_AFTER_D7.has(kind)) return 'neutral';
    const rising = [
        'overbought',
        'above',
        'beyond_upper',
        'near_upper',
        'buy_dominant',
        'high_positive',
        'turned_positive',
        'bear_power_rising',
        'green',
        'flipped_long',
        'strong_fit_up',
    ];
    const falling = [
        'oversold',
        'below',
        'beyond_lower',
        'near_lower',
        'sell_dominant',
        'high_negative',
        'turned_negative',
        'bull_power_falling',
        'red',
        'flipped_short',
        'strong_fit_down',
    ];
    const meanReverting = new Set(['connors_rsi']);
    if (meanReverting.has(kind)) {
        return state === 'overbought' || state === 'above_band_pctb'
            ? 'bearish'
            : state === 'oversold' || state === 'below_band_pctb'
              ? 'bullish'
              : 'neutral';
    }
    return rising.includes(state)
        ? 'bullish'
        : falling.includes(state)
          ? 'bearish'
          : 'neutral';
}

/** One side when the allowed states agree on it, else `null`. */
function commonSide(
    kind: string,
    states: readonly string[]
): TrendLabel | null {
    const sides = new Set(states.map(state => trendOfState(kind, state)));
    return sides.size === 1 ? ([...sides][0] ?? null) : null;
}

function printedSignals(prompt: string): {
    bullish: readonly string[];
    bearish: readonly string[];
    freshBullish: readonly string[];
    freshBearish: readonly string[];
} {
    const names = (label: string): readonly string[] => {
        const line = lineStarting(prompt, `${label}: `) ?? '';
        return [
            ...line.slice(label.length + 2).matchAll(/([a-z][a-z0-9_]*)\(/g),
        ].map(m => m[1]);
    };
    return {
        bullish: names('Bullish signals'),
        bearish: names('Bearish signals'),
        freshBullish: names('Newly lit on this bar (bullish)'),
        freshBearish: names('Newly lit on this bar (bearish)'),
    };
}

/** The numbers an event kind prints on its own value line, plus the signals it fired. */
function eventReading(
    kind: string,
    prompt: string,
    context: ReadContext,
    values: readonly (number | null)[] | null
): PrintedReading | null {
    const { triggers, cci } = context;
    const signals = printedSignals(prompt);
    const fired = (triggers ?? []).filter(
        t => signals.bullish.includes(t) || signals.bearish.includes(t)
    );
    if (fired.length === 0 || values === null) return null;
    const fresh = fired.filter(
        t =>
            signals.freshBullish.includes(t) || signals.freshBearish.includes(t)
    );
    // The card's own rules, through the shipped functions: a CCI cross counts only while it
    // holds on the last bar (listed ones lead the state), and MACD histogram convergence names
    // no side. Side from the events that fired on this bar when there are any, else from all.
    const holds = (t: string): boolean => {
        if (kind !== 'cci' || cci === undefined) return true;
        // The detector's own search (level order, lookback), shared with the card.
        const at = findCciCross(t, cci)?.index;
        return at === undefined || cciCrossHolds(t, cci, at);
    };
    const counted = fired.filter(holds);
    const freshCounted = counted.filter(t => fresh.includes(t));
    const side = (freshCounted.length > 0 ? freshCounted : counted).filter(
        t => kind !== 'macd' || !MACD_CONVERGENCE_TYPES.has(t)
    );
    const bullish = side.some(t => signals.bullish.includes(t));
    const bearish = side.some(t => signals.bearish.includes(t));
    return {
        state: fired[0],
        alsoStates: fired.slice(1),
        numbers: present(values),
        trend:
            bullish === bearish ? 'neutral' : bullish ? 'bullish' : 'bearish',
        signalTypes: fired,
        ...(fresh.length > 0 ? { newlyLit: fresh } : {}),
    };
}

const EVENT_LINES: Readonly<Record<string, string>> = {
    rsi: `^- RSI\\(\\d+\\): ${NUM}`,
    macd: `^- MACD: ${NUM} / Signal ${NUM} / Histogram ${NUM}`,
    cci: `^- CCI\\(\\d+\\): ${NUM}`,
    cmf: `^- CMF\\(\\d+\\): ${NUM}`,
    dmi: `^- DMI: \\+DI ${NUM} / -DI ${NUM} / ADX ${NUM}`,
    ichimoku: `^- Ichimoku\\([^)]*\\): Tenkan ${NUM} / Kijun ${NUM} / SpanA ${NUM} / SpanB ${NUM}`,
    mfi: `^- MFI\\(\\d+\\): ${NUM}`,
    parabolic_sar: `^- Parabolic SAR: ${NUM}`,
    squeeze_momentum: `^- Squeeze Momentum\\([^)]*\\): momentum ${NUM}`,
    supertrend: `^- Supertrend\\([^)]*\\): ${NUM}`,
    bollinger_percent_b: `^- Bollinger %B \\([^)]*\\): ${NUM}`,
};

/** A band line (`Upper u / Middle m / Lower l`) of the named indicator: its upper and lower, or `null`. */
function bandOf(
    prompt: string,
    label: string
): { upper: number; lower: number } | null {
    const found = captures(
        prompt,
        new RegExp(
            `^- ${label}: Upper ${NUM} / Middle ${NUM} / Lower ${NUM}`,
            'm'
        )
    );
    const [upper, , lower] = found ?? [null, null, null];
    return upper === null || lower === null ? null : { upper, lower };
}

/** The side of a close on a channel: beyond a band, or within `margin` of one (the nearer band). */
function channelState(
    close: number,
    band: { upper: number; lower: number },
    margin: number
): string {
    if (close >= band.upper) return 'beyond_upper';
    if (close <= band.lower) return 'beyond_lower';
    const [toUpper, toLower] = [band.upper - close, close - band.lower];
    if (toUpper > margin && toLower > margin) return 'between';
    return toUpper <= toLower ? 'near_upper' : 'near_lower';
}

function printedAtr(prompt: string): number | null {
    return (
        captures(prompt, new RegExp(`^- ATR\\(\\d+\\): ${NUM}`, 'm'))?.[0] ??
        null
    );
}

/** A state the printed lines settle, with its numbers and the side it stands for. */
function settled(
    kind: string,
    state: string,
    numbers: readonly number[]
): PrintedReading {
    return { state, numbers, trend: trendOfState(kind, state) };
}

/** A state the printed lines only bound: every allowed state, none of them recomputable. */
function bounded(
    kind: string,
    states: readonly string[],
    numbers: readonly number[]
): PrintedReading {
    return {
        state: states[0],
        alsoStates: states.slice(1),
        numbers,
        trend: commonSide(kind, states),
        partial: true,
    };
}

/**
 * A kind's reading from its own printed lines, or `null` when they are absent or `N/A` (or
 * the kind has no reader: see `hasReader`).
 */
export function printedKind(
    prompt: string,
    kind: string,
    context: ReadContext = {}
): PrintedReading | null {
    if (kind === 'ma') return stackOf(prompt, 'MA');
    if (kind === 'ema') return stackOf(prompt, 'EMA');
    if (kind === 'adx') {
        const dmi = prompt.match(
            /^- DMI: \+DI ([\d.]+) \/ -DI ([\d.]+) \/ ADX ([\d.]+)/m
        );
        if (dmi === null) return null;
        const [plus, minus, adx] = [num(dmi[1]), num(dmi[2]), num(dmi[3])];
        const state =
            adx >= C.cards.adxTrending
                ? 'trending'
                : adx < C.cards.adxWeak
                  ? 'weak'
                  : 'between';
        return {
            state,
            numbers: [plus, minus, adx],
            trend:
                state === 'weak'
                    ? 'neutral'
                    : plus > minus
                      ? 'bullish'
                      : plus < minus
                        ? 'bearish'
                        : 'neutral',
        };
    }
    if (kind === 'atr' || kind === 'obv') {
        const found = prompt.match(
            kind === 'atr'
                ? /^- ATR\(14\): (-?[\d.,]+) \[(rising|falling|flat)\]/m
                : /^- OBV: (-?[\d.,]+) \[(rising|falling|flat)\]/m
        );
        if (found === null) return null;
        const pct = prompt.match(/^- ATR % of price: ([\d.]+)%/m);
        return {
            state: found[2],
            numbers: [
                num(found[1]),
                ...(kind === 'atr' && pct !== null ? [num(pct[1])] : []),
            ],
            trend:
                kind === 'atr'
                    ? 'neutral'
                    : found[2] === 'rising'
                      ? 'bullish'
                      : found[2] === 'falling'
                        ? 'bearish'
                        : 'neutral',
        };
    }
    if (kind === 'volume_profile') {
        const profile = prompt.match(
            /^- Volume Profile \(all (\d+) bars\): POC (-?[\d.,]+) \/ VAH (-?[\d.,]+) \/ VAL (-?[\d.,]+)/m
        );
        const close = printedClose(prompt);
        if (profile === null || close === null) return null;
        const [poc, vah, val] = [
            num(profile[2]),
            num(profile[3]),
            num(profile[4]),
        ];
        const state =
            close > vah
                ? 'above_value_area'
                : close < val
                  ? 'below_value_area'
                  : 'inside_value_area';
        return {
            state,
            numbers: [num(profile[1]), poc, vah, val, close],
            trend:
                state === 'above_value_area'
                    ? 'bullish'
                    : state === 'below_value_area'
                      ? 'bearish'
                      : 'neutral',
        };
    }
    if (isEventKind(kind)) {
        return eventReading(
            kind,
            prompt,
            context,
            captures(prompt, new RegExp(EVENT_LINES[kind], 'm'))
        );
    }
    return printedStateKind(prompt, kind);
}

/** The state kinds: recomputed (or bounded) from the printed lines. */
function printedStateKind(prompt: string, kind: string): PrintedReading | null {
    const close = printedClose(prompt);
    if (kind === 'stochastic' || kind === 'stoch_rsi') {
        const found =
            kind === 'stochastic'
                ? prompt.match(
                      /^- Stochastic\([\d,]+\): %K (-?[\d.]+) \/ %D (-?[\d.]+)/m
                  )
                : prompt.match(
                      /^- StochRSI\([\d,]+\): K (-?[\d.]+) \/ D (-?[\d.]+)/m
                  );
        if (found === null) return null;
        const [k, d] = [num(found[1]), num(found[2])];
        const [hi, lo] =
            kind === 'stochastic'
                ? [C.cards.stochasticOverbought, C.cards.stochasticOversold]
                : [C.cards.stochRsiOverbought, C.cards.stochRsiOversold];
        return levelReading(kind, k, hi, lo, [k, d]);
    }
    if (kind === 'williams_r') {
        const found = prompt.match(/^- Williams %R\(\d+\): (-?[\d.]+)/m);
        if (found === null) return null;
        const value = num(found[1]);
        return levelReading(
            kind,
            value,
            C.cards.williamsROverbought,
            C.cards.williamsROversold,
            [value]
        );
    }
    if (kind === 'connors_rsi') {
        const v = captures(
            prompt,
            new RegExp(`^- Connors RSI: ${NUM}`, 'm')
        )?.[0];
        return v === null || v === undefined
            ? null
            : levelReading(
                  kind,
                  v,
                  C.cards.crsiOverbought,
                  C.cards.crsiOversold,
                  [v]
              );
    }
    if (kind === 'buy_sell_volume') {
        const found = prompt.match(/\(Buy ratio: ([\d.]+)%\)/);
        if (found === null) return null;
        const ratio = num(found[1]) / 100;
        const state =
            ratio >= C.cards.buySellBullish
                ? 'buy_dominant'
                : ratio <= C.cards.buySellBearish
                  ? 'sell_dominant'
                  : 'balanced';
        return {
            state,
            numbers: [num(found[1])],
            trend:
                state === 'buy_dominant'
                    ? 'bullish'
                    : state === 'sell_dominant'
                      ? 'bearish'
                      : 'neutral',
        };
    }
    if (kind === 'bollinger') {
        // The engine's own %B is the printed truth (DOM-8): the state is its printed value
        // against the daily bounds, not a recomputation on the printed band edges.
        const band = bandOf(prompt, 'Bollinger Bands');
        const pctB = captures(
            prompt,
            new RegExp(`^- Bollinger %B \\([^)]*\\): ${NUM}`, 'm')
        )?.[0];
        if (pctB === null || pctB === undefined) return null;
        const state =
            pctB >= C.cards.bollingerPctBHigh
                ? 'above_band_pctb'
                : pctB <= C.cards.bollingerPctBLow
                  ? 'below_band_pctb'
                  : 'between';
        return settled(kind, state, [
            pctB,
            ...(band === null ? [] : [band.upper, band.lower]),
            ...(close === null ? [] : [close]),
        ]);
    }
    if (kind === 'keltner' || kind === 'donchian') {
        const band = bandOf(
            prompt,
            kind === 'keltner'
                ? 'Keltner Channel\\([^)]*\\)'
                : 'Donchian Channel\\([^)]*\\)'
        );
        const atr = printedAtr(prompt);
        if (band === null || close === null) return null;
        if (kind === 'keltner' && (atr === null || atr <= 0)) return null;
        const margin =
            kind === 'keltner'
                ? C.cards.keltnerNearAtr * (atr ?? 0)
                : C.cards.donchianNearFraction * (band.upper - band.lower);
        return settled(kind, channelState(close, band, margin), [
            band.upper,
            band.lower,
            close,
            ...(kind === 'keltner' && atr !== null ? [atr] : []),
        ]);
    }
    if (kind === 'vwap') {
        const vwap = captures(prompt, new RegExp(`^- VWAP: ${NUM}`, 'm'))?.[0];
        const atr = printedAtr(prompt);
        if (vwap === null || vwap === undefined || close === null) return null;
        if (atr === null || atr <= 0) return null;
        const state =
            Math.abs(close - vwap) < C.cards.vwapAtr * atr
                ? 'between'
                : close > vwap
                  ? 'above'
                  : 'below';
        return settled(kind, state, [vwap, atr, close]);
    }
    if (kind === 'macd_v') {
        const v = captures(prompt, new RegExp(`^- MACD-V: ${NUM}`, 'm'))?.[0];
        if (v === null || v === undefined) return null;
        const state =
            v >= C.cards.macdVLevel
                ? 'high_positive'
                : v <= -C.cards.macdVLevel
                  ? 'high_negative'
                  : 'between';
        return settled(kind, state, [v]);
    }
    if (kind === 'force_index') {
        const found = prompt.match(
            /^- Force Index: (-?[\d,]+) \[(buying pressure|selling pressure|neutral)\]/m
        );
        if (found === null) return null;
        const state =
            found[2] === 'buying pressure'
                ? 'turned_positive'
                : found[2] === 'selling pressure'
                  ? 'turned_negative'
                  : 'none';
        return { ...settled(kind, state, [num(found[1])]), partial: true };
    }
    if (kind === 'elder_ray') {
        const found = captures(
            prompt,
            new RegExp(
                `^- Elder-Ray: Bull Power ${NUM} / Bear Power ${NUM}`,
                'm'
            )
        );
        if (found === null) return null;
        const [bull, bear] = found;
        // The turn against the previous bar is not printed: only the signs are a necessary condition.
        const [bearTurn, bullTurn] = [
            bear !== null && bear < 0,
            bull !== null && bull > 0,
        ];
        const states = [
            ...(bearTurn ? ['bear_power_rising'] : []),
            ...(bullTurn ? ['bull_power_falling'] : []),
            ...(bearTurn && bullTurn ? ['both'] : []),
        ];
        return states.length === 0
            ? null
            : bounded(kind, states, present(found));
    }
    if (kind === 'elder_impulse') {
        const found = prompt.match(
            /^- Elder Impulse: (green|red|blue)(?: \(flipped from (green|red|blue)\))?/m
        );
        return found === null
            ? null
            : { ...settled(kind, found[1], []), flippedFrom: found[2] ?? null };
    }
    if (kind === 'chandelier') {
        const found = prompt.match(
            /^- Chandelier Exit: (?:long|short) stop (-?[\d.,]+) \(trend: (long|short)\)/m
        );
        return found === null
            ? null
            : bounded(kind, [`flipped_${found[2]}`], [num(found[1])]);
    }
    if (kind === 'hurst' || kind === 'variance_ratio') {
        const found = captures(
            prompt,
            new RegExp(`^- Regime: Hurst ${NUM} / Variance Ratio ${NUM}`, 'm')
        );
        const value = found?.[kind === 'hurst' ? 0 : 1];
        if (value === null || value === undefined) return null;
        const [centre, margin] =
            kind === 'hurst'
                ? [0.5, C.cards.hurstMargin]
                : [1, C.cards.varianceRatioMargin];
        const state =
            value - centre >= margin - 1e-9
                ? 'trending'
                : centre - value >= margin - 1e-9
                  ? 'mean_reverting'
                  : 'between';
        return settled(kind, state, [value]);
    }
    if (kind === 'regression') {
        const found = prompt.match(
            /^- Regime: .*? R² (-?[\d.]+) (?:high|low) \([^)]*?slope (up|down|flat)/m
        );
        if (found === null || found[2] === 'flat') return null;
        const r2 = num(found[1]);
        const state =
            r2 < C.cards.regressionR2
                ? 'between'
                : found[2] === 'up'
                  ? 'strong_fit_up'
                  : 'strong_fit_down';
        return settled(kind, state, [r2]);
    }
    if (kind === 'yang_zhang' || kind === 'ewma') {
        const found = captures(
            prompt,
            new RegExp(
                `^- Volatility \\(per-bar σ\\): Yang-Zhang ${NUM}%(?: \\[[a-z]+\\])? / EWMA ${NUM}%`,
                'm'
            )
        );
        const value = found?.[kind === 'yang_zhang' ? 0 : 1];
        return value === null || value === undefined
            ? null
            : bounded(kind, ['high_volatility', 'low_volatility'], [value]);
    }
    return null;
}

/** The indicator-card kinds whose state, values and trend the instrument reads from their own printed lines. */
export const READER_KINDS: readonly string[] = [
    ...ALWAYS_ON_KINDS,
    ...EVENT_KINDS,
    ...STATE_KINDS,
];

export const hasReader = (kind: string): boolean => READER_KINDS.includes(kind);

/** A kind D7 can give a trend for: an indicator reader, or a cycle stage table. */
export const hasTrendRule = (kind: string): boolean =>
    hasReader(kind) || isCycleKind(kind);

/**
 * D7 baseline: the trend a card of this skill takes from the printed lines, with the model's
 * own calibration of cardtrend (ADX below 20 is neutral, whatever the DI side). `null` when the
 * lines are absent or the states they allow disagree on a side.
 */
export function ruleTrendOfKind(
    kind: string,
    prompt: string,
    context: ReadContext = {}
): TrendLabel | null {
    if (isCycleKind(kind)) {
        const stage = printedCycle(prompt, kind).stage;
        return stage === null ? null : STAGE_TREND[stage];
    }
    return printedKind(prompt, kind, context)?.trend ?? null;
}

export interface PrintedCycle {
    /** `null` when the line is absent, `N/A` or a transition. */
    stage: number | null;
    numbers: readonly number[];
    /** `ma_cycle`: the line's order from highest to lowest (`short`, `medium`, `long`), `[]` otherwise or when absent. */
    order: readonly string[];
}

const MA_ROLE_OF_PERIOD: Readonly<Record<number, string>> = {
    5: 'short',
    20: 'medium',
    60: 'long',
};

/** The `- MA cycle` / `- MACD cycle` line of `## Indicator State`. */
export function printedCycle(prompt: string, kind: CycleKind): PrintedCycle {
    const line =
        lineStarting(
            prompt,
            kind === 'ma_cycle' ? '- MA cycle (' : '- MACD cycle ('
        ) ?? '';
    const stage = line.match(/; stage (\d)\s*$/);
    const maValues = lineStarting(prompt, '- MA: ');
    return {
        stage: stage === null ? null : Number(stage[1]),
        numbers:
            kind === 'macd_cycle'
                ? [
                      ...line.matchAll(
                          /\((?:EMA\d+−EMA\d+)\) ([+-]?\d[\d,]*(?:\.\d+)?)/g
                      ),
                  ].map(m => num(m[1]))
                : maValues === null
                  ? []
                  : numbersOnLine(maValues),
        order:
            kind === 'ma_cycle'
                ? [...line.matchAll(/MA(\d+)(?=[>;])/g)].map(
                      m => MA_ROLE_OF_PERIOD[Number(m[1])] ?? m[1]
                  )
                : [],
    };
}

// ─── Cycle recomputation ──────────────────────────────────────────────────────

const smaAt = (
    closes: readonly number[],
    i: number,
    period: number
): number | null =>
    i + 1 < period
        ? null
        : closes.slice(i + 1 - period, i + 1).reduce((s, v) => s + v, 0) /
          period;

const MA_STAGE_BY_ORDER: Readonly<Record<string, number>> = {
    '0>1>2': 1,
    '1>0>2': 2,
    '1>2>0': 3,
    '2>1>0': 4,
    '2>0>1': 5,
    '0>2>1': 6,
};

/** Stage of the three MA values (short, medium, long), `null` on a missing value or a tie. */
export function maStage(values: readonly (number | null)[]): number | null {
    if (values.some(v => v === null)) return null;
    const ranked = values
        .map((value, role) => ({ value: value ?? 0, role }))
        .toSorted((a, b) => b.value - a.value);
    if (
        ranked[0].value === ranked[1].value ||
        ranked[1].value === ranked[2].value
    ) {
        return null;
    }
    return MA_STAGE_BY_ORDER[ranked.map(r => r.role).join('>')] ?? null;
}

const MACD_STAGE_BY_SIGNS: Readonly<Record<string, number>> = {
    '+++': 1,
    '-++': 2,
    '--+': 3,
    '---': 4,
    '+--': 5,
    '++-': 6,
};

/** Stage of the EMA(9, 21, 60) values, `null` on a missing value or a zero difference. */
export function macdStage(values: readonly (number | null)[]): number | null {
    if (values.some(v => v === null)) return null;
    const [short, mid, long] = values.map(v => v ?? 0);
    const sign = (n: number): string => (n > 0 ? '+' : n < 0 ? '-' : '0');
    return (
        MACD_STAGE_BY_SIGNS[
            `${sign(short - mid)}${sign(short - long)}${sign(mid - long)}`
        ] ?? null
    );
}

/** The stage at every bar of `closes` (the bars a prompt saw). */
export function cycleStageSeries(
    kind: CycleKind,
    closes: readonly number[]
): readonly (number | null)[] {
    if (kind === 'ma_cycle') {
        return closes.map((_, i) =>
            maStage(C.cards.maCyclePeriods.map(p => smaAt(closes, i, p)))
        );
    }
    const series = C.cards.macdCycleEmaPeriods.map(p => emaSeries(closes, p));
    return closes.map((_, i) => macdStage(series.map(s => s[i])));
}

export interface CycleHistory {
    stage: number | null;
    previousStage: number | null;
    barsInStage: number | null;
    progression: 'forward' | 'reverse' | null;
    stageChanges: number;
}

/**
 * The stage history the cycle reading carries (WP-16 §4, the orchestrator's decision):
 * the window is the last `lookback` bars by bar count, the current bar included. Bars with no
 * stage (a transition) are ignored everywhere: they neither end a run nor count as a change.
 * `stageChanges` is the number of changes between consecutive stages, `previousStage` the
 * stage of the run before the current one, and `barsInStage` the bars with a stage in the
 * current run, `null` when the run reaches the first bar of the window (or of the series).
 * The stage values themselves come from the whole series: the moving averages need the bars
 * before the window.
 */
export function cycleHistory(
    stages: readonly (number | null)[],
    lookback: number
): CycleHistory {
    const window = stages.slice(-lookback);
    const runs = window.reduce<
        { stage: number; bars: number; first: number }[]
    >((acc, stage, i) => {
        if (stage === null) return acc;
        const last = acc[acc.length - 1];
        return last !== undefined && last.stage === stage
            ? [...acc.slice(0, -1), { ...last, bars: last.bars + 1 }]
            : [...acc, { stage, bars: 1, first: i }];
    }, []);
    const current = window.length === 0 ? null : window[window.length - 1];
    const run = current === null ? undefined : runs[runs.length - 1];
    const previous =
        current === null ? null : (runs[runs.length - 2]?.stage ?? null);
    const step =
        current === null || previous === null
            ? 0
            : (((current - previous) % 6) + 6) % 6;
    return {
        stage: current,
        previousStage: previous,
        barsInStage: run === undefined || run.first === 0 ? null : run.bars,
        progression: step === 1 ? 'forward' : step === 5 ? 'reverse' : null,
        stageChanges: Math.max(0, runs.length - 1),
    };
}

// ─── Observed cards ───────────────────────────────────────────────────────────

export interface ObservedIndicatorCard {
    name: string | null;
    kind: string | null;
    state: string | null;
    trend: string | null;
    /** `null` when the card has no reading (an old row shape or a malformed card). */
    values: Readonly<Record<string, number | null>> | null;
    /** The types of the signals the reading lists (`null` without a reading). */
    signalTypes: readonly string[] | null;
    /** Elder Impulse: the colour the reading says it flipped from; `undefined` for every other kind. */
    flippedFrom: string | null | undefined;
}

/**
 * The cards of an assembled prompt (`AssembledPromptRecord.indicatorCards`), read as the typed
 * value core hands out. Each card is reduced to the fields the checks compare; the typed shape is
 * pinned by `analysisFieldsEvalRender.test.ts`, so a renamed field breaks the build rather than
 * silently reading `undefined`.
 */
export function readIndicatorCards(
    cards: readonly IndicatorGuideResult[]
): ObservedIndicatorCard[] {
    return cards.map(card => {
        const signal = card.signals[0];
        const reading = signal?.reading;
        return {
            name: card.indicatorName,
            kind: reading?.kind ?? null,
            state: reading?.state ?? null,
            trend: signal?.trend ?? null,
            values: reading === undefined ? null : { ...reading.values },
            signalTypes: reading?.signals.map(s => s.type) ?? null,
            flippedFrom:
                reading?.kind === 'elder_impulse'
                    ? reading.flippedFrom
                    : undefined,
        };
    });
}

export interface ObservedCycleCard {
    name: string | null;
    kind: string | null;
    trend: string | null;
    stage: number | null;
    previousStage: number | null;
    barsInStage: number | null;
    progression: string | null;
    stageChanges: number | null;
    hasCycle: boolean;
    values: Readonly<Record<string, number>> | null;
    order: readonly string[] | null;
}

export function readCycleCards(
    cards: readonly RawStrategyResult[]
): ObservedCycleCard[] {
    return cards.map(card => ({
        name: card.strategyName,
        kind: card.cycle?.kind ?? null,
        trend: card.trend,
        stage: card.cycle?.stage ?? null,
        previousStage: card.cycle?.previousStage ?? null,
        barsInStage: card.cycle?.barsInStage ?? null,
        progression: card.cycle?.progression ?? null,
        stageChanges: card.cycle?.stageChanges ?? null,
        hasCycle: card.cycle !== undefined,
        values: card.cycle === undefined ? null : { ...card.cycle.values },
        order: card.cycle?.order ?? null,
    }));
}

// ─── Checks ───────────────────────────────────────────────────────────────────

/** A tagged skill of the catalog as the checks need it. */
export interface TaggedGuide {
    name: string;
    computedCard: string;
    /** An event guide's trigger ids (`gating.triggers`); empty for every other kind. */
    triggers?: readonly string[];
}

export interface IndicatorCardCheck {
    /** One card per injected tagged guide, none for an always-on `N/A` line, none otherwise. */
    cardSet: { expected: number; observed: number; violations: number };
    /** Cards whose values are printed on their kind's own lines and whose state matches. */
    values: {
        cards: number;
        valueMismatches: number;
        stateMismatches: number;
        /** Cards whose kind is only bounded by the printed lines (a necessary condition, not a recomputation). */
        partial: number;
        /** Cards of a kind the instrument has no reader for: neither values nor state are checked. */
        unreadable: number;
    };
    naAlwaysOn: number;
    /** Event cards whose state is not one of the events the prompt lists as newly lit on this bar. */
    newlyLitMismatches: number;
    /** Cards (all kinds) whose trend is not the rule's trend for the same printed lines. */
    trendMismatches: number;
}

/** D5 and D6 on one prompt: `injected` are the tagged guides whose digest the prompt carries. */
export function checkIndicatorCards(input: {
    prompt: string;
    injected: readonly TaggedGuide[];
    cards: readonly ObservedIndicatorCard[];
}): IndicatorCardCheck {
    const readOf = (guide: TaggedGuide): PrintedReading | null | undefined =>
        hasReader(guide.computedCard)
            ? printedKind(input.prompt, guide.computedCard, {
                  triggers: guide.triggers,
              })
            : undefined;
    const printed = new Map(input.injected.map(g => [g.name, readOf(g)]));
    // An always-on guide whose source line is N/A (or absent) gets no card.
    const naAlwaysOn = input.injected.filter(
        g => isAlwaysOnKind(g.computedCard) && printed.get(g.name) === null
    );
    const expected = input.injected.filter(g => !naAlwaysOn.includes(g));
    const names = input.cards.map(card => card.name);
    const duplicates = names.length - new Set(names).size;
    const missing = expected.filter(g => !names.includes(g.name)).length;
    const extra = input.cards.filter(
        card => !expected.some(g => g.name === card.name)
    ).length;
    const checked = input.cards.map(card => {
        const guide = expected.find(g => g.name === card.name);
        const reference =
            guide === undefined ? undefined : printed.get(guide.name);
        const readable = reference !== undefined;
        const numbers = new Set(reference?.numbers ?? []);
        const allowed =
            reference === null || reference === undefined
                ? []
                : [reference.state, ...(reference.alsoStates ?? [])];
        return {
            readable,
            partial: reference?.partial === true,
            valueMismatch:
                card.values === null ||
                (guide !== undefined && card.kind !== guide.computedCard) ||
                (readable &&
                    (reference === null ||
                        Object.values(card.values).some(
                            v => v !== null && !numbers.has(v)
                        ) ||
                        (reference.signalTypes !== undefined &&
                            !sameSet(
                                card.signalTypes,
                                reference.signalTypes
                            )) ||
                        (reference.flippedFrom !== undefined &&
                            card.flippedFrom !== reference.flippedFrom))),
            stateMismatch:
                readable &&
                (reference === null ||
                    card.state === null ||
                    !allowed.includes(card.state)),
            newlyLitMismatch:
                reference !== null &&
                reference !== undefined &&
                reference.newlyLit !== undefined &&
                (card.state === null ||
                    !reference.newlyLit.includes(card.state)),
            trendMismatch:
                readable &&
                reference !== null &&
                reference.trend !== null &&
                card.trend !== reference.trend,
        };
    });
    return {
        cardSet: {
            expected: expected.length,
            observed: input.cards.length,
            violations: duplicates + missing + extra,
        },
        values: {
            cards: input.cards.length,
            valueMismatches: checked.filter(c => c.valueMismatch).length,
            stateMismatches: checked.filter(c => c.stateMismatch).length,
            partial: checked.filter(c => c.partial).length,
            unreadable: checked.filter(c => !c.readable).length,
        },
        naAlwaysOn: naAlwaysOn.length,
        newlyLitMismatches: checked.filter(c => c.newlyLitMismatch).length,
        trendMismatches: checked.filter(c => c.trendMismatch).length,
    };
}

/** Whether `observed` names exactly the types of `expected`, as sets. */
function sameSet(
    observed: readonly string[] | null,
    expected: readonly string[]
): boolean {
    return (
        observed !== null &&
        new Set(observed).size === observed.length &&
        observed.length === expected.length &&
        expected.every(type => observed.includes(type))
    );
}

/** The cycle kinds a prompt's strategy block says code builds a card for (`The MA cycle and MACD cycle cards are built by code`). */
export function noteCycleKinds(prompt: string): readonly CycleKind[] {
    const note = prompt.match(
        /^- The (MA cycle|MACD cycle)(?: and (MA cycle|MACD cycle))? cards? (?:is|are) built by code/m
    );
    return note === null
        ? []
        : [note[1], note[2]].flatMap(label =>
              label === 'MA cycle'
                  ? ['ma_cycle' as const]
                  : label === 'MACD cycle'
                    ? ['macd_cycle' as const]
                    : []
          );
}

export interface CycleCardCheck {
    cards: number;
    /** A card where the printed stage is absent or N/A. */
    withoutPrintedStage: number;
    stageMismatches: number;
    historyMismatches: number;
    trendMismatches: number;
    /** Values that are not printed numbers, and an order that is not the printed one. */
    valueMismatches: number;
    /** Cards missing for a cycle the strategy note names with a printed stage, duplicated, or without a note. */
    setViolations: number;
}

/** D8 on one prompt. `closes` are the closes of the bars the prompt saw, oldest first. */
export function checkCycleCards(input: {
    prompt: string;
    closes: readonly number[];
    cards: readonly ObservedCycleCard[];
}): CycleCardCheck {
    const rows = input.cards.map(card => {
        const kind =
            card.kind !== null && isCycleKind(card.kind) ? card.kind : null;
        const printed = kind === null ? null : printedCycle(input.prompt, kind);
        const history =
            kind === null
                ? null
                : cycleHistory(
                      cycleStageSeries(kind, input.closes),
                      C.cards.cycleLookbackBars
                  );
        const stage = printed?.stage ?? null;
        const numbers = new Set(printed?.numbers ?? []);
        return {
            without: kind === null || stage === null,
            stage: card.stage !== stage,
            history:
                history === null ||
                history.previousStage !== card.previousStage ||
                history.barsInStage !== card.barsInStage ||
                history.progression !== card.progression ||
                history.stageChanges !== card.stageChanges,
            trend: stage === null || card.trend !== STAGE_TREND[stage],
            values:
                card.values === null ||
                Object.values(card.values).some(v => !numbers.has(v)) ||
                (kind === 'ma_cycle' &&
                    (card.order === null ||
                        card.order.join('>') !== printed?.order.join('>'))),
        };
    });
    const expectedKinds = noteCycleKinds(input.prompt).filter(
        kind => printedCycle(input.prompt, kind).stage !== null
    );
    const observedKinds = input.cards.map(card => card.kind);
    const missing = expectedKinds.filter(kind => !observedKinds.includes(kind));
    const extra = observedKinds.filter(
        kind => kind === null || !expectedKinds.some(k => k === kind)
    );
    const duplicates = observedKinds.length - new Set(observedKinds).size;
    return {
        cards: rows.length,
        withoutPrintedStage: rows.filter(r => r.without).length,
        stageMismatches: rows.filter(r => !r.without && r.stage).length,
        historyMismatches: rows.filter(r => !r.without && r.history).length,
        trendMismatches: rows.filter(r => !r.without && r.trend).length,
        valueMismatches: rows.filter(r => !r.without && r.values).length,
        setViolations: missing.length + extra.length + duplicates,
    };
}
