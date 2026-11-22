import {
    eventCategoryLabel,
    isCompanyEarningsEvent,
} from '@/domain/analysis/earningsEvents';
import { ANALYSIS_TREND_MIN_BARS } from '@/domain/analysis/analysisTrend';
import {
    formatNullableNumber,
    formatQuotedPrice,
    formatSignedNumber,
    type PriceQuoting,
} from '@/domain/analysis/promptFormat';
import { ATR_DEFAULT_PERIOD } from '@/domain/indicators/constants';
import { formatStopTargetSpacing } from '@/domain/analysis/stopTargetSpacing';
import {
    confluenceFamilyWeight,
    evaluateConfluence,
    type SignalFreshness,
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
import {
    TREND_EMA_PERIOD,
    TREND_SLOPE_LOOKBACK,
    TREND_SLOPE_MIN_ATR,
} from '@/domain/signals/constants';
import type {
    AnalysisTrendReading,
    Bar,
    MarketEvent,
    MarketReference,
    NewsCategory,
    NewsImpact,
    PullbackEventCaveatInput,
    Timeframe,
} from '@/domain/types';

/**
 * Deterministic chart facts rendered into the analysis prompt.
 *
 * Numbers the model was previously asked to produce itself now arrive pre-computed: the
 * indicator-confluence tally, the short-term washout reading (daily charts), the trend
 * and the stop and target spacing.
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
 * **What the tally is not.** It was rendered with backtest authority. A later
 * out-of-sample re-measurement of this exact daily configuration, against an any-day
 * baseline over a 10-day horizon, found days with the entry rule met did *not* beat the
 * baseline, and exit-rule days beat it only in some periods. The tally is rendered as a
 * description of indicator agreement, not as evidence for or against entering.
 *
 * **Why the washout reading is here.** The same re-measurement found a different
 * reading — a short-term washout inside a long-term uptrend — ahead of
 * its baseline in every period tested. On those days the tally reads bearish about two thirds of
 * the time, so without the reading next to it the tally pulls the verdict the wrong way on
 * exactly the charts where the measured edge is.
 *
 * **Why the structural risk:reward is gone (WP-18).** The block divided the distance to the
 * nearest level above by the distance to the nearest level below and told the model that a
 * ratio under 1.0 meant "entering here risks more than the next move offers". Across the
 * 65-symbol daily replay set both anchors sat a median 0.53 ATR from the close (inside one
 * bar's range), the ratio's rank correlation with the next 10 sessions' return was 0.001,
 * and the printed levels held no more often than a price at the same distance on another
 * date. A verdict sentence on a number that carries no information is a claim the data
 * contradict (DOM-9, DOM-12), so the ratio and its sentences were removed; the measured
 * level statement is in the market reference framing and the plan's own risk:reward is
 * arithmetic on its own stop and target (`planCheck`).
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
 * window. **It did not survive re-measurement against a baseline**: this daily
 * configuration's met entry rule did not beat the any-day baseline over 10 days, and the
 * original rule was indistinguishable from its baseline over a long sample. The constants stay (they define the tally the prompt describes);
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
 * variant has not been backtested at all.** (A consumer's 1-hour measurement of its own
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
    // The daily rule's parameters on weekly bars: not measured there, and the
    // reliability line says so.
    '1Week': { min: 3, expectedWeight: 1 },
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
    '1Week':
        'Weekly, not measured: descriptive only. Report the tally as how many indicator families agree.',
};

/** `short_ma_bullish_cross(ma)` — or `support_proximity_bullish(support, half weight)` when expected. */
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
    quoting: PriceQuoting
): string[] {
    const params = snapshot.params;
    const maText =
        snapshot.ma50 === null
            ? 'SMA50 unavailable (short history)'
            : `close ${formatQuotedPrice(snapshot.close, quoting)} vs SMA50 ${formatQuotedPrice(snapshot.ma50, quoting)} (${
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
 * Asked to judge it, the model never chose "enter": across repeated A/B runs,
 * `entryRecommendation` was "wait" every time. It read the
 * reading's normal companions — a bearish tally, a red Elder
 * Impulse, price under the short averages — as missing confirmation, and asked for a
 * reversal candle or a close back above MA5. That confirmation is exactly what the
 * measurement found costs the edge (waiting for %R to cross back lost it in every
 * period). Rewriting the rule alone moved only some washout days to "enter"; printing the
 * verdict as a rule-engine value, like the tally, moved all of them and left
 * every near-washout day at "wait".
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
 * `earnings` is a theme label on news cards, not proof the company reported. With
 * `earningsDates` supplied, an `earnings` row counts only within the report-date window
 * ({@link isCompanyEarningsEvent}); guidance and regulation are unchanged. With it omitted
 * or empty (calendar unknown) the row still counts — suspending the verdict is the safe side when a real report cannot
 * be ruled out — but the verdict text calls it "earnings-related news", never a report.
 *
 * @internal
 * @param events - Market events for this symbol, any order.
 * @param bars - Daily bars, oldest first.
 * @param earningsDates - `YYYY-MM-DD` report dates of this company, past and upcoming.
 * @returns The first qualifying event, or `null` when the drop is not news-driven.
 */
export function newsDrivenWashoutEvent(
    events: readonly MarketEvent[],
    bars: readonly Bar[],
    earningsDates?: readonly string[]
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
                WASHOUT_NEWS_IMPACTS.includes(event.impact) &&
                (event.category !== 'earnings' ||
                    earningsDates === undefined ||
                    earningsDates.length === 0 ||
                    isCompanyEarningsEvent(event.publishedAt, earningsDates))
            );
        }) ?? null
    );
}

/**
 * A short English caveat for a consumer to attach as `pullback.caveat` when a
 * company event landed within the last sessions, or `null` when none did. Uses the
 * same gate as the analysis prompt's suspended washout verdict, so the agent tool
 * and the analysis agree on when the sell-off base rate does not apply.
 */
export function pullbackEventCaveat(
    input: PullbackEventCaveatInput
): string | null {
    const event = newsDrivenWashoutEvent(
        input.events,
        input.bars,
        input.earningsDates
    );
    if (event === null) return null;
    return `A ${event.impact}-impact ${eventCategoryLabel(event, input.earningsDates)} event (${event.sentiment}, published ${event.publishedAt.toISOString().slice(0, 10)}) landed within the last ${WASHOUT_NEWS_LOOKBACK_SESSIONS} sessions. The sell-off base rate was measured without news-driven drops, so it may not apply to this drop.`;
}

const WASHOUT_ENTRY_VERDICT =
    'Entry verdict (computed): enter — sell-off path. Put the entry zone at the snapshot close area so the close is inside it, and the verdict follows the Step 1 state ("enter" when the close is in the zone and a target lies at least one ATR above it); do not re-judge it. The exit reference is MA5 (or about 10 trading days), and the prose names the downside risks and where the reading fails (a close under MA200). No confirmation candle is required.';

/**
 * The suspended verdict names the event itself rather than pointing at `## Market Events`:
 * that section stops at the last bar's stamp and keeps at most a handful of events, so the
 * same-session article this gate exists to catch can be absent from it.
 */
const washoutNewsVerdict = (
    event: MarketEvent,
    earningsDates: readonly string[] | undefined
): string =>
    `Entry verdict (computed): none — a ${event.impact}-impact ${eventCategoryLabel(event, earningsDates)} event (${event.sentiment}, published ${event.publishedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC) landed within the last ${WASHOUT_NEWS_LOOKBACK_SESSIONS} sessions. The measured sell-off history does not cover news-driven drops, which were its largest failures. Place the entry zone yourself from the event and the chart (code sets entryRecommendation from where the close sits against it), and say that the sell-off base rate does not apply to this drop.`;

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
 * The inputs precede the reading so the model can check the conclusion against the numbers. The
 * base rate is printed only for a reading that has one; `none` carries no claim.
 */
function formatPullback(
    snapshot: PullbackSnapshot,
    quoting: PriceQuoting,
    newsEvent: MarketEvent | null,
    earningsDates: readonly string[] | undefined
): string[] {
    const side = snapshot.close > snapshot.ma200 ? 'above' : 'at or below';
    const lines = [
        PULLBACK_HEADER,
        `Close ${formatQuotedPrice(snapshot.close, quoting)} vs MA200 ${formatQuotedPrice(snapshot.ma200, quoting)} (${formatNullableNumber(snapshot.closeVsMa200Pct)}%, ${side})`,
        `Williams %R(14): ${formatNullableNumber(snapshot.williamsR)} / RSI(2): ${formatNullableNumber(snapshot.rsi2)}`,
        `Exit reference MA5: ${formatQuotedPrice(snapshot.ma5, quoting)} — the measured sell-off is treated as resolved on the first daily close above it, or after about 10 trading days`,
        `Reading: ${PULLBACK_READING_TEXT[snapshot.reading]}`,
    ];
    if (snapshot.reading === 'none') return lines;
    const measured = `Measured: ${PULLBACK_BASE_RATES[snapshot.reading]}`;
    if (snapshot.reading !== 'washoutInUptrend') return [...lines, measured];
    const verdict =
        newsEvent === null
            ? WASHOUT_ENTRY_VERDICT
            : washoutNewsVerdict(newsEvent, earningsDates);
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
    quoting: PriceQuoting,
    events: readonly MarketEvent[],
    earningsDates: readonly string[] | undefined
): string[] {
    if (timeframe !== '1Day') return [];
    const snapshot = evaluatePullback(bars);
    return snapshot !== null
        ? formatPullback(
              snapshot,
              quoting,
              newsDrivenWashoutEvent(events, bars, earningsDates),
              earningsDates
          )
        : [
              PULLBACK_HEADER,
              `Not measurable: the reading needs ${PULLBACK_TREND_MA_PERIOD} daily bars for MA200 and received ${bars.length}. This is an absence of measurement, not an absence of a sell-off.`,
          ];
}

const ENTRY_ZONE_HEADER = '### Entry Zone vs Last Close';

/**
 * The close the plan state is judged against, printed with the zone's own formatter (DOM-8,
 * DOM-11) so the model can place the zone around it. It lives here and not in the Step 1
 * rule because that rule sits in the cross-symbol byte-stable prefix and cannot carry a
 * per-chart number. Empty without a usable last close.
 */
function formatEntryZoneRule(
    bars: readonly Bar[],
    quoting: PriceQuoting
): string[] {
    const close = bars.at(-1)?.close;
    if (close === undefined || !Number.isFinite(close) || close <= 0) {
        return [];
    }
    return [
        ENTRY_ZONE_HEADER,
        `Last close ${formatQuotedPrice(close, quoting)}. Code reads entryPrices against this close with exact edges: the zone contains it when its low <= close <= its high; a zone whose high is below the close is a pullback plan; a zone above the close needs a rise into it. Step 1 of the action rules gives the entryRecommendation for each. To plan an entry at the price, make the zone contain the last close.`,
    ];
}

/** @internal The line under `## Deterministic Metrics`: every figure below it is computed from this chart's bars. */
export const METRICS_INTRO =
    'Computed from the same bars given to you. These are arithmetic facts about this chart — cite them, do not recompute or override them.';

/**
 * The same line once the higher-timeframe or market-backdrop block is present: those blocks name
 * their own bars, so "the same bars" would no longer be true (DOM-9). It is printed only then,
 * so a prompt without them keeps its bytes. The replay's H2b gate (`withoutHtfBlocks`) restores
 * {@link METRICS_INTRO} from this exact text.
 *
 * @internal
 */
export const METRICS_INTRO_WITH_CONTEXT_BLOCKS =
    'Computed from the same bars given to you, except the blocks that name their own bars (Higher Timeframe, Market Backdrop). These are arithmetic facts about this chart — cite them, do not recompute or override them.';

const TREND_HEADER = '### Trend (computed)';

/**
 * The computed trend as a prompt block (WP-15 C13). The numbers printed are the ones the
 * label was decided on, so recomputing the label from the text gives the same label.
 * Present on every timeframe: the rule is in ATR units and carries no measured claim.
 *
 * `reading === null` is the unmeasurable case: the block says so and hands the judgement
 * back to the model, because an unmeasurable input (short history, no usable ATR or close)
 * is not evidence of "neutral".
 */
function formatTrendBlock(
    reading: AnalysisTrendReading | null,
    barCount: number,
    quoting: PriceQuoting
): string[] {
    if (reading === null) {
        return [
            TREND_HEADER,
            `Not measurable: the rule needs at least ${ANALYSIS_TREND_MIN_BARS} bars (EMA${TREND_EMA_PERIOD} ${TREND_SLOPE_LOOKBACK} bars back), a positive ATR(${ATR_DEFAULT_PERIOD}) and a positive close; received ${barCount} bars. Judge the top-level trend yourself.`,
        ];
    }
    const closeVsEma =
        reading.close > reading.emaLast
            ? 'above'
            : reading.close < reading.emaLast
              ? 'below'
              : 'equal to';
    const min = formatNullableNumber(TREND_SLOPE_MIN_ATR, 0);
    return [
        TREND_HEADER,
        `Trend: ${reading.trend}. EMA${TREND_EMA_PERIOD} moved ${formatSignedNumber(reading.slopeAtr)} ATR(${ATR_DEFAULT_PERIOD}) over the last ${TREND_SLOPE_LOOKBACK} bars (from ${formatQuotedPrice(reading.emaFrom, quoting)} to ${formatQuotedPrice(reading.emaLast, quoting)}) and the close ${formatQuotedPrice(reading.close, quoting)} is ${closeVsEma} EMA${TREND_EMA_PERIOD}.`,
        `Rule: bullish when EMA${TREND_EMA_PERIOD} rose by at least ${min} ATR(${ATR_DEFAULT_PERIOD}) over the last ${TREND_SLOPE_LOOKBACK} bars and the close is above EMA${TREND_EMA_PERIOD}; bearish when it fell by at least ${min} ATR(${ATR_DEFAULT_PERIOD}) and the close is below EMA${TREND_EMA_PERIOD}; otherwise neutral. Copy this value into the top-level "trend" field and state this trend in summary, in the response language's own word for it (do not print the English label there). A longer-term picture that differs (for example a close under MA200) is context for the prose, not a different trend.`,
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
 *
 * `trend` is `buildAnalysisPrompt`'s one computation of the trend reading: a reading prints
 * the `### Trend (computed)` block and `null` prints its "not measurable" form. It is required
 * on purpose: a caller that omitted it would silently leave the model's own trend unframed.
 *
 * `contextBlocks` are the lines of the higher-timeframe and market-backdrop blocks
 * (`higherTimeframeSection.ts`), printed right after the trend block they refer to; empty (the
 * default) leaves the section byte-identical to what it printed without them. They are
 * descriptive and never reach the confluence gate below.
 */
export function formatDeterministicMetricsSection(
    bars: readonly Bar[],
    timeframe: Timeframe,
    reference: MarketReference,
    quoting: PriceQuoting = { dp: 2, krxTick: null },
    events: readonly MarketEvent[] = [],
    earningsDates: readonly string[] | undefined,
    trend: AnalysisTrendReading | null,
    freshness?: SignalFreshness,
    contextBlocks: readonly string[] = []
): string {
    const { min, expectedWeight } = CONFLUENCE_PARAMS_BY_TIMEFRAME[timeframe];
    // `exitMin` is deliberately not raised alongside `min` on the daily chart. Raising the
    // entry bar is the intent; raising the exit bar with it is the defect that principle
    // guards against — a missed entry costs opportunity, a missed exit costs money. The
    // asymmetry it leaves on `1Day` (entry 3, exit 2.5) is the correct direction.
    // The alignment gate stays off: `### Higher Timeframe (computed)` is descriptive (the
    // daily-and-weekly agreement showed no forward edge), so it never reaches this backtested
    // rule. That is the intended configuration on `1Day` (there is no natural timeframe above
    // it for the backtested rule) and an accepted looseness on intraday charts.
    const snapshot = evaluateConfluence(bars, {
        timeframe,
        min,
        expectedWeight,
        freshness,
    });

    const confluence =
        snapshot !== null
            ? formatConfluence(snapshot, timeframe, quoting)
            : [
                  `### Indicator Agreement (computed, ${timeframe} bars)`,
                  `Not measurable: the check needs more than ${CONFLUENCE_MIN_BARS} bars and received ${bars.length}. This is an absence of measurement, not an absence of agreement — judge the indicators yourself for this chart.`,
              ];

    const pullback = formatPullbackSection(
        bars,
        timeframe,
        quoting,
        events,
        earningsDates
    );
    const spacing = formatStopTargetSpacing(
        reference,
        bars,
        timeframe,
        quoting
    );

    return [
        DETERMINISTIC_METRICS_HEADER,
        contextBlocks.length === 0
            ? METRICS_INTRO
            : METRICS_INTRO_WITH_CONTEXT_BLOCKS,
        ...formatTrendBlock(trend, bars.length, quoting),
        ...contextBlocks,
        ...confluence,
        ...pullback,
        ...spacing,
        ...formatEntryZoneRule(bars, quoting),
    ].join('\n');
}
