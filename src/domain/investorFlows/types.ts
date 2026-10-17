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

/**
 * Aggregated 13F option positions (`putCall` rows) in one symbol for one report
 * quarter. `*Shares` is the underlying share count (`sshPrnamt`) and `*ValueUsd`
 * the underlying notional as filed — not the option premium.
 */
export interface InstitutionalOptionsQuarter {
    /** Report-period end, e.g. `2026-06-30`. */
    readonly period: string;
    /** `true` once the 13F filing deadline for `period` has passed; partial quarters are never scored. */
    readonly complete: boolean;
    /** Institutions reporting a put position. */
    readonly putHolders: number;
    /** Underlying shares of the put positions. */
    readonly putShares: number;
    /** Underlying notional of the put positions, USD. */
    readonly putValueUsd: number;
    /** Institutions reporting a call position. */
    readonly callHolders: number;
    /** Underlying shares of the call positions. */
    readonly callShares: number;
    /** Underlying notional of the call positions, USD. */
    readonly callValueUsd: number;
}

/** One SEC fails-to-deliver (FTD) settlement day. Rows exist only on days with fails. */
export interface FailsToDeliverPoint {
    /** Settlement date. */
    readonly settlementDate: string;
    /** Shares that failed to deliver on that day (cumulative open fails as published). */
    readonly failsQty: number;
    /** Closing price published with the row; `null` when the file has `.`. */
    readonly price: number | null;
}

/** One SEC Form 144 notice of a proposed sale by an affiliate. */
export interface ProposedSale {
    /** Date the Form 144 was filed. */
    readonly filingDate: string;
    /** Person for whose account the shares are to be sold. */
    readonly filer: string;
    /**
     * SEC CIK of that person, when the consumer has it. The same person files
     * under differently spelled names (`MARK ROBINSON`, `Mark Haymond Robinson`),
     * so distinct filers are counted by CIK when present and by a normalized
     * name otherwise. Optional for older snapshots.
     */
    readonly filerCik?: string | null;
    /** Relationships to the issuer as filed (`Officer`, `Director`, ...). */
    readonly relationships: readonly string[];
    /** Shares to be sold. */
    readonly shares: number;
    /** Aggregate market value of the shares to be sold, USD. */
    readonly valueUsd: number;
    /** Approximate sale date; `null` when not filed. */
    readonly approxSaleDate: string | null;
    /** Rule 10b5-1 plan adoption date; `null` when the sale is not under a plan. */
    readonly planAdoptionDate: string | null;
    /** Link to the SEC filing. */
    readonly url: string;
}

/**
 * Classification of a registration / offering filing, assigned by the consumer:
 * `shelf` (S-3, S-3ASR, F-3 and amendments), `registration` (S-1, F-1 and
 * amendments), `atm` / `underwritten` / `best_efforts` (424B5 classified from its
 * cover text), `private_placement` (Form D), `prospectus` (other 424B forms) and
 * `other` (a 424B5 that could not be classified).
 */
export type OfferingKind =
    | 'shelf'
    | 'registration'
    | 'prospectus'
    | 'atm'
    | 'underwritten'
    | 'best_efforts'
    | 'private_placement'
    | 'other';

/** One registration, prospectus or Form D filing by the issuer. */
export interface OfferingFiling {
    /** Filing date. */
    readonly filingDate: string;
    /** Form as filed (`S-3`, `424B5`, `D`, ...). */
    readonly form: string;
    /** Classification. */
    readonly kind: OfferingKind;
    /** Link to the SEC filing. */
    readonly url: string;
}

/**
 * Reg SHO threshold-list status (Nasdaq / NYSE / Cboe lists).
 *
 * With `asOf`, a status whose list date is more than
 * `THRESHOLD_LIST_MAX_AGE_DAYS` days before the reference day (or after it) is
 * treated as unavailable, like a switched-off feed. Without `asOf` the status is
 * taken as current — a provider that cannot date it should send `null` once its
 * lists stop updating.
 */
