import { describe, it, expect } from 'vitest';
import {
    normalizeTrend,
    normalizeRiskLevel,
    normalizeKeyLevel,
    normalizeKeyLevels,
    normalizePriceTarget,
    normalizePriceScenario,
    normalizePriceTargets,
    normalizeSignal,
    normalizeIndicatorGuideResult,
    normalizeKeyPrice,
    normalizeTrendlinePoint,
    normalizeTrendline,
    normalizePatternSummary,
    normalizePatternGeometry,
    normalizeStrategyResult,
    normalizeCandlePatternSummary,
    normalizeActionRecommendation,
    normalizeIdList,
    normalizeChartOverlay,
} from '@/domain/analysis/normalize';
import { postProcessAnalysisWithReconcile } from '@/domain/analysis/ai-levels';
import type { ActionRecommendation, AnalysisResponse } from '@/domain/types';

describe('normalizeTrend', () => {
    it('유효한 trend 값을 반환한다', () => {
        expect(normalizeTrend('bullish')).toBe('bullish');
        expect(normalizeTrend('bearish')).toBe('bearish');
        expect(normalizeTrend('neutral')).toBe('neutral');
    });

    it('유효하지 않은 값이면 neutral을 반환한다', () => {
        expect(normalizeTrend('unknown')).toBe('neutral');
        expect(normalizeTrend(null)).toBe('neutral');
        expect(normalizeTrend(undefined)).toBe('neutral');
    });
});

describe('normalizeRiskLevel', () => {
    it('유효한 riskLevel 값을 반환한다', () => {
        expect(normalizeRiskLevel('low')).toBe('low');
        expect(normalizeRiskLevel('medium')).toBe('medium');
        expect(normalizeRiskLevel('high')).toBe('high');
    });

    it('유효하지 않은 값이면 medium을 반환한다', () => {
        expect(normalizeRiskLevel('invalid')).toBe('medium');
        expect(normalizeRiskLevel(null)).toBe('medium');
    });
});

describe('normalizeKeyLevel', () => {
    it('price가 있으면 KeyLevel을 반환한다', () => {
        const result = normalizeKeyLevel({ price: 100, reason: 'support' });
        expect(result).toEqual({ price: 100, reason: 'support' });
    });

    it('price가 없으면 null을 반환한다', () => {
        expect(normalizeKeyLevel({ reason: 'support' })).toBeNull();
    });

    it('null/undefined이면 null을 반환한다', () => {
        expect(normalizeKeyLevel(null)).toBeNull();
        expect(normalizeKeyLevel(undefined)).toBeNull();
    });
});

describe('normalizeKeyLevels', () => {
    it('support와 resistance 배열을 반환한다', () => {
        const result = normalizeKeyLevels({
            support: [{ price: 100, reason: 'low' }],
            resistance: [{ price: 110, reason: 'high' }],
        });

        expect(result.support).toHaveLength(1);
        expect(result.resistance).toHaveLength(1);
    });

    it('null/undefined이면 빈 배열을 반환한다', () => {
        const result = normalizeKeyLevels(null);
        expect(result.support).toHaveLength(0);
        expect(result.resistance).toHaveLength(0);
    });

    it('support 배열의 무효 원소(null/비객체/price 없음)는 걸러내고 유효한 것만 남긴다', () => {
        const result = normalizeKeyLevels({
            support: [
                { price: 100, reason: 'a' },
                null,
                'bad',
                { reason: 'no price' },
            ],
        });
        expect(result.support).toEqual([{ price: 100, reason: 'a' }]);
    });

    it('support/resistance가 배열이 아니면(문자열 등) 빈 배열로 정규화한다', () => {
        const result = normalizeKeyLevels({
            support: 'wrong',
            resistance: 42,
        });
        expect(result.support).toEqual([]);
        expect(result.resistance).toEqual([]);
    });

    it('poc의 price가 없으면 poc는 undefined가 된다', () => {
        const result = normalizeKeyLevels({ poc: { reason: 'no price' } });
        expect(result.poc).toBeUndefined();
    });
});

describe('normalizePriceTarget', () => {
    it('price가 있으면 PriceTarget을 반환한다', () => {
        const result = normalizePriceTarget({
            price: 100,
            basis: 'resistance',
        });
        expect(result).toEqual({ price: 100, basis: 'resistance' });
    });

    it('price가 없으면 null을 반환한다', () => {
        expect(normalizePriceTarget({ basis: 'test' })).toBeNull();
    });
});

