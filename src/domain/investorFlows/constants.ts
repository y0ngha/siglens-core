import type {
    InvestorFlowsAxisId,
    InvestorFlowsSignalStrength,
} from '@/domain/investorFlows/types';

/**
 * Thresholds for `evaluateInvestorFlows`.
 *
 * **Judgment, not measurement.** No backtest set these numbers; each one
 * encodes a rule of thumb about what is unusual for a US equity, with the
 * rationale beside it. They are named so a recalibration is a one-line diff
 * and the unit tests import them instead of copying the values.
 */

/** Canonical axis order; also the order axes appear in prompts and normalized output. */
export const INVESTOR_FLOWS_AXES: readonly InvestorFlowsAxisId[] = [
    'institutional',
    'insider',
    'largeHolders',
    'short',
];

// ─── Scoring frame ───────────────────────────────────

/**
 * Points a signal adds to its axis score. A lone weak signal stays inside the
 * neutral band, a lone moderate signal reads bullish/bearish, and a lone
 * strong signal reads strong; several agreeing signals add up to the ±100 cap.
 */
export const SIGNAL_POINTS: Readonly<
    Record<InvestorFlowsSignalStrength, number>
> = {
    weak: 15,
    moderate: 35,
    strong: 60,
};

/** Score magnitude from which a label is `strong_*`. Equal to one strong signal (60) minus slack so 50+ needs a strong or two agreeing moderates. */
export const LABEL_STRONG_CUTOFF = 50;

/** Score magnitude from which a label is `bullish`/`bearish`. Above a lone weak signal (15), at or below a lone moderate one (35). */
export const LABEL_MILD_CUTOFF = 20;

/** Score bound on every axis and on the composite. */
export const SCORE_LIMIT = 100;

/**
 * Composite weights. 13F is the broadest and most stable measure of who owns
 * the stock but is up to ~45 days late; insider and short data are narrower
 * and noisier, 13D/G events are rare. Judgment only.
 */
export const COMPOSITE_WEIGHTS: Readonly<Record<InvestorFlowsAxisId, number>> =
    {
        institutional: 0.35,
        insider: 0.25,
        largeHolders: 0.15,
        short: 0.25,
    };

/** Axes with data required for a composite. One axis alone is not an "overall" read. */
export const COMPOSITE_MIN_AXES = 2;

/** Decimal places evidence and metrics are rounded to before thresholds are applied, so a recomputation from the rendered numbers agrees with the label. */
export const ROUND_DECIMALS = 2;

/** Decimal places for 0..1 ratios (short-volume ratio); two places would blur a 0.4523 vs 0.4549 difference that is half a standard deviation. */
export const RATIO_DECIMALS = 4;

// ─── Freshness gates ─────────────────────────────────

/**
 * A 13F quarter whose period end is more than this many days before `asOf` is
 * stale: two completed quarters (2 x 91 days) plus the 45-day filing window.
 * The newest complete quarter is normally at most ~135 days old at its filing
 * deadline, so anything past this means at least one expected quarter is missing.
 */
export const INSTITUTIONAL_MAX_AGE_DAYS = 2 * 91 + 45;

/**
 * A short-interest settlement older than this is stale. Settlements are twice a
 * month and published ~8 business days later (~25 days of normal age), so 45
 * days means a whole publication cycle was missed.
 */
export const SHORT_INTEREST_MAX_AGE_DAYS = 45;

/**
 * The latest off-exchange short-volume day older than this is stale: about 10
 * trading days, expressed in calendar days because the domain has no exchange
 * calendar for this check.
 */
export const SHORT_VOLUME_MAX_AGE_DAYS = 15;

// ─── Institutional (13F) ─────────────────────────────

/** Holders needed in the scored quarter. A 13F change on a handful of filers is noise. */
export const INSTITUTIONAL_MIN_HOLDERS = 10;

/**
 * Holders needed in the prior quarter (derived as holders - new + exited).
 * A backfill that starts mid-history marks nearly every holder as `new`; a
 * thin prior quarter means the comparison is not trustworthy.
 */
export const INSTITUTIONAL_MIN_PRIOR_HOLDERS = 10;

