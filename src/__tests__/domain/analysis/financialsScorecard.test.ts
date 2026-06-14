import { describe, expect, it } from 'vitest';

import { computeFinancialsScorecard } from '@/domain/analysis/financialsScorecard';
import type {
    BalanceSheetRow,
    CashFlowGrowthRow,
    CashFlowRow,
    FinancialGrowthRow,
    FinancialsSnapshot,
    IncomeGrowthRow,
    IncomeStatementRow,
} from '@/domain/types';

// ─── Row factories (only the fields the scorer reads are meaningful) ──────────

const income = (o: Partial<IncomeStatementRow> = {}): IncomeStatementRow => ({
    fiscalYear: '2024',
    period: 'FY',
    date: '2024-12-31',
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
    ...o,
});

const balance = (o: Partial<BalanceSheetRow> = {}): BalanceSheetRow => ({
    fiscalYear: '2024',
    period: 'FY',
    date: '2024-12-31',
    totalAssets: null,
    totalCurrentAssets: null,
    totalLiabilities: null,
    totalCurrentLiabilities: null,
    cashAndShortTermInvestments: null,
    totalDebt: null,
    netDebt: null,
    totalStockholdersEquity: null,
    currentRatio: null,
    ...o,
});

const cash = (o: Partial<CashFlowRow> = {}): CashFlowRow => ({
    fiscalYear: '2024',
    period: 'FY',
    date: '2024-12-31',
    operatingCashFlow: null,
    capitalExpenditure: null,
    freeCashFlow: null,
    dividendsPaid: null,
    fcfMargin: null,
    ...o,
});

const finGrowth = (
    o: Partial<FinancialGrowthRow> = {}
): FinancialGrowthRow => ({
    fiscalYear: '2024',
    period: 'FY',
    revenueGrowth: null,
    netIncomeGrowth: null,
    epsgrowth: null,
    freeCashFlowGrowth: null,
    operatingCashFlowGrowth: null,
    assetGrowth: null,
    debtGrowth: null,
    threeYRevenueGrowthPerShare: null,
    fiveYRevenueGrowthPerShare: null,
    tenYRevenueGrowthPerShare: null,
    ...o,
});

const empty = (): FinancialsSnapshot => ({
    income: [],
    balance: [],
    cashFlow: [],
    incomeGrowth: [] as IncomeGrowthRow[],
    financialGrowth: [],
    cashFlowGrowth: [] as CashFlowGrowthRow[],
});

// ─── Empty snapshot — deterministic worst case ───────────────────────────────

describe('computeFinancialsScorecard — empty snapshot', () => {
    const card = computeFinancialsScorecard(empty());

    it('every axis is score 0 / grade F', () => {
        for (const axis of [
            card.growth,
            card.quality,
            card.solvency,
            card.cash,
        ]) {
            expect(axis.score).toBe(0);
            expect(axis.grade).toBe('F');
            expect(axis.signals).toEqual([]);
        }
    });

    it('every axis still emits its metrics with null values', () => {
        expect(card.growth.metrics).toHaveLength(4);
        expect(card.quality.metrics).toHaveLength(3);
        expect(card.solvency.metrics).toHaveLength(3);
        expect(card.cash.metrics).toHaveLength(3);
        for (const axis of [
            card.growth,
            card.quality,
            card.solvency,
            card.cash,
        ]) {
            for (const m of axis.metrics) expect(m.value).toBeNull();
        }
    });

    it('composite is score 0 / grade F with a deterministic summary', () => {
        expect(card.composite.score).toBe(0);
        expect(card.composite.grade).toBe('F');
        expect(typeof card.composite.summaryKo).toBe('string');
        expect(card.composite.summaryKo.length).toBeGreaterThan(0);
    });
});

// ─── Strong company — A/B composite, net_cash signal ─────────────────────────

