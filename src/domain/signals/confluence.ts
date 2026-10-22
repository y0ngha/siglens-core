import type {
    Bar,
    IndicatorResult,
    SignalType,
    TrendState,
} from '@/domain/types';
import { calculateIndicators } from '@/domain/indicators';
import { calculateMA } from '@/domain/indicators/ma';
import { classifyTrend } from '@/domain/signals/trend';
import { detectSignals } from '@/domain/signals';

/**
 * Minimum weighted **indicator-family** count required for a trigger.
 *
 * Deliberately not a count of signal *types*. The 36 members of {@link SignalType} this
 * rule counts (the four 52-week-extreme and gap types are left out of the tally) derive
 * from only 14 indicators — RSI contributes 4 types, MACD 4, Bollinger 6 — so
 * counting types treats transforms of the same close series as independent votes. In
 * practice a sizeable share of the snapshots that reached "3 types" spanned only two indicators
 * (`bollinger_lower_bounce` + `bollinger_percentb_oversold` + `rsi_oversold`).
 *
 * Family counting can only tighten the rule: type count is always ≥ family count, so a
 * combination that failed before can never start passing. **That is why the default is 2.5
 * rather than the 3 the type-counting rule used** — keeping 3 while switching the unit
 * silently raised the bar twice. Measured: 3 families cut entry triggers to 17% of the
 * type-counting rate; 2.5 lands at 75%, which is the intended "slightly tighter", not
 * "effectively off".
 *
 * Fractional values are meaningful because the count is weighted — 2.5 is "two confirmed
 * indicators plus one anticipated", the shape the type rule used to accept as three.
 */
export const CONFLUENCE_MIN = 2.5;

/**
 * Half-width of the continuous score band around the neutral 50, yielding 35..65.
 *
 * The trigger snaps ({@link CONFLUENCE_TRIGGER_SCORE} /
 * {@link CONFLUENCE_EXIT_SCORE}) are the part backed by backtesting; the continuous
 * band is not. A wider band lets a single indicator cross carry most of the distance to
 * a buy decision, so it stays narrow until measurement says otherwise.
 */
export const CONFLUENCE_SPAN = 15;

/**
 * Pseudo-count added to the denominator so a lone directional signal does not snap to
 * the extremes of the band.
 */
export const CONFLUENCE_SHRINK = 1;

/** Score a snapshot receives when the bullish entry rule holds exactly. */
export const CONFLUENCE_TRIGGER_SCORE = 92;

/** Score a snapshot receives when the bearish inverse holds exactly. */
export const CONFLUENCE_EXIT_SCORE = 8;

/**
 * Vote weight of an `expected`-phase signal; `confirmed` signals weigh 1.
 *
 * `expected` members describe an anticipated or positional condition rather than a
 * completed event — `support_proximity_bullish` means "price sits near support", which
 * is a state, not a cross. Weighing it like a confirmed MACD cross overstates the
 * evidence. It is halved rather than dropped because some members (divergences) do
 * carry genuine leading information.
 */
export const CONFLUENCE_EXPECTED_WEIGHT = 0.5;

/**
 * Minimum bar count before the detector catalogue is complete enough to count.
 *
 * The `bollinger_squeeze_*` detectors read a 120-bar bandwidth percentile and stay
 * structurally silent below that, so a "3 bearish types" tally taken on 80 bars is not
 * a weaker reading — it is a differently defined one. Short history abstains.
 */
export const CONFLUENCE_MIN_BARS = 120;

/**
 * Weighted family count the **exit** trigger requires. Lower than {@link CONFLUENCE_MIN}.
 *
 * Entry and exit must not share one threshold. Tightening entry is a deliberate act;
 * tightening exit is a defect — a missed entry costs opportunity, a missed exit costs
 * money. When the two shared a knob, raising the entry bar silently raised the exit bar
 * with it and sharply cut liquidation signals.
 *
 * The default keeps the exit side at roughly the sensitivity it had when the rule counted
 * raw signal types, while still benefiting from the family/phase correction.
 */
export const CONFLUENCE_EXIT_MIN = 2.5;

/** Simple-moving-average period used as the same-timeframe trend filter. */
export const CONFLUENCE_TREND_MA_PERIOD = 50;

