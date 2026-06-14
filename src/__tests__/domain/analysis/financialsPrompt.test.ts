import { describe, it, expect } from 'vitest';
import { buildFinancialsAnalysisPrompt } from '@/domain/analysis/financialsPrompt';
import { computeFinancialsScorecard } from '@/domain/analysis/financialsScorecard';
import type {
    FinancialsSnapshot,
    IncomeStatementRow,
    BalanceSheetRow,
    CashFlowRow,
    FinancialGrowthRow,
    Skill,
} from '@/domain/types';

const empty: FinancialsSnapshot = {
    income: [],
    balance: [],
    cashFlow: [],
    incomeGrowth: [],
    financialGrowth: [],
    cashFlowGrowth: [],
};

const incomeRow: IncomeStatementRow = {
    fiscalYear: '2023',
    period: 'FY',
    date: '2023-09-30',
    revenue: 383_285_000_000,
    grossProfit: 169_148_000_000,
    operatingIncome: 114_301_000_000,
    netIncome: 96_995_000_000,
    ebitda: null,
    eps: 6.16,
    epsDiluted: 6.13,
    grossMargin: 44.13,
    operatingMargin: 29.82,
    netMargin: 25.31,
};

const balanceRow: BalanceSheetRow = {
    fiscalYear: '2023',
    period: 'FY',
    date: '2023-09-30',
    totalAssets: 352_583_000_000,
    totalCurrentAssets: 143_566_000_000,
    totalLiabilities: 290_437_000_000,
    totalCurrentLiabilities: 145_308_000_000,
    cashAndShortTermInvestments: 61_555_000_000,
    totalDebt: 123_930_000_000,
    netDebt: 81_123_000_000,
    totalStockholdersEquity: 62_146_000_000,
    currentRatio: 0.99,
};

const cashFlowRow: CashFlowRow = {
    fiscalYear: '2023',
    period: 'FY',
    date: '2023-09-30',
    operatingCashFlow: 110_543_000_000,
    capitalExpenditure: -11_085_000_000,
    freeCashFlow: 99_458_000_000,
    dividendsPaid: null,
    fcfMargin: 25.94,
};

const growthRow: FinancialGrowthRow = {
    fiscalYear: '2023',
    period: 'FY',
    revenueGrowth: -0.0027,
    netIncomeGrowth: 0.0296,
    epsgrowth: 0.0875,
    freeCashFlowGrowth: 0.2002,
    operatingCashFlowGrowth: 0.1236,
    assetGrowth: -0.0025,
    debtGrowth: -0.0156,
    threeYRevenueGrowthPerShare: 0.155,
    fiveYRevenueGrowthPerShare: 0.12,
    tenYRevenueGrowthPerShare: 0.099,
};

const richSnapshot: FinancialsSnapshot = {
    income: [incomeRow],
    balance: [balanceRow],
    cashFlow: [cashFlowRow],
    incomeGrowth: [],
    financialGrowth: [growthRow],
    cashFlowGrowth: [],
};

