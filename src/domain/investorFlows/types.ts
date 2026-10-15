/**
 * Investor flows (수급) domain types: the snapshot a consumer assembles from SEC 13F /
 * Form 4 / 13D-G and FINRA data, the deterministic scorecard computed from it,
 * and the normalized AI interpretation.
 *
 * Defined beside the feature (10+ cohesive types) and re-exported from
 * `domain/types.ts` so consumers keep the canonical `@/domain/types` path.
 *
 * Every date is a `yyyy-mm-dd` string unless stated otherwise.
 */

// ─── Snapshot (provider input) ───────────────────────

/** How one institutional filer's position in the symbol moved versus the prior quarter. */
export type InstitutionalHolderChangeKind =
    'new' | 'increased' | 'decreased' | 'exited' | 'unchanged';

/**
 * Aggregated 13F positions in one symbol for one report quarter.
 *
 * The change counts compare this quarter with the one before it, so the
 * identities `priorHolders = holders - newHolders + exited` and
 * `priorShares = shares - netShareChange` hold; the scorecard relies on them.
 */
export interface InstitutionalQuarter {
    /** Report-period end (`PERIODOFREPORT`), e.g. `2026-06-30`. */
    readonly period: string;
    /**
     * `true` once the 13F filing deadline for `period` has passed. An
     * in-progress quarter only counts the filers that have already reported,
     * so its change figures are partial and are never scored.
     */
    readonly complete: boolean;
    /** Number of distinct institutions holding the symbol. */
    readonly holders: number;
    /** Total shares held by those institutions. */
    readonly shares: number;
    /** Total reported market value in USD. */
    readonly valueUsd: number;
    /** Institutions with no position in the prior quarter. */
    readonly newHolders: number;
    /** Institutions that held before and hold more now. */
    readonly increased: number;
    /** Institutions that held before and hold less now. */
    readonly decreased: number;
    /** Institutions that held before and hold nothing now. */
    readonly exited: number;
    /** Sum over all institutions of (shares now - shares prior quarter). */
    readonly netShareChange: number;
}

/** One institution's position and its change versus the prior quarter. */
export interface InstitutionalHolderChange {
    /** Institution name as filed. */
    readonly filerName: string;
    /** SEC CIK of the institution. */
    readonly cik: string;
    /** Shares held in the quarter named by `topHoldersPeriod` (0 for `exited`). */
    readonly shares: number;
    /** Reported market value in USD. */
    readonly valueUsd: number;
    /** Shares held in the prior quarter; `null` when it held nothing then (`new`). */
    readonly prevShares: number | null;
    /** Direction of the change. */
    readonly change: InstitutionalHolderChangeKind;
}

/** Insider (Form 4) transaction classification; FMP `P-Purchase` → buy, `S-Sale` → sell, else other. */
export type InsiderTransactionType = 'buy' | 'sell' | 'other';

/** One Form 4 transaction. */
export interface InsiderTransaction {
    /** Transaction date. */
    readonly date: string;
    /** Date the Form 4 was filed. */
    readonly filingDate: string;
    /** Reporting person. */
    readonly name: string;
    /** Free-text relationship as filed (e.g. `officer: Chief Executive Officer`, `director`, `10 percent owner`). */
    readonly role: string;
    /** Open-market classification. */
    readonly type: InsiderTransactionType;
    /** Shares transacted (positive). */
    readonly shares: number;
    /** Price per share; `null` when not reported. */
    readonly price: number | null;
    /** Transaction value in USD; `null` when neither reported nor derivable. */
    readonly value: number | null;
    /** Shares the insider owns after the transaction; `null` when not reported. */
    readonly sharesOwnedAfter: number | null;
    /** Link to the SEC filing. */
    readonly url: string;
}

/** Optional pre-aggregated insider statistics from the provider; the scorecard does not read them. */
export interface InsiderStatistics {
    /** Quarter the statistics describe (`yyyy-mm-dd` quarter end). */
    readonly period: string;
    /** Count of acquiring transactions. */
    readonly acquiredTransactions: number;
    /** Count of disposing transactions. */
    readonly disposedTransactions: number;
    /** Total shares acquired. */
    readonly totalAcquired: number;
    /** Total shares disposed. */
    readonly totalDisposed: number;
}

