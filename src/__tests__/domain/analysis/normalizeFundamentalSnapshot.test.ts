import { describe, it, expect } from 'vitest';
import { normalizeFundamentalSnapshot } from '@/domain/analysis/normalizeFundamentalSnapshot';
import type {
    FundamentalProfileInput,
    FundamentalValuationMetrics,
    FundamentalRatiosInput,
    FundamentalCashFlowInput,
    FundamentalGrowthInput,
    FundamentalFinancialScoresInput,
    FundamentalPeerInput,
    FundamentalAnalystEstimateInput,
    FundamentalGradesConsensusInput,
    FundamentalPriceTargetConsensusInput,
    FundamentalPriceTargetSummaryInput,
} from '@/domain/types';

// ─────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────

const baseProfile: FundamentalProfileInput = {
    symbol: 'AAPL',
    companyName: 'Apple Inc.',
    sector: 'Technology',
    industry: 'Consumer Electronics',
    marketCap: 3_000_000_000_000,
    ceo: 'Tim Cook',
    website: 'https://apple.com',
    description: 'A tech company.',
};

const keyMetricsTtm: FundamentalValuationMetrics = {
    peRatioTTM: 28.5,
    priceToSalesRatioTTM: 7.2,
    pbRatioTTM: 45.1,
    pegRatioTTM: 1.8,
    enterpriseValueOverEBITDATTM: 22.4,
    epsTTM: 6.43,
};

const ratiosTtm: FundamentalRatiosInput = {
    returnOnEquityTTM: 1.45,
    returnOnAssetsTTM: 0.28,
    operatingProfitMarginTTM: 0.31,
    netProfitMarginTTM: 0.25,
    debtRatioTTM: 0.32,
    currentRatioTTM: 0.94,
};

const cashFlow: FundamentalCashFlowInput = {
    operatingCashFlow: 110_543_000_000,
};

const incomeGrowth: FundamentalGrowthInput = {
    growthRevenue: 0.08,
    growthEPS: 0.12,
};

const financialScores: FundamentalFinancialScoresInput = {
    altmanZScore: 4.5,
    piotroskiScore: 7,
};

const peers: FundamentalPeerInput[] = [
    { symbol: 'MSFT', companyName: 'Microsoft', marketCap: 2_800_000_000_000 },
    { symbol: 'GOOGL', companyName: 'Alphabet', marketCap: 1_900_000_000_000 },
];

const analystEstimate: FundamentalAnalystEstimateInput = {
    estimatedEpsAvg: 1.62,
    estimatedRevenueAvg: 94_000_000_000,
};

const gradesConsensus: FundamentalGradesConsensusInput = {
    strongBuy: 12,
    buy: 8,
    hold: 5,
    sell: 1,
    strongSell: 0,
};

const priceTargetConsensus: FundamentalPriceTargetConsensusInput = {
    targetHigh: 230.0,
    targetLow: 150.0,
    targetMedian: 200.0,
    targetConsensus: 198.5,
};

const priceTargetSummary: FundamentalPriceTargetSummaryInput = {
    lastMonth: { avgPriceTarget: 195.0 },
    lastQuarter: { avgPriceTarget: 190.0 },
    lastYear: { avgPriceTarget: 180.0 },
};

const sectorHistorical = [
    { date: '2024-01-02', changePct: 0.5 },
    { date: '2024-01-03', changePct: -0.3 },
];

// ─────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────