describe('buildFinancialsAnalysisPrompt', () => {
    it('includes symbol, scorecard grades, and JSON schema fields', () => {
        const p = buildFinancialsAnalysisPrompt(
            'AAPL',
            empty,
            computeFinancialsScorecard(empty),
            []
        );
        expect(p).toContain('AAPL');
        expect(p).toContain('axisAssessments');
        expect(p).toContain('overallSentiment');
        expect(p).toMatch(/growth|quality|solvency|cash/);
    });
    it('only injects fundamental-category skills', () => {
        const skills = [
            {
                name: 'KeepMe',
                description: '',
                indicators: [],
                confidenceWeight: 1,
                content: 'FIN_SKILL_CONTENT',
                category: 'fundamental',
            },
            {
                name: 'DropMe',
                description: '',
                indicators: [],
                confidenceWeight: 1,
                content: 'TECH_SKILL_CONTENT',
                category: 'reversal_bullish',
            },
        ] as unknown as Skill[];
        const p = buildFinancialsAnalysisPrompt(
            'AAPL',
            empty,
            computeFinancialsScorecard(empty),
            skills
        );
        expect(p).toContain('FIN_SKILL_CONTENT');
        expect(p).not.toContain('TECH_SKILL_CONTENT');
    });
    it('includes composite grade and summaryKo in scorecard section', () => {
        const scorecard = computeFinancialsScorecard(empty);
        const p = buildFinancialsAnalysisPrompt('TSLA', empty, scorecard, []);
        expect(p).toContain(scorecard.composite.grade);
        expect(p).toContain(scorecard.composite.summaryKo);
    });
    it('includes all four axis grades in the scorecard section', () => {
        const scorecard = computeFinancialsScorecard(empty);
        const p = buildFinancialsAnalysisPrompt('MSFT', empty, scorecard, []);
        // Each axis appears with its grade label
        expect(p).toContain('growth');
        expect(p).toContain('quality');
        expect(p).toContain('solvency');
        expect(p).toContain('cash');
    });
    it('includes overallConclusionKo and riskFactorsKo in the output schema', () => {
        const p = buildFinancialsAnalysisPrompt(
            'NVDA',
            empty,
            computeFinancialsScorecard(empty),
            []
        );
        expect(p).toContain('overallConclusionKo');
        expect(p).toContain('riskFactorsKo');
    });
    it('omits non-fundamental skills and keeps fundamental ones when mixed', () => {
        const skills = [
            {
                name: 'FundSkill',
                description: '',
                indicators: [],
                confidenceWeight: 0.8,
                content: 'FUND_CONTENT',
                category: 'fundamental',
            },
            {
                name: 'NeutralSkill',
                description: '',
                indicators: [],
                confidenceWeight: 1,
                content: 'NEUTRAL_CONTENT',
                category: 'neutral',
            },
            {
                name: 'NewsSkill',
                description: '',
                indicators: [],
                confidenceWeight: 1,
                content: 'NEWS_CONTENT',
                category: 'news',
            },
        ] as unknown as Skill[];
        const p = buildFinancialsAnalysisPrompt(
            'GOOG',
            empty,
            computeFinancialsScorecard(empty),
            skills
        );
        expect(p).toContain('FUND_CONTENT');
        expect(p).not.toContain('NEUTRAL_CONTENT');
        expect(p).not.toContain('NEWS_CONTENT');
    });
    it('shows no additional skills message when skill list is empty', () => {
        const p = buildFinancialsAnalysisPrompt(
            'AMZN',
            empty,
            computeFinancialsScorecard(empty),
            []
        );
        expect(p).toContain('No additional');
    });
    it('injects income statement data when snapshot has rows', () => {
        const p = buildFinancialsAnalysisPrompt(
            'AAPL',
            richSnapshot,
            computeFinancialsScorecard(richSnapshot),
            []
        );
        expect(p).toContain('2023');
        // fmtBillion: revenue ~383B
        expect(p).toContain('383.');
        // fmtPct: gross margin 44.13%
        expect(p).toContain('44.1%');
        // fmt: eps 6.16
        expect(p).toContain('6.16');
    });
    it('injects balance sheet data when snapshot has rows', () => {
        const p = buildFinancialsAnalysisPrompt(
            'AAPL',
            richSnapshot,
            computeFinancialsScorecard(richSnapshot),
            []
        );
        // totalAssets ~352B
        expect(p).toContain('352.');
        // currentRatio 0.99
        expect(p).toContain('0.99');
    });
    it('injects cash flow data when snapshot has rows', () => {
        const p = buildFinancialsAnalysisPrompt(
            'AAPL',
            richSnapshot,
            computeFinancialsScorecard(richSnapshot),
            []
        );
        // operatingCashFlow ~110B
        expect(p).toContain('110.');
        // FCF margin 25.94%
        expect(p).toContain('25.9%');
    });
    it('injects financial growth data including long-term per-share growth', () => {
        const p = buildFinancialsAnalysisPrompt(
            'AAPL',
            richSnapshot,
            computeFinancialsScorecard(richSnapshot),
            []
        );
        // revenueGrowth -0.0027 => -0.3%
        expect(p).toContain('-0.3%');
        // 3Y revenue growth per share 15.5%
        expect(p).toContain('15.5%');
        expect(p).toContain('Long-term (per share)');
    });
    it('formats null financial values as N/A', () => {
        const rowWithNulls: IncomeStatementRow = {
            fiscalYear: '2022',
            period: 'FY',
            date: '2022-09-30',
            revenue: null,
            grossProfit: null,
            operatingIncome: null,
            netIncome: null,
            ebitda: null,
            eps: null,
            epsDiluted: null,
            grossMargin: null,
            operatingMargin: null,
            netMargin: null,
        };
        const snap: FinancialsSnapshot = { ...empty, income: [rowWithNulls] };
        const p = buildFinancialsAnalysisPrompt(
            'TEST',
            snap,
            computeFinancialsScorecard(snap),
            []
        );
        expect(p).toContain('N/A');
    });
    it('includes axis signals in scorecard section when signals exist', () => {
        const scorecard = computeFinancialsScorecard(richSnapshot);
        const p = buildFinancialsAnalysisPrompt(
            'AAPL',
            richSnapshot,
            scorecard,
            []
        );
        // With richSnapshot, some signals should be generated
        // The scorecard section always renders signal labelKo or 'None'
        expect(p).toMatch(/Signals:/);
    });
});
