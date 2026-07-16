import { describe, expect, it } from 'vitest';
import { filterAnalysisResult } from '@/domain/analysis/filterAnalysisResult';
import { TIER_CONFIG } from '@/domain/tier';
import type {
    AnalysisResponse,
    FilteredAnalysisResponse,
    TierConfig,
} from '@/domain/types';

const restrictedConfig: TierConfig = {
    ...TIER_CONFIG,
    featureFlags: { enableTierRestrictions: true },
};

const customRestrictedConfig: TierConfig = {
    ...restrictedConfig,
    infoDepth: {
        ...restrictedConfig.infoDepth,
        member: [
            'direction',
            'summary',
            'skill_detection',
            'partial_detail',
            'full_detail',
            'entry',
            'stoploss',
            'target',
        ],
    },
};

// `full_detail` is granted (and partial_detail/entry/stoploss/target/
// confidence) but `skill_detection` is deliberately omitted, so this
// config isolates the deny branch of the skill_detection gate itself.
const denySkillDetectionConfig: TierConfig = {
    ...restrictedConfig,
    infoDepth: {
        ...restrictedConfig.infoDepth,
        member: [
            'direction',
            'summary',
            'partial_detail',
            'full_detail',
            'entry',
            'stoploss',
            'target',
            'confidence',
        ],
    },
};

const makeAnalysisResponse = (
    overrides: Partial<AnalysisResponse> = {}
): AnalysisResponse => ({
    summary: '요약',
    trend: 'bullish',
    indicatorResults: [
        {
            indicatorName: 'RSI',
            signals: [
                {
                    type: 'skill',
                    description: 'RSI 신호',
                    trend: 'bullish',
                    strength: 'strong',
                },
            ],
        },
    ],
    riskLevel: 'medium',
    keyLevels: {
        support: [{ price: 100, reason: '지지' }],
        resistance: [{ price: 120, reason: '저항' }],
        poc: { price: 110, reason: 'POC' },
    },
    priceTargets: {
        bullish: {
            targets: [{ price: 130, basis: '상승 목표' }],
            condition: '돌파',
        },
        bearish: {
            targets: [{ price: 90, basis: '하락 목표' }],
            condition: '이탈',
        },
    },
    patternSummaries: [
        {
            id: 'pattern_0',
            patternName: 'double_bottom',
            skillName: 'Double Bottom',
            detected: true,
            trend: 'bullish',
            summary: '패턴 요약',
            confidenceWeight: 0.8,
        },
    ],
    strategyResults: [
        {
            id: 'strategy_0',
            strategyName: 'Momentum',
            trend: 'bullish',
            summary: '전략 요약',
            confidenceWeight: 0.7,
        },
    ],
    candlePatterns: [
        {
            id: 'hammer_0',
            patternName: 'hammer',
            detected: true,
            trend: 'bullish',
            summary: '캔들 요약',
        },
    ],
    trendlines: [
        {
            direction: 'ascending',
            start: { time: 1, price: 100 },
            end: { time: 2, price: 110 },
        },
    ],
    actionRecommendation: {
        positionAnalysis: '현재 위치',
        entry: '진입 전략',
        exit: '청산 전략',
        riskReward: '손익비',
        entryRecommendation: 'enter',
        entryPrices: [101, 103],
        stopLoss: 95,
        takeProfitPrices: [130, 140],
        reconciledLevels: {
            stopLoss: 94,
            takeProfitPrices: [132, 142],
            exit: '보정 청산',
            riskReward: '보정 손익비',
            reason: '보정 사유',
        },
    },
    analyzedAt: '2026-04-28T00:00:00.000Z',
    ...overrides,
});

function expectFilteredResult(
    result: ReturnType<typeof filterAnalysisResult>
): FilteredAnalysisResponse {
    expect(result.result).not.toBeNull();
    return result.result as FilteredAnalysisResponse;
}