describe('normalizePriceScenario', () => {
    it('유효한 PriceScenario를 반환한다', () => {
        const result = normalizePriceScenario({
            targets: [{ price: 100, condition: '' }],
            condition: 'bullish',
        });
        expect(result).toBeDefined();
        expect(result!.targets).toHaveLength(1);
    });

    it('null이면 null을 반환한다', () => {
        expect(normalizePriceScenario(null)).toBeNull();
    });
});

describe('normalizePriceTargets', () => {
    it('bullish와 bearish를 반환한다', () => {
        const result = normalizePriceTargets({
            bullish: { targets: [], condition: '' },
            bearish: { targets: [], condition: '' },
        });
        expect(result).toBeDefined();
    });

    it('null이면 null PriceTargets를 반환한다', () => {
        const result = normalizePriceTargets(null);
        expect(result.bullish).toBeNull();
        expect(result.bearish).toBeNull();
    });
});

describe('normalizeSignal', () => {
    it('유효한 AnalysisSignal을 반환한다', () => {
        const result = normalizeSignal({
            strength: 'strong',
            trend: 'bullish',
            description: 'RSI below 30',
        });
        expect(result).toBeDefined();
        expect(result!.type).toBe('skill');
        expect(result!.description).toBe('RSI below 30');
    });

    it('null이면 null을 반환한다', () => {
        expect(normalizeSignal(null)).toBeNull();
    });

    it('trend가 유효하지 않으면 neutral, strength가 유효하지 않으면 undefined가 된다', () => {
        const result = normalizeSignal({
            description: 'd',
            trend: 'sideways',
            strength: 'ultra',
        });
        expect(result?.trend).toBe('neutral');
        expect(result?.strength).toBeUndefined();
    });
});

describe('normalizeIndicatorGuideResult', () => {
    it('유효한 IndicatorGuideResult를 반환한다', () => {
        const result = normalizeIndicatorGuideResult({
            indicatorName: 'RSI',
            signals: [],
        });
        expect(result).not.toBeNull();
        expect(result!.indicatorName).toBe('RSI');
    });

    it('null이면 null을 반환한다', () => {
        expect(normalizeIndicatorGuideResult(null)).toBeNull();
    });
});

describe('normalizeKeyPrice', () => {
    it('price가 있으면 KeyPrice를 반환한다', () => {
        const result = normalizeKeyPrice({ price: 150, label: 'entry' });
        expect(result).toEqual({ price: 150, label: 'entry' });
    });

    it('price가 없으면 null을 반환한다', () => {
        expect(normalizeKeyPrice({ label: 'entry' })).toBeNull();
    });
});

describe('normalizeTrendlinePoint', () => {
    it('time과 price가 있으면 TrendlinePoint를 반환한다', () => {
        const result = normalizeTrendlinePoint({ time: 1000, price: 100 });
        expect(result).toEqual({ time: 1000, price: 100 });
    });

    it('time이 없으면 null을 반환한다', () => {
        expect(normalizeTrendlinePoint({ price: 100 })).toBeNull();
    });
});

describe('normalizeTrendline', () => {
    it('유효한 Trendline을 반환한다', () => {
        const result = normalizeTrendline({
            direction: 'ascending',
            start: { time: 1000, price: 100 },
            end: { time: 2000, price: 110 },
        });
        expect(result).toBeDefined();
        expect(result!.direction).toBe('ascending');
    });

    it('null이면 null을 반환한다', () => {
        expect(normalizeTrendline(null)).toBeNull();
    });
});

