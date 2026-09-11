import { describe, it, expect } from 'vitest';
import { buildFinancialsAnalysisPrompt as buildFinancialsAnalysisPromptRaw } from '@/domain/analysis/financialsPrompt';
import { computeFinancialsScorecard } from '@/domain/analysis/financialsScorecard';
import type {
    CashFlowGrowthRow,
    FinancialsSnapshot,
    IncomeGrowthRow,
    IncomeStatementRow,
    BalanceSheetRow,
    CashFlowRow,
    FinancialGrowthRow,
    Skill,
} from '@/domain/types';

// `buildFinancialsAnalysisPrompt` now returns `{ stable, dynamic }` (spec
// §3.4 assembly split) — this file's call sites predate the split and assert
// against the single legacy combined string (`stable + '\n\n' + dynamic`,
// exactly the string dispatch still sends as the `prompt` fallback field).
const buildFinancialsAnalysisPrompt = (
    ...args: Parameters<typeof buildFinancialsAnalysisPromptRaw>
): string => {
    const { stable, dynamic } = buildFinancialsAnalysisPromptRaw(...args);
    return `${stable}\n\n${dynamic}`;
};

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
    epsGrowth: 0.0875,
    freeCashFlowGrowth: 0.2002,
    operatingCashFlowGrowth: 0.1236,
    assetGrowth: -0.0025,
    debtGrowth: -0.0156,
    threeYRevenueGrowthPerShare: 0.155,
    fiveYRevenueGrowthPerShare: 0.12,
    tenYRevenueGrowthPerShare: 0.099,
};

const incomeGrowthRow: IncomeGrowthRow = {
    fiscalYear: '2023',
    period: 'FY',
    growthRevenue: -0.0028,
    growthNetIncome: 0.0296,
    growthEPS: 0.0875,
    growthOperatingIncome: 0.0417,
};

const cashFlowGrowthRow: CashFlowGrowthRow = {
    fiscalYear: '2023',
    period: 'FY',
    growthOperatingCashFlow: 0.1236,
    growthFreeCashFlow: 0.2002,
    growthCapitalExpenditure: -0.0521,
};