/** One Schedule 13D / 13G (5% beneficial-owner) filing. */
export interface LargeHolderFiling {
    /** Filing date. */
    readonly filingDate: string;
    /** Filer (the beneficial owner). */
    readonly filer: string;
    /** Form as filed (`SC 13D`, `SC 13D/A`, `SCHEDULE 13G`, `SC 13G/A`, ...). */
    readonly form: string;
    /** Percent of the class owned (0–100); `null` when not reported. */
    readonly percentOfClass: number | null;
    /** Shares owned; `null` when not reported. */
    readonly shares: number | null;
    /** Link to the SEC filing. */
    readonly url: string;
}

/** One FINRA bi-monthly short-interest settlement. */
export interface ShortInterestPoint {
    /** Settlement date. */
    readonly settlementDate: string;
    /** Shares sold short. */
    readonly shortQty: number;
    /** Average daily share volume used for days-to-cover; `null` when unknown. */
    readonly avgDailyVolume: number | null;
    /** Days to cover as published; `null` when unknown. */
    readonly daysToCover: number | null;
}

/** One trading day of FINRA off-exchange (TRF-reported) short sale volume. */
export interface ShortVolumePoint {
    /** Trade date. */
    readonly date: string;
    /** Off-exchange short-sale volume in shares. */
    readonly shortVolume: number;
    /** Off-exchange total volume in shares. */
    readonly totalVolume: number;
}

/** Institutional (13F) section of the snapshot. */
export interface InstitutionalSnapshot {
    /** Quarters with data, in any order; the scorecard sorts by `period`. */
    readonly quarters: readonly InstitutionalQuarter[];
    /** Largest holders, largest position first, relative to the quarter named by `topHoldersPeriod`. */
    readonly topHolders: readonly InstitutionalHolderChange[];
    /**
     * Quarter `topHolders` was compared in. Consensus is scored only when it
     * equals the scored (latest complete) quarter — holders compared against
     * an in-progress quarter would show false exits. `null` when unknown.
     */
    readonly topHoldersPeriod: string | null;
}

/** Insider section of the snapshot. */
export interface InsiderSnapshot {
    /**
     * Roughly the last 12 months of Form 4 transactions, any order. The
     * extra history is what lets a quiet 90 days read as "quiet" instead of
     * "no coverage": an empty list means the axis has no data.
     */
    readonly transactions: readonly InsiderTransaction[];
    /** Optional provider statistics; informational only. */
    readonly stats?: readonly InsiderStatistics[];
}

/**
 * Everything the investor-flows evaluation reads for one symbol. Assembled by
 * the consumer's {@link InvestorFlowsDataProvider}.
 */
export interface InvestorFlowsSnapshot {
    /** Reference date, normalized to its UTC calendar day (an offset datetime is converted to UTC; no offset means UTC). Windows are measured back from it. */
    readonly asOf: string;
    /** Shares outstanding; `null` when unknown. */
    readonly sharesOutstanding: number | null;
    /** Free-float shares; `null` when unknown (short interest % of float is then not computed). */
    readonly floatShares: number | null;
    /** SEC 13F institutional holdings. */
    readonly institutional: InstitutionalSnapshot;
    /** SEC Form 4 insider transactions. */
    readonly insider: InsiderSnapshot;
    /**
     * Recent 13D/13G filings (about the last 2 years, any order); `null` when
     * unavailable. Same coverage logic as insider: no filings at all means no data.
     */
    readonly largeHolders: readonly LargeHolderFiling[] | null;
    /** FINRA short interest settlements, any order; `null` when the FINRA feature flag is off. */
    readonly shortInterest: readonly ShortInterestPoint[] | null;
    /** FINRA daily off-exchange short volume, any order; `null` when the FINRA feature flag is off. */
    readonly shortVolume: readonly ShortVolumePoint[] | null;
}

// ─── Scorecard (deterministic output) ────────────────

/** The four investor-flows axes. */
export type InvestorFlowsAxisId =
    'institutional' | 'insider' | 'largeHolders' | 'short';

