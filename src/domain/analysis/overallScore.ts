import type { OptionsTone } from '@/domain/options/types';
import type {
    AnalysisResponse,
    FinancialsScorecard,
    FundamentalAnalysisResponse,
    NewsAnalysisResponse,
    OptionsAnalysisResponse,
    Timeframe,
    Trend,
} from '@/domain/types';

/**
 * Deterministic weighted read across the overall-analysis axes.
 *
 * The overall prompt hands five axis reports to one model and asks it to synthesize. The
 * only thing telling it how to weigh them is a prose sentence per timeframe — *"Technical,
 * fundamental, and news inputs carry roughly equal weight"* — which is a hint, not an
 * arithmetic, and leaves no record of what the synthesis actually weighed.
 *
 * This computes that weighting explicitly so the model can be shown the number, and so the
 * number survives into a stored analysis where it can be compared across runs. The
 * downstream trading system carries the same structure and the same failure history:
 * weights that were never written down cannot be audited, and an axis that never varies
 * looks like a vote while acting as a constant.
 *
 * **It deliberately produces no verdict.** Each axis reports a three-value direction, so
 * the composite lands on a small discrete set rather than a continuous distribution, and
 * no threshold separating "buy" from "hold" has been measured on it. Attaching one would
 * repeat the mistake of picking a cutoff from intuition about a single axis instead of
 * from the distribution it actually produces.
 */

/**
 * @internal
 *
 * An axis that can vote in the overall synthesis.
 */
export type OverallScoreAxis =
    | 'technical'
    | 'fundamental'
    | 'news'
    | 'options'
    | 'financials';

/** Neutral midpoint of the 0–100 axis scale. */
const NEUTRAL = 50;

/**
 * Distance a directional axis moves from {@link NEUTRAL}.
 *
 * A three-value enum reports a *direction*, not a magnitude: `bullish` from the news axis
 * means "the news leans positive", not "maximally positive". Mapping it to 100 would let
 * one axis drag the composite fifty points on evidence that only distinguishes three
 * states, so the scale is compressed to 25..75 and the axis weights do the separating.
 */
const DIRECTIONAL_SPAN = 25;

/**
 * Directional vote each options tone casts, averaged across expirations.
 *
 * `cautious` is half a bearish vote rather than neutral: it means protection is being
 * bought, which is not a directional call but is not the absence of one either. Folding it
 * into `neutral` would erase the distinction the tone union exists to make.
 */
const TONE_VOTE: Record<OptionsTone, number> = {
    bullish: 1,
    bearish: -1,
    cautious: -0.5,
    neutral: 0,
};

const SENTIMENT_SCORE: Record<Trend, number> = {
    bullish: NEUTRAL + DIRECTIONAL_SPAN,
    neutral: NEUTRAL,
    bearish: NEUTRAL - DIRECTIONAL_SPAN,
};

/**
 * @internal
 *
 * Per-timeframe axis weights.
 *
 * These are the numeric form of the prose already in the overall prompt — a 5-minute chart
 * is driven by price action while a daily chart gives valuation real say. Writing them as
 * numbers is the point: prose weighting cannot be diffed, cannot be tuned, and leaves no
 * evidence of what a past synthesis weighed.
 *
 * **They are judgment, not measurement.** No backtest sets them. They are ordered so the
 * technical axis dominates intraday and fundamental/financials climb toward the daily
 * chart, which is what the prose already claimed; the specific integers encode relative
 * emphasis, nothing more. The sum carries no meaning — this is a weighted average, and an
 * absent axis drops out of the denominator entirely.
 */
export const OVERALL_AXIS_WEIGHTS: Record<
    Timeframe,
    Record<OverallScoreAxis, number>
> = {
    '5Min': {
        technical: 14,
        news: 6,
        options: 4,
        fundamental: 1,
        financials: 1,
    },
    '15Min': {
        technical: 13,
        news: 6,
        options: 4,
        fundamental: 2,
        financials: 1,
    },
    '30Min': {
        technical: 12,
        news: 6,
        options: 5,
        fundamental: 3,
        financials: 2,
    },
    '1Hour': {
        technical: 11,
        news: 6,
        options: 5,
        fundamental: 4,
        financials: 3,
    },
    '4Hour': {
        technical: 10,
        news: 6,
        options: 5,
        fundamental: 6,
        financials: 5,
    },
    '1Day': {
        technical: 8,
        news: 6,
        options: 5,
        fundamental: 8,
        financials: 7,
    },
};

/**
 * @internal
 *
 * One axis's contribution to the composite.
 */
export interface OverallAxisRead {
    axis: OverallScoreAxis;
    /** 0–100 directional read, or `null` when the axis abstained. */
    score: number | null;
    /** Weight actually applied. `0` for an abstaining axis. */
    weight: number;
    /** Short human-readable basis for the score, e.g. `'trend: bullish'`. */
    basis: string;
}

/**
 * @internal
 *
 * Result of weighting the available axes.
 */
export interface OverallScore {
    timeframe: Timeframe;
    axes: OverallAxisRead[];
    /**
     * Weighted average over the axes that reported, or `null` when none did.
     *
     * Abstaining axes leave the denominator rather than voting neutral. A crypto symbol
     * has no fundamentals by definition, and a fundamental axis silently voting 50 would
     * pull every crypto composite toward the middle for a reason that has nothing to do
     * with the asset.
     */
    composite: number | null;
}

