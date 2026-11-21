/**
 * Result-note texts for `get_bars_indicators` and `get_fundamentals`.
 *
 * These sentences used to sit in the two tool descriptions, which the model
 * reads on every turn although each one only matters when its field is null.
 * They now live here, and the consumer's executor attaches a text to the
 * result's `notes` array only when that field is null in that result (the
 * exact conditions are in `PUBLIC_API.md`, `runAgentTurn` action ⑩). The
 * descriptions keep every non-null rule and tell the model to follow `notes`
 * when present; the system prompt carries one rule saying the same.
 *
 * Each text states only what the code knows about THIS result (a gap in the
 * data is not a fact about the market, DOM-12) and keeps every obligation of
 * the description clause it replaced: cite, search when web search is
 * available, never from memory, never compute. Tests and the app's evaluation
 * checks import these instead of retyping the wording.
 */

export const BARS_RESULT_NOTES = {
    /**
     * Any timeframe other than 1Day. `timeframe` is the requested one.
     */
    dailyOnlyFields: (timeframe: string): string =>
        `This result is on timeframe ${timeframe}: calendarChange, closeStreak, maCross50_200, pullback, fearGreed and lastCompletedClose are not computed for it (null or absent). When the question needs one of them, call get_bars_indicators with timeframe 1Day and say the figure is on daily bars; if you cannot, say it is not available on this timeframe. Never fill one from these bars, from your own count or from memory. When the question does not need them, do not mention them.`,
    /** 1Day and `derived.closeStreak` is null. */
    closeStreakUnavailable:
        'derived.closeStreak is null in this result: no streak could be computed from the loaded daily bars. If the question asks about consecutive up or down sessions, say the streak cannot be determined; never count one yourself or give it from memory.',
    /** 1Day, and the 252-session cross scan could not be completed. */
    maCrossShortHistory:
        'derived.maCross50_200 is null in this result: the loaded daily history is too short to scan the last 252 sessions for 50/200-day crosses. If the question asks about a golden or dead cross, say the data does not reach that far; never say that no cross happened.',
    /** 1Day and `fearGreed` is null. */
    fearGreedUnavailable:
        "fearGreed is null in this result: SIGLENS could not compute this symbol's fear & greed reading from the loaded data. If the question asks about it, say it is not available; never estimate one and never substitute the market-wide index.",
} as const;

export const FUNDAMENTALS_RESULT_NOTES = {
    /** A next earnings date is present, earningsSession is null or absent, there is no earningsDateAlt and earningsDateConfirmed is not false. */
    earningsSessionUnknown:
        "earningsSession is null or absent in this result: this tool does not carry the before/after-market timing of this report date. If the question asks about that timing, never state it from memory and do not cite the company's usual reporting time from memory either: search the company announcement and cite it when web_search is available, otherwise say SIGLENS does not carry it and it could not be confirmed.",
    /** A figure field (epsDiluted, revenue, revenueYoYPct) inside a recentQuarters row `sec` is null. */
    secFieldMissing:
        'A figure field of a recentQuarters row `sec` is null in this result: SIGLENS has no filed value for that figure. When the answer needs that figure, say it is not in the filing data SIGLENS has (for a fiscal Q4 derived from the 10-K, sec.epsDiluted is null: the quarterly EPS is not in the filing); never take it from the row fields and never compute it.',
    /** `dividends` has the confirmed non-payer shape. */
    dividendsNonPayer:
        'dividends in this result shows a confirmed non-payer (latestExDate and latestAmount null, trailing12mAmount 0, trailingYieldPct 0): for a dividend question say the company pays no dividend and do not web_search for one.',
    /** `dividends` is null or absent. */
    dividendsUnknown:
        'dividends is null or absent in this result, so SIGLENS has no dividend information here. For a dividend question, search and cite when web_search is available, otherwise say it could not be confirmed; never answer from memory and never derive a yield.',
    /** `dividends.latestExDate` is present and both trailing fields are null. */
    dividendsTrailingUnknown:
        'dividends.latestExDate is present but trailing12mAmount and trailingYieldPct are both null in this result. For a dividend question, report only the latest payment and say the trailing-12-month yield could not be confirmed (or web_search it when available). Never derive an annual or trailing yield from a single payment.',
    /** annualReported is present, yieldOnLastClosePct is null and dpsCommon is not null. */
    krYieldOnLastCloseNull:
        'dividends.annualReported.yieldOnLastClosePct is null in this result. For a yield question, quote dartYieldPct labeled as the DART-reported yield on the record-date price, and when it is null too say the yield could not be confirmed. Never compute a yield yourself.',
    /** annualReported.dpsCommon is null. */
    krDpsUnknown:
        'dividends.annualReported.dpsCommon is null in this result: the DPS for that fiscal year could not be confirmed. For a dividend question, use the trailing fields, never a single payment.',
    /** A US stock whose indexMemberships is null or absent. */
    indexMembershipUnknown:
        'indexMemberships is null or absent in this result. For an index-membership question, search and cite when web_search is available, otherwise say SIGLENS does not carry it and it could not be confirmed; never answer from memory.',
    /** P/E is null. */
    peUntrusted:
        'The P/E in this result is null: SIGLENS returned no usable price-to-earnings figure. When the answer needs a P/E, say it is not available; never estimate it and never compute it from price and EPS yourself.',
} as const;