describe('normalizePatternSummary', () => {
    it('유효한 패턴 요약을 반환한다', () => {
        const result = normalizePatternSummary({
            patternName: 'Head and Shoulders',
            skillName: 'head_and_shoulders_skill',
            detected: true,
            trend: 'bearish',
            summary: 'Reversal pattern detected',
        });
        expect(result).not.toBeNull();
        expect(result!.patternName).toBe('Head and Shoulders');
        expect(result!.skillName).toBe('head_and_shoulders_skill');
    });

    it('null이면 null을 반환한다', () => {
        expect(normalizePatternSummary(null)).toBeNull();
    });

    it('patternName 또는 skillName이 비어 있으면 null을 반환한다', () => {
        expect(normalizePatternSummary({ patternName: 'X' })).toBeNull();
        expect(normalizePatternSummary({ skillName: 'Y' })).toBeNull();
    });

    it('keyPrices 키가 없거나 배열이 아니면 [] 아닌 undefined가 된다', () => {
        // 소스는 `Array.isArray(...) ? compact(...) : undefined` 이므로
        // 누락/비배열은 빈 배열이 아니라 undefined로 구분된다.
        const missing = normalizePatternSummary({
            patternName: 'X',
            skillName: 'Y',
        });
        expect(missing?.keyPrices).toBeUndefined();

        const nonArray = normalizePatternSummary({
            patternName: 'X',
            skillName: 'Y',
            keyPrices: 'notarray',
        });
        expect(nonArray?.keyPrices).toBeUndefined();
    });

    it('keyPrices 배열의 무효 원소를 걸러내고 유효한 KeyPrice만 남긴다', () => {
        const result = normalizePatternSummary({
            patternName: 'X',
            skillName: 'Y',
            keyPrices: [{ price: 100, label: 'a' }, null, 'bad', {}],
        });
        expect(result?.keyPrices).toEqual([{ label: 'a', price: 100 }]);
    });

    it('유효한 geometry를 그대로 전달한다', () => {
        const result = normalizePatternSummary({
            patternName: 'X',
            skillName: 'Y',
            geometry: {
                breakoutLevel: 140,
                extremeLevel: 150,
                direction: 'down',
                invalidationLevel: 148,
            },
        });
        expect(result?.geometry).toEqual({
            breakoutLevel: 140,
            extremeLevel: 150,
            direction: 'down',
            invalidationLevel: 148,
        });
    });

    it('geometry가 없으면 undefined', () => {
        const result = normalizePatternSummary({
            patternName: 'X',
            skillName: 'Y',
        });
        expect(result?.geometry).toBeUndefined();
    });

    it('candidateId(spec 2026-09-28)가 비어있지 않은 문자열이면 그대로 전달한다', () => {
        const result = normalizePatternSummary({
            patternName: 'X',
            skillName: 'Y',
            candidateId: 'pattern:double_top:1714521600',
        });
        expect(result?.candidateId).toBe('pattern:double_top:1714521600');
    });

    it('candidateId가 없거나 빈 문자열이면 undefined', () => {
        expect(
            normalizePatternSummary({ patternName: 'X', skillName: 'Y' })
                ?.candidateId
        ).toBeUndefined();
        expect(
            normalizePatternSummary({
                patternName: 'X',
                skillName: 'Y',
                candidateId: '',
            })?.candidateId
        ).toBeUndefined();
    });
});

