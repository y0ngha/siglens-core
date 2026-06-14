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
});