describe('computeFinancialsScorecard — strong company', () => {
    const strong = (): FinancialsSnapshot => ({
        income: [
            income({
                revenue: 1000,
                netIncome: 250,
                netMargin: 25,
                operatingMargin: 30,
            }),
            income({ netMargin: 22 }),
        ],
        balance: [
            balance({
                currentRatio: 2.5,
                totalLiabilities: 300,
                totalAssets: 1000,
                netDebt: -200,
            }),
        ],
        cashFlow: [
            cash({
                fcfMargin: 25,
                freeCashFlow: 240,
                operatingCashFlow: 300,
                capitalExpenditure: -50,
            }),
            cash({ freeCashFlow: 200 }),
        ],
        incomeGrowth: [],
        financialGrowth: [
            finGrowth({
                revenueGrowth: 0.25,
                netIncomeGrowth: 0.3,
                epsgrowth: 0.28,
                freeCashFlowGrowth: 0.22,
                debtGrowth: -0.05,
            }),
            finGrowth({ revenueGrowth: 0.15 }),
        ],
        cashFlowGrowth: [],
    });

    const card = computeFinancialsScorecard(strong());

    it('composite grade is A or B', () => {
        expect(['A', 'B']).toContain(card.composite.grade);
    });

    it('solvency carries a net_cash signal when netDebt < 0', () => {
        expect(card.solvency.signals.map(s => s.type)).toContain('net_cash');
    });

    it('quality carries earnings_quality_good (accruals >= 1)', () => {
        // OCF 300 / netIncome 250 = 1.2 >= 1
        expect(card.quality.signals.map(s => s.type)).toContain(
            'earnings_quality_good'
        );
    });

    it('growth has revenue_accel + operating_leverage signals', () => {
        const types = card.growth.signals.map(s => s.type);
        expect(types).toContain('revenue_accel'); // 0.25 > 0.15
        expect(types).toContain('operating_leverage'); // 0.3 > 0.25
    });

    it('cash carries fcf_solid', () => {
        expect(card.cash.signals.map(s => s.type)).toContain('fcf_solid');
    });
});

// ─── Partial data — only income populated ────────────────────────────────────

describe('computeFinancialsScorecard — only income', () => {
    const card = computeFinancialsScorecard({
        ...empty(),
        income: [income({ netMargin: 25, operatingMargin: 30 })],
    });

    it('quality > 0 while growth/solvency/cash stay 0', () => {
        expect(card.quality.score).toBeGreaterThan(0);
        expect(card.growth.score).toBe(0);
        expect(card.solvency.score).toBe(0);
        expect(card.cash.score).toBe(0);
    });
});

// ─── Growth band boundaries ──────────────────────────────────────────────────

describe('scoreGrowth — band boundaries + consistency', () => {
    const withRev = (g: number) =>
        computeFinancialsScorecard({
            ...empty(),
            financialGrowth: [finGrowth({ revenueGrowth: g })],
        }).growth.score;

    it('covers each growthBand tier', () => {
        // band: >=0.20→100, >=0.10→75, >=0.05→55, >=0→40, else 15
        // single metric present → avg = band; consistency: g>0 ⇒ 100, g<0 ⇒ 0
        expect(withRev(0.25)).toBe(Math.round(100 * 0.7 + 100 * 0.3)); // 100
        expect(withRev(0.15)).toBe(Math.round(75 * 0.7 + 100 * 0.3)); // 83
        expect(withRev(0.07)).toBe(Math.round(55 * 0.7 + 100 * 0.3)); // 69
        expect(withRev(0.0)).toBe(Math.round(40 * 0.7 + 0 * 0.3)); // 28 (0 is not >0 → consistency 0)
        expect(withRev(-0.1)).toBe(Math.round(15 * 0.7 + 0 * 0.3)); // 11
    });

    it('revenueGrowth == 0 → consistency 0 (not > 0)', () => {
        // band(0)=40, consistency: 0 is not >0 ⇒ 0
        expect(withRev(0)).toBe(Math.round(40 * 0.7 + 0 * 0.3));
    });

    it('growth_decline signal when revenueGrowth < 0', () => {
        const card = computeFinancialsScorecard({
            ...empty(),
            financialGrowth: [finGrowth({ revenueGrowth: -0.2 })],
        });
        expect(card.growth.signals.map(s => s.type)).toContain(
            'growth_decline'
        );
    });

    it('no accel/leverage signals when prior row or fields missing', () => {
        const card = computeFinancialsScorecard({
            ...empty(),
            financialGrowth: [finGrowth({ revenueGrowth: 0.1 })],
        });
        const types = card.growth.signals.map(s => s.type);
        expect(types).not.toContain('revenue_accel');
        expect(types).not.toContain('operating_leverage');
    });

    it('metrics scaled to percent (×100) and null when absent', () => {
        const card = computeFinancialsScorecard({
            ...empty(),
            financialGrowth: [
                finGrowth({ revenueGrowth: 0.2, netIncomeGrowth: null }),
            ],
        });
        const rev = card.growth.metrics.find(m => m.labelKo.includes('매출'));
        expect(rev?.value).toBeCloseTo(20);
        expect(rev?.unit).toBe('pct');
        const ni = card.growth.metrics.find(m => m.labelKo.includes('순이익'));
        expect(ni?.value).toBeNull();
    });
});

// ─── Quality: margin bands, trend, accruals ──────────────────────────────────