/** Direction a signal pushes investor flows (수급); `neutral` signals carry no score. */
export type InvestorFlowsSignalDirection = 'bullish' | 'bearish' | 'neutral';

/** How much weight a signal carries on its axis. */
export type InvestorFlowsSignalStrength = 'weak' | 'moderate' | 'strong';

/** Every signal the scorecard can emit. */
export type InvestorFlowsSignalId =
    // institutional
    | 'institutional_holder_count_change'
    | 'institutional_net_share_change'
    | 'institutional_new_vs_exited'
    | 'institutional_top_holder_consensus'
    | 'institutional_partial_quarter'
    // insider
    | 'insider_open_market_buying'
    | 'insider_cluster_buy'
    | 'insider_routine_selling'
    | 'insider_large_selling'
    | 'insider_quiet'
    // large holders
    | 'activist_13d_new'
    | 'activist_13d_increase'
    | 'activist_13d_reduction'
    | 'activist_13d_exit'
    | 'passive_13g_new'
    | 'passive_13g_increase'
    | 'passive_13g_reduction'
    | 'passive_13g_exit'
    | 'large_holder_amendment'
    // short
    | 'short_interest_level'
    | 'short_interest_trend'
    | 'days_to_cover_high'
    | 'off_exchange_short_ratio_z'
    | 'short_squeeze_risk'
    // any axis
    | 'data_stale';

/** Numeric facts behind a signal; `null` marks a fact that could not be computed. */
export type InvestorFlowsEvidence = Readonly<Record<string, number | null>>;

/** One finding on an axis, with the numbers that justify it. */
export interface InvestorFlowsSignal {
    /** Which signal this is. */
    readonly id: InvestorFlowsSignalId;
    /** Axis the signal belongs to. */
    readonly axis: InvestorFlowsAxisId;
    /** Direction of the pressure. */
    readonly direction: InvestorFlowsSignalDirection;
    /** Weight on the axis. */
    readonly strength: InvestorFlowsSignalStrength;
    /** Numeric facts, already rounded for display. */
    readonly evidence: InvestorFlowsEvidence;
    /** Party (insider, filer, institution) or period the signal is about, when it is about one. */
    readonly subject?: string;
}

/** Verdict on one axis or on the composite. */
export type InvestorFlowsLabel =
    | 'strong_bullish'
    | 'bullish'
    | 'neutral'
    | 'bearish'
    | 'strong_bearish'
    | 'insufficient';

/** Whether an axis had enough data to be scored. */
export type InvestorFlowsSufficiency = 'sufficient' | 'insufficient';

/** Fields every axis carries. `score` is `null` exactly when `sufficiency` is `insufficient`. */
export interface InvestorFlowsAxisBase {
    /** Which axis. */
    readonly id: InvestorFlowsAxisId;
    /** Score from -100 (strong outflow) to 100 (strong inflow); `null` when insufficient. */
    readonly score: number | null;
    /** Label derived from `score`; `insufficient` when there is no score. */
    readonly label: InvestorFlowsLabel;
    /** Data-sufficiency flag. */
    readonly sufficiency: InvestorFlowsSufficiency;
    /** Findings, strongest first. */
    readonly signals: readonly InvestorFlowsSignal[];
}

/** Basis the net institutional share change was measured against. */
export type NetShareChangeBasis = 'sharesOutstanding' | 'priorHoldings';

/** An in-progress 13F quarter, reported but not scored. */
export interface PartialInstitutionalQuarter {
    /** Report period. */
    readonly period: string;
    /** Institutions that have filed so far. */
    readonly holders: number;
    /** Shares held by those institutions. */
    readonly shares: number;
    /** Net share change among those institutions so far. */
    readonly netShareChange: number;
}

