import { INDICATOR_CARD_KINDS } from '@/domain/analysis/computedCardKinds';
import { readIndicator } from '@/domain/analysis/indicatorReadings';
import {
    CCI_OVERBOUGHT_LEVEL,
    CCI_OVERSOLD_LEVEL,
    RSI_OVERBOUGHT_LEVEL,
    RSI_OVERSOLD_LEVEL,
    STOCHASTIC_OVERBOUGHT_LEVEL,
    STOCHASTIC_OVERSOLD_LEVEL,
} from '@/domain/indicators/constants';
import { cciSignalHolds } from '@/domain/analysis/indicatorReadingsEvent';
import type {
    AnalysisSignal,
    IndicatorCardKind,
    IndicatorGuideResult,
    IndicatorReadInput,
    IndicatorReading,
    ReadingOf,
    SignalDirection,
    SignalStrength,
    Skill,
    SkillSelectionContext,
    Trend,
} from '@/domain/types';

// ─── Trend ────────────────────────────────────────────────────────────────────

/** An event card's direction: the side its signals agree on, `neutral` when they disagree. */
const sideOfSignals = (directions: readonly SignalDirection[]): Trend =>
    directions.length > 0 && directions.every(d => d === 'bullish')
        ? 'bullish'
        : directions.length > 0 && directions.every(d => d === 'bearish')
          ? 'bearish'
          : 'neutral';

/** The calibration the prompt imposed before cards were computed: overbought reads bearish, oversold bullish. */
const meanReversionSide = (state: 'overbought' | 'oversold'): Trend =>
    state === 'overbought' ? 'bearish' : 'bullish';

const NEUTRAL = (): Trend => 'neutral';

/**
 * @internal The trend of a card of each kind, from the reading alone (DOM-12: state only what
 * the reading proves). Event kinds take the direction of the signals that fired; a kind whose
 * state names no side (volatility and regime readings, a mixed stack, an ADX below the trending
 * floor, a blue impulse) is `neutral`.
 *
 * One entry per kind (`INDICATOR_CARD_TREND_RULE` does not compile without one).
 *
 * The pre-registered fallback of the evaluation (D7) is applied here: a kind whose rule was
 * opposite to the model's own trend on more than 5% of at least 30 stored cards maps to
 * `neutral`. Measured on the member run `2026-11-22-wp15-c2-after2` (838 analyses), opposite
 * share before the fallback and n for every kind: ma 0.0% (n 790); ema 0.8% (n 770); adx 0.0% (n
 * 770); atr 0.0% (n 805); obv 0.0% (n 714); volume_profile 1.4% (n 799); rsi 1.0% (n 209); macd
 * 4.1% (n 292); cci 3.8% (n 396); cmf 0.6% (n 172); dmi 3.3% (n 61); ichimoku 0.0% (n 37); mfi
 * 4.8% (n 63); parabolic_sar 0.0% (n 226); squeeze_momentum 0.0% (n 109); supertrend 0.0% (n 68);
 * bollinger_percent_b 0.0% (n 68); stochastic 20.5% (n 376); stoch_rsi 6.4% (n 329); williams_r
 * 7.3% (n 411); connors_rsi 0.0% (n 49); bollinger 41.6% (n 137); keltner 1.3% (n 315); donchian
 * 0.0% (n 121); vwap n < 30; buy_sell_volume 1.0% (n 608); macd_v 34.2% (n 73); force_index 1.9%
 * (n 54); elder_ray 74.5% (n 98); elder_impulse 0.0% (n 618); chandelier 7.3% (n 41); hurst 0.0%
 * (n 425); variance_ratio 0.0% (n 96); regression 0.0% (n 361); yang_zhang n < 30; ewma n < 30.
 * The kinds above 5% with n >= 30
 * (stochastic, stoch_rsi, williams_r, bollinger, macd_v, elder_ray, chandelier) are neutral
 * below; the oscillator rule (overbought bearish, oversold bullish) stays for `connors_rsi`.
 * Kinds with n < 30 keep the rule of the design.
 *
 * Re-measured for the shipped MACD and CCI rules (a newly lit event leads; CCI crosses count
 * only while they hold on the last bar; MACD histogram convergence names no side). The figures
 * above for macd (4.1%) and cci (3.8%) predate "newly lit first" and no longer describe the
 * rule. Opposite share against the old model's own per-card trend, and the share of cards that
 * are neutral, on the OLD-prompt runs `old-m` (206 MACD / 289 CCI cards) and `old-m-rep` (204 /
 * 295), `2026-11-22-wp15-c2-after2` (292 / 396) and `2026-11-22-wp16-before-m` (292 / 396):
 * MACD with convergence taking a side 6.3% / 4.4% / 4.5% / 4.8%, now 1.0% / 0.0% / 0.3% / 0.3%
 * with 43% of MACD cards neutral (2-3% before). CCI with every cross counting 6.9% / 4.7% / 6.1% /
 * 4.8%, now 7.3% / 4.7% / 5.6% / 5.6% with 7-8% neutral (6-7% before). RSI is unchanged
 * (5.4% / 3.5% / 1.0% / 2.0%, within resampling noise).
 *
 * DELIBERATE DEPARTURE from the D7 fallback above: CCI stays above 5% on three of the four runs
 * (old-m, c2-after2, wp16-before-m) and keeps its trend instead of mapping to `neutral`. The
 * hold check fixes the cards whose cross was undone inside the lookback (AAPL 2020-03-12), but
 * the remaining opposites are cases where the card is right and the old model is wrong: on
 * the cases read by hand, a cross that is fresh on the last bar or still holds is the correct
 * side per the skill, and the model followed the lagging 7-bar `[rising]/[falling]` slope tag.
 * Mapping CCI to neutral would throw those correct cards away.
 *
 * To re-measure, run `analysisFieldsEval --mode output --set <set> --skills <skills> --run
 * <after run> --before <old run> [--repeat <old run repeat>]`; `summary.output.cardTrend` holds
 * the per-skill `n` and `opposite` the figures above come from (the same rule as the card, on
 * the printed signal lists and the CCI series of the set's stored bars).
 */