describe('scoreQuality — margin bands / trend / accruals', () => {
    it('covers each marginBand tier', () => {
        const score = (m: number) =>
            computeFinancialsScorecard({
                ...empty(),
                income: [income({ netMargin: m, operatingMargin: m })],
            }).quality.score;
        // No prev (no trend), no accruals → clamp(base)
        expect(score(25)).toBe(100); // >=20
        expect(score(15)).toBe(75); // >=12
        expect(score(8)).toBe(55); // >=6
        expect(score(2)).toBe(40); // >=0
        expect(score(-5)).toBe(15); // <0
    });

    it('margin trend up adds +15 and emits margin_expansion', () => {
        const card = computeFinancialsScorecard({
            ...empty(),
            income: [
                income({ netMargin: 15, operatingMargin: 15 }),
                income({ netMargin: 10 }),
            ],
        });
        // base 75, +15 trend = 90
        expect(card.quality.score).toBe(90);
        expect(card.quality.signals.map(s => s.type)).toContain(
            'margin_expansion'
        );
    });

    it('margin trend down subtracts 15 and emits margin_contraction', () => {
        const card = computeFinancialsScorecard({
            ...empty(),
            income: [
                income({ netMargin: 15, operatingMargin: 15 }),
                income({ netMargin: 20 }),
            ],
        });
        expect(card.quality.score).toBe(60); // 75 - 15
        expect(card.quality.signals.map(s => s.type)).toContain(
            'margin_contraction'
        );
    });

    it('accruals >= 1 adds +20 and emits earnings_quality_good', () => {
        const card = computeFinancialsScorecard({
            ...empty(),
            income: [
                income({ netMargin: 8, operatingMargin: 8, netIncome: 100 }),
            ],
            cashFlow: [cash({ operatingCashFlow: 120 })], // 1.2
        });
        // base 55 + accruals 20 = 75
        expect(card.quality.score).toBe(75);
        expect(card.quality.signals.map(s => s.type)).toContain(
            'earnings_quality_good'
        );
        const acc = card.quality.metrics.find(m => m.unit === 'ratio');
        expect(acc?.value).toBeCloseTo(1.2);
    });

    it('accruals < 0.8 subtracts 20 and emits accrual_warning', () => {
        const card = computeFinancialsScorecard({
            ...empty(),
            income: [
                income({ netMargin: 8, operatingMargin: 8, netIncome: 100 }),
            ],
            cashFlow: [cash({ operatingCashFlow: 70 })], // 0.7
        });
        expect(card.quality.score).toBe(35); // 55 - 20
        expect(card.quality.signals.map(s => s.type)).toContain(
            'accrual_warning'
        );
    });

    it('0.8 <= accruals < 1 has no accrual delta and no signal', () => {
        const card = computeFinancialsScorecard({
            ...empty(),
            income: [
                income({ netMargin: 8, operatingMargin: 8, netIncome: 100 }),
            ],
            cashFlow: [cash({ operatingCashFlow: 90 })], // 0.9
        });
        expect(card.quality.score).toBe(55); // unchanged
        const types = card.quality.signals.map(s => s.type);
        expect(types).not.toContain('earnings_quality_good');
        expect(types).not.toContain('accrual_warning');
    });

    it('accruals null when netIncome is 0 (denominator 0)', () => {
        const card = computeFinancialsScorecard({
            ...empty(),
            income: [
                income({ netMargin: 8, operatingMargin: 8, netIncome: 0 }),
            ],
            cashFlow: [cash({ operatingCashFlow: 90 })],
        });
        const acc = card.quality.metrics.find(m => m.unit === 'ratio');
        expect(acc?.value).toBeNull();
        expect(card.quality.score).toBe(55); // no accrual delta
    });
});

// ─── Solvency: currentRatio / debtRatio bands, net cash, debt rising ─────────

