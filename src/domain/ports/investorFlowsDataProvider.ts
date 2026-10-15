import type { InvestorFlowsSnapshot } from '@/domain/investorFlows/types';

/**
 * @port
 * Port for institutional / insider / large-holder / short-selling investor flows data.
 *
 * Adapters live in the consumer (siglens assembles the snapshot from its stored
 * SEC 13F aggregates, FMP Form 4 and 13D/G endpoints, and FINRA files).
 *
 * Contract:
 * - Return `null` when the symbol has no investor flows (수급) coverage at all (non-US,
 *   unmapped CUSIP, ...). The use-case treats it as "no data", not an error.
 * - Throw ONLY on infrastructure failures.
 * - Return `shortInterest` and `shortVolume` as `null` when the FINRA feature
 *   flag is off (FINRA terms limit the data to non-commercial use).
 * - Sections that simply have no data are empty arrays; the scorecard marks
 *   such axes `insufficient` instead of scoring zeros.
 */
export interface InvestorFlowsDataProvider {
    /**
     * Fetch the investor flows snapshot for a symbol.
     *
     * @param symbol - U.S. equity ticker (e.g. `"AAPL"`).
     * @returns The snapshot, or `null` when the symbol has no investor flows data.
     */
    getInvestorFlowsSnapshot(
        symbol: string
    ): Promise<InvestorFlowsSnapshot | null>;
}