describe('normalizeFundamentalSnapshot — happy path (all fields populated)', () => {
    const result = normalizeFundamentalSnapshot({
        profile: baseProfile,
        keyMetricsTtm,
        ratiosTtm,
        cashFlow,
        incomeGrowth,
        financialScores,
        peers,
        analystEstimate,
        gradesConsensus,
        priceTargetConsensus,
        priceTargetSummary,
        nextEarningsAt: '2024-07-25',
        sectorTodayChangePct: 0.72,
        sectorHistorical,
    });

    it('profile 필드가 올바르게 매핑된다', () => {
        expect(result.profile.symbol).toBe('AAPL');
        expect(result.profile.companyName).toBe('Apple Inc.');
        expect(result.profile.sector).toBe('Technology');
        expect(result.profile.industry).toBe('Consumer Electronics');
        expect(result.profile.marketCap).toBe(3_000_000_000_000);
        expect(result.profile.ceo).toBe('Tim Cook');
        expect(result.profile.website).toBe('https://apple.com');
        expect(result.profile.description).toBe('A tech company.');
    });

    it('profile.marketCap 매핑이 정확하다', () => {
        expect(result.profile.marketCap).toBe(baseProfile.marketCap);
    });

    it('valuation 필드가 올바르게 매핑된다', () => {
        expect(result.valuation.per).toBe(28.5);
        expect(result.valuation.psr).toBe(7.2);
        expect(result.valuation.pbr).toBe(45.1);
        expect(result.valuation.peg).toBe(1.8);
        expect(result.valuation.evToEbitda).toBe(22.4);
        expect(result.valuation.eps).toBe(6.43);
    });

    it('profitability 필드가 decimal → percent 로 변환된다', () => {
        expect(result.profitability.roe).toBeCloseTo(145);
        expect(result.profitability.roa).toBeCloseTo(28);
        expect(result.profitability.operatingMargin).toBeCloseTo(31);
        expect(result.profitability.netMargin).toBeCloseTo(25);
    });

    it('growth 필드가 decimal → percent 로 변환된다', () => {
        expect(result.growth.revenueYoy).toBeCloseTo(8);
        expect(result.growth.epsYoy).toBeCloseTo(12);
    });

    it('health 필드가 올바르게 매핑된다', () => {
        expect(result.health.debtRatio).toBeCloseTo(32); // 0.32 → 32%
        expect(result.health.currentRatio).toBe(0.94); // currentRatio is absolute, no conversion
        expect(result.health.operatingCashFlow).toBe(110_543_000_000);
        expect(result.health.altmanZScore).toBe(4.5);
        expect(result.health.piotroskiScore).toBe(7);
    });

    it('peers 배열이 올바르게 매핑된다', () => {
        expect(result.peers).toHaveLength(2);
        expect(result.peers[0].symbol).toBe('MSFT');
        expect(result.peers[0].companyName).toBe('Microsoft');
        expect(result.peers[0].marketCap).toBe(2_800_000_000_000);
    });

    it('futureDirection.analystEstimate가 올바르게 매핑된다', () => {
        expect(result.futureDirection.analystEstimateEps).toBe(1.62);
        expect(result.futureDirection.analystEstimateRevenue).toBe(
            94_000_000_000
        );
    });

    it('futureDirection.gradesConsensus가 그대로 전달된다', () => {
        expect(result.futureDirection.gradesConsensus).toEqual(gradesConsensus);
    });

    it('priceTargetConsensus: targetHigh→high, targetLow→low, targetMedian→median, targetConsensus→consensus', () => {
        expect(result.futureDirection.priceTargetConsensus).not.toBeNull();
        expect(result.futureDirection.priceTargetConsensus!.high).toBe(230.0);
        expect(result.futureDirection.priceTargetConsensus!.low).toBe(150.0);
        expect(result.futureDirection.priceTargetConsensus!.median).toBe(200.0);
        expect(result.futureDirection.priceTargetConsensus!.consensus).toBe(
            198.5
        );
    });

    it('priceTargetSummary: lastMonth→month1Avg, lastQuarter→month3Avg, lastYear→year1Avg', () => {
        expect(result.futureDirection.priceTargetSummary).not.toBeNull();
        expect(result.futureDirection.priceTargetSummary!.month1Avg).toBe(
            195.0
        );
        expect(result.futureDirection.priceTargetSummary!.month3Avg).toBe(
            190.0
        );
        expect(result.futureDirection.priceTargetSummary!.year1Avg).toBe(180.0);
    });

    it('futureDirection.nextEarningsAt이 올바르게 전달된다', () => {
        expect(result.futureDirection.nextEarningsAt).toBe('2024-07-25');
    });

    it('sectorDirection이 올바르게 매핑된다', () => {
        expect(result.sectorDirection.todayChangePct).toBe(0.72);
        expect(result.sectorDirection.historical).toHaveLength(2);
    });

    it('sectorHistorical[i].changePct가 올바르게 전달된다', () => {
        expect(result.sectorDirection.historical[0].changePct).toBe(0.5);
        expect(result.sectorDirection.historical[1].changePct).toBe(-0.3);
    });
});