describe('scoreSolvency — bands / net cash / debt rising', () => {
    const crScore = (cr: number) =>
        computeFinancialsScorecard({
            ...empty(),
            balance: [balance({ currentRatio: cr })],
        }).solvency.score;

    it('covers each currentRatioBand tier (debtRatio absent)', () => {
        // only currentRatio present → avg = currentRatioBand
        expect(crScore(2)).toBe(100); // >=2
        expect(crScore(1.6)).toBe(80); // >=1.5
        expect(crScore(1.2)).toBe(55); // >=1
        expect(crScore(0.9)).toBe(35); // >=0.8
        expect(crScore(0.5)).toBe(15); // else
    });

    it('covers each debtRatioBand tier (currentRatio absent)', () => {
        const drScore = (liab: number) =>
            computeFinancialsScorecard({
                ...empty(),
                balance: [
                    balance({ totalLiabilities: liab, totalAssets: 100 }),
                ],
            }).solvency.score;
        expect(drScore(40)).toBe(100); // 0.4 <=0.4
        expect(drScore(55)).toBe(75); // 0.55 <=0.55
        expect(drScore(70)).toBe(50); // 0.70 <=0.7
        expect(drScore(85)).toBe(30); // 0.85 <=0.85
        expect(drScore(95)).toBe(15); // else
    });

    it('debtRatio null when totalAssets is 0', () => {
        const card = computeFinancialsScorecard({
            ...empty(),
            balance: [
                balance({
                    currentRatio: 2,
                    totalLiabilities: 50,
                    totalAssets: 0,
                }),
            ],
        });
        // debtRatioBand null → avg = currentRatioBand only = 100
        expect(card.solvency.score).toBe(100);
        const dr = card.solvency.metrics.find(m =>
            m.labelKo.includes('부채비율')
        );
        expect(dr?.value).toBeNull();
    });

    it('net cash bonus +15 and net_cash signal when netDebt < 0', () => {
        const card = computeFinancialsScorecard({
            ...empty(),
            balance: [balance({ currentRatio: 1.2, netDebt: -10 })],
        });
        // base 55 + 15 = 70
        expect(card.solvency.score).toBe(70);
        expect(card.solvency.signals.map(s => s.type)).toContain('net_cash');
    });

    it('debt rising penalty -10 and debt_rising signal when debtGrowth > 0.10', () => {
        const card = computeFinancialsScorecard({
            ...empty(),
            balance: [balance({ currentRatio: 1.2 })],
            financialGrowth: [finGrowth({ debtGrowth: 0.2 })],
        });
        // base 55 - 10 = 45
        expect(card.solvency.score).toBe(45);
        expect(card.solvency.signals.map(s => s.type)).toContain('debt_rising');
    });

    it('no debt_rising when debtGrowth <= 0.10', () => {
        const card = computeFinancialsScorecard({
            ...empty(),
            balance: [balance({ currentRatio: 1.2 })],
            financialGrowth: [finGrowth({ debtGrowth: 0.05 })],
        });
        expect(card.solvency.signals.map(s => s.type)).not.toContain(
            'debt_rising'
        );
        expect(card.solvency.score).toBe(55);
    });

    it('netDebt metric carries usd unit', () => {
        const card = computeFinancialsScorecard({
            ...empty(),
            balance: [balance({ currentRatio: 1.2, netDebt: 500 })],
        });
        const nd = card.solvency.metrics.find(m => m.unit === 'usd');
        expect(nd?.value).toBe(500);
    });
});

// ─── Cash: fcfMargin / conversion bands, positiveRatio, capex, fcf signals ───