export interface ThresholdListStatus {
    /** Whether the symbol is on a threshold list as of the latest list date. */
    readonly listed: boolean;
    /** Consecutive trading days on a list up to the latest list date (0 when not listed). */
    readonly consecutiveDays: number;
    /** First day of the current listing streak; `null` when not listed. */
    readonly firstListedDate: string | null;
    /** Markets whose list carries the symbol (`Nasdaq`, `NYSE`, ...). */
    readonly markets: readonly string[];
    /** Trade date of the latest list this status reflects; optional for older providers. */
    readonly asOf?: string;
}

/** Market the snapshot describes; it selects the axis evaluators and the prompt wording. */
export type InvestorFlowsMarket = 'us' | 'kr';

/**
 * DART major-holder report form: `detailed` is 일반 and `abbreviated` is 약식.
 * Informational only — 약식 is used both for simple investment and for a
 * professional investor's general investment, so the form never sets strength.
 */
export type KrMajorHolderReportForm = 'detailed' | 'abbreviated';

/** One DART 5%+ major-holder report (대량보유 상황보고, `majorstock.json`). */
export interface KrMajorHolderReport {
    /** Receipt date (`rcept_dt`). */
    readonly receiptDate: string;
    /** Reporter (`repror`). */
    readonly reporter: string;
    /** Report form (`report_tp`). */
    readonly reportForm: KrMajorHolderReportForm;
    /** Shares held after the change (`stkqy`). */
    readonly shares: number;
    /** Change in shares held (`stkqy_irds`). */
    readonly sharesChange: number;
    /** Holding ratio after the change, percent (`stkrt`). */
    readonly ratioPct: number;
    /** Change in the holding ratio, percentage points (`stkrt_irds`). */
    readonly ratioChangePct: number;
    /** Free-text reason (`report_resn`). */
    readonly reason: string;
    /** Link to the DART filing. */
    readonly url: string;
}

/** One DART executive / major-shareholder ownership report (임원·주요주주 소유보고, `elestock.json`). */
export interface KrInsiderReport {
    /** Receipt date (`rcept_dt`). */
    readonly receiptDate: string;
    /** Reporter (`repror`). */
    readonly reporter: string;
    /** Position (`isu_exctv_ofcps`); `null` when not an executive. */
    readonly position: string | null;
    /** Registered executive (`isu_exctv_rgist_at`). */
    readonly registered: boolean;
    /** Major shareholder (`isu_main_shrholdr`). */
    readonly majorShareholder: boolean;
    /** Shares held after the change (`sp_stock_lmp_cnt`). */
    readonly shares: number;
    /** Change in shares held (`sp_stock_lmp_irds_cnt`); the report carries no cause. */
    readonly sharesChange: number;
    /** Holding ratio after the change, percent (`sp_stock_lmp_rate`). */
    readonly ratioPct: number;
    /** Change in the holding ratio, percentage points (`sp_stock_lmp_irds_rate`). */
    readonly ratioChangePct: number;
    /** Link to the DART filing. */
    readonly url: string;
}

/** One DART insider trading-plan report (거래계획보고서, D005). */
export interface KrTradingPlan {
    /** Receipt date. */
    readonly receiptDate: string;
    /** Reporter. */
    readonly reporter: string;
    /** Report title as listed. */
    readonly title: string;
    /** Link to the DART filing. */
    readonly url: string;
}

/** Korean (DART) disclosure section of the snapshot; read only when `market` is `kr`. */
export interface KrDisclosureSnapshot {
    /** Major-holder reports, about the last 2 years, any order. */
    readonly majorHolders: readonly KrMajorHolderReport[];
    /** Executive / major-shareholder reports, about the last 2 years, any order. */
    readonly insiders: readonly KrInsiderReport[];
    /** Trading-plan reports, any order. */
    readonly tradingPlans: readonly KrTradingPlan[];
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
    /** 13F option positions per quarter, any order; absent in snapshots built before it existed. */
    readonly options?: readonly InstitutionalOptionsQuarter[];
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
    /**
     * Market the snapshot describes. Absent means `us`. With `kr` the scorecard
     * reads only {@link InvestorFlowsSnapshot.kr}: the major-holder and insider
     * axes are scored from DART reports and the US-only axes are insufficient.
     */
    readonly market?: InvestorFlowsMarket;
    /** SEC fails-to-deliver days, any order; `null` when unavailable. Optional for older snapshots. */
    readonly failsToDeliver?: readonly FailsToDeliverPoint[] | null;
    /** SEC Form 144 notices, about the last year, any order. Optional for older snapshots. */
    readonly proposedSales?: readonly ProposedSale[];
    /** Registration / offering filings, about the last 2 years, any order. Optional for older snapshots. */
    readonly offerings?: readonly OfferingFiling[];
    /** Reg SHO threshold-list status; `null` when the exchange-list feature flag is off. */
    readonly thresholdList?: ThresholdListStatus | null;
    /** DART disclosures; read only when `market` is `kr`. */
    readonly kr?: KrDisclosureSnapshot;
}

