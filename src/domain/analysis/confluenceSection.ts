import { structuralRiskReward } from '@/domain/analysis/planCheck';
import {
    AT_PRICE_BAR_RANGE_FRACTION,
    meanBarRangePercent,
} from '@/domain/analysis/referenceLevels';
import { formatNullableNumber } from '@/domain/analysis/promptFormat';
import { ATR_DEFAULT_PERIOD } from '@/domain/indicators/constants';
import {
    confluenceFamilyWeight,
    evaluateConfluence,
    isExpectedSignal,
    signalFamily,
    CONFLUENCE_MIN_BARS,
    type ConfluenceSnapshot,
} from '@/domain/signals/confluence';
import {
    evaluatePullback,
    PULLBACK_BASE_RATES,
    PULLBACK_TREND_MA_PERIOD,
    type PullbackReading,
    type PullbackSnapshot,
} from '@/domain/signals/pullback';
import type {
    Bar,
    MarketEvent,
    MarketReference,
    NewsCategory,
    NewsImpact,
    ReferenceLevel,
    ReferenceLevels,
    Timeframe,
} from '@/domain/types';

/**
 * Deterministic chart facts rendered into the analysis prompt.
 *
 * Numbers the model was previously asked to produce itself now arrive pre-computed: the
 * indicator-confluence tally, the short-term washout reading (daily charts) and the
 * risk:reward available from the current price.
 *
 * **Why confluence moved out of the model.** The prompt used to instruct: *"Count
 * confirming signals from different categories … Strong confluence: 3+ categories agree."*
 * The tally happened inside the model, so only the count survived into the output and
 * nothing about it could be checked. The categories were also coarser than the data
 * warrants — every trend indicator collapsed into one bucket while RSI, StochRSI and
 * Connors RSI, which are three transforms of the same close series, could each be read as
 * separate confirmation. The rule engine counts **indicator families**, which is the
 * correction.
 *
 * **What the tally is not.** It was rendered with backtest authority because an
 * auto-trader downstream scored with the same engine. That trader retired the rule on
 * 2026-09-24 after its own measurement, and a re-measurement of this exact daily
 * configuration (point-in-time S&P 500 2000–2020 plus large caps 2024–26) found days with
 * the entry rule met followed by *below*-baseline 10-day returns in all five periods, and
 * exit-rule days by returns above the baseline in three of five periods and level with it in a
 * fourth (2000–07, 0.01 point below; 2007–09 was below). The tally is rendered as a
 * description of indicator agreement, not as evidence for or against entering
 * (docs/superpowers/specs/2026-09-25-pullback-washout-design.md).
 *
 * **Why the washout reading is here.** The same re-measurement found the reading
 * siglens-trader switched to — a short-term washout inside a long-term uptrend — ahead of
 * its baseline in every period. On those days the tally reads bearish about two thirds of
 * the time, so without the reading next to it the tally pulls the verdict the wrong way on
 * exactly the charts where the measured edge is.
 *
 * **Why risk:reward moved out.** Measured over 426 production ticks: the nearest
 * resistance sat *below* the current price 14.6% of the time, and the median upside to the
 * first obstacle was 0.74%. The effect was worst exactly where the indicators agreed most
 * — median risk:reward 1.27 in a middling composite-score band versus **0.00** in the
 * highest. Strong confluence is therefore not evidence that entering now is attractive,
 * and the model cannot notice that unless the ratio is put in front of it before it writes
 * a verdict.
 */

/**
 * @internal
 *
 * Header for the deterministic block. Exported so tests assert the rendered text.
 */
export const DETERMINISTIC_METRICS_HEADER = '## Deterministic Metrics';

/**
 * @internal
 *
 * Confluence tunables that differ by chart timeframe.
 */
export interface TimeframeConfluenceParams {
    /** Weighted indicator families the entry rule requires. */
    min: number;
    /** Vote weight of an `expected`-phase signal. */
    expectedWeight: number;
}