/**
 * @internal
 *
 * Inputs available to the overall synthesis. Anything absent abstains.
 */
export interface OverallScoreInput {
    technical?: AnalysisResponse | null;
    fundamental?: FundamentalAnalysisResponse | null;
    news?: NewsAnalysisResponse | null;
    options?: OptionsAnalysisResponse | null;
    financials?: FinancialsScorecard | null;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Collapse the options axis's per-expiration tones into one directional read.
 *
 * Options is the only axis with no single overall verdict — it reports a tone per
 * expiration. `cautious` counts as half a bearish vote rather than as neutral: it means
 * protection is being bought, which is not a directional call but is not the absence of
 * one either, and folding it into `neutral` would erase the distinction the tone union was
 * created to make.
 */
function scoreOptions(options: OptionsAnalysisResponse): number | null {
    const tones = options.perExpiration.map(entry => entry.tone);
    if (tones.length === 0) return null;

    const sum = tones.reduce((acc, tone) => acc + TONE_VOTE[tone], 0);
    // No clamp: every vote lies in [-1, 1], so their mean does too and the result cannot
    // leave `NEUTRAL ± DIRECTIONAL_SPAN`. A guard here would be unreachable code that
    // reads like a real bound.
    return NEUTRAL + (sum / tones.length) * DIRECTIONAL_SPAN;
}

/**
 * Read one axis that reports a bare three-value direction.
 *
 * Technical, fundamental and news differ only in which field carries the verdict and what
 * that field is called; sharing the body keeps a future change to the scale or to the
 * abstention wording from landing on two of the three.
 */
function readSentimentAxis(
    axis: OverallScoreAxis,
    sentiment: Trend | undefined,
    field: string,
    absent: string
): Omit<OverallAxisRead, 'weight'> {
    return sentiment === undefined
        ? { axis, score: null, basis: absent }
        : {
              axis,
              score: SENTIMENT_SCORE[sentiment],
              basis: `${field} ${sentiment}`,
          };
}

function readOptions(
    input: OverallScoreInput
): Omit<OverallAxisRead, 'weight'> {
    const options = input.options;
    if (!options) {
        return { axis: 'options', score: null, basis: 'no options analysis' };
    }
    const score = scoreOptions(options);
    return score === null
        ? { axis: 'options', score: null, basis: 'no per-expiration tones' }
        : {
              axis: 'options',
              score,
              basis: `${options.perExpiration.length} expiration tones`,
          };
}

/**
 * The financials axis is already numeric, so its own 0–100 composite passes through.
 *
 * Worth naming: that score grades *company quality*, not price direction. A strong balance
 * sheet is a reason a decline is worth buying, not evidence the decline has stopped. It
 * earns a real weight only toward the daily end of {@link OVERALL_AXIS_WEIGHTS} for that
 * reason.
 */
function readFinancials(
    input: OverallScoreInput
): Omit<OverallAxisRead, 'weight'> {
    const score = input.financials?.composite.score;
    return isFiniteNumber(score)
        ? {
              axis: 'financials',
              score: clamp(score, 0, 100),
              basis: `scorecard ${input.financials?.composite.grade ?? '?'}`,
          }
        : { axis: 'financials', score: null, basis: 'no financials scorecard' };
}

/**
 * @internal
 *
 * Weight the available axes into one 0–100 read.
 *
 * @param input - Axis reports; anything absent or unreadable abstains.
 * @param timeframe - Selects the weight profile.
 *
 * @example
 * ```ts
 * const score = computeOverallScore({ technical, news }, '1Day');
 * // score.composite === 60.7, with fundamental/options/financials weight 0
 * ```
 */
export function computeOverallScore(
    input: OverallScoreInput,
    timeframe: Timeframe
): OverallScore {
    const weights = OVERALL_AXIS_WEIGHTS[timeframe];
    const reads = [
        readSentimentAxis(
            'technical',
            input.technical?.trend,
            'trend',
            'no technical analysis'
        ),
        readSentimentAxis(
            'fundamental',
            input.fundamental?.overallSentiment,
            'sentiment',
            'no fundamental analysis'
        ),
        readSentimentAxis(
            'news',
            input.news?.overallSentiment,
            'sentiment',
            'no news analysis'
        ),
        readOptions(input),
        readFinancials(input),
    ];

    const axes: OverallAxisRead[] = reads.map(read => ({
        ...read,
        weight: read.score === null ? 0 : weights[read.axis],
    }));

    // Only `score === null` is checked. A reporting axis always carries a positive weight
    // (a test holds that over the whole table), and a zero weight would contribute zero to
    // both the numerator and the denominator anyway — a guard for it would be inert code
    // that reads like a real branch.
    const { weighted, total } = axes.reduce(
        (acc, axis) =>
            axis.score === null
                ? acc
                : {
                      weighted: acc.weighted + axis.score * axis.weight,
                      total: acc.total + axis.weight,
                  },
        { weighted: 0, total: 0 }
    );

    return {
        timeframe,
        axes,
        composite:
            total === 0 ? null : Math.round((weighted / total) * 10) / 10,
    };
}
