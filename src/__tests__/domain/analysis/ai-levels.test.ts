import { describe, it, expect } from 'vitest';
import {
    isValidBullishStopLoss,
    isValidBullishTakeProfit,
    deriveFallbackStopLoss,
    deriveFallbackTakeProfit,
    resolveBullishStopLoss,
    resolveBullishTakeProfit,
    buildBullishExitText,
    buildBullishRiskRewardText,
    reconcileBullishActionRecommendation,
    postProcessAnalysisWithReconcile,
    SL_FALLBACK_ATR_MULTIPLIER,
    TP_FALLBACK_ATR_MULTIPLIER,
    SL_MAX_ATR_MULTIPLIER,
    TP_MAX_ATR_MULTIPLIER,
} from '@/domain/analysis/ai-levels';
import type { ActionRecommendation, AnalysisResponse } from '@/domain/types';

const entryPrice = 100;
const atr = 2;

const baseRec: ActionRecommendation = {
    positionAnalysis: '',
    entry: '',
    exit: '',
    riskReward: '',
    entryRecommendation: 'enter',
    entryPrices: [100],
    stopLoss: 97,
    takeProfitPrices: [105],
};

describe('isValidBullishStopLoss', () => {
    it('SL이 entryPrice 미만이면 유효하다', () => {
        expect(isValidBullishStopLoss(97, entryPrice, atr)).toBe(true);
    });

    it('SL이 undefined이면 무효하다', () => {
        expect(isValidBullishStopLoss(undefined, entryPrice, atr)).toBe(false);
    });

    it('SL이 entryPrice 이상이면 무효하다', () => {
        expect(isValidBullishStopLoss(100, entryPrice, atr)).toBe(false);
        expect(isValidBullishStopLoss(105, entryPrice, atr)).toBe(false);
    });

    it('SL이 ATR 최대 한도를 초과하면 무효하다', () => {
        const tooLow = entryPrice - atr * SL_MAX_ATR_MULTIPLIER - 1;
        expect(isValidBullishStopLoss(tooLow, entryPrice, atr)).toBe(false);
    });

    it('ATR이 없으면 ATR 한도 검증을 건너뛴다', () => {
        const veryLow = 1;
        expect(isValidBullishStopLoss(veryLow, entryPrice, undefined)).toBe(
            true
        );
    });
});

describe('isValidBullishTakeProfit', () => {
    it('TP가 entryPrice 초과이면 유효하다', () => {
        expect(isValidBullishTakeProfit(105, entryPrice, atr)).toBe(true);
    });

    it('TP가 undefined이면 무효하다', () => {
        expect(isValidBullishTakeProfit(undefined, entryPrice, atr)).toBe(
            false
        );
    });

    it('TP가 entryPrice 이하이면 무효하다', () => {
        expect(isValidBullishTakeProfit(100, entryPrice, atr)).toBe(false);
        expect(isValidBullishTakeProfit(95, entryPrice, atr)).toBe(false);
    });

    it('TP가 ATR 최대 한도를 초과하면 무효하다', () => {
        const tooHigh = entryPrice + atr * TP_MAX_ATR_MULTIPLIER + 1;
        expect(isValidBullishTakeProfit(tooHigh, entryPrice, atr)).toBe(false);
    });

    it('ATR이 없으면 ATR 한도 검증을 건너뛴다', () => {
        const veryHigh = 9999;
        expect(isValidBullishTakeProfit(veryHigh, entryPrice, undefined)).toBe(
            true
        );
    });
});

describe('deriveFallbackStopLoss', () => {
    it('ATR이 있으면 entryPrice - ATR * SL_FALLBACK_ATR_MULTIPLIER를 반환한다', () => {
        const expected = entryPrice - atr * SL_FALLBACK_ATR_MULTIPLIER;
        expect(deriveFallbackStopLoss(entryPrice, atr)).toBeCloseTo(expected);
    });

    it('ATR이 없으면 undefined를 반환한다', () => {
        expect(deriveFallbackStopLoss(entryPrice, undefined)).toBeUndefined();
    });

    it('ATR이 0이면 undefined를 반환한다', () => {
        expect(deriveFallbackStopLoss(entryPrice, 0)).toBeUndefined();
    });
});