/**
 * @internal
 *
 * Per-timeframe confluence parameters.
 *
 * The daily row restores the two **constants** the original backtest used — a threshold of
 * three and `expected` signals counted in full. That backtest ran on daily bars with a
 * ten-day hold and won its comparison at 70% versus 61.5% for an LLM read over the same
 * window. **It did not survive re-measurement against a baseline**: in 2026-09, this daily
 * configuration's met entry rule trailed the any-day baseline over 10 days in all five
 * periods tested, and siglens-trader found the original rule indistinguishable from its
 * baseline over 2015–26. The constants stay (they define the tally the prompt describes);
 * the authority does not — see {@link CONFLUENCE_RELIABILITY}.
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
 * variant has not been backtested at all.** (siglens-trader's 1-hour measurement of its own
 * gated variant found no advantage over the baseline after costs.)
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
 * How much authority a met rule carries on each timeframe — as measured, none.
 *
 * Every row says the same thing in the chart's own terms: the tally describes how many
 * indicator families agree, and neither rule has a measured forward edge. The daily row
 * carries the numbers because the daily configuration is the one that was measured
 * directly; intraday rows point at the 1-hour measurement, the only intraday one there is.
 */
const INTRADAY_RELIABILITY =
    'Intraday, descriptive only — the rule has no measured forward edge on intraday bars (1-hour backtests found no advantage over the baseline after costs). Report the tally as how many indicator families agree; do not treat a met entry or exit rule as a reason to enter or exit.';

const CONFLUENCE_RELIABILITY: Record<Timeframe, string> = {
    '5Min': INTRADAY_RELIABILITY,
    '15Min': INTRADAY_RELIABILITY,
    '30Min': INTRADAY_RELIABILITY,
    '1Hour': INTRADAY_RELIABILITY,
    '4Hour': INTRADAY_RELIABILITY,
    '1Day': 'Daily, descriptive only — measured 2000–2026, days with this entry rule met were followed by below-baseline 10-day returns in every period, and exit-rule days by returns above the baseline in three of five, level with it in a fourth and below it in 2007–09. Report the tally as how many indicator families agree, not as evidence for or against entering.',
};

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

/** Decimal places for the weighted family count (half-weight members make `.5`). */
const FAMILY_COUNT_DECIMALS = 1;

/** Weighted count of distinct indicator families, at most one decimal (`2.5`, `3`). */
function familyCount(types: readonly string[], expectedWeight: number): string {
    return String(
        Number(
            confluenceFamilyWeight(types, expectedWeight).toFixed(
                FAMILY_COUNT_DECIMALS
            )
        )
    );
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
    timeframe: Timeframe,
    priceDp: number
): string[] {
    const params = snapshot.params;
    const maText =
        snapshot.ma50 === null
            ? 'SMA50 unavailable (short history)'
            : `close ${formatNullableNumber(snapshot.close, priceDp)} vs SMA50 ${formatNullableNumber(snapshot.ma50, priceDp)} (${
                  snapshot.close > snapshot.ma50 ? 'above' : 'at or below'
              })`;

    return [
        `### Indicator Agreement (computed, ${timeframe} bars)`,
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
        // No 0-100 score: the model quoted it ("47/100") as if it were a finding. The two
        // weighted group counts carry the same direction in a form that reads as what it is.
        `Agreeing indicator groups (weighted, a half-weight member counts 0.5): ${familyCount(snapshot.bullish, params.expectedWeight)} bullish vs ${familyCount(snapshot.bearish, params.expectedWeight)} bearish`,
        `Reliability: ${CONFLUENCE_RELIABILITY[timeframe]}`,
        // Families, not indicator names, are what the count is over. Without this line the
        // model sees four RSI-derived rows elsewhere in the prompt and reasonably reads
        // them as four confirmations.
        'Counting unit: indicator families. RSI, StochRSI and Connors RSI are one family (they transform the same close series); MACD line/signal/histogram are one; every Bollinger read is one. Do not recount the raw indicator list as independent confirmations.',
    ];
}

const PULLBACK_HEADER = '### Short-term sell-off check (computed, 1Day bars)';

