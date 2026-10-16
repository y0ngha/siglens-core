import type { InvestorFlowsSnapshot } from '@/domain/investorFlows/types';

/**
 * @port
 * Port for institutional / insider / large-holder / short-selling / dilution
 * investor flows data.
 *
 * Adapters live in the consumer (siglens assembles the snapshot from its stored
 * SEC 13F aggregates and option positions, FMP Form 4 and 13D/G endpoints, SEC
 * Form 144 / offering / fails-to-deliver files, exchange Reg SHO lists, FINRA
 * files and, for Korean listings, DART disclosures).
 *
 * Contract:
 * - Return `null` when the symbol has no investor flows (수급) coverage at all
 *   (unmapped CUSIP, unmapped DART corp code, ...). The use-case treats it as
 *   "no data", not an error.
 * - Throw ONLY on infrastructure failures.
 * - Return `shortInterest` and `shortVolume` as `null` when the FINRA feature
 *   flag is off (FINRA terms limit the data to non-commercial use), and
 *   `thresholdList` as `null` when the exchange-list flag is off (same terms).
 * - A Korean listing sets `market: 'kr'` and fills `kr`; its US sections may be
 *   empty and are ignored.
 * - Sections that simply have no data are empty arrays; the scorecard marks
 *   such axes `insufficient` instead of scoring zeros. `failsToDeliver: []`
 *   means the feed is present with no fail day (rows exist only on fail days);
 *   `null` means the feed is unavailable.
 */
export interface InvestorFlowsDataProvider {
    /**
     * Fetch the investor flows snapshot for a symbol.
     *
     * @param symbol - Ticker (e.g. `"AAPL"`, `"005930.KS"`).
     * @returns The snapshot, or `null` when the symbol has no investor flows data.
     */
    getInvestorFlowsSnapshot(
        symbol: string
    ): Promise<InvestorFlowsSnapshot | null>;
}