describe('deriveFallbackTakeProfit', () => {
    it('ATR이 있으면 entryPrice + ATR * TP_FALLBACK_ATR_MULTIPLIER를 반환한다', () => {
        const expected = entryPrice + atr * TP_FALLBACK_ATR_MULTIPLIER;
        expect(deriveFallbackTakeProfit(entryPrice, atr)).toBeCloseTo(expected);
    });

    it('ATR이 없으면 undefined를 반환한다', () => {
        expect(deriveFallbackTakeProfit(entryPrice, undefined)).toBeUndefined();
    });
});

describe('resolveBullishStopLoss', () => {
    it('AI SL이 유효하면 ai source를 반환한다', () => {
        const result = resolveBullishStopLoss(97, entryPrice, atr);
        expect(result.source).toBe('ai');
        expect(result.value).toBe(97);
    });

    it('AI SL이 무효하고 ATR이 있으면 fallback source를 반환한다', () => {
        const result = resolveBullishStopLoss(200, entryPrice, atr);
        expect(result.source).toBe('fallback');
        expect(result.value).toBeGreaterThan(0);
    });

    it('AI SL이 무효하고 ATR도 없으면 missing source를 반환한다', () => {
        const result = resolveBullishStopLoss(200, entryPrice, undefined);
        expect(result.source).toBe('missing');
        expect(result.value).toBeUndefined();
    });
});

describe('resolveBullishTakeProfit', () => {
    it('AI TP가 유효하면 ai source를 반환한다', () => {
        const result = resolveBullishTakeProfit(105, entryPrice, atr);
        expect(result.source).toBe('ai');
        expect(result.value).toBe(105);
    });

    it('AI TP가 무효하고 ATR이 있으면 fallback source를 반환한다', () => {
        const result = resolveBullishTakeProfit(50, entryPrice, atr);
        expect(result.source).toBe('fallback');
    });

    it('AI TP가 무효하고 ATR도 없으면 missing source를 반환한다', () => {
        const result = resolveBullishTakeProfit(50, entryPrice, undefined);
        expect(result.source).toBe('missing');
    });
});

describe('buildBullishExitText', () => {
    it('유효한 TP와 SL로 exit 텍스트를 생성한다', () => {
        const text = buildBullishExitText(100, 97, [105]);
        expect(text).toContain('105.00');
        expect(text).toContain('97.00');
    });

    it('TP가 없으면 SL만 포함한다', () => {
        const text = buildBullishExitText(100, 97, []);
        expect(text).toContain('97.00');
        expect(text).not.toContain('익절');
    });

    it('SL이 없으면 TP만 포함한다', () => {
        const text = buildBullishExitText(100, undefined, [105]);
        expect(text).toContain('105.00');
        expect(text).not.toContain('손절');
    });

    it('TP와 SL 모두 없으면 빈 문자열을 반환한다', () => {
        const text = buildBullishExitText(100, undefined, []);
        expect(text).toBe('');
    });

    it('TP가 여러 개이면 1차, 2차 라벨을 포함한다', () => {
        const text = buildBullishExitText(100, 97, [105, 110]);
        expect(text).toContain('1차');
        expect(text).toContain('2차');
    });

    it('TP가 entryPrice 이하이면 무효로 처리한다', () => {
        const text = buildBullishExitText(100, 97, [99]);
        expect(text).not.toContain('익절');
    });
});