// ─── Scorecard (deterministic output) ────────────────

/** The five investor-flows axes. */
export type InvestorFlowsAxisId =
    'institutional' | 'insider' | 'largeHolders' | 'short' | 'dilution';

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
    | 'institutional_put_call_skew'
    // insider
    | 'insider_open_market_buying'
    | 'insider_cluster_buy'
    | 'insider_routine_selling'
    | 'insider_large_selling'
    | 'insider_quiet'
    | 'insider_proposed_sale'
    | 'insider_proposed_sale_cluster'
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
    | 'large_holder_ratio_diluted'
    // large holders, Korea (DART)
    | 'kr_major_holder_new'
    | 'kr_major_holder_increase'
    | 'kr_major_holder_reduction'
    | 'kr_major_holder_exit'
    | 'kr_major_holder_no_material_change'
    // insider, Korea (DART)
    | 'kr_insider_net_change'
    | 'kr_insider_cluster'
    | 'kr_insider_routine_mass_filing'
    | 'kr_trading_plan'
    | 'kr_insider_no_material_change'
    // short
    | 'short_interest_level'
    | 'short_interest_trend'
    | 'days_to_cover_high'
    | 'off_exchange_short_ratio_z'
    | 'short_squeeze_risk'
    | 'fails_to_deliver_elevated'
    | 'reg_sho_threshold_listed'
    // dilution
    | 'atm_offering_active'
    | 'underwritten_offering'
    | 'shelf_registration_new'
    | 'registration_new'
    | 'private_placement'
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
    /** 13F option quarter the put/call ratio was read from. */
    readonly optionsPeriod: string | null;
    /** Put notional / call notional in {@link InstitutionalMetrics.optionsPeriod}. */
    readonly putCallValueRatio: number | null;
    /** The same ratio one quarter earlier. */
    readonly priorPutCallValueRatio: number | null;
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
    /** Form 144 notices filed in the window. */
    readonly proposedSaleCount: number;
    /** Distinct Form 144 filers in the window. */
    readonly proposedSaleFilerCount: number;
    /** Aggregate value of the window's Form 144 notices, USD. */
    readonly proposedSaleValueUsd: number;
    /** Aggregate shares of the window's Form 144 notices. */
    readonly proposedSaleShares: number;
    /** {@link InsiderMetrics.proposedSaleShares} as % of shares outstanding; `null` without shares outstanding. */
    readonly proposedSalePctOutstanding: number | null;
    /** Part of {@link InsiderMetrics.proposedSaleValueUsd} under a Rule 10b5-1 plan, USD. */
    readonly proposedSalePlannedValueUsd: number;
}

/** Computed figures of the Korean insider axis over the insider window. */
export interface KrInsiderMetrics {
    /** Executive / major-shareholder reports in the window. */
    readonly reports: number;
    /** Distinct reporters in the window. */
    readonly reporters: number;
    /** Net change in shares held across the window's reports. */
    readonly netSharesChange: number;
    /** Net change as percent of shares outstanding (else the summed ratio change); `null` when neither is usable. */
    readonly netChangePct: number | null;
    /** Trading-plan reports in the window. */
    readonly tradingPlans: number;
    /**
     * Newest receipt date of a usable ownership report (parseable date, finite
     * share change) on or before the reference day, inside the window or not;
     * `null` when there is none. With `reports === 0` it marks "reports exist,
     * none in the window" — an insufficient axis that is not missing data.
     */
    readonly latestReceiptDate: string | null;
}

