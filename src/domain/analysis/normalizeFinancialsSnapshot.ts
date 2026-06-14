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
    revenueByYear: Map<string, number | null>
): CashFlowRow {
    return {
        ...r,
        fcfMargin:
            r.fcfMargin ??
            pct(r.freeCashFlow, revenueByYear.get(r.fiscalYear) ?? null),
    };
}

export function normalizeFinancialsSnapshot(
    input: NormalizeFinancialsSnapshotInput
): FinancialsSnapshot {
    const income = input.income.map(withIncomeDerived);
    const revenueByYear = new Map(income.map(r => [r.fiscalYear, r.revenue]));
    return {
        income,
        balance: input.balance.map(withBalanceDerived),
        cashFlow: input.cashFlow.map(r => withCashDerived(r, revenueByYear)),
        incomeGrowth: input.incomeGrowth,
        financialGrowth: input.financialGrowth,
        cashFlowGrowth: input.cashFlowGrowth,
    };
}
