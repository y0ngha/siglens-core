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
    normalizePatternLine,
    normalizeTimeRange,
    normalizeTrendline,
    normalizePatternSummary,
    normalizeStrategyResult,
    normalizeCandlePatternSummary,
    normalizeActionRecommendation,
} from '@/domain/analysis/normalize';

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

describe('normalizePatternLine', () => {
    it('유효한 PatternLine을 반환한다', () => {
        const result = normalizePatternLine({
            start: { time: 1000, price: 100 },
            end: { time: 2000, price: 110 },
        });
        expect(result).toBeDefined();
    });

    it('null이면 null을 반환한다', () => {
        expect(normalizePatternLine(null)).toBeNull();
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
});

describe('normalizeTimeRange', () => {
    it('유효한 start와 end를 가진 객체를 반환한다', () => {
        const result = normalizeTimeRange({ start: 1000, end: 2000 });
        expect(result).toEqual({ start: 1000, end: 2000 });
    });

    it('null이면 undefined를 반환한다', () => {
        expect(normalizeTimeRange(null)).toBeUndefined();
    });

    it('객체가 아닌 값이면 undefined를 반환한다', () => {
        expect(normalizeTimeRange('invalid')).toBeUndefined();
        expect(normalizeTimeRange(42)).toBeUndefined();
        expect(normalizeTimeRange([])).toBeUndefined();
    });

    it('start가 없으면 undefined를 반환한다', () => {
        expect(normalizeTimeRange({ end: 2000 })).toBeUndefined();
    });

    it('end가 없으면 undefined를 반환한다', () => {
        expect(normalizeTimeRange({ start: 1000 })).toBeUndefined();
    });

    it('start 또는 end가 숫자가 아닌 타입이면 undefined를 반환한다', () => {
        expect(normalizeTimeRange({ start: 'abc', end: 2000 })).toBeUndefined();
        expect(normalizeTimeRange({ start: 1000, end: null })).toBeUndefined();
    });
});