export const INDICATOR_CARD_TREND_RULE: {
    readonly [K in IndicatorCardKind]: (
        reading: ReadingOf<K>,
        directions: readonly SignalDirection[]
    ) => Trend;
} = {
    ma: r =>
        r.state === 'bullish_stack'
            ? 'bullish'
            : r.state === 'bearish_stack'
              ? 'bearish'
              : 'neutral',
    ema: r =>
        r.state === 'bullish_stack'
            ? 'bullish'
            : r.state === 'bearish_stack'
              ? 'bearish'
              : 'neutral',
    adx: r => {
        const { diPlus, diMinus } = r.values;
        if (r.state === 'weak' || diPlus === null || diMinus === null) {
            return 'neutral';
        }
        return diPlus > diMinus
            ? 'bullish'
            : diPlus < diMinus
              ? 'bearish'
              : 'neutral';
    },
    atr: NEUTRAL,
    obv: r =>
        r.state === 'rising'
            ? 'bullish'
            : r.state === 'falling'
              ? 'bearish'
              : 'neutral',
    volume_profile: r =>
        r.state === 'above_value_area'
            ? 'bullish'
            : r.state === 'below_value_area'
              ? 'bearish'
              : 'neutral',
    rsi: (_, d) => sideOfSignals(d),
    macd: (_, d) => sideOfSignals(d),
    cci: (_, d) => sideOfSignals(d),
    cmf: (_, d) => sideOfSignals(d),
    dmi: (_, d) => sideOfSignals(d),
    ichimoku: (_, d) => sideOfSignals(d),
    mfi: (_, d) => sideOfSignals(d),
    parabolic_sar: (_, d) => sideOfSignals(d),
    squeeze_momentum: (_, d) => sideOfSignals(d),
    supertrend: (_, d) => sideOfSignals(d),
    bollinger_percent_b: (_, d) => sideOfSignals(d),
    stochastic: NEUTRAL,
    stoch_rsi: NEUTRAL,
    williams_r: NEUTRAL,
    connors_rsi: r => meanReversionSide(r.state),
    bollinger: NEUTRAL,
    keltner: r =>
        r.state === 'beyond_upper' || r.state === 'near_upper'
            ? 'bullish'
            : 'bearish',
    donchian: r =>
        r.state === 'beyond_upper' || r.state === 'near_upper'
            ? 'bullish'
            : 'bearish',
    vwap: r => (r.state === 'above' ? 'bullish' : 'bearish'),
    buy_sell_volume: r => (r.state === 'buy_dominant' ? 'bullish' : 'bearish'),
    macd_v: NEUTRAL,
    force_index: r => (r.state === 'turned_positive' ? 'bullish' : 'bearish'),
    elder_ray: NEUTRAL,
    elder_impulse: r =>
        r.state === 'green'
            ? 'bullish'
            : r.state === 'red'
              ? 'bearish'
              : 'neutral',
    chandelier: NEUTRAL,
    hurst: NEUTRAL,
    variance_ratio: NEUTRAL,
    regression: r => (r.state === 'strong_fit_up' ? 'bullish' : 'bearish'),
    yang_zhang: NEUTRAL,
    ewma: NEUTRAL,
};