describe('normalizePatternGeometry (spec 2026-09-18 §A6)', () => {
    it('down 방향: extremeLevel > breakoutLevel이면 통과한다', () => {
        const result = normalizePatternGeometry({
            breakoutLevel: 140,
            extremeLevel: 150,
            direction: 'down',
        });
        expect(result).toEqual({
            breakoutLevel: 140,
            extremeLevel: 150,
            direction: 'down',
        });
    });

    it('up 방향: extremeLevel < breakoutLevel이면 통과한다', () => {
        const result = normalizePatternGeometry({
            breakoutLevel: 100,
            extremeLevel: 85,
            direction: 'up',
        });
        expect(result).toEqual({
            breakoutLevel: 100,
            extremeLevel: 85,
            direction: 'up',
        });
    });

    it('invalidationLevel이 유효하면 함께 전달한다', () => {
        const result = normalizePatternGeometry({
            breakoutLevel: 100,
            extremeLevel: 85,
            direction: 'up',
            invalidationLevel: 90,
        });
        expect(result?.invalidationLevel).toBe(90);
    });

    it('invalidationLevel이 null이면 생략(제공 안 한 것으로 취급)한다', () => {
        const result = normalizePatternGeometry({
            breakoutLevel: 100,
            extremeLevel: 85,
            direction: 'up',
            invalidationLevel: null,
        });
        expect(result).toEqual({
            breakoutLevel: 100,
            extremeLevel: 85,
            direction: 'up',
        });
    });

    it('invalidationLevel이 0/음수/비유한이면 geometry 전체를 버린다', () => {
        expect(
            normalizePatternGeometry({
                breakoutLevel: 100,
                extremeLevel: 85,
                direction: 'up',
                invalidationLevel: 0,
            })
        ).toBeUndefined();
        expect(
            normalizePatternGeometry({
                breakoutLevel: 100,
                extremeLevel: 85,
                direction: 'up',
                invalidationLevel: -5,
            })
        ).toBeUndefined();
        expect(
            normalizePatternGeometry({
                breakoutLevel: 100,
                extremeLevel: 85,
                direction: 'up',
                invalidationLevel: Number.NaN,
            })
        ).toBeUndefined();
    });

    it('방향과 일관되지 않은 geometry(down인데 extreme < breakout)는 버린다', () => {
        expect(
            normalizePatternGeometry({
                breakoutLevel: 150,
                extremeLevel: 140,
                direction: 'down',
            })
        ).toBeUndefined();
    });

    it('방향과 일관되지 않은 geometry(up인데 extreme > breakout)는 버린다', () => {
        expect(
            normalizePatternGeometry({
                breakoutLevel: 100,
                extremeLevel: 110,
                direction: 'up',
            })
        ).toBeUndefined();
    });

    it('breakoutLevel/extremeLevel이 0이거나 음수면 버린다', () => {
        expect(
            normalizePatternGeometry({
                breakoutLevel: 0,
                extremeLevel: 10,
                direction: 'up',
            })
        ).toBeUndefined();
        expect(
            normalizePatternGeometry({
                breakoutLevel: -100,
                extremeLevel: -90,
                direction: 'up',
            })
        ).toBeUndefined();
    });

    it('breakoutLevel/extremeLevel이 비유한(NaN)이면 버린다', () => {
        expect(
            normalizePatternGeometry({
                breakoutLevel: Number.NaN,
                extremeLevel: 10,
                direction: 'up',
            })
        ).toBeUndefined();
    });

    it('direction이 유효한 enum이 아니면 버린다', () => {
        expect(
            normalizePatternGeometry({
                breakoutLevel: 100,
                extremeLevel: 90,
                direction: 'sideways',
            })
        ).toBeUndefined();
    });

    it('null/객체가 아니면 undefined', () => {
        expect(normalizePatternGeometry(null)).toBeUndefined();
        expect(normalizePatternGeometry('not an object')).toBeUndefined();
        expect(normalizePatternGeometry(undefined)).toBeUndefined();
    });
});

describe('normalizeStrategyResult', () => {
    it('유효한 StrategyResult를 반환한다', () => {
        const result = normalizeStrategyResult({
            strategyName: 'Breakout',
            trend: 'bullish',
            summary: 'Price breaks resistance',
        });
        expect(result).not.toBeNull();
        expect(result!.strategyName).toBe('Breakout');
    });

    it('null이면 null을 반환한다', () => {
        expect(normalizeStrategyResult(null)).toBeNull();
    });

    it('candidateIds(spec 2026-09-28)가 배열이면 비문자열/빈문자열을 걸러 전달한다', () => {
        const result = normalizeStrategyResult({
            strategyName: 'Breakout',
            trend: 'bullish',
            summary: 'x',
            candidateIds: ['ew:up:1:6', '', 42, null, 'ew:up:2:5'],
        });
        expect(result?.candidateIds).toEqual(['ew:up:1:6', 'ew:up:2:5']);
    });

    it('candidateIds가 배열이 아니면 undefined', () => {
        const result = normalizeStrategyResult({
            strategyName: 'Breakout',
            trend: 'bullish',
            summary: 'x',
        });
        expect(result?.candidateIds).toBeUndefined();
    });
});

describe('normalizeCandlePatternSummary', () => {
    it('유효한 CandlePatternSummary를 반환한다', () => {
        const result = normalizeCandlePatternSummary({
            patternName: 'Doji',
            detected: false,
            trend: 'neutral',
            summary: 'Indecision',
        });
        expect(result).not.toBeNull();
        expect(result!.patternName).toBe('Doji');
    });

    it('null이면 null을 반환한다', () => {
        expect(normalizeCandlePatternSummary(null)).toBeNull();
    });
});