/** Computed institutional figures; `null` where the input was missing. */
export interface InstitutionalMetrics {
    /** Quarter that was scored (latest complete). */
    readonly scoredPeriod: string | null;
    /** Institutions holding in the scored quarter. */
    readonly holders: number | null;
    /** Change in holder count versus the prior quarter, percent. */
    readonly holderCountChangePct: number | null;
    /** Net share change as percent of the basis named by `netShareChangeBasis`. */
    readonly netShareChangePct: number | null;
    /** Basis of `netShareChangePct`. */
    readonly netShareChangeBasis: NetShareChangeBasis | null;
    /** New holders. */
    readonly newHolders: number | null;
    /** Exited holders. */
    readonly exited: number | null;
    /** (new - exited) / (new + exited), -1..1; the bounded form of the new-vs-exited ratio. */
    readonly newVsExitedBalance: number | null;
    /** (up - down) / n over the top holders, -1..1, where up = new + increased and down = decreased + exited. */
    readonly topHolderConsensus: number | null;
    /** Top holders that entered the consensus. */
    readonly topHolderCount: number | null;
    /** In-progress quarter, when the latest quarter is not complete. */
    readonly partialQuarter: PartialInstitutionalQuarter | null;
}

/** Institutional (13F) axis. */
export interface InstitutionalAxis extends InvestorFlowsAxisBase {
    readonly id: 'institutional';
    /** Computed figures. */
    readonly metrics: InstitutionalMetrics;
}

/** Computed insider figures over the insider window. */
export interface InsiderMetrics {
    /** Open-market buys in the window. */
    readonly buyCount: number;
    /** Distinct insiders buying in the window. */
    readonly buyerCount: number;
    /** Gross buy value in USD. */
    readonly buyValueUsd: number;
    /** Open-market sells in the window. */
    readonly sellCount: number;
    /** Distinct insiders selling in the window. */
    readonly sellerCount: number;
    /** Gross sell value in USD. */
    readonly sellValueUsd: number;
    /** Gross buy value minus gross sell value, USD. */
    readonly netValueUsd: number;
    /** Buy value weighted by role (officers and directors above 10% owners), USD. */
    readonly weightedBuyValueUsd: number;
    /** Largest number of distinct insiders buying within any 30-day span. */
    readonly largestBuyCluster: number;
    /** Whether a cluster buy was detected. */
    readonly clusterBuy: boolean;
    /** Sells that were large relative to the seller's holdings. */
    readonly largeSellCount: number;
}

/** Insider (Form 4) axis. */
export interface InsiderAxis extends InvestorFlowsAxisBase {
    readonly id: 'insider';
    /** Computed figures; `null` when the axis is insufficient. */
    readonly metrics: InsiderMetrics | null;
}

/** Computed 13D/13G figures over the large-holder window. */
export interface LargeHolderMetrics {
    /** 13D filings (original and amendments) in the window. */
    readonly filings13d: number;
    /** 13G filings (original and amendments) in the window. */
    readonly filings13g: number;
}

/** 5% beneficial-owner (13D/13G) axis. */
export interface LargeHolderAxis extends InvestorFlowsAxisBase {
    readonly id: 'largeHolders';
    /** Computed figures; `null` when the axis is insufficient. */
    readonly metrics: LargeHolderMetrics | null;
}

/** Direction of the last short-interest settlements. */
export type ShortInterestTrend = 'rising' | 'falling' | 'flat';

/** Computed short-selling figures; `null` where the input was missing. */
export interface ShortMetrics {
    /** Latest short interest as percent of float; `null` without float. */
    readonly shortInterestPctFloat: number | null;
    /** Days to cover of the latest settlement. */
    readonly daysToCover: number | null;
    /** Short-interest change across the last 3 settlements, percent. */
    readonly shortInterestChangePct: number | null;
    /** Trend over the last 3 settlements; `null` with fewer than 3 points. */
    readonly shortInterestTrend: ShortInterestTrend | null;
    /** Latest off-exchange short volume ratio (short / total), 0..1. */
    readonly shortVolumeRatio: number | null;
    /** Z-score of the latest ratio against the trailing baseline. */
    readonly shortVolumeRatioZ: number | null;
    /** Trading days in the baseline behind the z-score. */
    readonly shortVolumeBaselineDays: number | null;
    /**
     * Whether the squeeze-risk conditions all held: short interest % of float,
     * the days-to-cover *level* of the latest settlement (not its change) and a
     * rising short-interest trend. There is no price condition — the snapshot
     * carries no price.
     */
    readonly squeezeRisk: boolean;
}

/** Short-selling axis (FINRA data). */
export interface ShortAxis extends InvestorFlowsAxisBase {
    readonly id: 'short';
    /** Computed figures. */
    readonly metrics: ShortMetrics;
}

