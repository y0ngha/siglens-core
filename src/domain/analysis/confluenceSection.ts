import { structuralRiskReward } from '@/domain/analysis/planCheck';
import {
    evaluateConfluence,
    isExpectedSignal,
    scoreConfluence,
    signalFamily,
    CONFLUENCE_MIN_BARS,
} from '@/domain/signals/confluence';
import type { ConfluenceSnapshot } from '@/domain/signals/confluence';
import type {
    Bar,
    MarketReference,
    ReferenceLevels,
    Timeframe,
} from '@/domain/types';

/**
 * Deterministic chart facts rendered into the analysis prompt.
 *
 * Two numbers the model was previously asked to produce itself now arrive pre-computed:
 * the indicator-confluence tally and the risk:reward available from the current price.
 *
 * **Why confluence moved out of the model.** The prompt used to instruct: *"Count
 * confirming signals from different categories … Strong confluence: 3+ categories agree."*
 * The tally happened inside the model, so only the count survived into the output and
 * nothing about it could be checked. The categories were also coarser than the data
 * warrants — every trend indicator collapsed into one bucket while RSI, StochRSI and
 * Connors RSI, which are three transforms of the same close series, could each be read as
 * separate confirmation. The rule engine counts **indicator families**, which is the
 * correction, and it is the same engine an auto-trader downstream already scores with, so
 * the two stop drifting apart.
 *
 * **Why risk:reward moved out.** Measured over 426 production ticks: the nearest
 * resistance sat *below* the current price 14.6% of the time, and the median upside to the
 * first obstacle was 0.74%. The effect was worst exactly where the indicators agreed most
 * — median risk:reward 1.27 in a middling composite-score band versus **0.00** in the
 * highest. Strong confluence is therefore not evidence that entering now is attractive,
 * and the model cannot notice that unless the ratio is put in front of it before it writes
 * a verdict.
 */

/** Header for the deterministic block. Exported so tests assert the rendered text. */
export const DETERMINISTIC_METRICS_HEADER = '## Deterministic Metrics';

/** Confluence tunables that differ by chart timeframe. */
export interface TimeframeConfluenceParams {
    /** Weighted indicator families the entry rule requires. */
    min: number;
    /** Vote weight of an `expected`-phase signal. */
    expectedWeight: number;
}

/**
 * Per-timeframe confluence parameters.
 *
 * The daily row restores the two **constants** the original backtest used — a threshold of
 * three and `expected` signals counted in full. That backtest ran on daily bars with a
 * ten-day hold and won its comparison at 70% versus 61.5% for an LLM read over the same
 * window, so the daily chart is the one place those constants mean what they were measured
 * to mean.
 *
 * It is **not** a restoration of the backtested rule. The engine counts indicator families
 * where the measured rule counted signal types, and that difference is not undone here.
 * Family counting can only tighten (type count is always >= family count), so the daily
 * configuration is at most as permissive as the one that was measured — but its win rate
 * is inherited by argument, not by measurement, and nothing rendered into the prompt may
 * claim otherwise.
 *
 * Every intraday row is the modified rule: 2.5 families and half-weight `expected`
 * signals. A 30-minute bar is not a small daily bar — the same "three signals" threshold
 * is reached far more often and by weaker evidence — so the intraday side trades the
 * backtest's authority for constants that produce a comparable signal rate. **The intraday
 * variant has not been backtested at all.**
 */
export const CONFLUENCE_PARAMS_BY_TIMEFRAME: Record<
    Timeframe,
    TimeframeConfluenceParams
> = {
    '5Min': { min: 2.5, expectedWeight: 0.5 },
    '15Min': { min: 2.5, expectedWeight: 0.5 },
    '30Min': { min: 2.5, expectedWeight: 0.5 },
    '1Hour': { min: 2.5, expectedWeight: 0.5 },
    '4Hour': { min: 2.5, expectedWeight: 0.5 },
    '1Day': { min: 3, expectedWeight: 1 },
};