/** Insider axis: Form 4 and Form 144 for US listings, DART ownership reports for Korean ones. */
export interface InsiderAxis extends InvestorFlowsAxisBase {
    readonly id: 'insider';
    /** US figures; `null` when the axis is insufficient or the snapshot is Korean. */
    readonly metrics: InsiderMetrics | null;
    /**
     * Korean figures; present for a Korean snapshot with a usable report on or
     * before the reference day (in the window or not) or a trading plan in the
     * window.
     */
    readonly krMetrics?: KrInsiderMetrics;
}

/** Computed 13D/13G figures over the large-holder window. */
export interface LargeHolderMetrics {
    /**
     * 13D positions (events) in the window: one per holder after a filer's
     * amendments are netted and a joint filing's co-filers merged. Quote this
     * as the number of positions, not {@link LargeHolderMetrics.filings13d}.
     */
    readonly events13d: number;
    /** 13D filings (original and amendments) in the window; a joint filing and a same-day repeat count once. */
    readonly filings13d: number;
    /** 13G positions (events) in the window; see {@link LargeHolderMetrics.events13d}. */
    readonly events13g: number;
    /** 13G filings (original and amendments) in the window; see {@link LargeHolderMetrics.filings13d}. */
    readonly filings13g: number;
}

/** Computed figures of the Korean major-holder axis over the large-holder window. */
export interface KrMajorHolderMetrics {
    /** Major-holder reports in the window. */
    readonly reports: number;
    /** Distinct reporters in the window. */
    readonly reporters: number;
    /** Reports in the window filed on the detailed (일반) form; informational. */
    readonly detailedReports: number;
    /**
     * Largest per-reporter net holding-ratio change in the window, percentage
     * points, absolute; `null` when no report is in the window.
     */
    readonly maxAbsRatioChangePct: number | null;
    /**
     * Newest receipt date of a usable report (parseable date, finite ratio and
     * ratio change) on or before the reference day, inside the window or not.
     * With `reports === 0` it marks "reports exist, none in the window" — an
     * insufficient axis that is not missing data.
     */
    readonly latestReceiptDate: string;
}

/** 5% beneficial-owner axis: 13D/13G for US listings, DART major-holder reports for Korean ones. */
export interface LargeHolderAxis extends InvestorFlowsAxisBase {
    readonly id: 'largeHolders';
    /** US figures; `null` when the axis is insufficient or the snapshot is Korean. */
    readonly metrics: LargeHolderMetrics | null;
    /**
     * Korean figures; present for a Korean snapshot with a usable report on or
     * before the reference day, in the window or not.
     */
    readonly krMetrics?: KrMajorHolderMetrics;
}

/** Computed dilution figures over the dilution window. */
export interface DilutionMetrics {
    /** Offering filings in the window, every kind. */
    readonly filingsInWindow: number;
    /** At-the-market program filings (424B5 `atm`). */
    readonly atmFilings: number;
    /** Marketed offerings: underwritten or placement-agent (best efforts) 424B5. */
    readonly marketedOfferingFilings: number;
    /** Shelf registrations (S-3 / F-3 family). */
    readonly shelfFilings: number;
    /** Full registrations (S-1 / F-1 family). */
    readonly registrationFilings: number;
    /** Form D private placements. */
    readonly privatePlacementFilings: number;
    /** Newest filing date in the window. */
    readonly latestFilingDate: string | null;
}

/** Dilution (registration / offering filings) axis. */
export interface DilutionAxis extends InvestorFlowsAxisBase {
    readonly id: 'dilution';
    /**
     * `true` only when the snapshot provided an offering list, the reference
     * day is usable, and the list is empty — no filing exists for the issuer
     * over the provider's lookback. The axis is then `sufficient` at score 0
     * (neutral) with zero metrics and renders "no filings on record". A missing
     * list, an unusable reference day, or a list whose entries are all
     * unparseable or future-dated is `false` and `insufficient` ("no data"):
     * those are unusable inputs, not proof that nothing was filed.
     */
    readonly noFilingsOnRecord: boolean;
    /** Computed figures; `null` when the axis is insufficient. */
    readonly metrics: DilutionMetrics | null;
}

/**
 * Direction of the last short-interest settlements: `rising` / `falling` when
 * every step moved that way and the net change is material, `mixed` when the
 * steps reversed direction (one up, one down) and the net change is material
 * (e.g. 57.0M → 39.1M → 42.7M — calling that flat hid a -25% move), `flat`
 * otherwise (a net change under the minimum, or an unchanged step).
 */