/**
 * The verdict for the washout reading, decided here rather than by the model.
 *
 * Asked to judge it, the model never chose "enter": over 6,070 production analyses
 * (p9–p16) and a 170-case A/B, `entryRecommendation` was "wait" every time. It read the
 * reading's normal companions — a bearish tally, a sub-1.0 structural ratio, a red Elder
 * Impulse, price under the short averages — as missing confirmation, and asked for a
 * reversal candle or a close back above MA5. That confirmation is exactly what the
 * measurement found costs the edge (waiting for %R to cross back lost it in every
 * period). Rewriting the rule alone moved 8–14 of 25 washout days to "enter"; printing the
 * verdict as a rule-engine value, like the tally and the ratio, moved 25 of 25 and left
 * every near-washout day at "wait" (docs/superpowers/specs/2026-09-26-washout-entry-verdict-design.md).
 */
/**
 * Sessions, counted back from the last bar and including it, in which a company event
 * suspends the washout verdict. A drop that follows an earnings print or a guidance cut
 * usually lands the same session or the next; three covers a report released after the
 * close plus the day the washout closed.
 */
const WASHOUT_NEWS_LOOKBACK_SESSIONS = 3;
/** One calendar day. Daily bars are stamped at UTC midnight, so a same-day article is later. */
const DAY_MS = 86_400_000;
/**
 * The drops the skill and the measurement name as not covered — earnings, guidance and
 * regulatory news were the setup's big failures. M&A and product news are left out: they
 * rarely produce a washout and did not show up among the failures.
 */
const WASHOUT_NEWS_CATEGORIES: readonly NewsCategory[] = [
    'earnings',
    'guidance',
    'regulation',
];
const WASHOUT_NEWS_IMPACTS: readonly NewsImpact[] = ['high', 'medium'];

/**
 * The company event that makes this washout a news-driven drop, or `null`.
 *
 * Why the verdict needs this: `WASHOUT_ENTRY_VERDICT` tells the model not to re-judge, so
 * without a gate it overrides the one case the measurement does not cover. In the A/B that
 * introduced the verdict, 3 of 23 "enter" days fell within 3 days of an earnings date (one
 * lost 9.6% on the MA5 exit). The window runs to a day past the last bar because a daily bar
 * is stamped at UTC midnight and an article from that session is published after it — the
 * `## Market Events` selection stops at the bar stamp and would miss it.
 *
 * Bullish-labelled events are ignored: they do not explain a washout.
 *
 * @internal
 * @param events - Market events for this symbol, any order.
 * @param bars - Daily bars, oldest first.
 * @returns The first qualifying event, or `null` when the drop is not news-driven.
 */
export function newsDrivenWashoutEvent(
    events: readonly MarketEvent[],
    bars: readonly Bar[]
): MarketEvent | null {
    const from = bars.at(-WASHOUT_NEWS_LOOKBACK_SESSIONS) ?? bars.at(0);
    const last = bars.at(-1);
    if (from === undefined || last === undefined) return null;
    const fromMs = from.time * 1000;
    const toMs = last.time * 1000 + DAY_MS;
    return (
        events.find(event => {
            const at = event.publishedAt.getTime();
            return (
                at >= fromMs &&
                at < toMs &&
                event.sentiment !== 'bullish' &&
                WASHOUT_NEWS_CATEGORIES.includes(event.category) &&
                WASHOUT_NEWS_IMPACTS.includes(event.impact)
            );
        }) ?? null
    );
}

const WASHOUT_ENTRY_VERDICT =
    'Entry verdict (computed): enter — sell-off path. Copy "enter" into actionRecommendation.entryRecommendation; do not re-judge it. The entry reference is the snapshot close area, the exit reference is MA5 (or about 10 trading days), and the prose names the downside risks and where the reading fails (a close under MA200). No confirmation candle is required.';

/**
 * The suspended verdict names the event itself rather than pointing at `## Market Events`:
 * that section stops at the last bar's stamp and keeps at most a handful of events, so the
 * same-session article this gate exists to catch can be absent from it.
 */
const washoutNewsVerdict = (event: MarketEvent): string =>
    `Entry verdict (computed): none — a ${event.impact}-impact ${event.category} event (${event.sentiment}, published ${event.publishedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC) landed within the last ${WASHOUT_NEWS_LOOKBACK_SESSIONS} sessions. The measured sell-off history does not cover news-driven drops, which were its largest failures. Judge entryRecommendation yourself from the event and the chart, and say that the sell-off base rate does not apply to this drop.`;

