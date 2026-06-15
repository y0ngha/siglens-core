import type {
    BalanceSheetRow,
    CashFlowRow,
    FinancialsSnapshot,
    IncomeStatementRow,
    NormalizeFinancialsSnapshotInput,
} from '@/domain/types';

const pct = (num: number | null, den: number | null): number | null =>
    num == null || den == null || den === 0 ? null : (num / den) * 100;
const ratio = (num: number | null, den: number | null): number | null =>
    num == null || den == null || den === 0 ? null : num / den;

/**
 * Composite key for the revenue lookup map.
 *
 * Using `fiscalYear` alone collapses multiple quarterly rows that share
 * the same year onto a single entry — the last quarter's revenue silently
 * overwrites earlier ones. The composite `fiscalYear|period` key ensures
 * each row (annual *or* quarterly) maps to its own revenue value so that
 * `fcfMargin` in `withCashDerived` is always matched against the correct
 * quarter's revenue rather than a random survivor.
 */
const revenueKey = (r: { fiscalYear: string; period: string }): string =>
    `${r.fiscalYear}|${r.period}`;

function withIncomeDerived(r: IncomeStatementRow): IncomeStatementRow {
    return {
        ...r,
        grossMargin: r.grossMargin ?? pct(r.grossProfit, r.revenue),
        operatingMargin: r.operatingMargin ?? pct(r.operatingIncome, r.revenue),
        netMargin: r.netMargin ?? pct(r.netIncome, r.revenue),
    };
}
function withBalanceDerived(r: BalanceSheetRow): BalanceSheetRow {
    return {
        ...r,
        currentRatio:
            r.currentRatio ??
            ratio(r.totalCurrentAssets, r.totalCurrentLiabilities),
    };
}
function withCashDerived(
    r: CashFlowRow,
    revenueByKey: Map<string, number | null>
): CashFlowRow {
    return {
        ...r,
        fcfMargin:
            r.fcfMargin ??
            pct(r.freeCashFlow, revenueByKey.get(revenueKey(r)) ?? null),
    };
}

/**
 * Normalize a raw financial-statements bundle into a {@link FinancialsSnapshot}.
 *
 * Fills derived metrics that depend on cross-statement values: income margins
 * (gross/operating/net) when absent, balance-sheet current ratio, and cash-flow
 * `fcfMargin` (matched against the same period's revenue via a `fiscalYear|period`
 * key). Already-present values are preserved; growth series pass through
 * unchanged. Pure and null-safe — missing inputs yield `null` derived fields.
 *
 * @param input - Domain-neutral bundle of statement and growth rows assembled by
 *   the provider adapter; each series newest→oldest.
 * @returns A structurally complete {@link FinancialsSnapshot} ready for the
 *   scorecard and prompt builders.
 */
export function normalizeFinancialsSnapshot(
    input: NormalizeFinancialsSnapshotInput
): FinancialsSnapshot {
    const income = input.income.map(withIncomeDerived);
    const revenueByKey = new Map(income.map(r => [revenueKey(r), r.revenue]));
    return {
        income,
        balance: input.balance.map(withBalanceDerived),
        cashFlow: input.cashFlow.map(r => withCashDerived(r, revenueByKey)),
        incomeGrowth: input.incomeGrowth,
        financialGrowth: input.financialGrowth,
        cashFlowGrowth: input.cashFlowGrowth,
    };
}