export type ShortInterestTrend = 'rising' | 'falling' | 'flat' | 'mixed';

/** Computed short-selling figures; `null` where the input was missing. */
export interface ShortMetrics {
    /** Latest short interest as percent of float; `null` without float. */
    readonly shortInterestPctFloat: number | null;
    /** Days to cover of the latest settlement. */
    readonly daysToCover: number | null;
    /** Short-interest change across the last 3 settlements, percent. */
    readonly shortInterestChangePct: number | null;
    /** First settlement of {@link ShortMetrics.shortInterestChangePct}'s window; `null` with it. */
    readonly shortInterestChangeFromDate: string | null;
    /** Last (latest) settlement of that window; `null` with it. */
    readonly shortInterestChangeToDate: string | null;
    /** Change from the previous settlement to the latest one, percent; `null` with fewer than 2 points. */
    readonly shortInterestLatestChangePct: number | null;
    /** Previous settlement date of {@link ShortMetrics.shortInterestLatestChangePct}. */
    readonly shortInterestLatestChangeFromDate: string | null;
    /** Latest settlement date of {@link ShortMetrics.shortInterestLatestChangePct}. */
    readonly shortInterestLatestChangeToDate: string | null;
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
     * carries no price. With a squeeze context the flag instead means the squeeze
     * score reached `high` (see `evaluateSqueezeRisk`).
     */
    readonly squeezeRisk: boolean;
    /** Largest fails-to-deliver quantity in the recent FTD window. */
    readonly failsToDeliverPeakQty: number | null;
    /**
     * Settlement date of that peak (the newest such day on a tie); `null` when
     * the recent window had no fail day or the feed is unavailable. Not the
     * latest FTD file date — a peak quoted with the latest date misdates it.
     */
    readonly failsToDeliverPeakDate: string | null;
    /** That peak as percent of shares outstanding. */
    readonly failsToDeliverPctOutstanding: number | null;
    /** That peak divided by the baseline's average daily fails; `null` when that average is under `FTD_MIN_BASELINE_DAILY_AVERAGE` (near-zero baselines make the multiple noise). */
    readonly failsToDeliverMultiple: number | null;
    /** Reg SHO threshold-list status; `null` when the lists are excluded or unavailable. */
    readonly thresholdListed: boolean | null;
    /** Consecutive days on a threshold list; `null` when the lists are excluded or unavailable. */
    readonly thresholdConsecutiveDays: number | null;
}

/** Short-selling axis: FINRA short interest and short volume, plus SEC fails to deliver and Reg SHO threshold lists as neutral context. */
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
    /** Newest fails-to-deliver settlement date. */
    readonly failsToDeliverLatestDate: string | null;
    /** `asOf` of the Reg SHO threshold-list status; `null` when the list is excluded, unavailable or undated. */
    readonly thresholdListAsOf: string | null;
    /**
     * Whether the threshold-list status was dropped as stale (dated outside
     * `THRESHOLD_LIST_MAX_AGE_DAYS`, so not scored); `null` when there is no
     * status (excluded or unavailable).
     */
    readonly thresholdListStale: boolean | null;
    /** Window offering filings were measured over. */
    readonly dilutionWindow: InvestorFlowsWindow;
    /** Newest DART receipt date (major-holder, insider or trading-plan report); `null` for US snapshots. */
    readonly krDisclosureLatestDate: string | null;
}

/** The deterministic investor-flows scorecard. The LLM interprets it; it never recomputes it. */
export interface InvestorFlowsScorecard {
    /** 13F institutional axis. */
    readonly institutional: InstitutionalAxis;
    /** Form 4 insider axis. */
    readonly insider: InsiderAxis;
    /** 13D/13G axis. */
    readonly largeHolders: LargeHolderAxis;
    /** Short axis (FINRA short data, SEC fails to deliver, Reg SHO threshold lists). */
    readonly short: ShortAxis;
    /** Registration / offering (dilution) axis. */
    readonly dilution: DilutionAxis;
    /** Market the scorecard was evaluated for. */
    readonly market: InvestorFlowsMarket;
    /** Short-squeeze score; `null` without a squeeze context or for Korean snapshots. */
    readonly squeezeRisk: SqueezeRiskScore | null;
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
    /**
     * `false` ignores the Reg SHO threshold-list status even when the snapshot
     * carries it (the exchange lists are licensed for non-commercial use only).
     * Default `true`. Needed beside the provider's `null` feed for the same
     * reason as `includeFinraData`: a cached snapshot outlives a flag change.
     */
    readonly includeExchangeLists?: boolean;
    /**
     * Daily bars for the price-aware squeeze score. When given, the
     * `short_squeeze_risk` signal comes from `evaluateSqueezeRisk` and the
     * scorecard carries the score; without it the signal keeps the price-free rule.
     */
    readonly squeezeContext?: SqueezeRiskContext;
}