const richSnapshot: FinancialsSnapshot = {
    income: [incomeRow],
    balance: [balanceRow],
    cashFlow: [cashFlowRow],
    incomeGrowth: [incomeGrowthRow],
    financialGrowth: [growthRow],
    cashFlowGrowth: [cashFlowGrowthRow],
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
                gating: { tier: 'always_on' },
            },
            {
                name: 'DropMe',
                description: '',
                indicators: [],
                confidenceWeight: 1,
                content: 'TECH_SKILL_CONTENT',
                category: 'reversal_bullish',
                gating: { tier: 'always_on' },
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
                gating: { tier: 'always_on' },
            },
            {
                name: 'NeutralSkill',
                description: '',
                indicators: [],
                confidenceWeight: 1,
                content: 'NEUTRAL_CONTENT',
                category: 'neutral',
                gating: { tier: 'always_on' },
            },
            {
                name: 'NewsSkill',
                description: '',
                indicators: [],
                confidenceWeight: 1,
                content: 'NEWS_CONTENT',
                category: 'news',
                gating: { tier: 'always_on' },
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
    it('includes income statement growth section with operating income growth (B9)', () => {
        const p = buildFinancialsAnalysisPrompt(
            'AAPL',
            richSnapshot,
            computeFinancialsScorecard(richSnapshot),
            []
        );
        expect(p).toContain('Income Statement Growth');
        // growthOperatingIncome 0.0417 => 4.2%
        expect(p).toContain('Operating Income Growth 4.2%');
    });
    it('includes cash flow growth section with FCF/OCF growth (B9)', () => {
        const p = buildFinancialsAnalysisPrompt(
            'AAPL',
            richSnapshot,
            computeFinancialsScorecard(richSnapshot),
            []
        );
        expect(p).toContain('Cash Flow Growth');
        // growthFreeCashFlow 0.2002 => 20.0%
        expect(p).toContain('Free Cash Flow Growth 20.0%');
        // growthOperatingCashFlow 0.1236 => 12.4%
        expect(p).toContain('Operating Cash Flow Growth 12.4%');
    });
    it('shows N/A placeholders for growth sections when arrays are empty (B9)', () => {
        const p = buildFinancialsAnalysisPrompt(
            'AAPL',
            empty,
            computeFinancialsScorecard(empty),
            []
        );
        expect(p).toContain('No income statement growth data available');
        expect(p).toContain('No cash flow growth data available');
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

describe('buildFinancialsAnalysisPrompt — 출력 로케일', () => {
    /**
     * 이 축은 프롬프트 **본문**에 필드 언어 지시를 하드코딩하고 있었다.
     * 말미 리마인더는 필드 설명을 덮으려고 만든 것이라 과업 규칙으로 적힌
     * 지시까지 뒤집는다고 볼 수 없다 — 소스에서 갈라야 한다(리뷰 6라운드).
     */
    it('로케일을 생략하면 ko와 바이트가 같다', () => {
        expect(
            buildFinancialsAnalysisPrompt(
                'AAPL',
                empty,
                computeFinancialsScorecard(empty),
                []
            )
        ).toBe(
            buildFinancialsAnalysisPrompt(
                'AAPL',
                empty,
                computeFinancialsScorecard(empty),
                [],
                'ko'
            )
        );
    });

    it.each(['en', 'ja', 'zh'] as const)(
        '%s: 한국어로 쓰라는 지시가 본문에 남지 않는다',
        locale => {
            const prompt = buildFinancialsAnalysisPrompt(
                'AAPL',
                empty,
                computeFinancialsScorecard(empty),
                [],
                locale
            );
            expect(prompt).not.toContain('must be written in Korean');
            expect(prompt).not.toContain('in Korean (존댓말)');

            // 스키마 예시는 모델이 그대로 흉내 내는 자리라 지시문보다 힘이 셀
            // 수 있다 — `(한국어)` 표기가 남으면 리마인더가 무력해진다(리뷰 7라운드).
            expect(prompt).not.toContain('한국어');
        }
    );

    it('ko: 예전 지시문이 그대로다', () => {
        expect(
            buildFinancialsAnalysisPrompt(
                'AAPL',
                empty,
                computeFinancialsScorecard(empty),
                [],
                'ko'
            )
        ).toContain('Korean (존댓말)');
    });
});

describe('buildFinancialsAnalysisPrompt — currency and non-finite values', () => {
    const scorecard = computeFinancialsScorecard(empty);

    it('labels statement amounts with the row’s reporting currency', () => {
        const withCurrency = (
            reportedCurrency: string
        ): FinancialsSnapshot => ({
            ...empty,
            income: [{ ...incomeRow, reportedCurrency }],
        });
        expect(
            buildFinancialsAnalysisPrompt(
                'AAPL',
                withCurrency('USD'),
                scorecard,
                []
            )
        ).toContain('Revenue 383.3B USD');
        // An ADR files in its home currency: TSM's statements are TWD, not its USD listing.
        expect(
            buildFinancialsAnalysisPrompt(
                'TSM',
                withCurrency('TWD'),
                scorecard,
                []
            )
        ).toContain('Revenue 383.3B TWD');
    });

    it('leaves statement amounts unlabelled when the reporting currency is unknown', () => {
        const snapshot: FinancialsSnapshot = { ...empty, income: [incomeRow] };
        const p = buildFinancialsAnalysisPrompt(
            '005930.KS',
            snapshot,
            scorecard,
            []
        );
        expect(p).toContain('Revenue 383.3B,');
        expect(p).not.toMatch(/383\.3B (USD|KRW)/);
    });

    it('renders a non-finite margin as N/A instead of NaN%', () => {
        const snapshot: FinancialsSnapshot = {
            ...empty,
            income: [{ ...incomeRow, grossMargin: Number.NaN }],
        };
        const p = buildFinancialsAnalysisPrompt(
            'AAPL',
            snapshot,
            scorecard,
            []
        );
        expect(p).toContain('Gross Margin N/A');
        expect(p).not.toContain('NaN%');
    });

    it('renders a missing growth rate as N/A', () => {
        const snapshot: FinancialsSnapshot = {
            ...empty,
            financialGrowth: [{ ...growthRow, revenueGrowth: null }],
        };
        const p = buildFinancialsAnalysisPrompt(
            'AAPL',
            snapshot,
            scorecard,
            []
        );
        expect(p).toContain('Revenue Growth N/A');
    });
});