/**
 * Indicator families derived from volume.
 *
 * Used by the optional entry gate: a confluence that no volume indicator supports is
 * more likely to fade than to follow through.
 */
export const VOLUME_FAMILIES: ReadonlySet<string> = new Set(['cmf', 'mfi']);

/**
 * How the higher-timeframe trend gates the entry trigger.
 *
 * - `'uptrend'` — the entry requires the higher timeframe to be in an uptrend
 *   ("trade with the larger trend").
 * - `'notUptrend'` — the entry requires it **not** to be in an uptrend: bullish
 *   confluence on top of an already-extended higher timeframe is treated as a late chase.
 *
 * Either way an unclassifiable trend (`null`) passes, and the exit trigger ignores the
 * mode entirely — every tightening here is entry-only.
 */
export type ConfluenceHtfMode = 'uptrend' | 'notUptrend';

/**
 * Default {@link ConfluenceHtfMode}. Kept at `'uptrend'` so existing consumers and the
 * daily backtest are unchanged.
 *
 * **Measurement does not back this default on intraday bars** — it is the default only
 * because changing it silently would move every consumer at once. Measured on 16 US
 * symbols × one year of completed 1-hour bars (27,190 bars, 2025-09 → 2026-09, entry
 * window only, first trigger per symbol-day, excess return over each symbol's own mean):
 * requiring a daily uptrend selected entries at **−0.54% over the next day** (n=230,
 * t −2.1, negative with any one symbol left out) and −1.03% over two; turning the gate
 * off measured +0.10% (n=641, noise); excluding the uptrend measured +0.45% (n=413,
 * t 2.2, median ≈ 0 — the mean comes from the right tail). The direction holds without
 * any confluence at all: a daily `uptrend` state preceded −0.19% next-day excess (3 of
 * 16 symbols positive), a `downtrend` state +0.18% (15 of 16). One year and one regime —
 * which is why this is an option a consumer opts into and compares via `params`, not a
 * new default.
 */
export const CONFLUENCE_HTF_MODE: ConfluenceHtfMode = 'uptrend';

/**
 * Signal type → indicator family. Signals sharing an indicator collapse to one vote.
 *
 * Unlisted types (a detector added after this map was written) fall back to their own
 * name as the family, so a new detector is never silently worth zero votes.
 */
const SIGNAL_FAMILY: Readonly<Record<string, string>> = {
    rsi_oversold: 'rsi',
    rsi_overbought: 'rsi',
    rsi_bullish_divergence: 'rsi',
    rsi_bearish_divergence: 'rsi',
    golden_cross: 'ma',
    death_cross: 'ma',
    macd_bullish_cross: 'macd',
    macd_bearish_cross: 'macd',
    macd_histogram_bullish_convergence: 'macd',
    macd_histogram_bearish_convergence: 'macd',
    bollinger_lower_bounce: 'bollinger',
    bollinger_upper_breakout: 'bollinger',
    bollinger_percentb_oversold: 'bollinger',
    bollinger_percentb_overbought: 'bollinger',
    bollinger_squeeze_bullish: 'bollinger',
    bollinger_squeeze_bearish: 'bollinger',
    supertrend_bullish_flip: 'supertrend',
    supertrend_bearish_flip: 'supertrend',
    parabolic_sar_flip: 'psar',
    parabolic_sar_bearish_flip: 'psar',
    ichimoku_cloud_breakout: 'ichimoku',
    ichimoku_cloud_breakdown: 'ichimoku',
    cci_bullish_cross: 'cci',
    cci_bearish_cross: 'cci',
    dmi_bullish_cross: 'dmi',
    dmi_bearish_cross: 'dmi',
    cmf_bullish_flip: 'cmf',
    cmf_bearish_flip: 'cmf',
    mfi_oversold_bounce: 'mfi',
    mfi_overbought_reversal: 'mfi',
    keltner_upper_breakout: 'keltner',
    keltner_lower_breakout: 'keltner',
    squeeze_momentum_bullish: 'squeeze',
    squeeze_momentum_bearish: 'squeeze',
    support_proximity_bullish: 'level',
    resistance_proximity_bearish: 'level',
};