describe('normalizeActionRecommendation', () => {
    it('유효한 ActionRecommendation을 반환한다', () => {
        const result = normalizeActionRecommendation({
            entryRecommendation: 'enter',
            entryPrices: [100],
            stopLoss: 95,
            takeProfitPrices: [110],
            positionAnalysis: 'bullish setup',
            entry: 'buy at 100',
            exit: 'sell at 110',
            riskReward: '1:2',
        });
        expect(result).toBeDefined();
        expect(result!.entryRecommendation).toBe('enter');
    });

    it('텍스트 필드가 모두 비어있으면 undefined를 반환한다', () => {
        expect(normalizeActionRecommendation(null)).toBeUndefined();
    });

    it('숫자 필드만 있고 텍스트 4개 필드가 모두 비면 undefined를 반환한다', () => {
        // The 4 text fields are the presence signal; numeric fields alone are
        // treated as "no recommendation" per the source contract.
        expect(
            normalizeActionRecommendation({
                entryPrices: [100],
                stopLoss: 95,
                takeProfitPrices: [110],
            })
        ).toBeUndefined();
    });

    it('entryPrices 배열의 비유한·비숫자 원소를 걸러내고 유한 숫자만 남긴다', () => {
        const result = normalizeActionRecommendation({
            entry: 'buy',
            entryPrices: [100, 'x', NaN, null, Infinity, -Infinity, 110],
            takeProfitPrices: [120, {}, 130],
        });
        expect(result?.entryPrices).toEqual([100, 110]);
        expect(result?.takeProfitPrices).toEqual([120, 130]);
    });

    it('entryPrices/takeProfitPrices가 배열이 아니면 undefined가 된다', () => {
        const result = normalizeActionRecommendation({
            entry: 'buy',
            entryPrices: 42,
            takeProfitPrices: 'nope',
        });
        expect(result?.entryPrices).toBeUndefined();
        expect(result?.takeProfitPrices).toBeUndefined();
    });

    it('stopLoss가 비유한 숫자(NaN/Infinity)이면 undefined가 된다', () => {
        const result = normalizeActionRecommendation({
            entry: 'buy',
            stopLoss: Infinity,
        });
        expect(result?.stopLoss).toBeUndefined();
    });

    describe('planCheck', () => {
        // `postProcessAnalysisWithReconcile`이 attach하는 실제 AnalysisResponse/
        // ActionRecommendation 픽스처. 손으로 만든 planCheck 원시 객체가 아니라
        // 실제 도메인 함수의 산출물을 다시 normalizeActionRecommendation에 통과시켜야
        // "카피가 필드 하나를 빠뜨렸다"는 이번 버그의 실패 모드를 잡는다.
        const baseResponse: AnalysisResponse = {
            summary: 'test',
            trend: 'bullish',
            indicatorResults: [],
            riskLevel: 'low',
            keyLevels: { support: [], resistance: [] },
            priceTargets: { bullish: null, bearish: null },
            patternSummaries: [],
            strategyResults: [],
            candlePatterns: [],
            trendlines: [],
        };
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

        it('postProcessAnalysisWithReconcile이 실제로 붙인 planCheck를 라운드트립 후에도 deep-equal로 보존한다', () => {
            const withPlanCheck = postProcessAnalysisWithReconcile(
                { ...baseResponse, actionRecommendation: baseRec },
                100,
                2
            );
            const attached = withPlanCheck.actionRecommendation?.planCheck;
            expect(attached).toBeDefined();

            const renormalized = normalizeActionRecommendation(
                withPlanCheck.actionRecommendation
            );
            expect(renormalized?.planCheck).toEqual(attached);
        });

        it('riskRewardAtCurrent: 0은 살아남는다 (0=타깃 소진, null=계산 불가는 다른 의미)', () => {
            const result = normalizeActionRecommendation({
                entry: 'buy',
                planCheck: {
                    currentPrice: 100,
                    entryZoneTop: 100,
                    exceedsEntryZone: false,
                    belowStopLoss: false,
                    riskRewardAtEntry: null,
                    riskRewardAtCurrent: 0,
                },
            });
            expect(result?.planCheck?.riskRewardAtCurrent).toBe(0);
        });

        it('비율/entryZoneTop 필드가 비유한이면 null이 된다', () => {
            const result = normalizeActionRecommendation({
                entry: 'buy',
                planCheck: {
                    currentPrice: 100,
                    entryZoneTop: Number.NaN,
                    exceedsEntryZone: false,
                    belowStopLoss: false,
                    riskRewardAtEntry: Number.NaN,
                    riskRewardAtCurrent: Infinity,
                },
            });
            expect(result?.planCheck?.entryZoneTop).toBeNull();
            expect(result?.planCheck?.riskRewardAtEntry).toBeNull();
            expect(result?.planCheck?.riskRewardAtCurrent).toBeNull();
        });

        it('currentPrice가 없거나 유한 양수가 아니면 planCheck 전체를 버린다', () => {
            const withoutCurrentPrice = normalizeActionRecommendation({
                entry: 'buy',
                planCheck: {
                    entryZoneTop: 100,
                    exceedsEntryZone: false,
                    belowStopLoss: false,
                    riskRewardAtEntry: 1,
                    riskRewardAtCurrent: 1,
                },
            });
            expect(withoutCurrentPrice?.planCheck).toBeUndefined();

            const zeroCurrentPrice = normalizeActionRecommendation({
                entry: 'buy',
                planCheck: {
                    currentPrice: 0,
                    exceedsEntryZone: false,
                    belowStopLoss: false,
                    riskRewardAtEntry: null,
                    riskRewardAtCurrent: null,
                },
            });
            expect(zeroCurrentPrice?.planCheck).toBeUndefined();

            const negativeCurrentPrice = normalizeActionRecommendation({
                entry: 'buy',
                planCheck: {
                    currentPrice: -5,
                    exceedsEntryZone: false,
                    belowStopLoss: false,
                    riskRewardAtEntry: null,
                    riskRewardAtCurrent: null,
                },
            });
            expect(negativeCurrentPrice?.planCheck).toBeUndefined();
        });

        it('exceedsEntryZone/belowStopLoss가 boolean이 아니면 false가 된다', () => {
            const result = normalizeActionRecommendation({
                entry: 'buy',
                planCheck: {
                    currentPrice: 100,
                    entryZoneTop: null,
                    exceedsEntryZone: 'yes',
                    belowStopLoss: 1,
                    riskRewardAtEntry: null,
                    riskRewardAtCurrent: null,
                },
            });
            expect(result?.planCheck?.exceedsEntryZone).toBe(false);
            expect(result?.planCheck?.belowStopLoss).toBe(false);
        });

        it('LLM 원본 출력처럼 planCheck가 없으면 결과 객체에 키 자체가 생기지 않는다', () => {
            const result = normalizeActionRecommendation({
                positionAnalysis: 'p',
                entry: 'e',
                exit: 'x',
                riskReward: 'r',
            });
            expect(result?.planCheck).toBeUndefined();
            expect(result && 'planCheck' in result).toBe(false);
        });
    });
});