/**
 * How much authority a met entry rule carries on each timeframe.
 *
 * Mirrors the existing `Timeframe interpretation` line rather than inventing a second,
 * possibly contradictory reliability scale: the daily row is the validated one, the
 * intraday rows are not.
 */
const CONFLUENCE_RELIABILITY: Record<Timeframe, string> = {
    '5Min': 'Intraday, unvalidated parameters — treat a met rule as a setup that still needs volume and higher-timeframe confirmation, not as a signal.',
    '15Min':
        'Intraday, unvalidated parameters — treat a met rule as a setup to confirm, not as a completed signal.',
    '30Min':
        'Intraday, unvalidated parameters — treat a met rule as a setup to confirm, not as a completed signal.',
    '1Hour':
        'Intraday, unvalidated parameters — a met rule is meaningful but still wants confirmation from structure or volume.',
    '4Hour':
        'Swing horizon. A met rule carries real weight; parameters are the intraday variant, so prefer corroboration from structure.',
    '1Day': 'Daily horizon, running the thresholds the original backtest used (3 families, expected signals at full weight). The backtest counted signal types rather than indicator families, so this is a stricter variant of the measured rule, not the measured rule itself — treat a met rule as strong evidence, not as a validated 70% setup.',
};

function fmtPrice(n: number): string {
    return n.toFixed(2);
}

function fmtRatio(n: number): string {
    return n.toFixed(2);
}

/** `golden_cross(ma)` — or `support_proximity_bullish(support, half weight)` when expected. */
function describeSignal(type: string): string {
    const family = signalFamily(type);
    return isExpectedSignal(type)
        ? `${type}(${family}, half weight — anticipated, not a completed event)`
        : `${type}(${family})`;
}

function signalLine(label: string, types: readonly string[]): string {
    return types.length === 0
        ? `${label}: none`
        : `${label}: ${types.map(describeSignal).join(', ')}`;
}

/**
 * Render the confluence half of the block.
 *
 * The rule's own clauses are printed alongside the verdict. A bare "MET" would be another
 * opaque number; the model needs to see which clause carried it in order to weigh a rule
 * that passed on three confirmed crosses differently from one that passed on two crosses
 * plus a proximity state.
 */
function formatConfluence(
    snapshot: ConfluenceSnapshot,
    timeframe: Timeframe
): string[] {
    const params = snapshot.params;
    const maText =
        snapshot.ma50 === null
            ? 'SMA50 unavailable (short history)'
            : `close ${fmtPrice(snapshot.close)} vs SMA50 ${fmtPrice(snapshot.ma50)} (${
                  snapshot.close > snapshot.ma50 ? 'above' : 'at or below'
              })`;

    return [
        `### Indicator Confluence (rule engine, ${timeframe} bars)`,
        signalLine('Bullish signals', snapshot.bullish),
        signalLine('Bearish signals', snapshot.bearish),
        signalLine('Newly lit on this bar (bullish)', snapshot.freshBullish),
        signalLine('Newly lit on this bar (bearish)', snapshot.freshBearish),
        `Trend filter: ${maText}`,
        `Entry rule (>= ${params.min} weighted bullish families, >= 1 newly lit, close above SMA50): ${
            snapshot.entryTrigger ? 'MET' : 'not met'
        }`,
        `Exit rule (>= ${params.exitMin} weighted bearish families, >= 1 newly lit, close below SMA50): ${
            snapshot.exitTrigger ? 'MET' : 'not met'
        }`,
        `Confluence score: ${scoreConfluence(snapshot)} / 100 (50 is neutral)`,
        `Reliability: ${CONFLUENCE_RELIABILITY[timeframe]}`,
        // Families, not indicator names, are what the count is over. Without this line the
        // model sees four RSI-derived rows elsewhere in the prompt and reasonably reads
        // them as four confirmations.
        'Counting unit: indicator families. RSI, StochRSI and Connors RSI are one family (they transform the same close series); MACD line/signal/histogram are one; every Bollinger read is one. Do not recount the raw indicator list as independent confirmations.',
    ];
}