/**
 * Detector outputs kept out of the tally entirely — the 52-week-extreme and gap
 * detectors.
 *
 * Every threshold and weight above was set (or re-measured) on the indicator catalogue
 * alone; these price-structure types have never been measured as confluence votes. Left
 * to the `SIGNAL_FAMILY` fallback each would become a family of its own and a full vote,
 * so a gap on the trigger bar alone could lift a 1.5-family reading past `min` —
 * changing every trigger with no evidence behind it. They stay in `detectSignals` for
 * skill gating and other consumers; they are only filtered out of the snapshot here.
 */
const CONFLUENCE_EXCLUDED_TYPES: ReadonlySet<SignalType> = new Set([
    'new_52w_high',
    'new_52w_low',
    'gap_up',
    'gap_down',
]);

/**
 * The `ExpectedSignalType` members, as a runtime set.
 *
 * A snapshot stores type names only, so phase is recovered by name. The two unions are
 * disjoint, which makes the lookup exact — and keeping the snapshot free of `phase`
 * means previously stored snapshots stay re-scorable. Adding a member to
 * `ExpectedSignalType` requires adding it here too, otherwise it silently earns a full
 * vote.
 */
const EXPECTED_SIGNAL_TYPES: ReadonlySet<string> = new Set([
    'rsi_bullish_divergence',
    'rsi_bearish_divergence',
    'macd_histogram_bullish_convergence',
    'macd_histogram_bearish_convergence',
    'bollinger_squeeze_bullish',
    'bollinger_squeeze_bearish',
    'support_proximity_bullish',
    'resistance_proximity_bearish',
]);

/** Parameters a snapshot was produced with, recorded so a stored row stays explainable. */
export interface ConfluenceParams {
    /** Weighted family count the entry trigger requires. */
    min: number;
    /** Weighted family count the exit trigger requires. Independent of {@link min}. */
    exitMin: number;
    /** Half-width of the continuous score band. */
    span: number;
    /** Vote weight of `expected`-phase signals. */
    expectedWeight: number;
    /** Higher-timeframe label, or `null` when the alignment gate was off. */
    htf: string | null;
    /** Whether the entry trigger required a volume-family signal. */
    requireVolume: boolean;
    /**
     * How the higher-timeframe trend gated the entry. Absent on snapshots stored before
     * the option existed, which all ran as `'uptrend'`.
     *
     * Always recorded, even when the gate was off — it is only meaningful when
     * {@link htf} is non-null. `htf: null` is what says "no gate was applied".
     */
    htfMode?: ConfluenceHtfMode;
}

/** Indicator-confluence state of one symbol at one bar. */
export interface ConfluenceSnapshot {
    /** Timeframe label of the bars this was computed from. */
    timeframe: string;
    /** Unix timestamp (seconds) of the last bar. */
    barTime: number;
    /** Close of the last bar. */
    close: number;
    /** Same-timeframe SMA used as the trend filter; `null` when history is too short. */
    ma50: number | null;
    /** Active bullish signal types, de-duplicated and sorted. */
    bullish: string[];
    /** Active bearish signal types, de-duplicated and sorted. */
    bearish: string[];
    /** Bullish types newly lit versus the previous bar. */
    freshBullish: string[];
    /** Bearish types newly lit versus the previous bar. */
    freshBearish: string[];
    /** Higher-timeframe trend, or `null` when the gate was off or bars were absent. */
    htfTrend: TrendState | null;
    /** Effective parameters this snapshot was produced with. */
    params: ConfluenceParams;
    /** Bullish rule held: weighted families ≥ min, ≥1 fresh, close > MA, HTF gate passed ({@link ConfluenceHtfMode}), volume backed. */
    entryTrigger: boolean;
    /** Bearish inverse held. Deliberately free of the HTF and volume gates — see {@link evaluateConfluence}. */
    exitTrigger: boolean;
}