// ─────────────────────────────────────────
// All optional fields null
// ─────────────────────────────────────────

describe('normalizeFundamentalSnapshot — 모든 optional 필드가 null', () => {
    const result = normalizeFundamentalSnapshot({
        profile: baseProfile,
        keyMetricsTtm: null,
        ratiosTtm: null,
        cashFlow: null,
        incomeGrowth: null,
        financialScores: null,
        peers: [],
        analystEstimate: null,
        gradesConsensus: null,
        priceTargetConsensus: null,
        priceTargetSummary: null,
        nextEarningsAt: null,
        sectorTodayChangePct: null,
        sectorHistorical: [],
    });

    it('크래시 없이 실행된다', () => {
        expect(result).toBeDefined();
    });

    it('valuation 필드는 모두 null이다', () => {
        expect(result.valuation.per).toBeNull();
        expect(result.valuation.psr).toBeNull();
        expect(result.valuation.pbr).toBeNull();
        expect(result.valuation.peg).toBeNull();
        expect(result.valuation.evToEbitda).toBeNull();
        expect(result.valuation.eps).toBeNull();
    });

    it('profitability 필드는 모두 null이다', () => {
        expect(result.profitability.roe).toBeNull();
        expect(result.profitability.roa).toBeNull();
        expect(result.profitability.operatingMargin).toBeNull();
        expect(result.profitability.netMargin).toBeNull();
    });

    it('growth 필드는 모두 null이다', () => {
        expect(result.growth.revenueYoy).toBeNull();
        expect(result.growth.epsYoy).toBeNull();
    });

    it('health 필드는 모두 null이다', () => {
        expect(result.health.debtRatio).toBeNull();
        expect(result.health.currentRatio).toBeNull();
        expect(result.health.operatingCashFlow).toBeNull();
        expect(result.health.altmanZScore).toBeNull();
        expect(result.health.piotroskiScore).toBeNull();
    });

    it('futureDirection 필드는 모두 null이다', () => {
        expect(result.futureDirection.nextEarningsAt).toBeNull();
        expect(result.futureDirection.analystEstimateEps).toBeNull();
        expect(result.futureDirection.analystEstimateRevenue).toBeNull();
        expect(result.futureDirection.gradesConsensus).toBeNull();
        expect(result.futureDirection.priceTargetConsensus).toBeNull();
        expect(result.futureDirection.priceTargetSummary).toBeNull();
    });

    it('sectorDirection은 null과 빈 배열이다', () => {
        expect(result.sectorDirection.todayChangePct).toBeNull();
        expect(result.sectorDirection.historical).toEqual([]);
    });
});

// ─────────────────────────────────────────
// Empty peers array
// ─────────────────────────────────────────

describe('normalizeFundamentalSnapshot — peers 빈 배열', () => {
    it('peers가 빈 배열이면 결과도 빈 배열이다 (undefined 아님)', () => {
        const result = normalizeFundamentalSnapshot({
            profile: baseProfile,
            keyMetricsTtm: null,
            ratiosTtm: null,
            cashFlow: null,
            incomeGrowth: null,
            financialScores: null,
            peers: [],
            analystEstimate: null,
            gradesConsensus: null,
            priceTargetConsensus: null,
            priceTargetSummary: null,
            nextEarningsAt: null,
            sectorTodayChangePct: null,
            sectorHistorical: [],
        });

        expect(result.peers).toBeDefined();
        expect(Array.isArray(result.peers)).toBe(true);
        expect(result.peers).toHaveLength(0);
    });
});

// ─────────────────────────────────────────
// Empty sectorHistorical
// ─────────────────────────────────────────

