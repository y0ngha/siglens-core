import type {
    InvestorFlowsAxisId,
    InvestorFlowsSignalStrength,
    SqueezeRiskComponentId,
    SqueezeRiskLevel,
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
    'dilution',
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
 *
 * Adding `dilution` (2026-10) took 0.15 for it and scaled the other four by
 * ~0.85 (0.35/0.25/0.15/0.25 → 0.30/0.22/0.13/0.20), keeping their relative
 * order. Dilution gets the weight of the 13D/G axis because both are rare,
 * discrete filings: an offering adds supply the day it prices, but most
 * symbols have none in the window, and an axis without data abstains anyway.
 * Weights are relative (the composite divides by the used weights), so the
 * sum of 1 is only for readability.
 */
export const COMPOSITE_WEIGHTS: Readonly<Record<InvestorFlowsAxisId, number>> =
    {
        institutional: 0.3,
        insider: 0.22,
        largeHolders: 0.13,
        short: 0.2,
        dilution: 0.15,
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

/** 13F option quarters need at least this many put + call holders before a ratio means anything; one fund's hedge is not positioning. */
export const PUT_CALL_MIN_HOLDERS = 10;

/**
 * Put / call notional ratio from which positioning reads one-sided (and its
 * inverse on the call side). 13F option notional is mostly hedges against long
 * stock, so a ratio near 1 says nothing; 1.5x is the first clear tilt.
 */
export const PUT_CALL_SKEW_RATIO = 1.5;

/** Quarter-over-quarter multiple of the put / call ratio (or its inverse) that counts as a shift on its own. */
export const PUT_CALL_SHIFT_MULTIPLE = 2;

/** Strength cap of the put / call signal: hedging dominates 13F option notional, so it is never more than weak. */
export const PUT_CALL_MAX_STRENGTH: InvestorFlowsSignalStrength = 'weak';

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

// ─── Insider (Form 144) ──────────────────────────────

/**
 * Aggregate Form 144 shares in the insider window, as % of shares outstanding,
 * for a weak proposed-sale signal. This is the primary scale: a fixed dollar
 * floor reads a mega cap's routine plan sales (Apple executives' ~$40M a
 * quarter is ~0.003% of the company) as a bearish event and misses a small
 * cap's meaningful one. Anchored on Rule 144(e): one affiliate may sell at most
 * 1% of shares outstanding (or the average weekly volume) per three months, so
 * 0.05% is a twentieth of a single affiliate's cap. Same scale as the Korean
 * insider net-change thresholds. Judgment, not a measurement.
 */
export const INSIDER_PROPOSED_SALE_WEAK_PCT_OUTSTANDING = 0.05;
/**
 * See {@link INSIDER_PROPOSED_SALE_WEAK_PCT_OUTSTANDING}: a quarter of one
 * affiliate's Rule 144(e) three-month cap. Capped at moderate: a notice is
 * intent, and the sale reappears later as a Form 4.
 */
export const INSIDER_PROPOSED_SALE_MODERATE_PCT_OUTSTANDING = 0.25;

/**
 * Fallback only: aggregate Form 144 value (USD) in the insider window for a
 * weak proposed-sale signal, applied to every notice when the snapshot has no
 * shares outstanding, and otherwise only to the notices that carry no share
 * count (the stronger of that and the percent reading wins).
 * Form 144 is required above $50k in three months, so small notices are
 * routine; $1M is four times the Form 4 routine-sell floor.
 */
export const INSIDER_PROPOSED_SALE_WEAK_USD = 1_000_000;
/** See {@link INSIDER_PROPOSED_SALE_WEAK_USD}. Capped at moderate: a notice is intent, and the sale reappears later as a Form 4. */
export const INSIDER_PROPOSED_SALE_MODERATE_USD = 10_000_000;

/**
 * Value share under a Rule 10b5-1 plan from which the proposed-sale signals
 * drop one strength step (never below weak): a plan adopted months earlier
 * says little about today's view.
 */
export const INSIDER_PROPOSED_SALE_PLAN_MAJORITY = 0.5;

/** Distinct Form 144 filers within {@link INSIDER_CLUSTER_WINDOW_DAYS} days for a proposed-sale cluster. */
export const INSIDER_PROPOSED_SALE_CLUSTER_MIN_FILERS = 3;

// ─── Large holders (13D / 13G) ───────────────────────

/** Window 13D/13G filings are measured over. */
export const LARGE_HOLDER_WINDOW_DAYS = 90;

/**
 * Cap on the summed absolute score from 13G events. 13G is passive and
 * filed routinely (index funds file dozens of annual amendments), so many of
 * them must not stack into a strong read.
 */
export const LARGE_HOLDER_13G_POINTS_CAP = 30;

// ─── Dilution (registration / offering filings) ──────

/** Window offering filings are measured over: long enough to cover a shelf followed by its first takedown. */
export const DILUTION_WINDOW_DAYS = 180;

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

// ─── Fails to deliver (SEC) and Reg SHO lists ────────

/** Days back from the reference day that count as "recent" fails. FTD files publish about two weeks after each half-month, so 30 days holds at least one published period. */
export const FTD_RECENT_WINDOW_DAYS = 30;

/** Calendar days before the recent window that form the FTD baseline. */
export const FTD_BASELINE_WINDOW_DAYS = 60;

/** Trading days in {@link FTD_BASELINE_WINDOW_DAYS} calendar days (5/7, minus a holiday). FTD rows exist only on fail days, so the baseline sum is divided by this, not by the row count. */
export const FTD_BASELINE_TRADING_DAYS = 42;

/** Reg SHO's own share floor for a threshold security; smaller fails are noise. */
export const FTD_MIN_QTY = 10_000;

/** Peak fails as % of shares outstanding for a weak FTD signal. */
export const FTD_PCT_OUTSTANDING_WEAK = 0.1;
/** Reg SHO's threshold-security level (0.5% of shares outstanding) — moderate, the cap: fails are not evidence of naked shorting (SEC). */
export const FTD_PCT_OUTSTANDING_MODERATE = 0.5;

/**
 * Smallest baseline average daily fails a peak is compared against. Below it
 * the baseline is near zero and the multiple explodes into noise (AAPL read
 * 240x on a ~3,700-share daily average), so `failsToDeliverMultiple` is `null`
 * and no multiple-based strength applies. Set at {@link FTD_MIN_QTY}, Reg SHO's
 * own floor for fails worth noticing: a baseline under the level a single day
 * must reach to count is no baseline.
 */
export const FTD_MIN_BASELINE_DAILY_AVERAGE = FTD_MIN_QTY;

/** A peak below this multiple of the baseline daily average is chronic, not new; such a signal is held at weak. */
export const FTD_SPIKE_MIN_MULTIPLE = 2;

/**
 * Newest FTD row older than this many days before the reference day makes the
 * feed stale (dropped, like a stale FINRA feed). SEC publishes each half-month
 * about two weeks after it ends, so a live feed's newest fail day is normally
 * under ~30 days old; 45 tolerates one late file. Rows exist only on fail days,
 * so a symbol that stopped failing more than 45 days ago also reads as stale —
 * the conservative side: missing, not "no fails".
 */
export const FTD_MAX_AGE_DAYS = 45;

/** A threshold-list status dated more than this many days before the reference day is stale: lists publish every trading day, so a week covers a long weekend plus a holiday. */
export const THRESHOLD_LIST_MAX_AGE_DAYS = 7;

/** Consecutive threshold-list days at which Rule 203(b)(3) mandates a close-out — the listing signal becomes moderate. */
export const THRESHOLD_LIST_CLOSE_OUT_DAYS = 13;

// ─── Short-squeeze score ─────────────────────────────

/** Range of one squeeze input: `floor` maps to 0, `cap` to 1, linear in between. */
export interface SqueezeComponentScale {
    readonly floor: number;
    readonly cap: number;
}

/**
 * Squeeze-score inputs: weight and 0..1 scale. Judgment, not measurement.
 * Crowding (short interest % of float) and the price move carry the most —
 * a squeeze needs both shorts and a rally against them; days to cover and the
 * short-interest trend say how hard and how recently the crowd built; the
 * off-exchange z-score is mostly market-maker hedging, so it carries least.
 * Weights sum to 1 and are renormalized over the inputs that are present.
 */
export const SQUEEZE_COMPONENTS: Readonly<
    Record<
        SqueezeRiskComponentId,
        { readonly weight: number; readonly scale: SqueezeComponentScale }
    >
> = {
    /** 5% is ordinary; 30% of float is among the most crowded US names. */
    short_interest_pct_float: { weight: 0.25, scale: { floor: 5, cap: 30 } },
    /** Two days unwinds quietly; ten days of volume is a trap. */
    days_to_cover: { weight: 0.15, scale: { floor: 2, cap: 10 } },
    /** Short-interest change across the last 3 settlements, percent; a flat or falling crowd adds nothing. */
    short_interest_trend: { weight: 0.1, scale: { floor: 0, cap: 30 } },
    /** Off-exchange short-ratio z-score; only above-baseline shorting counts. */
    off_exchange_short_ratio_z: { weight: 0.05, scale: { floor: 0, cap: 3 } },
    /** Recent peak fails as % of shares outstanding; full at the Reg SHO level. */
    fails_to_deliver_pct: { weight: 0.1, scale: { floor: 0, cap: 0.5 } },
    /** Consecutive threshold-list days; full at the mandatory close-out. */
    threshold_list_days: { weight: 0.05, scale: { floor: 0, cap: 13 } },
    /** 20-session close change, percent; only a rally pressures shorts. */
    price_change_20d: { weight: 0.2, scale: { floor: 0, cap: 50 } },
    /** Last 5 sessions' average volume over the 20 before; 3x is a crowd rushing in or out. */
    volume_ratio: { weight: 0.1, scale: { floor: 1, cap: 3 } },
};

/** Squeeze-score inputs quoted in the `short_squeeze_risk` signal evidence, largest contribution first. */
export const SQUEEZE_SIGNAL_EVIDENCE_COMPONENTS = 3;

/** Inputs that measure short positioning itself; without any of them the level is capped. */
export const SQUEEZE_POSITIONING_COMPONENTS: readonly SqueezeRiskComponentId[] =
    [
        'short_interest_pct_float',
        'days_to_cover',
        'short_interest_trend',
        'off_exchange_short_ratio_z',
    ];

/**
 * Delivery-stress inputs. They count toward "is there a short side at all"
 * only when non-zero: an empty FTD feed or a not-listed status is the absence
 * of stress, not evidence about short sellers, so on its own it must not let
 * price and volume produce a squeeze score. Once another input passes the
 * gate, a zero still contributes 0 to the score.
 */
export const SQUEEZE_STRESS_COMPONENTS: readonly SqueezeRiskComponentId[] = [
    'fails_to_deliver_pct',
    'threshold_list_days',
];

/** Score from which each level starts (ascending). */
export const SQUEEZE_LEVEL_CUTOFFS: Readonly<
    Record<Exclude<SqueezeRiskLevel, 'low'>, number>
> = {
    elevated: 25,
    high: 50,
    extreme: 75,
};

/** Highest level without a positioning input: fails and price alone cannot call a squeeze. */
export const SQUEEZE_CAPPED_LEVEL: SqueezeRiskLevel = 'elevated';

/**
 * Calendar days the newest completed bar may lag the reference day before the
 * price inputs are dropped. A long weekend plus a holiday puts the last
 * session up to 4 days back; 7 allows that with slack, while a feed that
 * stopped a week ago no longer describes the current move.
 */
export const SQUEEZE_MAX_BAR_AGE_DAYS = 7;

/** Sessions the price change spans. */
export const SQUEEZE_PRICE_CHANGE_SESSIONS = 20;
/** Recent sessions of the volume ratio. */
export const SQUEEZE_VOLUME_RECENT_SESSIONS = 5;
/** Baseline sessions of the volume ratio (before the recent ones). */
export const SQUEEZE_VOLUME_BASELINE_SESSIONS = 20;

// ─── Korea (DART) ────────────────────────────────────

/** Window DART major-holder and insider reports are measured over (the US windows, for comparability). */
export const KR_WINDOW_DAYS = 90;

/** Ownership level the 5% rule reports around; dropping below it is an exit. */
export const KR_MAJOR_HOLDER_THRESHOLD_PCT = 5;

/**
 * Net holding-ratio change (percentage points) per reporter in the window.
 * 1%p is the change that obliges a new report, so it is the floor; 10%p is a
 * control-level move. Strength never comes from the report form.
 */
export const KR_MAJOR_HOLDER_CHANGE_WEAK_PCT = 1;
/** See {@link KR_MAJOR_HOLDER_CHANGE_WEAK_PCT}. */
export const KR_MAJOR_HOLDER_CHANGE_MODERATE_PCT = 3;
/** See {@link KR_MAJOR_HOLDER_CHANGE_WEAK_PCT}. */
export const KR_MAJOR_HOLDER_CHANGE_STRONG_PCT = 10;

/**
 * Net insider share change as % of shares outstanding. The report carries no
 * cause (open market, gift, inheritance, exercise), so the signal is capped at
 * moderate; 0.05% is about the size of a meaningful executive purchase.
 */
export const KR_INSIDER_NET_CHANGE_WEAK_PCT = 0.05;
/** See {@link KR_INSIDER_NET_CHANGE_WEAK_PCT}. */
export const KR_INSIDER_NET_CHANGE_MODERATE_PCT = 0.25;

/** Distinct reporters moving the same way within {@link INSIDER_CLUSTER_WINDOW_DAYS} days for a Korean insider cluster. */
export const KR_INSIDER_CLUSTER_MIN_REPORTERS = 3;

// ─── Prompt sizing ───────────────────────────────────

/** Compact-fact caps for the analysis prompt. */
export const PROMPT_MAX_TOP_HOLDERS = 10;
/** See {@link PROMPT_MAX_TOP_HOLDERS}. */
export const PROMPT_MAX_INSIDER_TRANSACTIONS = 15;
/** See {@link PROMPT_MAX_TOP_HOLDERS}. */
export const PROMPT_MAX_LARGE_HOLDER_FILINGS = 10;
/** See {@link PROMPT_MAX_TOP_HOLDERS}. */
export const PROMPT_MAX_SHORT_INTEREST_POINTS = 6;
/** See {@link PROMPT_MAX_TOP_HOLDERS}. */
export const PROMPT_MAX_PROPOSED_SALES = 5;
/** See {@link PROMPT_MAX_TOP_HOLDERS}. */
export const PROMPT_MAX_OFFERINGS = 5;
/** See {@link PROMPT_MAX_TOP_HOLDERS}. */
export const PROMPT_MAX_FAILS_TO_DELIVER = 5;
/** See {@link PROMPT_MAX_TOP_HOLDERS}. */
export const PROMPT_MAX_KR_REPORTS = 10;
/** Squeeze-score inputs listed in prompts, largest contribution first. */
export const PROMPT_MAX_SQUEEZE_COMPONENTS = 3;
/** Names come from filings and are untrusted prompt text; clipped to this length. */
export const PROMPT_MAX_NAME_CHARS = 60;
