import { describe, it, expect } from 'vitest';
import {
    isValidBullishStopLoss,
    isValidBullishTakeProfit,
    deriveFallbackTakeProfit,
    resolveBullishStopLoss,
    isStopBandEmpty,
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
import { PLAN_MIN_ATR_SPACING } from '@/domain/analysis/planCheck';
import { ceilToKrxTick, roundToKrxTick } from '@/domain/analysis/krxTick';
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

    it('SL이 진입 구간 하단 이상이면 중앙값 아래여도 무효하다', () => {
        expect(isValidBullishStopLoss(98, entryPrice, atr, 96)).toBe(false);
        expect(isValidBullishStopLoss(96, entryPrice, atr, 96)).toBe(false);
        expect(isValidBullishStopLoss(95.9, entryPrice, atr, 96)).toBe(true);
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

describe('isValidBullishTakeProfit — 진입 구간 상단', () => {
    it('TP가 진입 구간 상단 이하면 중앙값 위여도 무효하다', () => {
        expect(isValidBullishTakeProfit(103, entryPrice, atr, 104)).toBe(false);
        expect(isValidBullishTakeProfit(104, entryPrice, atr, 104)).toBe(false);
        expect(isValidBullishTakeProfit(104.1, entryPrice, atr, 104)).toBe(
            true
        );
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

describe('resolveBullishStopLoss — the stop floor', () => {
    // Zone [98, 102] around a mid of 100, ATR 2: the allowed band is [90, 96].
    const mid = 100;
    const low = 98;
    const none: readonly number[] = [];
    const identity = (price: number): number => price;
    const resolve = (
        aiValue: number | undefined,
        candidates: readonly number[] = none,
        quote: (price: number) => number = identity
    ) => resolveBullishStopLoss(aiValue, mid, atr, low, candidates, quote);
    const floorLow = mid - SL_MAX_ATR_MULTIPLIER * atr;
    const floorHigh = low - PLAN_MIN_ATR_SPACING * atr;

    it('keeps the model stop inside the band (basis model)', () => {
        expect(resolve(95)).toEqual({
            value: 95,
            source: 'ai',
            basis: 'model',
        });
    });

    it('accepts both band edges exactly and rejects a hair outside them', () => {
        expect(resolve(floorHigh).basis).toBe('model');
        expect(resolve(floorLow).basis).toBe('model');
        expect(resolve(floorHigh + 0.01).basis).toBe('atr');
        expect(resolve(floorLow - 0.01).basis).toBe('atr');
    });

    it('moves a stop closer than one ATR to the highest printed support in the band (basis level)', () => {
        // 97.5 is inside the one-ATR gap, 85 beyond the 5-ATR cap; 94 beats 92.
        const result = resolve(97, [92, 94, 97.5, 85]);
        expect(result).toEqual({
            value: 94,
            source: 'fallback',
            basis: 'level',
        });
    });

    it('stores the printed price as the level stop and decides on it (raw outside the band, printed inside)', () => {
        // Zone low 81.2212, ATR 2: the ceiling is 79.2212. The printed 79.22 is inside it.
        const result = resolveBullishStopLoss(
            undefined,
            85,
            atr,
            81.2212,
            [79.22],
            identity
        );
        expect(result).toEqual({
            value: 79.22,
            source: 'fallback',
            basis: 'level',
        });
        // A printed 79.23 is outside the same ceiling: no level, the ATR fallback instead.
        expect(
            resolveBullishStopLoss(
                undefined,
                85,
                atr,
                81.2212,
                [79.23],
                identity
            ).basis
        ).toBe('atr');
    });

    it('takes a candidate exactly on either band edge', () => {
        expect(resolve(97, [floorHigh]).value).toBe(floorHigh);
        expect(resolve(97, [floorLow]).value).toBe(floorLow);
    });

    it('falls back to 1.5 ATR below the zone low when no printed support is in the band (basis atr)', () => {
        const result = resolve(97, [97.5, 85]);
        expect(result).toEqual({
            value: low - SL_FALLBACK_ATR_MULTIPLIER * atr,
            source: 'fallback',
            basis: 'atr',
        });
    });

    it('measures the fallback from the zone low, not the zone mid', () => {
        // The old rule took the mid-based value 100 - 3 = 97, inside a wide zone.
        expect(resolve(undefined).value).toBe(95);
    });

    it('treats a missing stop like a too-close one', () => {
        expect(resolve(undefined, [94]).basis).toBe('level');
        expect(resolve(undefined).basis).toBe('atr');
    });

    it('replaces a stop beyond the five-ATR cap', () => {
        expect(resolve(80, [93]).value).toBe(93);
        expect(resolve(80).basis).toBe('atr');
    });

    it('replaces a stop above the zone low and a non-positive one', () => {
        expect(resolve(99).basis).toBe('atr');
        expect(resolve(0).basis).toBe('atr');
        expect(resolve(Number.NaN).basis).toBe('atr');
    });

    it('ignores candidates that are not finite positive prices', () => {
        expect(
            resolve(97, [Number.NaN, -3, 0, Number.POSITIVE_INFINITY, 93])
        ).toEqual({ value: 93, source: 'fallback', basis: 'level' });
    });

    describe('the fallback respects the five-ATR cap; an empty band leaves no stop', () => {
        const atr1 = 1;
        // Zone [low, 2 x mid - low]: half-width h puts the mid h ATR above the low.
        const zone = (halfWidth: number) => ({
            low: 100 - halfWidth,
            mid: 100,
        });
        const run = (halfWidth: number) => {
            const { low, mid } = zone(halfWidth);
            return resolveBullishStopLoss(
                undefined,
                mid,
                atr1,
                low,
                [],
                identity
            );
        };

        it('half-width 3.5 ATR: 1.5 ATR below the low is exactly the cap, so it stands', () => {
            expect(run(3.5)).toEqual({
                value: 100 - 3.5 - SL_FALLBACK_ATR_MULTIPLIER,
                source: 'fallback',
                basis: 'atr',
            });
        });

        it('half-width 4 ATR: the band is the single price one ATR below the low', () => {
            // mid - 5 = low - 1: the clamp lifts 1.5 ATR below the low up to the cap.
            expect(run(4)).toEqual({
                value: 100 - 4 - PLAN_MIN_ATR_SPACING,
                source: 'fallback',
                basis: 'atr',
            });
        });

        it('half-width 3.9 ATR: the clamp keeps the fallback inside the band', () => {
            const { value } = run(3.9);
            expect(value).toBeCloseTo(100 - 5);
        });

        it('half-width just over 4 ATR: the band is empty, so there is no stop', () => {
            expect(run(4.01)).toEqual({
                value: undefined,
                source: 'missing',
                basis: null,
            });
            expect(isStopBandEmpty(100, 100 - 4.01, atr1)).toBe(true);
            expect(isStopBandEmpty(100, 100 - 4, atr1)).toBe(false);
            expect(isStopBandEmpty(100, 90, undefined)).toBe(false);
        });

        describe('KRX tick rounding never crosses the cap or the one-ATR gap', () => {
            const quote = (price: number, round?: 'up') =>
                round === 'up'
                    ? ceilToKrxTick(price, 'share')
                    : roundToKrxTick(price, 'share');
            const krxAtr = 914;
            const mid = 72_000;
            const cap = mid - SL_MAX_ATR_MULTIPLIER * krxAtr; // 67,430: off the 100-won tick
            const resolveAt = (halfWidth: number) =>
                resolveBullishStopLoss(
                    undefined,
                    mid,
                    krxAtr,
                    mid - halfWidth * krxAtr,
                    [],
                    quote
                );

            it('rounds the cap-bound fallback up when the nearest tick lies below the cap', () => {
                // Nearest-tick rounding of 67,430 is 67,400, below the cap.
                expect(roundToKrxTick(cap, 'share')).toBeLessThan(cap);
                const result = resolveAt(3.8);
                expect(result.basis).toBe('atr');
                expect(result.value).toBe(67_500);
                expect(result.value).toBeGreaterThanOrEqual(cap);
            });

            it('keeps nearest-tick rounding when it already respects the cap', () => {
                // Half-width 3: 1.5 ATR below the low is above the cap (the cap binds only
                // above half-width 3.5), so nothing is lifted.
                const { low, value } = {
                    low: mid - 3 * krxAtr,
                    value: resolveAt(3).value,
                };
                expect(value).toBe(roundToKrxTick(low - 1.5 * krxAtr, 'share'));
            });

            it('has no stop when no quotable price fits between the cap and the one-ATR gap', () => {
                // Half-width 4: the band is the single price 67,430, which is not a tick.
                expect(resolveAt(4)).toEqual({
                    value: undefined,
                    source: 'missing',
                    basis: null,
                });
            });
        });

        it('an empty band beats a candidate and a model stop: nothing can satisfy both ends', () => {
            const { low, mid } = zone(5);
            const result = resolveBullishStopLoss(
                low - 1,
                mid,
                atr1,
                low,
                [low - 2],
                identity
            );
            expect(result.source).toBe('missing');
        });
    });

    it('rounds the ATR fallback to the KRX tick but leaves a printed support as given', () => {
        const quote = (price: number) => roundToKrxTick(price, 'share');
        // 71,500 - 1.5 x 900 = 70,150: off the 100-won tick.
        const fallback = resolveBullishStopLoss(
            undefined,
            72_000,
            900,
            71_500,
            [],
            quote
        );
        expect(fallback.basis).toBe('atr');
        expect(fallback.value).toBe(quote(70_150));
        expect(fallback.value).not.toBe(70_150);
        const level = resolveBullishStopLoss(
            undefined,
            72_000,
            900,
            71_500,
            [70_300],
            quote
        );
        expect(level).toEqual({
            value: 70_300,
            source: 'fallback',
            basis: 'level',
        });
    });

    it('reports a missing stop when the fallback would not be a price', () => {
        const result = resolveBullishStopLoss(undefined, 2, 5, 2, [], identity);
        expect(result).toEqual({
            value: undefined,
            source: 'missing',
            basis: null,
        });
    });

    describe('without a usable ATR', () => {
        const legacy = (aiValue: number | undefined, atrValue?: number) =>
            resolveBullishStopLoss(aiValue, mid, atrValue, low, [94], identity);

        it('keeps a stop that is positive and below the zone, whatever its distance', () => {
            expect(legacy(97)).toEqual({
                value: 97,
                source: 'ai',
                basis: 'model',
            });
            expect(legacy(1)).toEqual({
                value: 1,
                source: 'ai',
                basis: 'model',
            });
        });

        it('leaves an invalid stop missing, never snapping to a candidate', () => {
            expect(legacy(99)).toEqual({
                value: undefined,
                source: 'missing',
                basis: null,
            });
            expect(legacy(undefined)).toEqual({
                value: undefined,
                source: 'missing',
                basis: null,
            });
            expect(legacy(99, 0).source).toBe('missing');
            expect(legacy(99, Number.NaN).source).toBe('missing');
        });
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
            [],
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
            [],
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
            [],
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
            [],
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

    it('AI TP가 무효하면 지어내지 않고 제외한다 — 남은 목표가가 없으면 목표가도 위험:보상도 비운다', () => {
        const rec: ActionRecommendation = {
            ...baseRec,
            takeProfitPrices: [50],
        };

        const result = reconcileBullishActionRecommendation(
            rec,
            entryPrice,
            atr,
            [],
            'USD'
        );

        const levels = result.recommendation.reconciledLevels;
        expect(result.wasReconciled).toBe(true);
        // never `entry + 2*ATR` (104): that level was nobody's proposal
        expect(levels?.takeProfitPrices).toEqual([]);
        expect(levels?.riskReward).toBe('');
        expect(levels?.exit).not.toContain('목표');
        expect(levels?.exit).toContain('손절');
        expect(result.changes).toHaveLength(1);
        expect(result.changes[0]).toContain('dropped');
    });

    it('AI가 목표가를 아예 주지 않으면 보정하지 않고 목표가를 채우지 않는다', () => {
        const rec: ActionRecommendation = {
            ...baseRec,
            takeProfitPrices: undefined,
        };

        const result = reconcileBullishActionRecommendation(
            rec,
            entryPrice,
            atr,
            [],
            'USD'
        );

        expect(result.wasReconciled).toBe(false);
        expect(result.recommendation.reconciledLevels).toBeUndefined();
    });

    describe('ATR 상한은 첫 목표가에만 적용된다', () => {
        const rec: ActionRecommendation = {
            ...baseRec,
            entryPrices: [100, 110],
            stopLoss: 96,
            takeProfitPrices: [115, 140], // ATR 2 -> cap 100 + 20 = 120 for the first only
        };

        it('구간 위의 먼 두 번째 목표가는 그대로 남기고 보정하지 않는다', () => {
            const result = reconcileBullishActionRecommendation(
                rec,
                105,
                2,
                [],
                'USD'
            );

            expect(result.wasReconciled).toBe(false);
        });

        it('다른 목표가 때문에 보정이 일어나도 먼 두 번째 목표가는 남는다', () => {
            const result = reconcileBullishActionRecommendation(
                { ...rec, takeProfitPrices: [108, 115, 140] },
                105,
                2,
                [],
                'USD'
            );

            const levels = result.recommendation.reconciledLevels;
            expect(levels?.takeProfitPrices).toEqual([115, 140]);
            expect(levels?.reason).toContain('진입 구간 위가 아닌');
            expect(levels?.reason).not.toContain('ATR');
        });

        it('첫 목표가가 ATR 상한을 넘으면 제외하고 그 이유를 정확히 적는다', () => {
            const result = reconcileBullishActionRecommendation(
                { ...rec, takeProfitPrices: [140, 150] },
                105,
                2,
                [],
                'USD'
            );

            const levels = result.recommendation.reconciledLevels;
            expect(levels?.takeProfitPrices).toEqual([150]);
            expect(levels?.reason).toContain(
                '첫 번째 목표가가 ATR 기준 상한을 넘어'
            );
            expect(levels?.reason).not.toContain('진입 구간 위가 아닌');
            expect(result.changes).toEqual([
                'takeProfitPrices[0]: 140 dropped (beyond the ATR cap)',
            ]);
        });
    });

    it('AI가 손절가를 주지 않았으면 이유에 보정이 아니라 계산했다고 적는다', () => {
        const result = reconcileBullishActionRecommendation(
            { ...baseRec, stopLoss: undefined, takeProfitPrices: [95, 106] },
            entryPrice,
            atr,
            [],
            'USD'
        );

        const reason = result.recommendation.reconciledLevels?.reason ?? '';
        expect(reason).toContain('AI가 손절가를 제시하지 않아');
        expect(reason).toContain('진입 구간 위가 아닌');
        expect(reason).not.toContain('보정하고');
    });

    it('AI 손절가가 있었지만 무효면 보정했다고 적는다', () => {
        const result = reconcileBullishActionRecommendation(
            { ...baseRec, stopLoss: 200, takeProfitPrices: [95, 106] },
            entryPrice,
            atr,
            [],
            'USD'
        );

        const reason = result.recommendation.reconciledLevels?.reason ?? '';
        expect(reason).toContain(
            // 200 is above the zone, not merely close to its low: out of range.
            '손절가가 내부 기준을 벗어나 ATR 기준값으로 계산했습니다'
        );
        expect(reason).toContain('진입 구간 위가 아닌');
    });

    describe('진입 구간 경계 기준 검증 (중앙값만 보지 않는다)', () => {
        const zoneRec: ActionRecommendation = {
            ...baseRec,
            entryPrices: [96, 104], // mid 100
            stopLoss: 94,
            takeProfitPrices: [108, 112],
        };

        it('구간 안쪽 손절(중앙값 아래, 하단 위)은 무효라 fallback으로 보정한다', () => {
            const result = reconcileBullishActionRecommendation(
                { ...zoneRec, stopLoss: 98 },
                100,
                atr,
                [],
                'USD'
            );

            const stop = result.recommendation.reconciledLevels?.stopLoss;
            expect(result.wasReconciled).toBe(true);
            expect(stop).toBeLessThan(96);
        });

        it('구간 하단에서 1 ATR 아래에 놓인 손절은 그대로 유효하다', () => {
            const result = reconcileBullishActionRecommendation(
                { ...zoneRec, stopLoss: 93.5 },
                100,
                atr,
                [],
                'USD'
            );

            expect(result.wasReconciled).toBe(false);
        });

        it('구간 상단 이하의 목표가는 제외하고 위의 목표가는 남긴다', () => {
            const result = reconcileBullishActionRecommendation(
                { ...zoneRec, takeProfitPrices: [102, 104, 108, 112] },
                100,
                atr,
                [],
                'USD'
            );

            const levels = result.recommendation.reconciledLevels;
            expect(result.wasReconciled).toBe(true);
            expect(levels?.takeProfitPrices).toEqual([108, 112]);
            expect(levels?.riskReward).toContain('+8.0%');
        });

        it('목표가를 제외해도 순서를 오름차순으로 돌려준다', () => {
            const result = reconcileBullishActionRecommendation(
                { ...zoneRec, takeProfitPrices: [112, 90, 108] },
                100,
                atr,
                [],
                'USD'
            );

            expect(
                result.recommendation.reconciledLevels?.takeProfitPrices
            ).toEqual([108, 112]);
        });

        it('뒤집힌 진입 구간 배열도 같은 경계로 읽는다', () => {
            const result = reconcileBullishActionRecommendation(
                { ...zoneRec, entryPrices: [104, 96], takeProfitPrices: [103] },
                100,
                atr,
                [],
                'USD'
            );

            expect(result.wasReconciled).toBe(true);
            expect(
                result.recommendation.reconciledLevels?.takeProfitPrices
            ).toEqual([]);
        });

        it('폭이 넓은 구간에서 중앙값 기준 fallback이 구간 안이면 하단 기준으로 계산한다', () => {
            const result = reconcileBullishActionRecommendation(
                {
                    ...zoneRec,
                    entryPrices: [90, 110],
                    stopLoss: 95,
                    takeProfitPrices: [120],
                },
                100,
                10,
                [],
                'USD'
            );

            // the fallback is measured from the zone low: 90 - 1.5 x 10 = 75 (the old mid-based 85)
            expect(
                result.recommendation.reconciledLevels?.stopLoss
            ).toBeCloseTo(75);

            const wide = reconcileBullishActionRecommendation(
                {
                    ...zoneRec,
                    entryPrices: [70, 130],
                    stopLoss: 95,
                    takeProfitPrices: [140],
                },
                100,
                10,
                [],
                'USD'
            );
            // mid-based 85 would sit inside [70, 130] → measured from the low edge: 70 - 15
            expect(wide.recommendation.reconciledLevels?.stopLoss).toBeCloseTo(
                55
            );
        });
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
            [],
            'USD'
        );

        expect(result.changes).toContain(
            'stopLoss: null → 0.08250 (floor, atr)'
        );
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
            [],
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
            atr,
            []
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
            atr,
            []
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
            atr,
            []
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
            atr,
            []
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
                atr,
                []
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

        it('a KRW close off the tick grid is compared at the tick the prompt printed (DOM-8)', () => {
            const krw: AnalysisResponse = {
                ...baseResponse,
                actionRecommendation: {
                    ...baseRec,
                    entryPrices: [70_500, 71_500],
                    stopLoss: 68_000,
                    takeProfitPrices: [75_000],
                },
            };
            // 71,540 rounds to the printed 71,500 (100-won tick), the zone high.
            const raw = 71_540;
            expect(roundToKrxTick(raw, 'share')).toBe(71_500);
            const result = postProcessAnalysisWithReconcile(
                krw,
                raw,
                900,
                [],
                'KRW',
                undefined,
                'share'
            );
            const rec = result.actionRecommendation;
            expect(rec?.planCheck?.currentPrice).toBe(71_500);
            expect(rec?.planCheck?.exceedsEntryZone).toBe(false);
            expect(rec?.planState?.position).toBe('in_zone');
            // The same raw close in a USD listing is not rounded: above the zone high.
            const usd = postProcessAnalysisWithReconcile(
                krw,
                raw,
                900,
                [],
                'USD'
            );
            expect(usd.actionRecommendation?.planCheck?.exceedsEntryZone).toBe(
                true
            );
        });

        it('현재가가 진입 구간을 벗어나면 두 손익비가 갈라진다', () => {
            const result = postProcessAnalysisWithReconcile(
                healthy,
                104,
                atr,
                []
            );
            const check = result.actionRecommendation?.planCheck;

            expect(check?.exceedsEntryZone).toBe(true);
            // 계획 기준으로는 여전히 매력적이지만 지금 사면 거의 남는 게 없다.
            expect(check?.riskRewardAtEntry).toBeCloseTo(5 / 3);
            expect(check?.riskRewardAtCurrent).toBeCloseTo(1 / 7);
        });

        it('목표가를 이미 지난 계획은 상방 0으로 보고한다', () => {
            const result = postProcessAnalysisWithReconcile(
                healthy,
                106,
                atr,
                []
            );

            expect(
                result.actionRecommendation?.planCheck?.riskRewardAtCurrent
            ).toBe(0);
        });

        it("'avoid' 판정에도 붙는다 — 보정도 다른 판정과 같다", () => {
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
                atr,
                []
            );

            // avoid 판정도 보정한다. 진입가 위에 있는 손절가는 롱이 실행할 수 있는
            // 손절가가 아니므로 floor 손절(100 - 1.5 x 2)로 바뀌고, 100에 거래되는
            // 차트를 "이미 손절됐다"고 보고하지 않는다.
            expect(
                result.actionRecommendation?.reconciledLevels?.stopLoss
            ).toBeCloseTo(97);
            expect(result.actionRecommendation?.planCheck).toMatchObject({
                belowStopLoss: false,
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
                atr,
                []
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
                atr,
                []
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
                atr,
                []
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
                atr,
                []
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
                [],
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
                atr,
                []
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
                [],
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
                bigAtr,
                []
            );

            expect(
                result.actionRecommendation?.reconciledLevels?.stopLoss
            ).toBe(entryPrice - bigAtr * SL_FALLBACK_ATR_MULTIPLIER);
            expect(
                result.actionRecommendation?.reconciledLevels?.takeProfitPrices
            ).toEqual([105, 150]); // 항상 오름차순(가까운 목표가 먼저) — 읽는 쪽이 [0]을 가장 가까운 목표가로 믿어도 된다

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
                undefined, // no ATR → TP fallback also unavailable, nothing to reconcile
                []
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
                atr,
                []
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
            atr,
            []
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
            [],
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
            atr,
            []
        );

        // 95 sits below the entry and is dropped; nearest remaining target above
        // entryPrice is 102, not 110 — buildBullishRiskRewardText([102]) is the same
        // line the filter+sort should produce. It rides on reconciledLevels now,
        // because the target list was corrected.
        const expectedLine = buildBullishRiskRewardText(entryPrice, 97, [102]);
        const levels = result.actionRecommendation?.reconciledLevels;
        expect(levels?.takeProfitPrices).toEqual([102, 110]);
        expect(levels?.riskReward).toBe(expectedLine);
        expect(levels?.riskReward).not.toContain('모델이 채운');

        // planCheck measures via the same nearest-target-above-price rule, so the two
        // never disagree.
        expect(
            result.actionRecommendation?.planCheck?.riskRewardAtEntry
        ).toBeCloseTo((102 - 100) / (100 - 97));
    });
});

describe('postProcessAnalysisWithReconcile — plan edges and no fabricated target', () => {
    const response = (
        rec: Partial<ActionRecommendation>
    ): AnalysisResponse => ({
        ...({
            patternSummaries: [],
        } as unknown as AnalysisResponse),
        actionRecommendation: { ...baseRec, ...rec },
    });

    it('TP[0]이 중앙값 이하일 때 entry+2*ATR을 끼워 넣지 않는다 (1:0.0 줄의 원인)', () => {
        const result = postProcessAnalysisWithReconcile(
            response({ takeProfitPrices: [95, 108] }),
            entryPrice,
            atr,
            []
        );

        const levels = result.actionRecommendation?.reconciledLevels;
        // old behaviour: [104, 108] with 104 = 100 + 2*2 invented
        expect(levels?.takeProfitPrices).toEqual([108]);
        expect(levels?.riskReward).toContain('1:2.7');
        expect(levels?.riskReward).not.toContain('1:0.0');
    });

    it('남은 목표가가 없으면 위험:보상 줄을 붙이지 않고 planCheck도 비율이 없다', () => {
        const result = postProcessAnalysisWithReconcile(
            response({ takeProfitPrices: [95, 99], riskReward: '' }),
            entryPrice,
            atr,
            []
        );

        const rec = result.actionRecommendation;
        expect(rec?.reconciledLevels?.takeProfitPrices).toEqual([]);
        expect(rec?.reconciledLevels?.riskReward).toBe('');
        expect(rec?.riskReward).toBe('');
        expect(rec?.planCheck?.riskRewardAtEntry).toBeNull();
        expect(rec?.planCheck?.riskRewardAtCurrent).toBeNull();
    });

    it('진입 구간 안쪽의 손절과 목표가를 함께 걸러낸다', () => {
        const result = postProcessAnalysisWithReconcile(
            response({
                entryPrices: [98, 102],
                stopLoss: 99,
                takeProfitPrices: [101, 106],
            }),
            entryPrice,
            atr,
            []
        );

        const levels = result.actionRecommendation?.reconciledLevels;
        expect(levels?.stopLoss).toBeCloseTo(95); // zone low 98 - 1.5 * 2
        expect(levels?.takeProfitPrices).toEqual([106]);
        expect(levels?.reason).toContain('제외');
    });

    it('이미 유효한 계획은 그대로 둔다 (원본 참조 유지, reconciledLevels 없음)', () => {
        const result = postProcessAnalysisWithReconcile(
            response({
                entryPrices: [98, 102],
                stopLoss: 96,
                takeProfitPrices: [104, 108],
            }),
            entryPrice,
            atr,
            []
        );

        expect(result.actionRecommendation?.reconciledLevels).toBeUndefined();
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
            undefined,
            []
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
            undefined,
            []
        );
        expect(result.patternSummaries[0].keyPrices).toEqual([
            { label: '보수 목표가(50%)', price: 2.5 },
        ]);
    });

    it('down 패턴: measuredTarget = breakout - height, conservative = breakout - height/2', () => {
        const result = postProcessAnalysisWithReconcile(
            { ...baseResponse, patternSummaries: [downPattern] },
            undefined,
            undefined,
            []
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
            undefined,
            []
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
            undefined,
            []
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
            undefined,
            []
        );
        const twice = postProcessAnalysisWithReconcile(
            once,
            undefined,
            undefined,
            []
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
            [],
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
            undefined,
            []
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
            undefined,
            []
        );
        expect(result.patternSummaries[0]).toEqual(noGeometry);
    });

    it('patternSummaries에 geometry가 하나도 없으면 원본 참조를 그대로 반환한다', () => {
        const result = postProcessAnalysisWithReconcile(
            baseResponse,
            undefined,
            undefined,
            []
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
            [],
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
            [],
            'KRW',
            undefined,
            'etp'
        ).actionRecommendation?.reconciledLevels;
        const share = postProcessAnalysisWithReconcile(
            fallbackResponse,
            40_000,
            123,
            [],
            'KRW'
        ).actionRecommendation?.reconciledLevels;

        // Only the stop is a computed level now; no target is invented.
        expect(etp?.takeProfitPrices).toBeUndefined();
        const etpLevels = [etp!.stopLoss!];
        const shareLevels = [share!.stopLoss!];
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
                [],
                'USD',
                undefined,
                'etp'
            )
        ).toEqual(
            postProcessAnalysisWithReconcile(
                fallbackResponse,
                100,
                2.37,
                [],
                'USD'
            )
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

describe('reconcileBullishActionRecommendation — normalized targets', () => {
    const zoneRec: ActionRecommendation = {
        ...baseRec,
        entryPrices: [98, 102],
        stopLoss: 88.2,
        takeProfitPrices: [105, 110],
    };
    const reconcile = (
        overrides: Partial<ActionRecommendation>,
        atrValue = 5
    ) =>
        reconcileBullishActionRecommendation(
            { ...zoneRec, ...overrides },
            entryPrice,
            atrValue,
            [],
            'USD'
        );

    it('sorts descending targets ascending and says so', () => {
        const result = reconcile({ takeProfitPrices: [110, 105] });

        expect(result.wasReconciled).toBe(true);
        expect(
            result.recommendation.reconciledLevels?.takeProfitPrices
        ).toEqual([105, 110]);
        expect(result.recommendation.reconciledLevels?.reason).toContain(
            '오름차순'
        );
        expect(result.changes).toContain(
            'takeProfitPrices: reordered ascending (nearest first)'
        );
        expect(result.recommendation.takeProfitPrices).toEqual([110, 105]);
    });

    it('removes a duplicated target and says so', () => {
        const result = reconcile({ takeProfitPrices: [105, 105, 110] });

        expect(
            result.recommendation.reconciledLevels?.takeProfitPrices
        ).toEqual([105, 110]);
        expect(result.recommendation.reconciledLevels?.reason).toContain(
            '중복'
        );
        expect(result.recommendation.reconciledLevels?.reason).not.toContain(
            '오름차순'
        );
        expect(result.changes).toContain(
            'takeProfitPrices: duplicate targets removed'
        );
    });

    it('does not touch targets that are already ascending and unique', () => {
        const result = reconcile({ takeProfitPrices: [105, 110] });

        expect(result.wasReconciled).toBe(false);
        expect(result.recommendation.reconciledLevels).toBeUndefined();
    });

    it('reports a drop and a reorder together', () => {
        const result = reconcile({ takeProfitPrices: [110, 100, 105] });

        expect(
            result.recommendation.reconciledLevels?.takeProfitPrices
        ).toEqual([105, 110]);
        expect(result.recommendation.reconciledLevels?.reason).toContain(
            '진입 구간 위가 아닌'
        );
        expect(result.recommendation.reconciledLevels?.reason).toContain(
            '오름차순'
        );
    });

    it('still drops a first target beyond the ATR cap, then sorts what is left', () => {
        // ATR 2: the model's first target (130) is far past the cap; 110 then 105 remain.
        const result = reconcile({ takeProfitPrices: [130, 110, 105] }, 2);

        expect(
            result.recommendation.reconciledLevels?.takeProfitPrices
        ).toEqual([105, 110]);
        expect(result.changes).toContain(
            'takeProfitPrices[0]: 130 dropped (beyond the ATR cap)'
        );
    });

    it('lets the reconciled risk:reward read the nearest target', () => {
        const result = reconcile({
            takeProfitPrices: [150, 105],
            stopLoss: 200,
        });

        expect(
            result.recommendation.reconciledLevels?.takeProfitPrices
        ).toEqual([105, 150]);
        expect(result.recommendation.reconciledLevels?.riskReward).toContain(
            '+5.0%'
        );
    });
});

describe('reconcileBullishActionRecommendation — stop with no replacement', () => {
    const rejectedInput: ActionRecommendation = {
        ...baseRec,
        entryPrices: [98, 102],
        stopLoss: 112.2,
        takeProfitPrices: [107.1, 112.2],
    };

    it('rejects an unusable stop when there is no ATR, marks it and invents nothing', () => {
        const result = reconcileBullishActionRecommendation(
            rejectedInput,
            entryPrice,
            undefined,
            [],
            'USD'
        );

        const levels = result.recommendation.reconciledLevels;
        expect(result.wasReconciled).toBe(true);
        expect(levels?.stopLossRejected).toBe(true);
        expect(levels?.stopLoss).toBeUndefined();
        expect(levels?.exit).not.toContain('손절');
        expect(levels?.riskReward).toBe('');
        expect(levels?.reason).toContain('손절가');
        expect(levels?.reason).toContain('제외');
        expect(result.changes).toContain(
            'stopLoss: 112.2 rejected (not below the entry zone, no usable ATR for a fallback)'
        );
        // The model's own fields are never rewritten.
        expect(result.recommendation.stopLoss).toBe(112.2);
    });

    it('keeps reconciling the targets next to a rejected stop', () => {
        const result = reconcileBullishActionRecommendation(
            rejectedInput,
            entryPrice,
            undefined,
            [],
            'USD'
        );

        expect(
            result.recommendation.reconciledLevels?.takeProfitPrices
        ).toEqual([107.1, 112.2]);
        expect(result.recommendation.reconciledLevels?.exit).toContain('목표');
    });

    it('does not mark a plan that never had a stop', () => {
        const result = reconcileBullishActionRecommendation(
            { ...rejectedInput, stopLoss: undefined },
            entryPrice,
            undefined,
            [],
            'USD'
        );

        expect(result.wasReconciled).toBe(false);
        expect(result.recommendation.reconciledLevels).toBeUndefined();
    });

    it('prefers the ATR fallback over a rejection when one can be derived', () => {
        const result = reconcileBullishActionRecommendation(
            rejectedInput,
            entryPrice,
            atr,
            [],
            'USD'
        );

        expect(result.recommendation.reconciledLevels?.stopLossRejected).toBe(
            undefined
        );
        expect(result.recommendation.reconciledLevels?.stopLoss).toBeLessThan(
            98
        );
    });

    it('leaves the plan check without a stop and without a risk:reward ratio', () => {
        const response = {
            summary: '',
            trend: 'bullish',
            indicatorResults: [],
            riskLevel: 'low',
            keyLevels: { support: [], resistance: [] },
            priceTargets: { bullish: null, bearish: null },
            patternSummaries: [],
            strategyResults: [],
            candlePatterns: [],
            trendlines: [],
            actionRecommendation: { ...rejectedInput, riskReward: '모델 산문' },
        } satisfies AnalysisResponse;

        const rec = postProcessAnalysisWithReconcile(
            response,
            entryPrice,
            undefined,
            []
        ).actionRecommendation;

        expect(rec?.reconciledLevels?.stopLossRejected).toBe(true);
        expect(rec?.planCheck?.belowStopLoss).toBe(false);
        expect(rec?.planCheck?.riskRewardAtEntry).toBeNull();
        expect(rec?.planCheck?.riskRewardAtCurrent).toBeNull();
        expect(rec?.riskReward).toBe('모델 산문');
    });
});

describe('stop floor, plan state and the computed verdict (WP-15 core-2)', () => {
    const response = (rec: ActionRecommendation): AnalysisResponse => ({
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
        actionRecommendation: rec,
    });
    // Zone [98, 102] (mid 100), ATR 2: the allowed stop band is [90, 96].
    const zoneRec: ActionRecommendation = {
        ...baseRec,
        entryRecommendation: 'wait',
        entryPrices: [98, 102],
        stopLoss: 97,
        takeProfitPrices: [105, 110],
    };
    const run = (
        rec: ActionRecommendation,
        close: number | null = 100,
        candidates: readonly number[] = []
    ) =>
        postProcessAnalysisWithReconcile(
            response(rec),
            close ?? undefined,
            atr,
            candidates
        ).actionRecommendation;

    describe('reconciled levels, reason and changes', () => {
        const reconcile = (
            rec: ActionRecommendation,
            candidates: readonly number[] = []
        ) =>
            reconcileBullishActionRecommendation(
                rec,
                100,
                atr,
                candidates,
                'USD'
            );

        it('a stop closer than one ATR moves to a printed support: level basis, stamped, with its reason and change line', () => {
            const result = reconcile(zoneRec, [94, 92]);
            const levels = result.recommendation.reconciledLevels;
            expect(levels?.stopLoss).toBe(94);
            expect(levels?.stopBasis).toBe('level');
            expect(levels?.reason).toBe(
                'AI가 제시한 손절가가 진입 구간 하단에서 1 ATR보다 가까워 그 아래 기준 가격대로 옮겼습니다.'
            );
            expect(result.changes).toContain(
                'stopLoss: 97 → 94.00 (floor, level)'
            );
            expect(result.recommendation.stopLoss).toBe(97);
        });

        it('with no printed support in the band it falls to 1.5 ATR below the zone low: atr basis', () => {
            const result = reconcile(zoneRec, [97.5]);
            const levels = result.recommendation.reconciledLevels;
            expect(levels?.stopLoss).toBe(95);
            expect(levels?.stopBasis).toBe('atr');
            expect(levels?.reason).toBe(
                'AI가 제시한 손절가가 진입 구간 하단에서 1 ATR보다 가까워 ATR 기준값으로 계산했습니다.'
            );
            expect(result.changes).toContain(
                'stopLoss: 97 → 95.00 (floor, atr)'
            );
        });

        it('says each way a stop is replaced exactly: missing, too far, closer than one ATR', () => {
            const reason = (rec: ActionRecommendation, c: readonly number[]) =>
                reconcile(rec, c).recommendation.reconciledLevels?.reason;
            expect(reason({ ...zoneRec, stopLoss: undefined }, [93])).toBe(
                'AI가 손절가를 제시하지 않아 진입 구간 하단에서 1 ATR 이상 아래의 기준 가격대를 손절가로 정했습니다.'
            );
            expect(reason({ ...zoneRec, stopLoss: undefined }, [])).toBe(
                'AI가 손절가를 제시하지 않아 ATR 기반 기본값을 계산했습니다.'
            );
            expect(reason({ ...zoneRec, stopLoss: 80 }, [93])).toBe(
                'AI가 제시한 손절가가 내부 기준을 벗어나 진입 구간 하단에서 1 ATR 이상 아래의 기준 가격대로 옮겼습니다.'
            );
            expect(reason({ ...zoneRec, stopLoss: 80 }, [])).toBe(
                'AI가 제시한 손절가가 내부 기준을 벗어나 ATR 기준값으로 계산했습니다.'
            );
        });

        it('leaves a stop that clears the floor alone: no stamp, no reconciliation', () => {
            const result = reconcile({ ...zoneRec, stopLoss: 95 }, [94]);
            expect(result.wasReconciled).toBe(false);
            expect(result.recommendation.reconciledLevels).toBeUndefined();
        });

        it('keeps the model stop but still stamps nothing when only the targets change', () => {
            const result = reconcile(
                { ...zoneRec, stopLoss: 95, takeProfitPrices: [101, 105] },
                []
            );
            expect(result.wasReconciled).toBe(true);
            expect(
                result.recommendation.reconciledLevels?.stopBasis
            ).toBeUndefined();
        });

        it('reconcile marks the plan stopLossRejected with its own reason, also when the model gave no stop', () => {
            const wide = {
                ...zoneRec,
                entryPrices: [95, 105],
                stopLoss: undefined,
                takeProfitPrices: [130],
            };
            const result = reconcileBullishActionRecommendation(
                wide,
                100,
                1,
                [90],
                'USD'
            );
            const levels = result.recommendation.reconciledLevels;
            expect(levels?.stopLossRejected).toBe(true);
            expect(levels?.stopLoss).toBeUndefined();
            expect(levels?.reason).toContain('손절가를 정할 수 없습니다');
            expect(result.changes.join(' ')).toContain('no stop fits the band');
        });

        it('a KRX listing gets the ATR fallback at its tick', () => {
            const result = reconcileBullishActionRecommendation(
                {
                    ...zoneRec,
                    entryPrices: [71_500, 72_500],
                    stopLoss: 71_400,
                    takeProfitPrices: [75_000],
                },
                72_000,
                900,
                [],
                'KRW'
            );
            // 71,500 - 1.5 x 900 = 70,150 is off the 100-won tick.
            expect(result.recommendation.reconciledLevels?.stopLoss).toBe(
                roundToKrxTick(70_150, 'share')
            );
        });
    });

    describe('why a stop was moved', () => {
        const reasonFor = (stopLoss: number) =>
            reconcileBullishActionRecommendation(
                { ...zoneRec, stopLoss },
                100,
                atr,
                [],
                'USD'
            ).recommendation.reconciledLevels?.reason;

        it('a stop below the zone low that has not cleared one ATR is closer than one ATR', () => {
            expect(reasonFor(97.9)).toContain('1 ATR보다 가까워');
        });

        it.each([98, 99, 120])(
            'a stop at %s, at or above the zone low, is out of range, not "closer than one ATR"',
            stop => {
                expect(reasonFor(stop)).toContain('내부 기준을 벗어나');
                expect(reasonFor(stop)).not.toContain('1 ATR보다 가까워');
            }
        );
    });

    describe('plan state and verdict in the full chain', () => {
        it('attaches the state next to the plan check and overwrites the model verdict', () => {
            // Close 100 is inside [98, 102]; the model said wait.
            const rec = run(zoneRec);
            expect(rec?.planState).toMatchObject({
                position: 'in_zone',
                atr,
                stopBasis: 'atr',
            });
            expect(rec?.entryRecommendation).toBe('enter');
            expect(rec?.planCheck).toBeDefined();
        });

        it.each([
            [108, 'above_zone', 'wait'],
            [96.5, 'below_zone', 'wait'],
        ] as const)(
            'a close at %s is %s and the verdict is %s',
            (close, position, verdict) => {
                const rec = run(
                    { ...zoneRec, entryRecommendation: 'enter' },
                    close
                );
                expect(rec?.planState?.position).toBe(position);
                expect(rec?.entryRecommendation).toBe(verdict);
            }
        );

        it('no target one ATR above the zone is no_setup and avoid, whatever the model said', () => {
            const rec = run({
                ...zoneRec,
                entryRecommendation: 'enter',
                takeProfitPrices: [103],
            });
            expect(rec?.planState).toMatchObject({
                position: 'no_setup',
                reason: 'no_room_above',
            });
            expect(rec?.entryRecommendation).toBe('avoid');
        });

        it('a sell-off path plan whose zone is the close area reads in_zone / enter', () => {
            const rec = run({
                ...zoneRec,
                entryRecommendation: 'wait',
                entryPrices: [99.5, 100.5],
                stopLoss: 95,
                takeProfitPrices: [104, 106],
            });
            expect(rec?.planState?.position).toBe('in_zone');
            expect(rec?.entryRecommendation).toBe('enter');
        });

        it('drops a model-supplied planState before deciding', () => {
            const rec = run({
                ...zoneRec,
                planState: {
                    position: 'no_setup',
                    reason: 'stopped',
                    atr: 1,
                    stopDistanceAtr: null,
                    stopBasis: null,
                },
            });
            expect(rec?.planState?.position).toBe('in_zone');
        });

        it('drops a model-supplied planState even when no close exists to build one', () => {
            const rec = run(
                {
                    ...zoneRec,
                    planState: {
                        position: 'in_zone',
                        atr: 1,
                        stopDistanceAtr: 1,
                        stopBasis: 'model',
                        distanceAtr: 0,
                    },
                },
                null
            );
            expect(rec?.planState).toBeUndefined();
        });

        it('without a close there is no plan check, no state, and the model verdict stands', () => {
            const rec = run(zoneRec, null);
            expect(rec?.planCheck).toBeUndefined();
            expect(rec?.planState).toBeUndefined();
            expect(rec?.entryRecommendation).toBe('wait');
        });

        it('a plan with no stop and no ATR is no_stop / avoid', () => {
            const rec = postProcessAnalysisWithReconcile(
                response({ ...zoneRec, stopLoss: undefined }),
                100,
                undefined,
                []
            ).actionRecommendation;
            expect(rec?.planState).toMatchObject({
                position: 'no_setup',
                reason: 'no_stop',
                atr: null,
            });
            expect(rec?.entryRecommendation).toBe('avoid');
        });

        it('stopped: a close under the floored stop', () => {
            const rec = run(zoneRec, 94, [94]);
            expect(rec?.planState).toMatchObject({
                position: 'no_setup',
                reason: 'stopped',
            });
        });
    });
});