describe('normalizeFundamentalSnapshot — sectorHistorical 빈 배열', () => {
    it('sectorHistorical이 빈 배열이면 historical도 빈 배열이다', () => {
        const result = normalizeFundamentalSnapshot({
            profile: baseProfile,
            keyMetricsTtm: null,
            ratiosTtm: null,
            cashFlow: null,
            incomeGrowth: null,
            financialScores: null,
            peers: [],
            analystEstimate: null,
            gradesConsensus: null,
            priceTargetConsensus: null,
            priceTargetSummary: null,
            nextEarningsAt: null,
            sectorTodayChangePct: null,
            sectorHistorical: [],
        });

        expect(result.sectorDirection.historical).toEqual([]);
    });
});

// ─────────────────────────────────────────
// Mixed nullability
// ─────────────────────────────────────────

describe('normalizeFundamentalSnapshot — 혼합 nullability (keyMetricsTtm 있음, ratiosTtm null)', () => {
    const result = normalizeFundamentalSnapshot({
        profile: baseProfile,
        keyMetricsTtm,
        ratiosTtm: null,
        cashFlow: null,
        incomeGrowth: null,
        financialScores: null,
        peers: [],
        analystEstimate: null,
        gradesConsensus: null,
        priceTargetConsensus: null,
        priceTargetSummary: null,
        nextEarningsAt: null,
        sectorTodayChangePct: null,
        sectorHistorical: [],
    });

    it('valuation은 keyMetricsTtm 값으로 채워진다', () => {
        expect(result.valuation.per).toBe(28.5);
        expect(result.valuation.eps).toBe(6.43);
    });

    it('profitability는 ratiosTtm이 null이므로 모두 null이다', () => {
        expect(result.profitability.roe).toBeNull();
        expect(result.profitability.roa).toBeNull();
        expect(result.profitability.operatingMargin).toBeNull();
        expect(result.profitability.netMargin).toBeNull();
    });

    it('health의 ratiosTtm 의존 필드는 null이다', () => {
        expect(result.health.debtRatio).toBeNull();
        expect(result.health.currentRatio).toBeNull();
    });

    it('health의 cashFlow 의존 필드는 null이다', () => {
        expect(result.health.operatingCashFlow).toBeNull();
    });
});

// ─────────────────────────────────────────
// Field-level mapping assertions
// ─────────────────────────────────────────