/** Holder-count change per quarter (%). Typical drift is ±1–2%, so 2% is the first unusual step. */
export const HOLDER_COUNT_CHANGE_WEAK_PCT = 2;
/** See {@link HOLDER_COUNT_CHANGE_WEAK_PCT}. */
export const HOLDER_COUNT_CHANGE_MODERATE_PCT = 5;
/** See {@link HOLDER_COUNT_CHANGE_WEAK_PCT}. */
export const HOLDER_COUNT_CHANGE_STRONG_PCT = 10;

/** Net institutional share change as % of shares outstanding. Institutions hold ~60–80% of a typical float, so 0.5% of the company moving in one quarter is already notable. */
export const NET_SHARES_VS_OUTSTANDING_WEAK_PCT = 0.5;
/** See {@link NET_SHARES_VS_OUTSTANDING_WEAK_PCT}. */
export const NET_SHARES_VS_OUTSTANDING_MODERATE_PCT = 1.5;
/** See {@link NET_SHARES_VS_OUTSTANDING_WEAK_PCT}. */
export const NET_SHARES_VS_OUTSTANDING_STRONG_PCT = 3;

/** Net share change as % of prior institutional holdings (fallback basis). Holdings are the larger denominator's ~70% slice, so thresholds are about 1.4x the outstanding-basis ones. */
export const NET_SHARES_VS_HOLDINGS_WEAK_PCT = 1;
/** See {@link NET_SHARES_VS_HOLDINGS_WEAK_PCT}. */
export const NET_SHARES_VS_HOLDINGS_MODERATE_PCT = 2;
/** See {@link NET_SHARES_VS_HOLDINGS_WEAK_PCT}. */
export const NET_SHARES_VS_HOLDINGS_STRONG_PCT = 4;

/** New + exited institutions needed before their balance means anything. */
export const NEW_VS_EXITED_MIN_EVENTS = 10;

/** |(new - exited) / (new + exited)|. 0.2 = 60/40 split; 0.6 = 80/20. */
export const NEW_VS_EXITED_WEAK_BALANCE = 0.2;
/** See {@link NEW_VS_EXITED_WEAK_BALANCE}. */
export const NEW_VS_EXITED_MODERATE_BALANCE = 0.4;
/** See {@link NEW_VS_EXITED_WEAK_BALANCE}. */
export const NEW_VS_EXITED_STRONG_BALANCE = 0.6;

/** Largest holders that enter the consensus. */
export const TOP_HOLDER_COUNT = 10;

/** Top holders needed for a consensus; fewer is anecdote. */
export const TOP_HOLDER_MIN_COUNT = 5;

/** |(up - down) / n| over the top holders. 0.4 = 7 of 10 net moving one way after netting. */
export const TOP_HOLDER_CONSENSUS_WEAK = 0.4;
/** See {@link TOP_HOLDER_CONSENSUS_WEAK}. */
export const TOP_HOLDER_CONSENSUS_MODERATE = 0.6;
/** See {@link TOP_HOLDER_CONSENSUS_WEAK}. */
export const TOP_HOLDER_CONSENSUS_STRONG = 0.8;

// ─── Insider (Form 4) ────────────────────────────────

/** Window insider activity is measured over. A quarter is long enough to see a pattern and short enough to stay current. */
export const INSIDER_WINDOW_DAYS = 90;

/** A cluster is this many calendar days from the first to the last buy (inclusive). */
export const INSIDER_CLUSTER_WINDOW_DAYS = 30;

/** Distinct insiders buying inside one cluster window for a cluster buy. */
export const INSIDER_CLUSTER_MIN_INSIDERS = 3;

/** Cluster size at which a cluster buy is strong rather than moderate. */
export const INSIDER_CLUSTER_STRONG_INSIDERS = 5;

/** Role weights: officers and directors trade on the best information; 10% owners and others often trade for portfolio reasons. */
export const INSIDER_ROLE_WEIGHTS = {
    officerOrDirector: 1,
    tenPercentOwner: 0.5,
    other: 0.5,
} as const;

/** Weighted open-market buy value (USD) for a weak buy signal. Small purchases are common token buys. */
export const INSIDER_BUY_WEAK_USD = 50_000;
/** See {@link INSIDER_BUY_WEAK_USD}. */
export const INSIDER_BUY_MODERATE_USD = 250_000;
/** See {@link INSIDER_BUY_WEAK_USD}. A buy of this size is personal money at risk. */
export const INSIDER_BUY_STRONG_USD = 1_000_000;

/** Gross sell value (USD) below which routine selling is not reported at all. */
export const INSIDER_SELL_MIN_USD = 250_000;