describe('filterAnalysisResult', () => {
    it('returns the original analysis when info-depth restrictions are disabled', () => {
        const analysis = makeAnalysisResponse();
        const filtered = filterAnalysisResult(analysis, 'free', {
            ...TIER_CONFIG,
            featureFlags: {
                ...TIER_CONFIG.featureFlags,
                enableInfoDepthRestrictions: false,
            },
        });

        expect(filtered.result).toBe(analysis);
        expect(filtered.lockedInfoDepth).toEqual([]);
    });

    it('applies the independently enabled default info-depth restriction', () => {
        const filtered = filterAnalysisResult(makeAnalysisResponse(), 'free');
        const result = expectFilteredResult(filtered);

        expect(result.summary).toBe('요약');
        expect(result.indicatorResults).toBeNull();
        expect(filtered.lockedInfoDepth).toContain('partial_detail');
    });

    it('keeps direction, summary, and sampled skill detections for free tier when restrictions are enabled', () => {
        const filtered = filterAnalysisResult(
            makeAnalysisResponse(),
            'free',
            restrictedConfig
        );
        const result = expectFilteredResult(filtered);

        expect(result.summary).toBe('요약');
        expect(result.trend).toBe('bullish');
        expect(result.indicatorResults).toBeNull();
        expect(result.riskLevel).toBeNull();
        expect(result.keyLevels).toBeNull();
        expect(result.priceTargets).toBeNull();
        // Free now sees the detection output of its <=3-per-group sampled
        // skills. confidenceWeight is a separate paid ('confidence') fragment,
        // so it is masked to 0 while the pattern/strategy itself is visible.
        expect(result.patternSummaries).toEqual([
            {
                id: 'pattern_0',
                patternName: 'double_bottom',
                skillName: 'Double Bottom',
                detected: true,
                trend: 'bullish',
                summary: '패턴 요약',
                confidenceWeight: 0,
            },
        ]);
        expect(result.strategyResults).toEqual([
            {
                id: 'strategy_0',
                strategyName: 'Momentum',
                trend: 'bullish',
                summary: '전략 요약',
                confidenceWeight: 0,
            },
        ]);
        // candlePatterns (partial_detail) and trendlines (full_detail) stay
        // member-only.
        expect(result.candlePatterns).toBeNull();
        expect(result.trendlines).toBeNull();
        expect(result.actionRecommendation).toEqual({
            positionAnalysis: null,
            entry: null,
            exit: null,
            riskReward: null,
        });
        expect(filtered.lockedInfoDepth).toEqual([
            'partial_detail',
            'full_detail',
            'entry',
            'stoploss',
            'target',
            'confidence',
        ]);
    });

    it('keeps the complete analysis for member tier', () => {
        const filtered = filterAnalysisResult(
            makeAnalysisResponse(),
            'member',
            restrictedConfig
        );
        const result = expectFilteredResult(filtered);

        expect(result.indicatorResults).toHaveLength(1);
        expect(result.riskLevel).toBe('medium');
        expect(result.keyLevels).toEqual({
            support: [{ price: 100, reason: '지지' }],
            resistance: [{ price: 120, reason: '저항' }],
            poc: { price: 110, reason: 'POC' },
        });
        expect(result.candlePatterns).toHaveLength(1);
        expect(result.patternSummaries).toHaveLength(1);
        expect(result.strategyResults).toHaveLength(1);
        expect(result.trendlines).toHaveLength(1);
        expect(result.priceTargets).toEqual(
            makeAnalysisResponse().priceTargets
        );
        expect(result.actionRecommendation).toEqual(
            makeAnalysisResponse().actionRecommendation ?? null
        );
        expect(filtered.lockedInfoDepth).toEqual([]);
    });

    it('keeps all analysis fields for pro tier', () => {
        const analysis = makeAnalysisResponse();
        const filtered = filterAnalysisResult(
            analysis,
            'pro',
            restrictedConfig
        );
        const result = expectFilteredResult(filtered);

        expect(result.summary).toBe(analysis.summary);
        expect(result.trend).toBe(analysis.trend);
        expect(result.priceTargets).toBe(analysis.priceTargets);
        expect(result.patternSummaries).toEqual(analysis.patternSummaries);
        expect(result.strategyResults).toEqual(analysis.strategyResults);
        expect(result.trendlines).toBe(analysis.trendlines);
        expect(result.actionRecommendation).toEqual(
            analysis.actionRecommendation
        );
        expect(filtered.lockedInfoDepth).toEqual([]);
    });

    it('removes confidence weights when full details are allowed without confidence', () => {
        const filtered = filterAnalysisResult(
            makeAnalysisResponse(),
            'member',
            customRestrictedConfig
        );
        const result = expectFilteredResult(filtered);

        expect(result.patternSummaries).toEqual([
            {
                id: 'pattern_0',
                patternName: 'double_bottom',
                skillName: 'Double Bottom',
                detected: true,
                trend: 'bullish',
                summary: '패턴 요약',
                confidenceWeight: 0,
            },
        ]);
        expect(result.strategyResults).toEqual([
            {
                id: 'strategy_0',
                strategyName: 'Momentum',
                trend: 'bullish',
                summary: '전략 요약',
                confidenceWeight: 0,
            },
        ]);
        expect(result.actionRecommendation).toEqual({
            positionAnalysis: '현재 위치',
            entry: '진입 전략',
            exit: '청산 전략',
            riskReward: '손익비',
            entryRecommendation: 'enter',
            entryPrices: [101, 103],
            stopLoss: 95,
            takeProfitPrices: [130, 140],
            reconciledLevels: {
                stopLoss: 94,
                takeProfitPrices: [132, 142],
                exit: '보정 청산',
                riskReward: '보정 손익비',
                reason: '보정 사유',
            },
        });
        expect(filtered.lockedInfoDepth).toEqual(['confidence']);
    });

    it('masks patternSummaries and strategyResults to null when skill_detection is not allowed', () => {
        // Guards that the gate is `skill_detection`, not `full_detail`: this
        // config grants full_detail (plus partial_detail/entry/stoploss/
        // target/confidence) but omits skill_detection, so a future revert
        // that re-gates on `allowFullDetail` would leak these fields and
        // fail this test.
        const filtered = filterAnalysisResult(
            makeAnalysisResponse(),
            'member',
            denySkillDetectionConfig
        );
        const result = expectFilteredResult(filtered);

        expect(result.patternSummaries).toBeNull();
        expect(result.strategyResults).toBeNull();
    });

    it('filters action recommendations with missing optional fields', () => {
        const filtered = filterAnalysisResult(
            makeAnalysisResponse({
                actionRecommendation: {
                    positionAnalysis: '현재 위치',
                    entry: '진입 전략',
                    exit: '청산 전략',
                    riskReward: '손익비',
                },
            }),
            'pro',
            restrictedConfig
        );
        const result = expectFilteredResult(filtered);

        expect(result.actionRecommendation).toEqual({
            positionAnalysis: '현재 위치',
            entry: '진입 전략',
            exit: '청산 전략',
            riskReward: '손익비',
        });
    });

    it('omits absent optional reconciled levels', () => {
        const filtered = filterAnalysisResult(
            makeAnalysisResponse({
                actionRecommendation: {
                    positionAnalysis: '현재 위치',
                    entry: '진입 전략',
                    exit: '청산 전략',
                    riskReward: '손익비',
                    stopLoss: 95,
                    takeProfitPrices: [130, 140],
                    reconciledLevels: {
                        exit: '보정 청산',
                        riskReward: '보정 손익비',
                        reason: '보정 사유',
                    },
                },
            }),
            'pro',
            restrictedConfig
        );
        const result = expectFilteredResult(filtered);

        expect(result.actionRecommendation?.reconciledLevels).toEqual({
            exit: '보정 청산',
            riskReward: '보정 손익비',
            reason: '보정 사유',
        });
        expect(
            result.actionRecommendation?.reconciledLevels
        ).not.toHaveProperty('stopLoss');
        expect(
            result.actionRecommendation?.reconciledLevels
        ).not.toHaveProperty('takeProfitPrices');
    });

    it('uses null action recommendation when the source analysis has no recommendation', () => {
        const filtered = filterAnalysisResult(
            makeAnalysisResponse({ actionRecommendation: undefined }),
            'pro',
            restrictedConfig
        );
        const result = expectFilteredResult(filtered);

        expect(result.actionRecommendation).toBeNull();
    });

    it('locks direction and summary when a custom config omits them', () => {
        const filtered = filterAnalysisResult(makeAnalysisResponse(), 'free', {
            ...restrictedConfig,
            infoDepth: {
                ...restrictedConfig.infoDepth,
                free: [],
            },
        });
        const result = expectFilteredResult(filtered);

        expect(result.summary).toBeNull();
        expect(result.trend).toBeNull();
        expect(filtered.lockedInfoDepth).toEqual([
            'direction',
            'summary',
            'skill_detection',
            'partial_detail',
            'full_detail',
            'entry',
            'stoploss',
            'target',
            'confidence',
        ]);
    });

    it('calculates locked depths from custom pro config', () => {
        const filtered = filterAnalysisResult(makeAnalysisResponse(), 'free', {
            ...restrictedConfig,
            infoDepth: {
                ...restrictedConfig.infoDepth,
                free: [],
                pro: ['direction', 'summary'],
            },
        });

        expect(filtered.lockedInfoDepth).toEqual(['direction', 'summary']);
    });
});