describe('normalizeIdList (spec 2026-09-28)', () => {
    it('non-array 값이면 []', () => {
        expect(normalizeIdList(null)).toEqual([]);
        expect(normalizeIdList('not-an-array')).toEqual([]);
    });

    it('빈 문자열/문자열 아닌 원소를 걸러낸다', () => {
        expect(normalizeIdList(['a', '', 1, null, 'b'])).toEqual(['a', 'b']);
    });
});

describe('normalizeChartOverlay (spec 2026-09-28)', () => {
    const validOverlay = {
        id: 'pattern:double_top:1714521600',
        kind: 'pattern',
        skill: 'double_top',
        sourceRef: 'double_top_0',
        variant: 'primary',
        segments: [
            {
                from: { time: 1, price: 10 },
                to: { time: 5, price: 12 },
                role: 'pattern',
                style: 'solid',
                pane: 'price',
            },
        ],
        levels: [{ price: 11, fromTime: 5, label: 'breakout' }],
        labels: [],
    };

    it('정상 형태를 그대로 통과시킨다', () => {
        const result = normalizeChartOverlay(validOverlay);
        expect(result).toEqual(validOverlay);
    });

    it('kind가 유효 집합 밖이면 null', () => {
        expect(
            normalizeChartOverlay({ ...validOverlay, kind: 'bogus' })
        ).toBeNull();
    });

    it('segments도 levels도 없으면 null', () => {
        expect(
            normalizeChartOverlay({ ...validOverlay, segments: [], levels: [] })
        ).toBeNull();
    });

    it('id가 없거나 객체가 아니면 null', () => {
        expect(normalizeChartOverlay(null)).toBeNull();
        expect(normalizeChartOverlay({ ...validOverlay, id: 42 })).toBeNull();
    });

    it('variant가 alternate가 아니면 primary로 정규화한다', () => {
        expect(
            normalizeChartOverlay({ ...validOverlay, variant: 'bogus' })
                ?.variant
        ).toBe('primary');
    });

    it('옛 캐시의 patternLines 같은 낯선 필드는 조용히 무시한다', () => {
        const result = normalizeChartOverlay({
            ...validOverlay,
            patternLines: [{ points: [] }],
            timeRange: { start: 1, end: 5 },
        });
        expect(result).toEqual(validOverlay);
    });
});