const PULLBACK_READING_TEXT: Record<PullbackReading, string> = {
    washoutInUptrend:
        'sell-off in an uptrend — close above MA200 and Williams %R(14) at or below -90',
    nearWashoutInUptrend:
        'near sell-off in an uptrend — close above MA200 and Williams %R(14) between -90 and -80',
    washoutBelowMa200:
        'sell-off below MA200 — Williams %R(14) at or below -90 with the close at or under MA200',
    none: 'none — no short-term sell-off on this bar',
};

/**
 * Render the washout half of the block — daily charts only.
 *
 * The inputs precede the reading for the same reason the risk:reward block prints its
 * levels before its ratio: the model can check the conclusion against the numbers. The
 * base rate is printed only for a reading that has one; `none` carries no claim.
 */
function formatPullback(
    snapshot: PullbackSnapshot,
    priceDp: number,
    newsEvent: MarketEvent | null
): string[] {
    const side = snapshot.close > snapshot.ma200 ? 'above' : 'at or below';
    const lines = [
        PULLBACK_HEADER,
        `Close ${formatNullableNumber(snapshot.close, priceDp)} vs MA200 ${formatNullableNumber(snapshot.ma200, priceDp)} (${formatNullableNumber(snapshot.closeVsMa200Pct)}%, ${side})`,
        `Williams %R(14): ${formatNullableNumber(snapshot.williamsR)} / RSI(2): ${formatNullableNumber(snapshot.rsi2)}`,
        `Exit reference MA5: ${formatNullableNumber(snapshot.ma5, priceDp)} — the measured sell-off is treated as resolved on the first daily close above it, or after about 10 trading days`,
        `Reading: ${PULLBACK_READING_TEXT[snapshot.reading]}`,
    ];
    if (snapshot.reading === 'none') return lines;
    const measured = `Measured: ${PULLBACK_BASE_RATES[snapshot.reading]}`;
    if (snapshot.reading !== 'washoutInUptrend') return [...lines, measured];
    const verdict =
        newsEvent === null
            ? WASHOUT_ENTRY_VERDICT
            : washoutNewsVerdict(newsEvent);
    return [...lines, verdict, measured];
}

/**
 * The washout block for a chart, or nothing on intraday timeframes. The measurement is on
 * daily bars, and MA200 on an intraday chart is a different object — rendering it there
 * would put an unmeasured claim in front of the model.
 */
function formatPullbackSection(
    bars: readonly Bar[],
    timeframe: Timeframe,
    priceDp: number,
    events: readonly MarketEvent[]
): string[] {
    if (timeframe !== '1Day') return [];
    const snapshot = evaluatePullback(bars);
    return snapshot !== null
        ? formatPullback(
              snapshot,
              priceDp,
              newsDrivenWashoutEvent(events, bars)
          )
        : [
              PULLBACK_HEADER,
              `Not measurable: the reading needs ${PULLBACK_TREND_MA_PERIOD} daily bars for MA200 and received ${bars.length}. This is an absence of measurement, not an absence of a sell-off.`,
          ];
}

/**
 * Levels beyond the at-price band on each side: not flagged `atPrice` by the reference
 * builder, and at least `floorPercent` away (the distance check also covers a reference
 * assembled without flags).
 */
function levelsBeyondNoise(
    levels: ReferenceLevels,
    floorPercent: number
): ReferenceLevels {
    const clear = (l: ReferenceLevel): boolean =>
        !l.atPrice && Math.abs(l.distancePercent) >= floorPercent;
    return {
        support: levels.support.filter(clear),
        resistance: levels.resistance.filter(clear),
    };
}

