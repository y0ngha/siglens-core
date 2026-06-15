import { describe, it, expect } from 'vitest';
import { normalizeFinancialsSnapshot } from '@/domain/analysis/normalizeFinancialsSnapshot';
import type { NormalizeFinancialsSnapshotInput } from '@/domain/types';

const base: NormalizeFinancialsSnapshotInput = {
    income: [
        {
            fiscalYear: '2025',
            period: 'FY',
            date: '2025-09-27',
            revenue: 1000,
            grossProfit: 400,
            operatingIncome: 300,
            netIncome: 200,
            ebitda: 350,
            eps: 6,
            epsDiluted: 5.9,
            grossMargin: null,
            operatingMargin: null,
            netMargin: null,
        },
    ],
    balance: [
        {
            fiscalYear: '2025',
            period: 'FY',
            date: '2025-09-27',
            totalAssets: 5000,
            totalCurrentAssets: 1500,
            totalLiabilities: 3000,
            totalCurrentLiabilities: 1000,
            cashAndShortTermInvestments: 800,
            totalDebt: 1200,
            netDebt: 400,
            totalStockholdersEquity: 2000,
            currentRatio: null,
        },
    ],
    cashFlow: [
        {
            fiscalYear: '2025',
            period: 'FY',
            date: '2025-09-27',
            operatingCashFlow: 350,
            capitalExpenditure: -50,
            freeCashFlow: 300,
            dividendsPaid: -40,
            fcfMargin: null,
        },
    ],
    incomeGrowth: [],
    financialGrowth: [],
    cashFlowGrowth: [],
};

describe('normalizeFinancialsSnapshot', () => {
    it('computes derived margins when missing', () => {
        const s = normalizeFinancialsSnapshot(base);
        expect(s.income[0].grossMargin).toBeCloseTo(40);
        expect(s.income[0].operatingMargin).toBeCloseTo(30);
        expect(s.income[0].netMargin).toBeCloseTo(20);
        expect(s.balance[0].currentRatio).toBeCloseTo(1.5);
        expect(s.cashFlow[0].fcfMargin).toBeCloseTo(30);
    });
    it('keeps existing derived values when already present', () => {
        const s = normalizeFinancialsSnapshot({
            ...base,
            income: [{ ...base.income[0], grossMargin: 99 }],
        });
        expect(s.income[0].grossMargin).toBe(99);
    });
    it('leaves derived null when inputs missing', () => {
        const s = normalizeFinancialsSnapshot({
            ...base,
            income: [{ ...base.income[0], revenue: null }],
            balance: [{ ...base.balance[0], totalCurrentLiabilities: null }],
        });
        expect(s.income[0].grossMargin).toBeNull();
        expect(s.balance[0].currentRatio).toBeNull();
        expect(s.cashFlow[0].fcfMargin).toBeNull();
    });
    it('returns structurally complete snapshot for empty input', () => {
        const s = normalizeFinancialsSnapshot({
            income: [],
            balance: [],
            cashFlow: [],
            incomeGrowth: [],
            financialGrowth: [],
            cashFlowGrowth: [],
        });
        expect(s).toEqual({
            income: [],
            balance: [],
            cashFlow: [],
            incomeGrowth: [],
            financialGrowth: [],
            cashFlowGrowth: [],
        });
    });

    it('quarterly rows with the same fiscalYear use their own revenue for fcfMargin', () => {
        // Two quarterly rows share fiscalYear '2025' but have different periods
        // and different revenue values. Each cash-flow row's fcfMargin must be
        // derived from its own quarter's revenue — not the last writer's.
        const quarterly: NormalizeFinancialsSnapshotInput = {
            income: [
                {
                    fiscalYear: '2025',
                    period: 'Q1',
                    date: '2025-03-29',
                    revenue: 1000,
                    grossProfit: null,
                    operatingIncome: null,
                    netIncome: null,
                    ebitda: null,
                    eps: null,
                    epsDiluted: null,
                    grossMargin: null,
                    operatingMargin: null,
                    netMargin: null,
                },
                {
                    fiscalYear: '2025',
                    period: 'Q2',
                    date: '2025-06-28',
                    revenue: 2000,
                    grossProfit: null,
                    operatingIncome: null,
                    netIncome: null,
                    ebitda: null,
                    eps: null,
                    epsDiluted: null,
                    grossMargin: null,
                    operatingMargin: null,
                    netMargin: null,
                },
            ],
            balance: [],
            cashFlow: [
                {
                    fiscalYear: '2025',
                    period: 'Q1',
                    date: '2025-03-29',
                    operatingCashFlow: null,
                    capitalExpenditure: null,
                    freeCashFlow: 100,
                    dividendsPaid: null,
                    fcfMargin: null,
                },
                {
                    fiscalYear: '2025',
                    period: 'Q2',
                    date: '2025-06-28',
                    operatingCashFlow: null,
                    capitalExpenditure: null,
                    freeCashFlow: 300,
                    dividendsPaid: null,
                    fcfMargin: null,
                },
            ],
            incomeGrowth: [],
            financialGrowth: [],
            cashFlowGrowth: [],
        };

        const s = normalizeFinancialsSnapshot(quarterly);

        // Q1: FCF 100 / revenue 1000 = 10 %
        expect(s.cashFlow[0].fcfMargin).toBeCloseTo(10);
        // Q2: FCF 300 / revenue 2000 = 15 %
        expect(s.cashFlow[1].fcfMargin).toBeCloseTo(15);
        // Values must be distinct — not the same collapsing value
        expect(s.cashFlow[0].fcfMargin).not.toBe(s.cashFlow[1].fcfMargin);
    });
});
