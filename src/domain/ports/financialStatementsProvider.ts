import type {
    BalanceSheetRow,
    CashFlowGrowthRow,
    CashFlowRow,
    FinancialGrowthRow,
    IncomeGrowthRow,
    IncomeStatementRow,
    StatementPeriod,
} from '@/domain/types';

/**
 * @port
 * Financial-statement time-series fetcher contract the domain depends on for
 * income statements, balance sheets, cash flow statements, and their YoY growth
 * series.
 *
 * Adapters live in the consumer (e.g. siglens provides its own adapter built on
 * FMP statement endpoints) and must map source-specific shapes to the
 * domain-neutral Row interfaces before returning — the port surface references
 * only domain types. Every method returns rows in newest→oldest order and an
 * empty array when no data is available; implementations throw only on
 * infrastructure failures, never for missing data.
 *
 * @see normalizeFinancialsSnapshot
 */
export interface FinancialStatementsProvider {
    /**
     * Fetch income statements (revenue, profit, margins, EPS).
     *
     * @param symbol - Ticker symbol (e.g. `"AAPL"`).
     * @param period - Reporting cadence (`'annual'` or `'quarter'`).
     * @param limit - Maximum number of rows to return.
     * @returns Income statement rows, newest first; empty array if unavailable.
     */
    getIncomeStatements(
        symbol: string,
        period: StatementPeriod,
        limit: number
    ): Promise<IncomeStatementRow[]>;

    /**
     * Fetch balance sheets (assets, liabilities, equity, net debt, ratios).
     *
     * @param symbol - Ticker symbol.
     * @param period - Reporting cadence (`'annual'` or `'quarter'`).
     * @param limit - Maximum number of rows to return.
     * @returns Balance sheet rows, newest first; empty array if unavailable.
     */
    getBalanceSheets(
        symbol: string,
        period: StatementPeriod,
        limit: number
    ): Promise<BalanceSheetRow[]>;

    /**
     * Fetch cash flow statements (operating cash flow, capex, free cash flow).
     *
     * @param symbol - Ticker symbol.
     * @param period - Reporting cadence (`'annual'` or `'quarter'`).
     * @param limit - Maximum number of rows to return.
     * @returns Cash flow rows, newest first; empty array if unavailable.
     */
    getCashFlowStatements(
        symbol: string,
        period: StatementPeriod,
        limit: number
    ): Promise<CashFlowRow[]>;

    /**
     * Fetch income-statement growth (revenue, net income, EPS, operating income YoY).
     *
     * @param symbol - Ticker symbol.
     * @param period - Reporting cadence (`'annual'` or `'quarter'`).
     * @param limit - Maximum number of rows to return.
     * @returns Income growth rows, newest first; empty array if unavailable.
     */
    getIncomeStatementGrowths(
        symbol: string,
        period: StatementPeriod,
        limit: number
    ): Promise<IncomeGrowthRow[]>;

    /**
     * Fetch the financial growth series (revenue/NI/EPS/FCF/debt growth plus
     * long-term per-share growth).
     *
     * @param symbol - Ticker symbol.
     * @param period - Reporting cadence (`'annual'` or `'quarter'`).
     * @param limit - Maximum number of rows to return.
     * @returns Financial growth rows, newest first; empty array if unavailable.
     */
    getFinancialGrowths(
        symbol: string,
        period: StatementPeriod,
        limit: number
    ): Promise<FinancialGrowthRow[]>;

    /**
     * Fetch cash-flow growth (operating cash flow, free cash flow, capex YoY).
     *
     * @param symbol - Ticker symbol.
     * @param period - Reporting cadence (`'annual'` or `'quarter'`).
     * @param limit - Maximum number of rows to return.
     * @returns Cash flow growth rows, newest first; empty array if unavailable.
     */
    getCashFlowGrowths(
        symbol: string,
        period: StatementPeriod,
        limit: number
    ): Promise<CashFlowGrowthRow[]>;
}