/** Pick the tightest horizon that still has a level beyond the noise floor on both sides. */
function nearestLevels(
    reference: MarketReference,
    floorPercent: number
): ReferenceLevels | null {
    for (const horizon of [reference.short, reference.medium, reference.long]) {
        const levels = levelsBeyondNoise(horizon.levels, floorPercent);
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
const RISK_REWARD_HEADER = '### Risk:Reward From Current Price';

function formatRiskReward(
    reference: MarketReference,
    bars: readonly Bar[],
    priceDp: number
): string[] {
    const meanRangePercent = meanBarRangePercent(bars);
    const floorPercent = meanRangePercent * AT_PRICE_BAR_RANGE_FRACTION;
    const noiseNote =
        floorPercent > 0
            ? [
                  `Levels within ${formatNullableNumber(floorPercent)}% of the current price (half the mean bar range over the last ${ATR_DEFAULT_PERIOD} bars) sit inside ordinary bar noise and are skipped here. Do not anchor a stop-loss or an entry trigger on such an at-price level.`,
              ]
            : [];
    // Said explicitly rather than dropping the block: a silently absent ratio reads to the
    // model as "nothing to worry about", which is a claim, not an absence of measurement.
    const notMeasurable = [
        RISK_REWARD_HEADER,
        ...noiseNote,
        'Not measurable: no horizon has both a support and a resistance level beyond bar noise. This is an absence of measurement, not a favourable or unfavourable ratio — do not derive one from at-price levels.',
    ];

    const levels = nearestLevels(reference, floorPercent);
    const up = levels?.resistance[0];
    const down = levels?.support[0];
    if (!levels || !up || !down) return notMeasurable;

    // Can still be null after the guard above: a zero-distance support or a "resistance"
    // the collector placed at or below the price makes the ratio undefined, not zero.
    //
    // Both legs use their raw distances. The noise band above already bounds each leg from
    // below at the same half bar range, so the ratio cannot explode. Flooring only the risk
    // leg at a full bar range was tried and rejected: across 90 real charts it pushed 34
    // verdicts from >= 1.0 to below 1.0, where the verdict sentence ("the nearest obstacle
    // above is closer than the nearest support below") became false.
    const ratio = structuralRiskReward(levels);
    if (ratio === null) return notMeasurable;

    const verdict =
        ratio < 1
            ? 'Below 1.0: the nearest obstacle above is closer than the nearest support below. Outside the sell-off path, entering here risks more than the next move offers.'
            : 'At or above 1.0: there is more room to the next obstacle above than to the support below.';

    return [
        RISK_REWARD_HEADER,
        ...noiseNote,
        `Nearest resistance ${up.label} at ${formatNullableNumber(up.price, priceDp)} (${formatNullableNumber(up.distancePercent)}%)`,
        `Nearest support ${down.label} at ${formatNullableNumber(down.price, priceDp)} (${formatNullableNumber(down.distancePercent)}%)`,
        `Structural risk:reward from current price = ${fmtRatio(ratio)}`,
        verdict,
        // The correlation is the part the model cannot infer from the ratio alone.
        'Measured downstream: analyses with the strongest indicator agreement carried the WORST ratios (median 0.00 in the highest agreement band, 1.27 in a middling one). Outside the sell-off path, strong indicator agreement plus a sub-1.0 ratio is a reason to set entryRecommendation to "wait" and name a pullback level, not a reason to enter. On a sell-off in an uptrend the nearest levels sit a bar or two away on both sides, so this ratio is not the measured edge and does not override the sell-off verdict.',
    ];
}

/**
 * @internal
 *
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
    reference: MarketReference,
    priceDp = 2,
    events: readonly MarketEvent[] = []
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
            ? formatConfluence(snapshot, timeframe, priceDp)
            : [
                  `### Indicator Agreement (computed, ${timeframe} bars)`,
                  `Not measurable: the check needs more than ${CONFLUENCE_MIN_BARS} bars and received ${bars.length}. This is an absence of measurement, not an absence of agreement — judge the indicators yourself for this chart.`,
              ];

    const pullback = formatPullbackSection(bars, timeframe, priceDp, events);
    const riskReward = formatRiskReward(reference, bars, priceDp);

    return [
        DETERMINISTIC_METRICS_HEADER,
        'Computed from the same bars given to you. These are arithmetic facts about this chart — cite them, do not recompute or override them.',
        ...confluence,
        ...pullback,
        ...riskReward,
    ].join('\n');
}