/** Tunables for {@link evaluateConfluence}. Every field falls back to its module default. */
export interface EvaluateConfluenceOptions {
    /** Label stored on the snapshot; purely descriptive. */
    timeframe: string;
    /**
     * Higher-timeframe bars for the alignment gate, already fetched by the caller.
     *
     * Omitted or `null` turns the gate off. Fetching belongs to the consumer — this
     * layer performs no I/O.
     */
    htfBars?: readonly Bar[] | null;
    /** Label recorded for `htfBars`. Ignored when `htfBars` is absent. */
    htfLabel?: string | null;
    /** Weighted family count the entry trigger requires. Default {@link CONFLUENCE_MIN}. */
    min?: number;
    /**
     * Weighted family count the exit trigger requires. Default {@link CONFLUENCE_EXIT_MIN}.
     *
     * Separate from {@link min} on purpose — see {@link CONFLUENCE_EXIT_MIN}.
     */
    exitMin?: number;
    /** Half-width of the continuous band. Default {@link CONFLUENCE_SPAN}. */
    span?: number;
    /** `expected`-phase vote weight. Default {@link CONFLUENCE_EXPECTED_WEIGHT}. */
    expectedWeight?: number;
    /**
     * Require a volume-family bullish signal for the entry trigger. Default `false`.
     *
     * Shipped defaulting to `true` on the reasoning that a breakout no volume indicator
     * supports tends to fade. Measurement did not back it: it halved entry triggers at
     * every threshold, and on the three losing entries it was meant to catch, the
     * higher-timeframe gate and the caller's own stop-distance guard already blocked all
     * three — the volume requirement was redundant on every one. Left as an opt-in knob
     * rather than removed, because the reasoning may still hold on other symbols; it just
     * has not earned being on by default.
     */
    requireVolume?: boolean;
    /**
     * Which higher-timeframe state the entry trigger accepts. Default
     * {@link CONFLUENCE_HTF_MODE}; any unrecognised value falls back to it. Ignored when
     * `htfBars` is absent (the gate is off). Entry-only — see {@link ConfluenceHtfMode}.
     */
    htfMode?: ConfluenceHtfMode;
    /** SMA period for the same-timeframe filter. Default {@link CONFLUENCE_TREND_MA_PERIOD}. */
    trendMaPeriod?: number;
    /** Minimum bars before scoring is attempted. Default {@link CONFLUENCE_MIN_BARS}. */
    minBars?: number;
}

/**
 * Whether a signal describes an anticipated condition rather than a completed event.
 *
 * Exported so a renderer can label the half-weight members instead of presenting a
 * fractional family count with no visible explanation for the fraction.
 */
export function isExpectedSignal(type: string): boolean {
    return EXPECTED_SIGNAL_TYPES.has(type);
}

/** The indicator family a signal belongs to; the type name itself when unmapped. */
export function signalFamily(type: string): string {
    return SIGNAL_FAMILY[type] ?? type;
}

/**
 * Weighted count of distinct indicator families among `types`.
 *
 * Each family contributes its **highest** member weight once, so three Bollinger
 * signals still count as one indicator. The result may be fractional — two confirmed
 * families plus one expected family is 2.5.
 */
export function confluenceFamilyWeight(
    types: readonly string[],
    expectedWeight: number = CONFLUENCE_EXPECTED_WEIGHT
): number {
    const safeExpected =
        Number.isFinite(expectedWeight) && expectedWeight >= 0
            ? Math.min(expectedWeight, 1)
            : 0;
    const best = new Map<string, number>();
    for (const type of types) {
        if (typeof type !== 'string') continue;
        const weight = EXPECTED_SIGNAL_TYPES.has(type) ? safeExpected : 1;
        const family = signalFamily(type);
        if (weight > (best.get(family) ?? 0)) best.set(family, weight);
    }
    let total = 0;
    for (const w of best.values()) total += w;
    return total;
}

/**
 * Convert a snapshot into a 0..100 signal score.
 *
 * The continuous band comes from the shrunk bullish/bearish family ratio and stays
 * within `50 ± span`. A snapshot whose entry or exit rule held exactly snaps to
 * {@link CONFLUENCE_TRIGGER_SCORE} or {@link CONFLUENCE_EXIT_SCORE} — the two carry
 * different confidence, which is why the band is narrow and the snaps are not.
 *
 * `null` scores 50 so callers that average axes see a neutral value; callers that drop
 * absent axes from the denominator should check for `null` themselves.
 */