/** The trend of a reading given the directions of the signals behind it. */
export function trendOfReading(
    reading: IndicatorReading,
    directions: readonly SignalDirection[]
): Trend {
    // Safe cast: the table is indexed by the reading's own kind, so the rule it yields only
    // ever receives a reading of that kind (TypeScript cannot correlate the two unions).
    const rule = INDICATOR_CARD_TREND_RULE[reading.kind] as (
        reading: IndicatorReading,
        directions: readonly SignalDirection[]
    ) => Trend;
    return rule(reading, directions);
}

// ─── Strength ─────────────────────────────────────────────────────────────────

/**
 * @internal The bands the old card rules named for the three oscillators that had them: a
 * reading at or beyond `strong` is strong, at or beyond `moderate` (the oscillator's
 * overbought/oversold line) moderate, else weak. Every other kind has no strength.
 */
export const CARD_STRENGTH_BANDS = {
    rsi: {
        strongHigh: 80,
        strongLow: 20,
        moderateHigh: RSI_OVERBOUGHT_LEVEL,
        moderateLow: RSI_OVERSOLD_LEVEL,
    },
    stochastic: {
        strongHigh: 90,
        strongLow: 10,
        moderateHigh: STOCHASTIC_OVERBOUGHT_LEVEL,
        moderateLow: STOCHASTIC_OVERSOLD_LEVEL,
    },
    cci: {
        strongHigh: 200,
        strongLow: -200,
        moderateHigh: CCI_OVERBOUGHT_LEVEL,
        moderateLow: CCI_OVERSOLD_LEVEL,
    },
} as const;

const strengthOf = (
    value: number | null,
    bands: (typeof CARD_STRENGTH_BANDS)[keyof typeof CARD_STRENGTH_BANDS]
): SignalStrength | undefined => {
    if (value === null) return undefined;
    if (value >= bands.strongHigh || value <= bands.strongLow) return 'strong';
    return value >= bands.moderateHigh || value <= bands.moderateLow
        ? 'moderate'
        : 'weak';
};

/**
 * @internal The strength of a reading: only RSI, Stochastic and CCI cards have one (the bands
 * the prompt named for them), on the printed value; every other card has none.
 */
export function strengthOfReading(
    reading: IndicatorReading
): SignalStrength | undefined {
    switch (reading.kind) {
        case 'rsi':
            return strengthOf(reading.values.rsi, CARD_STRENGTH_BANDS.rsi);
        case 'stochastic':
            return strengthOf(
                reading.values.percentK,
                CARD_STRENGTH_BANDS.stochastic
            );
        case 'cci':
            return strengthOf(reading.values.cci, CARD_STRENGTH_BANDS.cci);
        default:
            return undefined;
    }
}

// ─── Canonical description ────────────────────────────────────────────────────

const describeSignals = (reading: IndicatorReading): string =>
    reading.signals.length === 0
        ? ''
        : ` Signals: ${reading.signals
              .map(
                  s =>
                      `${s.type} (${s.phase}, ${s.barsAgo === 0 ? 'last bar' : `${s.barsAgo} bars ago`})`
              )
              .join(', ')}.`;

