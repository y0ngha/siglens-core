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
 * 재무제표 시계열 provider 포트. 어댑터(siglens FMP client)가 구현한다.
 * 각 메서드는 domain-neutral Row 배열을 최신→과거 순으로 반환하며,
 * 데이터 부재 시 빈 배열을 반환한다(throw는 인프라 장애에 한함).
 */
export interface FinancialStatementsProvider {
    getIncomeStatements(
        symbol: string,
        period: StatementPeriod,
        limit: number
    ): Promise<IncomeStatementRow[]>;
    getBalanceSheets(
        symbol: string,
        period: StatementPeriod,
        limit: number
    ): Promise<BalanceSheetRow[]>;
    getCashFlowStatements(
        symbol: string,
        period: StatementPeriod,
        limit: number
    ): Promise<CashFlowRow[]>;
    getIncomeStatementGrowths(
        symbol: string,
        period: StatementPeriod,
        limit: number
    ): Promise<IncomeGrowthRow[]>;
    getFinancialGrowths(
        symbol: string,
        period: StatementPeriod,
        limit: number
    ): Promise<FinancialGrowthRow[]>;
    getCashFlowGrowths(
        symbol: string,
        period: StatementPeriod,
        limit: number
    ): Promise<CashFlowGrowthRow[]>;
}