describe('normalizeFundamentalSnapshot — 필드 매핑 검증', () => {
    it('growthRevenue → growth.revenueYoy, growthEPS → growth.epsYoy (decimal → percent)', () => {
        const result = normalizeFundamentalSnapshot({
            profile: baseProfile,
            keyMetricsTtm: null,
            ratiosTtm: null,
            cashFlow: null,
            incomeGrowth: { growthRevenue: 0.15, growthEPS: 0.2 },
            financialScores: null,
            peers: [],
            analystEstimate: null,
            gradesConsensus: null,
            priceTargetConsensus: null,
            priceTargetSummary: null,
            nextEarningsAt: null,
            sectorTodayChangePct: null,
            sectorHistorical: [],
        });

        expect(result.growth.revenueYoy).toBeCloseTo(15); // 0.15 × 100
        expect(result.growth.epsYoy).toBeCloseTo(20); // 0.20 × 100
    });

    it('debtRatioTTM → health.debtRatio (decimal → percent), currentRatioTTM → health.currentRatio (absolute)', () => {
        const result = normalizeFundamentalSnapshot({
            profile: baseProfile,
            keyMetricsTtm: null,
            ratiosTtm: {
                returnOnEquityTTM: null,
                returnOnAssetsTTM: null,
                operatingProfitMarginTTM: null,
                netProfitMarginTTM: null,
                debtRatioTTM: 0.45,
                currentRatioTTM: 1.2,
            },
            cashFlow: null,
            incomeGrowth: null,
            financialScores: null,
            peers: [],
            analystEstimate: null,
            gradesConsensus: null,
            priceTargetConsensus: null,
            priceTargetSummary: null,
            nextEarningsAt: null,
            sectorTodayChangePct: null,
            sectorHistorical: [],
        });

        expect(result.health.debtRatio).toBeCloseTo(45); // 0.45 × 100
        expect(result.health.currentRatio).toBe(1.2); // already absolute
    });

    it('operatingCashFlow → health.operatingCashFlow', () => {
        const result = normalizeFundamentalSnapshot({
            profile: baseProfile,
            keyMetricsTtm: null,
            ratiosTtm: null,
            cashFlow: { operatingCashFlow: 500_000_000 },
            incomeGrowth: null,
            financialScores: null,
            peers: [],
            analystEstimate: null,
            gradesConsensus: null,
            priceTargetConsensus: null,
            priceTargetSummary: null,
            nextEarningsAt: null,
            sectorTodayChangePct: null,
            sectorHistorical: [],
        });

        expect(result.health.operatingCashFlow).toBe(500_000_000);
    });

    it('altmanZScore → health.altmanZScore, piotroskiScore → health.piotroskiScore', () => {
        const result = normalizeFundamentalSnapshot({
            profile: baseProfile,
            keyMetricsTtm: null,
            ratiosTtm: null,
            cashFlow: null,
            incomeGrowth: null,
            financialScores: { altmanZScore: 3.2, piotroskiScore: 6 },
            peers: [],
            analystEstimate: null,
            gradesConsensus: null,
            priceTargetConsensus: null,
            priceTargetSummary: null,
            nextEarningsAt: null,
            sectorTodayChangePct: null,
            sectorHistorical: [],
        });

        expect(result.health.altmanZScore).toBe(3.2);
        expect(result.health.piotroskiScore).toBe(6);
    });

    it('estimatedEpsAvg → futureDirection.analystEstimateEps, estimatedRevenueAvg → futureDirection.analystEstimateRevenue', () => {
        const result = normalizeFundamentalSnapshot({
            profile: baseProfile,
            keyMetricsTtm: null,
            ratiosTtm: null,
            cashFlow: null,
            incomeGrowth: null,
            financialScores: null,
            peers: [],
            analystEstimate: {
                estimatedEpsAvg: 2.05,
                estimatedRevenueAvg: 120_000_000_000,
            },
            gradesConsensus: null,
            priceTargetConsensus: null,
            priceTargetSummary: null,
            nextEarningsAt: null,
            sectorTodayChangePct: null,
            sectorHistorical: [],
        });

        expect(result.futureDirection.analystEstimateEps).toBe(2.05);
        expect(result.futureDirection.analystEstimateRevenue).toBe(
            120_000_000_000
        );
    });

    it('sectorHistorical[i].changesPercentage → historical[i].changePct', () => {
        const result = normalizeFundamentalSnapshot({
            profile: baseProfile,
            keyMetricsTtm: null,
            ratiosTtm: null,
            cashFlow: null,
            incomeGrowth: null,
            financialScores: null,
            peers: [],
            analystEstimate: null,
            gradesConsensus: null,
            priceTargetConsensus: null,
            priceTargetSummary: null,
            nextEarningsAt: null,
            sectorTodayChangePct: null,
            sectorHistorical: [
                { date: '2024-03-01', changePct: 1.23 },
                { date: '2024-03-04', changePct: -0.45 },
            ],
        });

        expect(result.sectorDirection.historical[0].changePct).toBe(1.23);
        expect(result.sectorDirection.historical[1].changePct).toBe(-0.45);
        expect(result.sectorDirection.historical[0].date).toBe('2024-03-01');
    });
});

// ─────────────────────────────────────────
// IC-3: Decimal → Percent unit conversion
// ─────────────────────────────────────────