// ─── Short-squeeze score ─────────────────────────────

/** One daily bar the squeeze score reads. */
export interface SqueezeRiskBar {
    /** Session date (`yyyy-mm-dd`, or a datetime whose leading date is the session). */
    readonly date: string;
    /** Close. */
    readonly close: number;
    /** Share volume. */
    readonly volume: number;
}

/** Price context for {@link SqueezeRiskScore}. */
export interface SqueezeRiskContext {
    /**
     * Daily bars, any order. Only bars dated **before** the reference day are
     * used, so a still-forming bar of the reference day never changes the score.
     */
    readonly dailyBars: readonly SqueezeRiskBar[];
}

/** Options for `evaluateSqueezeRisk`. */
export interface EvaluateSqueezeRiskOptions {
    /** Overrides `snapshot.asOf` (same normalization as `evaluateInvestorFlows`). */
    readonly asOf?: string;
    /** `false` drops the FINRA components. Default `true`. */
    readonly includeFinraData?: boolean;
    /** `false` drops the threshold-list component. Default `true`. */
    readonly includeExchangeLists?: boolean;
}

/** Squeeze-score band. */
export type SqueezeRiskLevel = 'low' | 'elevated' | 'high' | 'extreme';

/** Inputs of the squeeze score. */
export type SqueezeRiskComponentId =
    | 'short_interest_pct_float'
    | 'days_to_cover'
    | 'short_interest_trend'
    | 'off_exchange_short_ratio_z'
    | 'fails_to_deliver_pct'
    | 'threshold_list_days'
    | 'price_change_20d'
    | 'volume_ratio';

/** One input of the squeeze score. */
export interface SqueezeRiskComponent {
    /** Which input. */
    readonly id: SqueezeRiskComponentId;
    /** Raw value in the input's own unit (percent, days, z, multiple). */
    readonly value: number;
    /** Value mapped onto 0..1. */
    readonly normalized: number;
    /** Weight after renormalizing over the available inputs (the weights of the listed components sum to 1). */
    readonly weight: number;
    /** Points this input adds to the 0..100 score (`normalized x weight x 100`, rounded). */
    readonly contribution: number;
}

/** `full` = every input present; `partial` = some missing, weights renormalized; `insufficient` = no short-side input. */
export type SqueezeRiskSufficiency = 'full' | 'partial' | 'insufficient';

/** Deterministic short-squeeze risk score. */
export interface SqueezeRiskScore {
    /** 0..100; `null` when insufficient. */
    readonly score: number | null;
    /** Band of `score`; `null` when insufficient. */
    readonly level: SqueezeRiskLevel | null;
    /** Inputs that were present, largest contribution first. */
    readonly components: readonly SqueezeRiskComponent[];
    /** Inputs that were missing or excluded by an option. */
    readonly missing: readonly SqueezeRiskComponentId[];
    /** Data sufficiency. */
    readonly sufficiency: SqueezeRiskSufficiency;
    /**
     * `true` when the level was held at `elevated` because no short-positioning
     * input (short interest, days to cover, trend, short-volume z) was present.
     */
    readonly levelCapped: boolean;
    /** Whether a FINRA-derived input contributed. */
    readonly includesFinra: boolean;
    /** Whether the threshold-list input contributed. */
    readonly includesExchangeLists: boolean;
    /** Reference day; `null` when unusable. */
    readonly asOf: string | null;
    /** Last bar date the price inputs used; `null` without usable bars. */
    readonly lastBarDate: string | null;
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