/**
 * Sold shares / (shares owned after + sold) from which a sale is "large
 * relative to holdings". Scheduled sales (10b5-1 plans, tax withholding) rarely
 * liquidate a quarter of a position.
 */
export const INSIDER_LARGE_SELL_FRACTION = 0.25;

/** Distinct insiders with large sells for a strong (rather than moderate) large-selling signal. */
export const INSIDER_LARGE_SELL_STRONG_INSIDERS = 3;

// ─── Large holders (13D / 13G) ───────────────────────

/** Window 13D/13G filings are measured over. */
export const LARGE_HOLDER_WINDOW_DAYS = 90;

/**
 * Cap on the summed absolute score from 13G events. 13G is passive and
 * filed routinely (index funds file dozens of annual amendments), so many of
 * them must not stack into a strong read.
 */
export const LARGE_HOLDER_13G_POINTS_CAP = 30;

// ─── Short selling (FINRA) ───────────────────────────

/** Settlements the short-interest trend spans. */
export const SHORT_INTEREST_TREND_POINTS = 3;

/** Short interest % of float: above this is notable. Market-wide median is low single digits. */
export const SHORT_INTEREST_PCT_FLOAT_WEAK = 10;
/** See {@link SHORT_INTEREST_PCT_FLOAT_WEAK}. */
export const SHORT_INTEREST_PCT_FLOAT_MODERATE = 20;

/** Change (%) across the trend window below which it is `flat`. */
export const SHORT_INTEREST_TREND_MIN_CHANGE_PCT = 5;
/** See {@link SHORT_INTEREST_TREND_MIN_CHANGE_PCT}. */
export const SHORT_INTEREST_TREND_MODERATE_CHANGE_PCT = 15;
/** See {@link SHORT_INTEREST_TREND_MIN_CHANGE_PCT}. */
export const SHORT_INTEREST_TREND_STRONG_CHANGE_PCT = 30;

/** Days to cover from which crowding is worth noting. Above a week of average volume is hard to unwind. */
export const DAYS_TO_COVER_WEAK = 5;
/** See {@link DAYS_TO_COVER_WEAK}. */
export const DAYS_TO_COVER_MODERATE = 10;

/** Trailing trading days the off-exchange short-volume baseline spans. */
export const SHORT_VOLUME_BASELINE_DAYS = 60;

/** Baseline days needed before a z-score is computed. */
export const SHORT_VOLUME_MIN_BASELINE_DAYS = 30;

/** |z| thresholds for the short-volume ratio. Capped at moderate: the ratio includes market-maker hedging, so it is never strong evidence. */
export const SHORT_VOLUME_Z_WEAK = 1.5;
/** See {@link SHORT_VOLUME_Z_WEAK}. */
export const SHORT_VOLUME_Z_MODERATE = 2.5;

/** Squeeze-risk conditions: crowded (SI % of float), hard to cover (DTC) and growing (trend `rising`). */
export const SQUEEZE_MIN_SHORT_INTEREST_PCT_FLOAT = 15;
/** See {@link SQUEEZE_MIN_SHORT_INTEREST_PCT_FLOAT}. */
export const SQUEEZE_MIN_DAYS_TO_COVER = 5;
/** Both of these together make the squeeze-risk signal strong instead of moderate. */
export const SQUEEZE_STRONG_SHORT_INTEREST_PCT_FLOAT = 25;
/** See {@link SQUEEZE_STRONG_SHORT_INTEREST_PCT_FLOAT}. */
export const SQUEEZE_STRONG_DAYS_TO_COVER = 8;

// ─── Prompt sizing ───────────────────────────────────

/** Compact-fact caps for the analysis prompt. */
export const PROMPT_MAX_TOP_HOLDERS = 10;
/** See {@link PROMPT_MAX_TOP_HOLDERS}. */
export const PROMPT_MAX_INSIDER_TRANSACTIONS = 15;
/** See {@link PROMPT_MAX_TOP_HOLDERS}. */
export const PROMPT_MAX_LARGE_HOLDER_FILINGS = 10;
/** See {@link PROMPT_MAX_TOP_HOLDERS}. */
export const PROMPT_MAX_SHORT_INTEREST_POINTS = 6;
/** Names come from filings and are untrusted prompt text; clipped to this length. */
export const PROMPT_MAX_NAME_CHARS = 60;