/** Composite across the axes that had data. */
export interface InvestorFlowsComposite {
    /** Weighted mean of the sufficient axes' scores; `null` when fewer than two axes had data. */
    readonly score: number | null;
    /** Label derived from `score`. */
    readonly label: InvestorFlowsLabel;
    /** Axes that entered the composite. */
    readonly axesUsed: readonly InvestorFlowsAxisId[];
}

/** A window of days ending at `to`. */
export interface InvestorFlowsWindow {
    /** First day of the window; `null` when `asOf` is unusable. */
    readonly from: string | null;
    /** Last day (the `asOf` date); `null` when `asOf` is unusable. */
    readonly to: string | null;
    /** Window length in days. */
    readonly days: number;
}

/** How fresh each underlying data source is. */
export interface InvestorFlowsFreshness {
    /** `asOf` date the windows were measured from. */
    readonly asOf: string | null;
    /** 13F quarter that was scored (latest complete); `null` when none. */
    readonly institutionalPeriod: string | null;
    /** Latest 13F quarter present, possibly in progress. */
    readonly latestInstitutionalPeriod: string | null;
    /** Whether `latestInstitutionalPeriod` is complete; `null` without 13F data. */
    readonly latestInstitutionalPeriodComplete: boolean | null;
    /** Latest short-interest settlement date. */
    readonly shortInterestSettlementDate: string | null;
    /** Latest off-exchange short-volume trade date. */
    readonly shortVolumeLatestDate: string | null;
    /** Window insider activity was measured over. */
    readonly insiderWindow: InvestorFlowsWindow;
    /** Form 4 transactions inside the insider window. */
    readonly insiderTransactionsInWindow: number;
    /** Window 13D/13G activity was measured over. */
    readonly largeHolderWindow: InvestorFlowsWindow;
}

/** The deterministic investor-flows scorecard. The LLM interprets it; it never recomputes it. */
export interface InvestorFlowsScorecard {
    /** 13F institutional axis. */
    readonly institutional: InstitutionalAxis;
    /** Form 4 insider axis. */
    readonly insider: InsiderAxis;
    /** 13D/13G axis. */
    readonly largeHolders: LargeHolderAxis;
    /** FINRA short axis. */
    readonly short: ShortAxis;
    /** Composite across the axes with data. */
    readonly composite: InvestorFlowsComposite;
    /** Data freshness metadata. */
    readonly freshness: InvestorFlowsFreshness;
}

/** Options for `evaluateInvestorFlows`. */
export interface EvaluateInvestorFlowsOptions {
    /** Overrides `snapshot.asOf` as the window reference date (same normalization). */
    readonly asOf?: string;
    /** `false` ignores the FINRA short data even when the snapshot carries it. Default `true`. */
    readonly includeFinraData?: boolean;
}

// ─── AI interpretation ───────────────────────────────

/** AI interpretation of one axis. */
export interface InvestorFlowsAxisInterpretation {
    /** Axis interpreted. */
    axis: InvestorFlowsAxisId;
    /** Korean-suffixed field; content follows the requested locale. */
    interpretationKo: string;
}

/** Normalized AI interpretation of a symbol's investor flows (수급). */
export interface InvestorFlowsAnalysisResponse {
    /** One-paragraph summary. */
    summaryKo: string;
    /** At most one interpretation per axis, in canonical axis order. */
    axisInterpretations: InvestorFlowsAxisInterpretation[];
    /** The most decision-relevant signals in prose. */
    keySignalsKo: string[];
    /** Risks and caveats. */
    risksKo: string[];
    /** Data-lag and coverage notes. */
    dataNotesKo: string[];
}

/** @internal Raw LLM response before normalization. */
export interface RawInvestorFlowsAnalysisResponse {
    summaryKo?: unknown;
    axisInterpretations?: unknown;
    keySignalsKo?: unknown;
    risksKo?: unknown;
    dataNotesKo?: unknown;
}

/** @internal Raw axis interpretation before normalization. */
export interface RawInvestorFlowsAxisInterpretation {
    axis?: unknown;
    interpretationKo?: unknown;
}