describe('buildBullishRiskRewardText', () => {
    it('SL과 TP가 유효하면 R:R 텍스트를 반환한다', () => {
        const text = buildBullishRiskRewardText(100, 97, [105]);
        expect(text).toContain('1:');
        expect(text).toContain('위험:보상');
    });

    it('SL이 없으면 빈 문자열을 반환한다', () => {
        expect(buildBullishRiskRewardText(100, undefined, [105])).toBe('');
    });

    it('TP가 없으면 빈 문자열을 반환한다', () => {
        expect(buildBullishRiskRewardText(100, 97, [])).toBe('');
    });

    it('SL이 entryPrice 이상이면 빈 문자열을 반환한다', () => {
        expect(buildBullishRiskRewardText(100, 105, [110])).toBe('');
    });

    it('TP가 entryPrice 이하이면 빈 문자열을 반환한다', () => {
        expect(buildBullishRiskRewardText(100, 97, [99])).toBe('');
    });
});

describe('reconcileBullishActionRecommendation', () => {
    it('avoid 추천은 보정하지 않는다', () => {
        const rec: ActionRecommendation = {
            ...baseRec,
            entryRecommendation: 'avoid',
        };

        const result = reconcileBullishActionRecommendation(
            rec,
            entryPrice,
            atr
        );

        expect(result.wasReconciled).toBe(false);
        expect(result.recommendation.reconciledLevels).toBeUndefined();
    });

    it('AI SL/TP가 모두 유효하면 보정하지 않는다', () => {
        const result = reconcileBullishActionRecommendation(
            baseRec,
            entryPrice,
            atr
        );

        expect(result.wasReconciled).toBe(false);
    });

    it('AI SL이 무효하면 fallback으로 보정한다', () => {
        const rec: ActionRecommendation = {
            ...baseRec,
            stopLoss: 200,
        };

        const result = reconcileBullishActionRecommendation(
            rec,
            entryPrice,
            atr
        );

        expect(result.wasReconciled).toBe(true);
        expect(result.recommendation.reconciledLevels?.stopLoss).toBeLessThan(
            entryPrice
        );
        expect(result.changes).toHaveLength(1);
    });

    it('AI TP가 무효하면 fallback으로 보정한다', () => {
        const rec: ActionRecommendation = {
            ...baseRec,
            takeProfitPrices: [50],
        };

        const result = reconcileBullishActionRecommendation(
            rec,
            entryPrice,
            atr
        );

        expect(result.wasReconciled).toBe(true);
        expect(
            result.recommendation.reconciledLevels?.takeProfitPrices?.[0]
        ).toBeGreaterThan(entryPrice);
    });

    it('AI 원본 필드는 수정하지 않는다', () => {
        const rec: ActionRecommendation = {
            ...baseRec,
            stopLoss: 200,
        };

        const result = reconcileBullishActionRecommendation(
            rec,
            entryPrice,
            atr
        );

        expect(result.recommendation.stopLoss).toBe(200);
    });
});