export function scoreConfluence(snapshot: ConfluenceSnapshot | null): number {
    if (!snapshot) return 50;

    const rawExpected = snapshot.params?.expectedWeight;
    const expectedWeight =
        typeof rawExpected === 'number' &&
        Number.isFinite(rawExpected) &&
        rawExpected >= 0
            ? Math.min(rawExpected, 1)
            : CONFLUENCE_EXPECTED_WEIGHT;
    // Clamped for the same reason as the weight above: a snapshot travels through JSON
    // storage, and a negative span would invert the sign of the score rather than merely
    // scaling it.
    const rawSpan = snapshot.params?.span;
    const span =
        typeof rawSpan === 'number' && Number.isFinite(rawSpan) && rawSpan >= 0
            ? rawSpan
            : CONFLUENCE_SPAN;

    const bull = confluenceFamilyWeight(snapshot.bullish, expectedWeight);
    const bear = confluenceFamilyWeight(snapshot.bearish, expectedWeight);
    const directional = bull + bear;

    let base = 50;
    if (directional > 0) {
        base = 50 + ((bull - bear) / (directional + CONFLUENCE_SHRINK)) * span;
    }
    if (snapshot.entryTrigger) base = Math.max(base, CONFLUENCE_TRIGGER_SCORE);
    if (snapshot.exitTrigger) base = Math.min(base, CONFLUENCE_EXIT_SCORE);

    return clamp(Math.round(base), 0, 100);
}

/**
 * Whether the bearish inverse of the entry rule holds — an exit signal for an open
 * position.
 *
 * Only the trigger counts. Selling because a couple of bearish signals lit would exit
 * on every ordinary pullback.
 */
export function isConfluenceExit(snapshot: ConfluenceSnapshot | null): boolean {
    return snapshot?.exitTrigger === true;
}

/**
 * Evaluate indicator confluence for one symbol from already-fetched bars.
 *
 * Pure: the caller performs every fetch, including the higher-timeframe bars. Returns
 * `null` when the input cannot support a reading — fewer than `minBars` bars, or a
 * non-finite last close. Callers should treat `null` as an abstention rather than a
 * neutral vote, so that a data outage leaves the rest of the system unchanged.
 *
 * The entry rule is: **≥ `min` weighted indicator families bullish, at least one of
 * them newly lit versus the previous bar, close above the same-timeframe SMA, the
 * higher timeframe in the state `htfMode` asks for (an uptrend by default), and at least
 * one volume-family signal present when `requireVolume` is set.** The
 * "newly lit" clause is what timestamps the entry — three signals that have been on for
 * twenty bars are already in the price.
 *
 * The exit rule is the bearish inverse of the first three clauses only, and it uses its
 * own threshold ({@link CONFLUENCE_EXIT_MIN}). The higher-timeframe and volume gates are
 * **entry-only by design**, and the thresholds are **separate for the same reason**: each
 * of these makes a trigger harder to reach, which is the point for entries and exactly
 * backwards for exits — a missed entry costs opportunity, a missed exit costs money. Any
 * future tightening has to declare which side it lands on.
 *
 * @param bars - OHLCV bars sorted oldest-first, at the trading timeframe.
 * @param options - Timeframe label plus optional tunables and higher-timeframe bars.
 * @returns The snapshot, or `null` when the bars cannot support a reading.
 *
 * @example
 * ```ts
 * const snap = evaluateConfluence(bars, { timeframe: '30Min', htfBars: dailyBars });
 * const score = scoreConfluence(snap);
 * ```
 *
 * @see scoreConfluence
 * @see isConfluenceExit
 */
