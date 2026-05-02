import { vi } from 'vitest';
import type { EarningsCalendarItem, EnrichedNewsItem } from '@/domain/types';
import type { FundamentalDataProvider } from '@/infrastructure/fundamental/types';

/** Minimal {@link EnrichedNewsItem} fixture for use in overall analysis tests. */
export function makeEnrichedNewsItem(id: string): EnrichedNewsItem {
    return {
        id,
        symbol: 'AAPL',
        source: 'Reuters',
        url: `https://reuters.com/${id}`,
        publishedAt: '2026-05-02T10:00:00Z',
        titleEn: `Apple news ${id}`,
        bodyEn: `Apple body ${id}`,
        card: {
            titleKo: `애플 뉴스 ${id}`,
            bodyKo: `애플 본문 ${id}`,
            summaryKo: `요약 ${id}`,
            sentiment: 'neutral',
            category: 'other',
        },
    };
}

/** Minimal {@link EarningsCalendarItem} fixture for use in overall analysis tests. */
export function makeCalendarItem(earningsDate: string): EarningsCalendarItem {
    return {
        symbol: 'AAPL',
        earningsDate,
        epsActual: null,
        epsEstimated: 1.5,
        revenueActual: null,
        revenueEstimated: 90_000_000_000,
        lastUpdated: '2026-05-01',
    };
}

/** Minimal {@link FundamentalDataProvider} stub for use in overall analysis tests. */
export const minimalProvider: FundamentalDataProvider = {
    getProfile: vi.fn(),
    getKeyMetricsTtm: vi.fn(),
    getRatiosTtm: vi.fn(),
    getIncomeStatement: vi.fn(),
    getBalanceSheetStatement: vi.fn(),
    getCashFlowStatement: vi.fn(),
    getIncomeStatementGrowth: vi.fn(),
    getFinancialScores: vi.fn(),
    getStockPeers: vi.fn(),
    getAnalystEstimates: vi.fn(),
    getGrades: vi.fn(),
    getGradesConsensus: vi.fn(),
    getPriceTargetConsensus: vi.fn(),
    getPriceTargetSummary: vi.fn(),
    getSectorPerformanceSnapshot: vi.fn(),
    getHistoricalSectorPerformance: vi.fn(),
    getEarningsReport: vi.fn(),
};