describe('normalizeFundamentalSnapshot — IC-3 decimal → percent 단위 변환', () => {
    const makeInput = (partial: {
        ratiosTtm?: typeof ratiosTtm | null;
        incomeGrowth?: typeof incomeGrowth | null;
    }) =>
        normalizeFundamentalSnapshot({
            profile: baseProfile,
            keyMetricsTtm: null,
            ratiosTtm: partial.ratiosTtm ?? null,
            cashFlow: null,
            incomeGrowth: partial.incomeGrowth ?? null,
            financialScores: null,
            peers: [],
            analystEstimate: null,
            gradesConsensus: null,
            priceTargetConsensus: null,
            priceTargetSummary: null,
            nextEarningsAt: null,
            sectorTodayChangePct: null,
            sectorHistorical: [],
        });

    it('returnOnEquityTTM 0.15 → roe 15', () => {
        const result = makeInput({
            ratiosTtm: {
                returnOnEquityTTM: 0.15,
                returnOnAssetsTTM: null,
                operatingProfitMarginTTM: null,
                netProfitMarginTTM: null,
                debtRatioTTM: null,
                currentRatioTTM: null,
            },
        });
        expect(result.profitability.roe).toBeCloseTo(15);
    });

    it('returnOnAssetsTTM 0.08 → roa 8', () => {
        const result = makeInput({
            ratiosTtm: {
                returnOnEquityTTM: null,
                returnOnAssetsTTM: 0.08,
                operatingProfitMarginTTM: null,
                netProfitMarginTTM: null,
                debtRatioTTM: null,
                currentRatioTTM: null,
            },
        });
        expect(result.profitability.roa).toBeCloseTo(8);
    });

    it('operatingProfitMarginTTM 0.30 → operatingMargin 30', () => {
        const result = makeInput({
            ratiosTtm: {
                returnOnEquityTTM: null,
                returnOnAssetsTTM: null,
                operatingProfitMarginTTM: 0.3,
                netProfitMarginTTM: null,
                debtRatioTTM: null,
                currentRatioTTM: null,
            },
        });
        expect(result.profitability.operatingMargin).toBeCloseTo(30);
    });

    it('netProfitMarginTTM 0.25 → netMargin 25', () => {
        const result = makeInput({
            ratiosTtm: {
                returnOnEquityTTM: null,
                returnOnAssetsTTM: null,
                operatingProfitMarginTTM: null,
                netProfitMarginTTM: 0.25,
                debtRatioTTM: null,
                currentRatioTTM: null,
            },
        });
        expect(result.profitability.netMargin).toBeCloseTo(25);
    });

    it('growthRevenue 0.10 → revenueYoy 10', () => {
        const result = makeInput({
            incomeGrowth: { growthRevenue: 0.1, growthEPS: null },
        });
        expect(result.growth.revenueYoy).toBeCloseTo(10);
    });

    it('growthEPS 0.05 → epsYoy 5', () => {
        const result = makeInput({
            incomeGrowth: { growthRevenue: null, growthEPS: 0.05 },
        });
        expect(result.growth.epsYoy).toBeCloseTo(5);
    });

    it('debtRatioTTM 0.40 → debtRatio 40', () => {
        const result = makeInput({
            ratiosTtm: {
                returnOnEquityTTM: null,
                returnOnAssetsTTM: null,
                operatingProfitMarginTTM: null,
                netProfitMarginTTM: null,
                debtRatioTTM: 0.4,
                currentRatioTTM: null,
            },
        });
        expect(result.health.debtRatio).toBeCloseTo(40);
    });

    it('currentRatioTTM 1.5 는 변환 없이 그대로 1.5 이다', () => {
        const result = makeInput({
            ratiosTtm: {
                returnOnEquityTTM: null,
                returnOnAssetsTTM: null,
                operatingProfitMarginTTM: null,
                netProfitMarginTTM: null,
                debtRatioTTM: null,
                currentRatioTTM: 1.5,
            },
        });
        expect(result.health.currentRatio).toBe(1.5);
    });

    it('null 입력은 null 을 반환한다', () => {
        const result = makeInput({ ratiosTtm: null, incomeGrowth: null });
        expect(result.profitability.roe).toBeNull();
        expect(result.profitability.roa).toBeNull();
        expect(result.profitability.operatingMargin).toBeNull();
        expect(result.profitability.netMargin).toBeNull();
        expect(result.growth.revenueYoy).toBeNull();
        expect(result.growth.epsYoy).toBeNull();
        expect(result.health.debtRatio).toBeNull();
    });
});
