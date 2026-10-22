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
import type {
    ActionRecommendation,
    AnalysisResponse,
    PatternResult,
    ReconciledActionLevels,
} from '@/domain/types';

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
        const text = buildBullishExitText(100, 97, [105], 'USD', 'share');
        expect(text).toContain('105.00');
        expect(text).toContain('97.00');
    });

    it('TP가 없으면 SL만 포함한다', () => {
        const text = buildBullishExitText(100, 97, [], 'USD', 'share');
        expect(text).toContain('97.00');
        expect(text).not.toContain('익절');
    });

    it('SL이 없으면 TP만 포함한다', () => {
        const text = buildBullishExitText(
            100,
            undefined,
            [105],
            'USD',
            'share'
        );
        expect(text).toContain('105.00');
        expect(text).not.toContain('손절');
    });

    it('TP와 SL 모두 없으면 빈 문자열을 반환한다', () => {
        const text = buildBullishExitText(100, undefined, [], 'USD', 'share');
        expect(text).toBe('');
    });

    it('TP가 여러 개이면 1차, 2차 라벨을 포함한다', () => {
        const text = buildBullishExitText(100, 97, [105, 110], 'USD', 'share');
        expect(text).toContain('1차');
        expect(text).toContain('2차');
    });

    it('TP가 entryPrice 이하이면 무효로 처리한다', () => {
        const text = buildBullishExitText(100, 97, [99], 'USD', 'share');
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

    it('TP 배열이 정렬돼 있지 않고 entryPrice 이하 값을 섞어 가지고 있어도 entryPrice 위 가장 가까운 값을 쓴다 (root-cause fix 2026-09-19: 더는 [0]을 쓰지 않는다)', () => {
        // [0]=95 (<=entryPrice, dropped), 110 and 105 both qualify — nearest is 105.
        const text = buildBullishRiskRewardText(100, 97, [95, 110, 105]);
        const withOnlyNearest = buildBullishRiskRewardText(100, 97, [105]);
        expect(text).toBe(withOnlyNearest);
    });

    it('locale을 생략하면 한국어(기본값)로 렌더한다', () => {
        const text = buildBullishRiskRewardText(100, 97, [105]);
        expect(text).toContain('손절');
        expect(text).toContain('위험:보상');
    });

    it.each([
        ['en', 'Stop', 'risk:reward'],
        ['ja', '損切り', 'リスク・リワード'],
        ['zh', '止损', '风险回报比'],
    ] as const)(
        'locale=%s는 그 언어로 렌더한다',
        (locale, stopWord, rrWord) => {
            const text = buildBullishRiskRewardText(100, 97, [105], locale);
            expect(text).toContain(stopWord);
            expect(text).toContain(rrWord);
            expect(text).toContain('1:');
        }
    );

    it('SL이 entry 바로 아래(0.01%)라 소수 첫째 자리에서 0으로 반올림돼도 -0.0%를 찍지 않는다', () => {
        // slPct = (99.99 - 100) / 100 * 100 = -0.01 -> toFixed(1) would be "-0.0".
        const text = buildBullishRiskRewardText(100, 99.99, [105]);
        expect(text).not.toContain('-0.0%');
        expect(text).toContain('0.0%');
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
            atr,
            'USD'
        );

        expect(result.wasReconciled).toBe(false);
        expect(result.recommendation.reconciledLevels).toBeUndefined();
    });

    it('AI SL/TP가 모두 유효하면 보정하지 않는다', () => {
        const result = reconcileBullishActionRecommendation(
            baseRec,
            entryPrice,
            atr,
            'USD'
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
            atr,
            'USD'
        );

        expect(result.wasReconciled).toBe(true);
        expect(result.recommendation.reconciledLevels?.stopLoss).toBeLessThan(
            entryPrice
        );
        expect(result.changes).toHaveLength(1);
    });

    it('locale=en으로 보정하면 reconciledLevels.riskReward도 영어로 렌더한다', () => {
        const rec: ActionRecommendation = {
            ...baseRec,
            stopLoss: 200, // invalid → fallback triggers reconciliation
        };

        const result = reconcileBullishActionRecommendation(
            rec,
            entryPrice,
            atr,
            'USD',
            'en'
        );

        expect(result.wasReconciled).toBe(true);
        expect(result.recommendation.reconciledLevels?.riskReward).toContain(
            'Stop'
        );
        expect(result.recommendation.reconciledLevels?.riskReward).toContain(
            'risk:reward'
        );
        expect(
            result.recommendation.reconciledLevels?.riskReward
        ).not.toContain('손절');
    });

    it('AI TP가 무효하면 fallback으로 보정한다', () => {
        const rec: ActionRecommendation = {
            ...baseRec,
            takeProfitPrices: [50],
        };

        const result = reconcileBullishActionRecommendation(
            rec,
            entryPrice,
            atr,
            'USD'
        );

        expect(result.wasReconciled).toBe(true);
        expect(
            result.recommendation.reconciledLevels?.takeProfitPrices?.[0]
        ).toBeGreaterThan(entryPrice);
    });

    it('sub-dollar fallback note는 4 유효숫자로 표기한다', () => {
        const rec: ActionRecommendation = {
            ...baseRec,
            entryPrices: [0.09],
            stopLoss: undefined,
            takeProfitPrices: [0.095],
        };

        const result = reconcileBullishActionRecommendation(
            rec,
            0.09,
            0.005,
            'USD'
        );

        expect(result.changes).toContain('stopLoss: null → 0.08250 (fallback)');
    });

    it('AI 원본 필드는 수정하지 않는다', () => {
        const rec: ActionRecommendation = {
            ...baseRec,
            stopLoss: 200,
        };

        const result = reconcileBullishActionRecommendation(
            rec,
            entryPrice,
            atr,
            'USD'
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
            // 보정을 건너뛰므로 폴백할 값이 없다. 진입가 위에 있는 손절가는 롱이
            // 실행할 수 있는 손절가가 아니므로 버려야 한다 — 남겨 두면 100에
            // 거래되는 차트를 "이미 손절됐다"고 보고한다.
            expect(result.actionRecommendation?.planCheck).toMatchObject({
                belowStopLoss: false,
                riskRewardAtCurrent: null,
            });
        });

        it('보정된 손절가로 잰다 — 도메인이 물린 원본 값이 아니라', () => {
            const response: AnalysisResponse = {
                ...baseResponse,
                actionRecommendation: { ...baseRec, stopLoss: 200 },
            };

            const result = postProcessAnalysisWithReconcile(
                response,
                entryPrice,
                atr
            );

            // entryPrice 100 − atr 2 × 1.5 = 97
            expect(
                result.actionRecommendation?.reconciledLevels?.stopLoss
            ).toBeCloseTo(97);
            expect(result.actionRecommendation?.planCheck).toMatchObject({
                belowStopLoss: false,
            });
            // (105 − 100) / (100 − 97)
            expect(
                result.actionRecommendation?.planCheck?.riskRewardAtCurrent
            ).toBeCloseTo(5 / 3);
        });

        it('deterministic risk:reward 줄을 모든 경로에서 riskReward 앞에 붙인다 — 보정 경로가 아니어도', () => {
            const response: AnalysisResponse = {
                ...baseResponse,
                actionRecommendation: { ...baseRec, riskReward: '모델 산문.' },
            };
            const result = postProcessAnalysisWithReconcile(
                response,
                entryPrice,
                atr
            );
            const riskReward = result.actionRecommendation?.riskReward ?? '';
            expect(riskReward.startsWith('손절')).toBe(true);
            expect(riskReward).toContain('위험:보상');
            expect(riskReward).toContain('\n\n모델 산문.');
            // 이 케이스가 요점이다 — 보정되지 않았는데도 결정론적 줄이 붙는다.
            expect(
                result.actionRecommendation?.reconciledLevels
            ).toBeUndefined();
        });

        it('모델 산문이 빈 문자열이면 결정론적 줄만 남는다', () => {
            const response: AnalysisResponse = {
                ...baseResponse,
                actionRecommendation: { ...baseRec, riskReward: '' },
            };
            const result = postProcessAnalysisWithReconcile(
                response,
                entryPrice,
                atr
            );
            expect(result.actionRecommendation?.riskReward).not.toContain(
                '\n\n'
            );
            expect(result.actionRecommendation?.riskReward).toContain(
                '위험:보상'
            );
        });

        it('SL/TP가 무효해 결정론적 줄이 빈 문자열이면 모델 산문만 남긴다', () => {
            const response: AnalysisResponse = {
                ...baseResponse,
                actionRecommendation: {
                    ...baseRec,
                    entryRecommendation: 'avoid',
                    stopLoss: 200, // >= entryPrice → invalid, avoid는 보정도 건너뜀
                    riskReward: '모델 산문만.',
                },
            };
            const result = postProcessAnalysisWithReconcile(
                response,
                entryPrice,
                atr
            );
            expect(result.actionRecommendation?.riskReward).toBe(
                '모델 산문만.'
            );
        });

        it('locale=en이면 결정론적 줄을 영어로 렌더한다', () => {
            const response: AnalysisResponse = {
                ...baseResponse,
                actionRecommendation: { ...baseRec, riskReward: 'prose.' },
            };
            const result = postProcessAnalysisWithReconcile(
                response,
                entryPrice,
                atr,
                'USD',
                'en'
            );
            expect(result.actionRecommendation?.riskReward).toContain('Stop');
            expect(result.actionRecommendation?.riskReward).toContain(
                'risk:reward'
            );
        });

        it('보정된 SL/TP로 결정론적 줄을 계산한다 — AI 원본이 아니라 (reconciledLevels.riskReward에 실린다)', () => {
            const response: AnalysisResponse = {
                ...baseResponse,
                actionRecommendation: {
                    ...baseRec,
                    stopLoss: 200, // invalid → fallback to ATR-derived 97
                    riskReward: '',
                },
            };
            const result = postProcessAnalysisWithReconcile(
                response,
                entryPrice,
                atr
            );
            // fallback SL = 100 − 2×1.5 = 97 (같은 리스크로 원본 SL 97과 동일 텍스트가 되진 않지만
            // 유효한 손절 퍼센트가 나와야 한다). 보정이 일어났으므로
            // reconciledLevels.riskReward가 이 줄을 이미 담고 있고, 최상위
            // riskReward에는 R5로 중복 prepend하지 않는다 (UI가 둘 다 보여줌).
            expect(
                result.actionRecommendation?.reconciledLevels?.riskReward
            ).toContain('손절');
            expect(
                result.actionRecommendation?.reconciledLevels?.riskReward
            ).not.toContain('NaN');
            expect(result.actionRecommendation?.riskReward).toBe('');
        });

        it('locale=en + 보정된 SL/TP면 reconciledLevels.riskReward도 영어 템플릿으로 렌더한다', () => {
            const response: AnalysisResponse = {
                ...baseResponse,
                actionRecommendation: {
                    ...baseRec,
                    stopLoss: 200, // invalid → fallback to ATR-derived 97
                    riskReward: '',
                },
            };
            const result = postProcessAnalysisWithReconcile(
                response,
                entryPrice,
                atr,
                'USD',
                'en'
            );
            expect(
                result.actionRecommendation?.reconciledLevels?.riskReward
            ).toContain('Stop');
            expect(
                result.actionRecommendation?.reconciledLevels?.riskReward
            ).toContain('risk:reward');
            expect(
                result.actionRecommendation?.reconciledLevels?.riskReward
            ).not.toContain('손절');
        });

        it('보정된 SL과 미정렬 원본 TP가 섞인 reconciled 경로 — reconciledLevels.riskReward가 planCheck.riskRewardAtEntry와 같은 타깃을 쓴다 (root-cause regression: SL만 보정될 때 reconciledTpArr에 AI 원본 미정렬 배열이 그대로 전달된다)', () => {
            const response: AnalysisResponse = {
                ...baseResponse,
                actionRecommendation: {
                    ...baseRec,
                    stopLoss: 200, // invalid (>= entryPrice) → SL-only reconciliation
                    takeProfitPrices: [150, 105], // both individually valid, unsorted — [0]=150 is the FARTHER target
                },
            };
            const bigAtr = 20; // keeps TP 150 under the ATR cap so only SL reconciles

            const result = postProcessAnalysisWithReconcile(
                response,
                entryPrice,
                bigAtr
            );

            expect(
                result.actionRecommendation?.reconciledLevels?.stopLoss
            ).toBe(entryPrice - bigAtr * SL_FALLBACK_ATR_MULTIPLIER);
            expect(
                result.actionRecommendation?.reconciledLevels?.takeProfitPrices
            ).toEqual([150, 105]); // AI 원본 그대로 — 버그는 이 배열이 아니라 어느 원소를 읽느냐에 있었다

            const riskReward =
                result.actionRecommendation?.reconciledLevels?.riskReward ?? '';
            const ratioMatch = riskReward.match(/1:([\d.]+)/);
            const lineRatio = ratioMatch ? Number(ratioMatch[1]) : NaN;
            const planRatio = result.actionRecommendation?.planCheck
                ?.riskRewardAtEntry as number;

            expect(planRatio).not.toBeNull();
            expect(lineRatio).toBeCloseTo(Number(planRatio.toFixed(1)), 5);
        });

        it('reconciledLevels도 takeProfitPrices도 없으면 결정론적 줄을 붙이지 않고 모델 산문을 그대로 둔다', () => {
            const response: AnalysisResponse = {
                ...baseResponse,
                actionRecommendation: {
                    ...baseRec,
                    stopLoss: 97,
                    takeProfitPrices: undefined,
                    riskReward: '모델 산문.',
                },
            };

            const result = postProcessAnalysisWithReconcile(
                response,
                entryPrice,
                undefined // no ATR → TP fallback also unavailable, nothing to reconcile
            );

            expect(
                result.actionRecommendation?.reconciledLevels
            ).toBeUndefined();
            expect(result.actionRecommendation?.riskReward).toBe('모델 산문.');
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

describe('postProcessAnalysisWithReconcile — model-authored reconciledLevels is dropped; deterministic risk:reward gated by wasReconciled (regressions 2026-09-19)', () => {
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

    it('모델이 유효한 SL/TP로 reconciledLevels를 직접 채워도(core는 보정하지 않음) 결정론적 줄이 붙고 planCheck.riskRewardAtEntry(반올림 1dp)와 일치한다', () => {
        const modelReconciledLevels: ReconciledActionLevels = {
            stopLoss: baseRec.stopLoss,
            takeProfitPrices: baseRec.takeProfitPrices,
            exit: buildBullishExitText(
                entryPrice,
                baseRec.stopLoss,
                baseRec.takeProfitPrices,
                'USD',
                'share'
            ),
            riskReward: buildBullishRiskRewardText(
                entryPrice,
                baseRec.stopLoss,
                baseRec.takeProfitPrices
            ),
            reason: '',
        };
        const response: AnalysisResponse = {
            ...baseResponse,
            actionRecommendation: {
                ...baseRec,
                reconciledLevels: modelReconciledLevels,
            },
        };

        const result = postProcessAnalysisWithReconcile(
            response,
            entryPrice,
            atr
        );

        // No reconciliation happened, so the model's own object must not survive
        // to be shown as core's correction.
        expect(result.actionRecommendation?.reconciledLevels).toBeUndefined();

        const riskReward = result.actionRecommendation?.riskReward ?? '';
        expect(riskReward.startsWith('손절')).toBe(true);
        expect(riskReward).toContain('위험:보상');

        const ratioMatch = riskReward.match(/1:([\d.]+)/);
        const lineRatio = ratioMatch ? Number(ratioMatch[1]) : NaN;
        const planRatio = result.actionRecommendation?.planCheck
            ?.riskRewardAtEntry as number;
        expect(planRatio).not.toBeNull();
        expect(lineRatio).toBeCloseTo(Number(planRatio.toFixed(1)), 5);
    });

    it('locale=en이어도 위 경로에서 영어 템플릿으로 렌더한다', () => {
        const modelReconciledLevels: ReconciledActionLevels = {
            stopLoss: baseRec.stopLoss,
            takeProfitPrices: baseRec.takeProfitPrices,
            exit: buildBullishExitText(
                entryPrice,
                baseRec.stopLoss,
                baseRec.takeProfitPrices,
                'USD',
                'share'
            ),
            riskReward: '',
            reason: '',
        };
        const response: AnalysisResponse = {
            ...baseResponse,
            actionRecommendation: {
                ...baseRec,
                reconciledLevels: modelReconciledLevels,
            },
        };

        const result = postProcessAnalysisWithReconcile(
            response,
            entryPrice,
            atr,
            'USD',
            'en'
        );

        const riskReward = result.actionRecommendation?.riskReward ?? '';
        expect(riskReward).toContain('Stop');
        expect(riskReward).toContain('risk:reward');
    });

    it('takeProfitPrices가 정렬돼 있지 않고 진입가 이하 값을 포함해도 진입가 위 가장 가까운 목표가를 쓰고, 모델이 채운 reconciledLevels의 값은 쓰지 않는다', () => {
        const modelReconciledLevels: ReconciledActionLevels = {
            stopLoss: 90,
            takeProfitPrices: [130],
            exit: '',
            riskReward: '모델이 채운 임의 텍스트',
            reason: '',
        };
        const response: AnalysisResponse = {
            ...baseResponse,
            actionRecommendation: {
                ...baseRec, // stopLoss: 97 — valid, first target 110 valid → core does not reconcile
                takeProfitPrices: [110, 95, 102], // unsorted + one at/below entryPrice(100)
                reconciledLevels: modelReconciledLevels,
            },
        };

        const result = postProcessAnalysisWithReconcile(
            response,
            entryPrice,
            atr
        );

        // nearest target above entryPrice among [110, 95, 102] is 102, not 110 or the
        // sub-entry 95 — buildBullishRiskRewardText([102]) is the same line the
        // filter+sort should produce.
        const expectedLine = buildBullishRiskRewardText(entryPrice, 97, [102]);
        expect(result.actionRecommendation?.riskReward).toBe(expectedLine);

        // planCheck measures via the same nearest-target-above-price rule, so the two
        // never disagree.
        expect(
            result.actionRecommendation?.planCheck?.riskRewardAtEntry
        ).toBeCloseTo((102 - 100) / (100 - 97));
    });
});

describe('postProcessAnalysisWithReconcile — pattern-geometry targets', () => {
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

    const downPattern: PatternResult = {
        id: 'p1',
        patternName: 'head_and_shoulders',
        skillName: 'head_and_shoulders_skill',
        detected: true,
        trend: 'bearish',
        summary: 'test',
        confidenceWeight: 0.8,
        geometry: {
            breakoutLevel: 140,
            extremeLevel: 150, // height 10, down -> target 130, conservative 135
            direction: 'down',
        },
    };

    const upPattern: PatternResult = {
        id: 'p2',
        patternName: 'rounding_bottom',
        skillName: 'rounding_bottom_skill',
        detected: true,
        trend: 'bullish',
        summary: 'test',
        confidenceWeight: 0.6,
        geometry: {
            breakoutLevel: 100,
            extremeLevel: 85, // height 15, up -> target 115, conservative 107.5
            direction: 'up',
        },
    };

    it('does not store a non-positive target when a down pattern is taller than its breakout level', () => {
        const tall: PatternResult = {
            ...downPattern,
            id: 'p-tall',
            geometry: { breakoutLevel: 5, extremeLevel: 20, direction: 'down' },
        };
        const result = postProcessAnalysisWithReconcile(
            { ...baseResponse, patternSummaries: [tall] },
            undefined,
            undefined
        );
        // height 15: measured 5 − 15 = −10 and conservative 5 − 7.5 = −2.5
        // are not prices, so neither keyPrice is appended.
        expect(result.patternSummaries[0].keyPrices ?? []).toEqual([]);
    });

    it('keeps a positive conservative target when only the measured target is non-positive (per-target guard)', () => {
        const mixed: PatternResult = {
            ...downPattern,
            id: 'p-mixed',
            // height 5: measured 5 − 5 = 0 — exactly zero is not a price
            // (dropped; pins the `> 0` boundary); conservative 5 − 2.5 = 2.5 (kept)
            geometry: { breakoutLevel: 5, extremeLevel: 10, direction: 'down' },
        };
        const result = postProcessAnalysisWithReconcile(
            { ...baseResponse, patternSummaries: [mixed] },
            undefined,
            undefined
        );
        expect(result.patternSummaries[0].keyPrices).toEqual([
            { label: '보수 목표가(50%)', price: 2.5 },
        ]);
    });

    it('down 패턴: measuredTarget = breakout - height, conservative = breakout - height/2', () => {
        const result = postProcessAnalysisWithReconcile(
            { ...baseResponse, patternSummaries: [downPattern] },
            undefined,
            undefined
        );
        expect(result.patternSummaries[0].keyPrices).toEqual([
            { label: '측정 목표가', price: 130 },
            { label: '보수 목표가(50%)', price: 135 },
        ]);
    });

    it('up 패턴: measuredTarget = breakout + height, conservative = breakout + height/2', () => {
        const result = postProcessAnalysisWithReconcile(
            { ...baseResponse, patternSummaries: [upPattern] },
            undefined,
            undefined
        );
        expect(result.patternSummaries[0].keyPrices).toEqual([
            { label: '측정 목표가', price: 115 },
            { label: '보수 목표가(50%)', price: 107.5 },
        ]);
    });

    it('기존 keyPrices는 보존하고 뒤에 덧붙인다', () => {
        const withExisting: PatternResult = {
            ...downPattern,
            keyPrices: [{ label: '넥라인', price: 140 }],
        };
        const result = postProcessAnalysisWithReconcile(
            { ...baseResponse, patternSummaries: [withExisting] },
            undefined,
            undefined
        );
        expect(result.patternSummaries[0].keyPrices).toEqual([
            { label: '넥라인', price: 140 },
            { label: '측정 목표가', price: 130 },
            { label: '보수 목표가(50%)', price: 135 },
        ]);
    });

    it('재처리해도 같은 라벨이 중복되지 않는다 (idempotent)', () => {
        const once = postProcessAnalysisWithReconcile(
            { ...baseResponse, patternSummaries: [downPattern] },
            undefined,
            undefined
        );
        const twice = postProcessAnalysisWithReconcile(
            once,
            undefined,
            undefined
        );
        expect(twice.patternSummaries[0].keyPrices).toEqual([
            { label: '측정 목표가', price: 130 },
            { label: '보수 목표가(50%)', price: 135 },
        ]);
    });

    it('로케일별 라벨을 사용한다', () => {
        const result = postProcessAnalysisWithReconcile(
            { ...baseResponse, patternSummaries: [downPattern] },
            undefined,
            undefined,
            'USD',
            'en'
        );
        expect(result.patternSummaries[0].keyPrices).toEqual([
            { label: 'Measured target', price: 130 },
            { label: 'Conservative target (50%)', price: 135 },
        ]);
    });

    it('rounds binary-float noise off computed targets to the input precision (real-data case)', () => {
        // Seen in a real DeepSeek analysis: 338.34 + (338.34 − 328.35) came out
        // as 348.3299999999999 in the stored keyPrices.
        const channel: PatternResult = {
            ...upPattern,
            id: 'p3',
            patternName: 'Ascending Channel',
            skillName: 'Ascending Channel',
            geometry: {
                breakoutLevel: 338.34,
                extremeLevel: 328.35,
                direction: 'up',
            },
        };
        const result = postProcessAnalysisWithReconcile(
            { ...baseResponse, patternSummaries: [channel] },
            undefined,
            undefined
        );
        const prices = result.patternSummaries[0].keyPrices!.map(k => k.price);
        expect(prices[0]).toBe(348.33);
        // Halving a 2-decimal height needs one more place: 338.34 + 4.995.
        expect(prices[1]).toBe(343.335);
    });

    it('geometry가 없는 패턴은 손대지 않는다', () => {
        const noGeometry: PatternResult = {
            id: 'p3',
            patternName: 'flag',
            skillName: 'flag_skill',
            detected: true,
            trend: 'bullish',
            summary: 'test',
            confidenceWeight: 0.5,
            keyPrices: [{ label: '기존', price: 99 }],
        };
        const result = postProcessAnalysisWithReconcile(
            { ...baseResponse, patternSummaries: [noGeometry] },
            undefined,
            undefined
        );
        expect(result.patternSummaries[0]).toEqual(noGeometry);
    });

    it('patternSummaries에 geometry가 하나도 없으면 원본 참조를 그대로 반환한다', () => {
        const result = postProcessAnalysisWithReconcile(
            baseResponse,
            undefined,
            undefined
        );
        expect(result).toBe(baseResponse);
    });
});

describe('exit text currency', () => {
    // 실측 회귀: 원화 종목 20건 중 19건이 `목표가 $143025.73 ... 손절 $121980.70`
    // 형태로 나왔다. 단위가 틀렸고(달러 아님), 원화에 없는 소수 정밀도를 주장한다.
    it('formats KRW levels as won at the KRX tick, not dollars', () => {
        const text = buildBullishExitText(
            131000,
            121980.69948682484,
            [143025.73401756687],
            'KRW',
            'share'
        );

        // 50,000–200,000원 구간의 호가 단위는 100원이다.
        expect(text).toContain('목표가 143,000원');
        expect(text).toContain('손절 122,000원');
        expect(text).not.toContain('$');
        expect(text).not.toContain('.7');
    });

    it('keeps the pre-existing dollar format for USD', () => {
        // 이 인자가 생기기 전 출력과 바이트 단위로 같아야 한다.
        expect(buildBullishExitText(100, 97, [105], 'USD', 'share')).toBe(
            '목표가 $105.00 (+5.0%)에서 익절, 손절 $97.00 (-3.0%).'
        );
    });

    it('applies the currency to every target in a multi-target exit', () => {
        const text = buildBullishExitText(
            100000,
            95000,
            [110000, 120000],
            'KRW',
            'share'
        );

        expect(text).toContain('1차 목표 110,000원');
        expect(text).toContain('2차 목표 120,000원');
        expect(text).not.toContain('$');
    });

    it('threads currency from postProcessAnalysisWithReconcile', () => {
        // SL/TP 둘 다 없어 fallback 경로를 타야 reconciledLevels가 생긴다.
        const response = {
            patternSummaries: [],
            actionRecommendation: {
                entryRecommendation: 'enter',
                entryPrices: [100000],
            },
        } as unknown as Parameters<typeof postProcessAnalysisWithReconcile>[0];

        const out = postProcessAnalysisWithReconcile(
            response,
            100000,
            2000,
            'KRW'
        );

        expect(out.actionRecommendation?.reconciledLevels?.exit).not.toContain(
            '$'
        );
        expect(out.actionRecommendation?.reconciledLevels?.exit).toContain(
            '원'
        );
    });
});

describe('KRX ETF/ETN tick table', () => {
    const fallbackResponse = {
        patternSummaries: [],
        actionRecommendation: {
            entryRecommendation: 'enter',
            entryPrices: [40_000],
        },
    } as unknown as Parameters<typeof postProcessAnalysisWithReconcile>[0];

    it('formats exit levels at the 5-won ETP tick instead of the 50-won share tick', () => {
        const etp = buildBullishExitText(
            40_000,
            38_123,
            [42_123],
            'KRW',
            'etp'
        );
        const share = buildBullishExitText(
            40_000,
            38_123,
            [42_123],
            'KRW',
            'share'
        );
        expect(etp).toContain('목표가 42,125원');
        expect(etp).toContain('손절 38,125원');
        expect(share).toContain('목표가 42,100원');
        expect(share).toContain('손절 38,100원');
    });

    it('rounds the ATR fallback levels to the ETP tick, and to the share tick by default', () => {
        const etp = postProcessAnalysisWithReconcile(
            fallbackResponse,
            40_000,
            123,
            'KRW',
            undefined,
            'etp'
        ).actionRecommendation?.reconciledLevels;
        const share = postProcessAnalysisWithReconcile(
            fallbackResponse,
            40_000,
            123,
            'KRW'
        ).actionRecommendation?.reconciledLevels;

        const etpLevels = [etp!.stopLoss!, ...etp!.takeProfitPrices!];
        const shareLevels = [share!.stopLoss!, ...share!.takeProfitPrices!];
        expect(etpLevels.filter(n => n % 5 !== 0)).toEqual([]);
        expect(etpLevels.filter(n => n % 50 !== 0).length).toBeGreaterThan(0);
        expect(shareLevels.filter(n => n % 50 !== 0)).toEqual([]);
    });

    it('ignores the table for a non-KRW listing', () => {
        expect(
            postProcessAnalysisWithReconcile(
                fallbackResponse,
                100,
                2.37,
                'USD',
                undefined,
                'etp'
            )
        ).toEqual(
            postProcessAnalysisWithReconcile(fallbackResponse, 100, 2.37, 'USD')
        );
    });
});

describe('buildBullishExitText 서브달러 정밀도', () => {
    it('$1 미만 가격은 유효숫자 4자리로 표기한다', () => {
        const text = buildBullishExitText(
            0.0835,
            0.0825,
            [0.0852],
            'USD',
            'share'
        );
        expect(text).toContain('$0.08520');
        expect(text).toContain('$0.08250');
        expect(text).not.toContain('$0.08 ');
    });

    it('$1 이상 가격은 기존 2자리 표기를 유지한다', () => {
        const text = buildBullishExitText(100, 95, [110], 'USD', 'share');
        expect(text).toContain('$110.00');
        expect(text).toContain('$95.00');
    });
});