describe('postProcessAnalysisWithReconcile', () => {
    const baseResponse: AnalysisResponse = {
        summary: 'test',
        trend: 'bullish',
        indicatorResults: [],
        riskLevel: 'low',
        keyLevels: { support: [], resistance: [] },
        priceTargets: {
            bullish: { targets: [], condition: '' },
            bearish: { targets: [], condition: '' },
        },
        patternSummaries: [],
        strategyResults: [],
        candlePatterns: [],
        trendlines: [],
    };

    it('actionRecommendation이 없으면 원본을 반환한다', () => {
        const result = postProcessAnalysisWithReconcile(
            baseResponse,
            entryPrice,
            atr
        );

        expect(result).toBe(baseResponse);
    });

    it('entryPrice를 결정할 수 없으면 원본을 반환한다', () => {
        const response: AnalysisResponse = {
            ...baseResponse,
            actionRecommendation: {
                ...baseRec,
                entryPrices: [],
            },
        };

        const result = postProcessAnalysisWithReconcile(
            response,
            undefined,
            atr
        );

        expect(result).toBe(response);
    });

    it('entryPrices의 평균을 entryPrice로 사용한다', () => {
        const response: AnalysisResponse = {
            ...baseResponse,
            actionRecommendation: {
                ...baseRec,
                entryPrices: [100, 110],
                stopLoss: 200,
            },
        };

        const result = postProcessAnalysisWithReconcile(
            response,
            undefined,
            atr
        );

        // entryPrice = (100 + 110) / 2 = 105
        // SL 200 > entryPrice 105 → fallback 적용
        expect(
            result.actionRecommendation?.reconciledLevels?.stopLoss
        ).toBeDefined();
    });

    it('보정을 적용하고 새 actionRecommendation을 포함한 결과를 반환한다', () => {
        const response: AnalysisResponse = {
            ...baseResponse,
            actionRecommendation: {
                ...baseRec,
                stopLoss: 200,
            },
        };

        const result = postProcessAnalysisWithReconcile(
            response,
            entryPrice,
            atr
        );

        expect(result).not.toBe(response);
        expect(result.actionRecommendation?.reconciledLevels).toBeDefined();
    });

    describe('planCheck', () => {
        const healthy: AnalysisResponse = {
            ...baseResponse,
            actionRecommendation: baseRec,
        };

        it('레벨이 전부 유효한 정상 경로에서도 붙는다', () => {
            // 이 케이스가 요점이다. reconcileBullish...는 보정할 것이 없으면 조기 반환하므로
            // 종전에는 **정상 분석에만** 결정론적 손익비가 없었다.
            const result = postProcessAnalysisWithReconcile(
                healthy,
                entryPrice,
                atr
            );

            expect(
                result.actionRecommendation?.reconciledLevels
            ).toBeUndefined();
            expect(result.actionRecommendation?.planCheck).toEqual({
                currentPrice: 100,
                entryZoneTop: 100,
                exceedsEntryZone: false,
                belowStopLoss: false,
                // (105 - 100) / (100 - 97)
                riskRewardAtEntry: 5 / 3,
                riskRewardAtCurrent: 5 / 3,
            });
        });

        it('현재가가 진입 구간을 벗어나면 두 손익비가 갈라진다', () => {
            const result = postProcessAnalysisWithReconcile(healthy, 104, atr);
            const check = result.actionRecommendation?.planCheck;

            expect(check?.exceedsEntryZone).toBe(true);
            // 계획 기준으로는 여전히 매력적이지만 지금 사면 거의 남는 게 없다.
            expect(check?.riskRewardAtEntry).toBeCloseTo(5 / 3);
            expect(check?.riskRewardAtCurrent).toBeCloseTo(1 / 7);
        });

        it('목표가를 이미 지난 계획은 상방 0으로 보고한다', () => {
            const result = postProcessAnalysisWithReconcile(healthy, 106, atr);

            expect(
                result.actionRecommendation?.planCheck?.riskRewardAtCurrent
            ).toBe(0);
        });

        it("'avoid' 판정에도 붙는다 — 보정은 건너뛰지만 검산은 여전히 유효하다", () => {
            const response: AnalysisResponse = {
                ...baseResponse,
                actionRecommendation: {
                    ...baseRec,
                    entryRecommendation: 'avoid',
                    stopLoss: 200,
                },
            };

            const result = postProcessAnalysisWithReconcile(
                response,
                entryPrice,
                atr
            );

            expect(
                result.actionRecommendation?.reconciledLevels
            ).toBeUndefined();
            expect(result.actionRecommendation?.planCheck).toBeDefined();
        });

        it('현재가가 없으면 계획 진입가로 대체하지 않고 생략한다', () => {
            // 대체하면 "가격이 계획한 자리에 정확히 있다"고 보고하게 되는데, 입력이
            // 뒷받침하지 않는 주장이다.
            const result = postProcessAnalysisWithReconcile(
                healthy,
                undefined,
                atr
            );

            expect(result.actionRecommendation?.planCheck).toBeUndefined();
        });
    });
});