const describeValues = (reading: IndicatorReading): string => {
    const entries = Object.entries(reading.values);
    return entries.length === 0
        ? ''
        : ` Values: ${entries.map(([key, value]) => `${key} ${value ?? 'N/A'}`).join(', ')}.`;
};

/**
 * @internal The English canonical line of an indicator card (`AnalysisSignal.description`):
 * the guide's name, the state and the printed values, nothing else. The agent, the legacy chat
 * prompt and API users read this line; the UI renders `reading` in the reader's language.
 */
export function describeIndicatorReading(
    indicatorName: string,
    reading: IndicatorReading
): string {
    const flipped =
        reading.kind === 'elder_impulse' && reading.flippedFrom !== null
            ? ` (flipped from ${reading.flippedFrom})`
            : '';
    return `${indicatorName}: ${reading.state}${flipped}.${describeSignals(reading)}${describeValues(reading)}`;
}

// ─── Cards ────────────────────────────────────────────────────────────────────

const isIndicatorKind = (
    kind: Skill['computedCard']
): kind is IndicatorCardKind => INDICATOR_CARD_KINDS.some(k => k === kind);

/** @internal The MACD signals that anticipate (histogram shrinking) rather than report a cross. */
export const MACD_CONVERGENCE_TYPES: ReadonlySet<string> = new Set([
    'macd_histogram_bullish_convergence',
    'macd_histogram_bearish_convergence',
]);

/**
 * The directions a card's trend is read from: the signals newly lit on this bar when there are
 * any (an older cross never outweighs the one the prompt lists as newly lit; both directions
 * newly lit read as no side), else every signal the reading lists. Two kinds narrow that:
 * a CCI cross counts only while it still holds on the last bar (a cross the series has since
 * undone names no side), and a MACD card takes no side from histogram convergence, which is
 * momentum fading with no line or signal cross and so no reversal yet. The newly lit set is
 * chosen first and convergence dropped after, so a MACD card whose only newly lit signal is
 * convergence is neutral even when an older cross is listed (the older cross does not
 * outweigh the signal the prompt lists as newly lit, and that one names no side).
 */
const directionsOf = (
    reading: IndicatorReading,
    selection: SkillSelectionContext
): SignalDirection[] => {
    const fresh = new Set<string>(selection.newSignalTypes ?? []);
    const listed =
        reading.kind === 'cci'
            ? reading.signals.filter(s => cciSignalHolds(s.type, selection))
            : reading.signals;
    const newly = listed.filter(s => fresh.has(s.type));
    return (newly.length > 0 ? newly : listed)
        .filter(
            s => reading.kind !== 'macd' || !MACD_CONVERGENCE_TYPES.has(s.type)
        )
        .flatMap(s => {
            const hit = selection.signals.find(d => d.type === s.type);
            return hit === undefined ? [] : [hit.direction];
        });
};

/**
 * @internal One card per injected `indicator_guide` skill that carries a `computed_card` tag
 * of an indicator kind and whose reading exists (an always-on line printed as `N/A`, an event
 * skill whose signals did not fire and a state that is not notable have no card), in the order
 * of `skills`. `indicatorName` is the skill's name. Each card holds one signal: the reading,
 * the English canonical `description`, the rule `trend`, and a `strength` for RSI, Stochastic
 * and CCI.
 */
export function buildIndicatorCards(
    skills: readonly Skill[],
    input: IndicatorReadInput
): readonly IndicatorGuideResult[] {
    return skills.flatMap(skill => {
        const kind = skill.computedCard;
        if (skill.type !== 'indicator_guide' || !isIndicatorKind(kind)) {
            return [];
        }
        const reading = readIndicator(kind, skill, input);
        if (reading === null) return [];
        const strength = strengthOfReading(reading);
        const signal: AnalysisSignal = {
            type: 'skill',
            description: describeIndicatorReading(skill.name, reading),
            trend: trendOfReading(
                reading,
                directionsOf(reading, input.selection)
            ),
            ...(strength === undefined ? {} : { strength }),
            reading,
        };
        return [{ indicatorName: skill.name, signals: [signal] }];
    });
}