export function evaluateConfluence(
    bars: readonly Bar[],
    options: EvaluateConfluenceOptions
): ConfluenceSnapshot | null {
    const params = resolveParams(options);
    const minBars = positive(options.minBars, CONFLUENCE_MIN_BARS);
    const maPeriod = positive(
        options.trendMaPeriod,
        CONFLUENCE_TREND_MA_PERIOD
    );

    if (!Array.isArray(bars) || bars.length <= minBars) return null;
    const last = bars[bars.length - 1];
    if (!last || !Number.isFinite(last.close) || last.close <= 0) return null;

    const mutable = bars as Bar[];
    const current = detectSignals(mutable, calculateIndicators(mutable));
    // Core evaluates only the tail of the array it is given, so there is no "state at
    // bar N−1" to read out of a single call — recomputing on the truncated array is the
    // only way to obtain it, and that diff is what "newly lit" means.
    const prevBars = mutable.slice(0, -1);
    const previous = detectSignals(prevBars, calculateIndicators(prevBars));

    const bullish = typesOf(current, 'bullish');
    const bearish = typesOf(current, 'bearish');
    const prevBullish = new Set(typesOf(previous, 'bullish'));
    const prevBearish = new Set(typesOf(previous, 'bearish'));
    const freshBullish = bullish.filter(t => !prevBullish.has(t));
    const freshBearish = bearish.filter(t => !prevBearish.has(t));

    const ma = trailingMa(mutable, maPeriod);

    const htfTrend = htfTrendOf(options.htfBars, params.htf, minBars);
    // Absent trend means the gate could not be evaluated, not that it failed.
    const htfAligned =
        htfTrend === null ||
        (params.htfMode === 'notUptrend'
            ? htfTrend !== 'uptrend'
            : htfTrend === 'uptrend');
    const volumeOk =
        !params.requireVolume ||
        bullish.some(t => VOLUME_FAMILIES.has(signalFamily(t)));

    return {
        timeframe: options.timeframe,
        barTime: last.time,
        close: last.close,
        ma50: ma,
        bullish,
        bearish,
        freshBullish,
        freshBearish,
        htfTrend,
        params,
        // Close sits on exactly one side of the MA, so the two triggers are mutually
        // exclusive by construction.
        entryTrigger:
            confluenceFamilyWeight(bullish, params.expectedWeight) >=
                params.min &&
            freshBullish.length >= 1 &&
            ma !== null &&
            last.close > ma &&
            htfAligned &&
            volumeOk,
        exitTrigger:
            confluenceFamilyWeight(bearish, params.expectedWeight) >=
                params.exitMin &&
            freshBearish.length >= 1 &&
            ma !== null &&
            last.close < ma,
    };
}

function resolveParams(options: EvaluateConfluenceOptions): ConfluenceParams {
    const gateOn = Array.isArray(options.htfBars) && options.htfBars.length > 0;
    return {
        min: nonNegative(options.min, CONFLUENCE_MIN),
        exitMin: nonNegative(options.exitMin, CONFLUENCE_EXIT_MIN),
        span: nonNegative(options.span, CONFLUENCE_SPAN),
        expectedWeight: Math.min(
            nonNegative(options.expectedWeight, CONFLUENCE_EXPECTED_WEIGHT),
            1
        ),
        htf: gateOn ? (options.htfLabel ?? 'htf') : null,
        requireVolume: options.requireVolume ?? false,
        htfMode:
            options.htfMode === 'notUptrend'
                ? 'notUptrend'
                : CONFLUENCE_HTF_MODE,
    };
}

function htfTrendOf(
    htfBars: readonly Bar[] | null | undefined,
    htfLabel: string | null,
    minBars: number
): TrendState | null {
    if (htfLabel === null || !Array.isArray(htfBars)) return null;
    // The trend classifier needs its EMA warmed up; half the confluence minimum is
    // enough for that and keeps a short daily history usable.
    if (htfBars.length < Math.floor(minBars / 2)) return null;
    const mutable = htfBars as Bar[];
    return classifyTrend(mutable, calculateIndicators(mutable));
}

/**
 * Direction-filtered signal types, minus {@link CONFLUENCE_EXCLUDED_TYPES},
 * de-duplicated and sorted for a stable snapshot.
 */
function typesOf(
    signals: readonly { type: SignalType; direction: string }[],
    direction: 'bullish' | 'bearish'
): string[] {
    const set = new Set<string>();
    for (const s of signals) {
        if (
            s.direction === direction &&
            typeof s.type === 'string' &&
            !CONFLUENCE_EXCLUDED_TYPES.has(s.type)
        )
            set.add(s.type);
    }
    return [...set].sort();
}

/** Last value of the SMA series, or `null` when it is absent or non-finite. */
function trailingMa(bars: Bar[], period: number): number | null {
    if (bars.length < period) return null;
    const series = calculateMA(bars, period);
    const value = series[series.length - 1];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegative(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? value
        : fallback;
}

function positive(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : fallback;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

// `IndicatorResult` is referenced only through the functions above; the import keeps the
// type reachable for consumers reading this module's signatures.
export type { IndicatorResult };