describe('scoreCash — bands / positiveRatio / capex / fcf signals', () => {
    it('covers each fcfMarginBand tier (only fcfMargin present, no non-null fcf rows)', () => {
        const score = (m: number) =>
            computeFinancialsScorecard({
                ...empty(),
                cashFlow: [cash({ fcfMargin: m })],
            }).cash.score;
        // freeCashFlow null on the only row → no non-null fcf rows → positiveRatio
        // metric is null (excluded), conversion null → base = fcfMarginBand alone.
        expect(score(25)).toBe(100); // >=20
        expect(score(15)).toBe(75); // >=10
        expect(score(8)).toBe(55); // >=5
        expect(score(2)).toBe(40); // >=0
        expect(score(-5)).toBe(15); // <0
    });

    it('positiveRatio is a real 0 when an fcf row exists but is not positive', () => {
        // freeCashFlow 0 (non-null, not >0) → fcfRows.length 1 → positiveRatio 0 counts
        const card = computeFinancialsScorecard({
            ...empty(),
            cashFlow: [cash({ fcfMargin: 25, freeCashFlow: 0 })],
        });
        // conversion null (ocf null). base = avg([100, 0]) = 50
        expect(card.cash.score).toBe(50);
    });

    it('covers each conversionBand tier', () => {
        // fcfMargin null, fcf>0 (positiveRatio 100), conversion = fcf/ocf
        const score = (fcf: number, ocf: number) =>
            computeFinancialsScorecard({
                ...empty(),
                cashFlow: [cash({ freeCashFlow: fcf, operatingCashFlow: ocf })],
            }).cash.score;
        // base = avg([positiveRatio(100), convBand]) since fcfMargin null
        expect(score(80, 100)).toBe(Math.round((100 + 100) / 2)); // 0.8 →100
        expect(score(60, 100)).toBe(Math.round((100 + 75) / 2)); // 0.6 →75
        expect(score(40, 100)).toBe(Math.round((100 + 50) / 2)); // 0.4 →50
        expect(score(10, 100)).toBe(Math.round((100 + 30) / 2)); // >=0 →30
    });

    it('conversion < 0 band (negative fcf)', () => {
        // fcf < 0 → positiveRatio 0, conversion negative → band 10
        const card = computeFinancialsScorecard({
            ...empty(),
            cashFlow: [cash({ freeCashFlow: -10, operatingCashFlow: 100 })],
        });
        // base = avg([positiveRatio(0), 10]) = 5
        expect(card.cash.score).toBe(5);
        expect(card.cash.signals.map(s => s.type)).toContain('fcf_negative');
    });

    it('conversion null when operatingCashFlow is 0', () => {
        const card = computeFinancialsScorecard({
            ...empty(),
            cashFlow: [
                cash({ fcfMargin: 20, freeCashFlow: 5, operatingCashFlow: 0 }),
            ],
        });
        const conv = card.cash.metrics.find(m => m.labelKo.includes('전환'));
        expect(conv?.value).toBeNull();
    });

    it('positiveRatio across multiple rows', () => {
        const card = computeFinancialsScorecard({
            ...empty(),
            cashFlow: [
                cash({ freeCashFlow: 10 }),
                cash({ freeCashFlow: -5 }),
                cash({ freeCashFlow: 20 }),
                cash({ freeCashFlow: null }),
            ],
        });
        // 2 of 3 non-null positive → positiveRatio ≈ 66.67; latest fcf 10 > 0 → fcf_solid
        expect(card.cash.signals.map(s => s.type)).toContain('fcf_solid');
        expect(card.cash.score).toBeGreaterThan(0);
    });

    it('capex heavy penalty -10 and capex_heavy signal when intensity > 0.15', () => {
        const card = computeFinancialsScorecard({
            ...empty(),
            income: [income({ revenue: 1000 })],
            cashFlow: [
                cash({
                    fcfMargin: 25,
                    freeCashFlow: 200,
                    operatingCashFlow: 400,
                    capitalExpenditure: -200,
                }),
            ],
        });
        // capex intensity = 200/1000 = 0.2 > 0.15
        expect(card.cash.signals.map(s => s.type)).toContain('capex_heavy');
        const ci = card.cash.metrics.find(m => m.labelKo.includes('설비'));
        expect(ci?.value).toBeCloseTo(0.2);
    });

    it('no capex_heavy when intensity <= 0.15', () => {
        const card = computeFinancialsScorecard({
            ...empty(),
            income: [income({ revenue: 1000 })],
            cashFlow: [
                cash({
                    fcfMargin: 25,
                    freeCashFlow: 200,
                    operatingCashFlow: 400,
                    capitalExpenditure: -50,
                }),
            ],
        });
        expect(card.cash.signals.map(s => s.type)).not.toContain('capex_heavy');
    });

    it('capex intensity null when revenue absent', () => {
        const card = computeFinancialsScorecard({
            ...empty(),
            cashFlow: [
                cash({
                    fcfMargin: 25,
                    freeCashFlow: 200,
                    operatingCashFlow: 400,
                    capitalExpenditure: -200,
                }),
            ],
        });
        const ci = card.cash.metrics.find(m => m.labelKo.includes('설비'));
        expect(ci?.value).toBeNull();
        expect(card.cash.signals.map(s => s.type)).not.toContain('capex_heavy');
    });
});

// ─── Composite summary determinism ───────────────────────────────────────────

describe('composite summaryKo', () => {
    it('mentions top axis (우수) and bottom axis (주의) in Korean', () => {
        const card = computeFinancialsScorecard({
            income: [
                income({
                    revenue: 1000,
                    netIncome: 250,
                    netMargin: 25,
                    operatingMargin: 30,
                }),
            ],
            balance: [
                balance({
                    currentRatio: 0.5,
                    totalLiabilities: 95,
                    totalAssets: 100,
                }),
            ],
            cashFlow: [
                cash({
                    fcfMargin: 25,
                    freeCashFlow: 240,
                    operatingCashFlow: 300,
                }),
            ],
            incomeGrowth: [],
            financialGrowth: [],
            cashFlowGrowth: [],
        });
        expect(card.composite.summaryKo).toContain('우수');
        expect(card.composite.summaryKo).toContain('주의');
    });

    it('is deterministic for identical input', () => {
        const snap = empty();
        expect(computeFinancialsScorecard(snap).composite.summaryKo).toBe(
            computeFinancialsScorecard(snap).composite.summaryKo
        );
    });
});