/** Pick the horizon whose levels bracket the price most tightly; `null` when none do. */
function nearestLevels(reference: MarketReference): ReferenceLevels | null {
    for (const horizon of [reference.short, reference.medium, reference.long]) {
        const levels = horizon.levels;
        if (levels.resistance.length > 0 && levels.support.length > 0) {
            return levels;
        }
    }
    return null;
}

/**
 * Render the risk:reward half of the block.
 *
 * Deliberately phrased as a constraint on the *verdict* rather than on the prose. The
 * downstream failure was not that analyses described the upside inaccurately — it was that
 * `entryRecommendation` said "enter" while the nearest obstacle was half a percent away.
 */
function formatRiskReward(reference: MarketReference): string[] {
    const levels = nearestLevels(reference);
    if (!levels) return [];

    const up = levels.resistance[0];
    const down = levels.support[0];
    if (!up || !down) return [];

    // Can still be null after the guard above: a zero-distance support or a "resistance"
    // the collector placed at or below the price makes the ratio undefined, not zero.
    const ratio = structuralRiskReward(levels);
    if (ratio === null) return [];

    const verdict =
        ratio < 1
            ? 'Below 1.0: the nearest obstacle above is closer than the nearest support below. Entering here risks more than the next move offers.'
            : 'At or above 1.0: there is more room to the next obstacle above than to the support below.';

    return [
        '### Risk:Reward From Current Price',
        `Nearest resistance ${up.label} at ${fmtPrice(up.price)} (${up.distancePercent.toFixed(2)}%)`,
        `Nearest support ${down.label} at ${fmtPrice(down.price)} (${down.distancePercent.toFixed(2)}%)`,
        `Structural risk:reward from current price = ${fmtRatio(ratio)}`,
        verdict,
        // The correlation is the part the model cannot infer from the ratio alone.
        'Measured downstream: analyses with the strongest indicator agreement carried the WORST ratios (median 0.00 in the highest score band, 1.27 in a middling one). Strong confluence plus a sub-1.0 ratio is a reason to set entryRecommendation to "wait" and name a pullback level, not a reason to enter.',
    ];
}

/**
 * Build the deterministic-metrics section, or `''` when nothing can be computed.
 *
 * An empty string is filtered out by the caller rather than rendering an empty header.
 * When the bar history is too short for the detector catalogue to be complete, the section
 * says so explicitly instead of vanishing — a silently absent section reads to the model
 * as "no confluence", which is a different and stronger claim than "not measurable".
 */
export function formatDeterministicMetricsSection(
    bars: readonly Bar[],
    timeframe: Timeframe,
    reference: MarketReference
): string {
    const { min, expectedWeight } = CONFLUENCE_PARAMS_BY_TIMEFRAME[timeframe];
    // `exitMin` is deliberately not raised alongside `min` on the daily chart. Raising the
    // entry bar is the intent; raising the exit bar with it is the defect that principle
    // guards against — a missed entry costs opportunity, a missed exit costs money. The
    // asymmetry it leaves on `1Day` (entry 3, exit 2.5) is the correct direction.
    // No higher-timeframe bars are fetched for the prompt, so the alignment gate stays
    // off. That is the intended configuration on `1Day` (there is no natural timeframe
    // above it for the backtested rule) and an accepted looseness on intraday charts,
    // where the gate would otherwise need a second fetch this layer must not perform.
    const snapshot = evaluateConfluence(bars, {
        timeframe,
        min,
        expectedWeight,
    });

    const confluence =
        snapshot !== null
            ? formatConfluence(snapshot, timeframe)
            : [
                  `### Indicator Confluence (rule engine, ${timeframe} bars)`,
                  `Not measurable: the rule needs more than ${CONFLUENCE_MIN_BARS} bars and received ${bars.length}. This is an absence of measurement, not an absence of confluence — judge the indicators yourself for this chart.`,
              ];

    const riskReward = formatRiskReward(reference);

    return [
        DETERMINISTIC_METRICS_HEADER,
        'Computed by a rule engine from the same bars given to you. These are arithmetic facts about this chart — cite them, do not recompute or override them.',
        ...confluence,
        ...riskReward,
    ].join('\n');
}
