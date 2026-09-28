import { describe, it, expect } from 'vitest';
import {
    EXCLUDED_SINGLE_PATTERNS,
    getMultiPatternTrend,
    getSinglePatternTrend,
} from '@/domain/analysis/candle-trend';

describe('getSinglePatternTrend', () => {
    describe('상승 단봉 패턴일 때', () => {
        it('hammer는 "bullish"를 반환한다', () => {
            expect(getSinglePatternTrend('hammer')).toBe('bullish');
        });

        it('inverted_hammer는 "bullish"를 반환한다', () => {
            expect(getSinglePatternTrend('inverted_hammer')).toBe('bullish');
        });

        it('bullish_marubozu는 "bullish"를 반환한다', () => {
            expect(getSinglePatternTrend('bullish_marubozu')).toBe('bullish');
        });

        it('bullish_belt_hold는 "bullish"를 반환한다', () => {
            expect(getSinglePatternTrend('bullish_belt_hold')).toBe('bullish');
        });

        it('dragonfly_doji는 "bullish"를 반환한다', () => {
            expect(getSinglePatternTrend('dragonfly_doji')).toBe('bullish');
        });
    });

    describe('하락 단봉 패턴일 때', () => {
        it('shooting_star는 "bearish"를 반환한다', () => {
            expect(getSinglePatternTrend('shooting_star')).toBe('bearish');
        });

        it('hanging_man은 "bearish"를 반환한다', () => {
            expect(getSinglePatternTrend('hanging_man')).toBe('bearish');
        });

        it('bearish_marubozu는 "bearish"를 반환한다', () => {
            expect(getSinglePatternTrend('bearish_marubozu')).toBe('bearish');
        });

        it('bearish_belt_hold는 "bearish"를 반환한다', () => {
            expect(getSinglePatternTrend('bearish_belt_hold')).toBe('bearish');
        });

        it('gravestone_doji는 "bearish"를 반환한다', () => {
            expect(getSinglePatternTrend('gravestone_doji')).toBe('bearish');
        });
    });

    describe('중립 단봉 패턴일 때', () => {
        it('doji는 "neutral"을 반환한다', () => {
            expect(getSinglePatternTrend('doji')).toBe('neutral');
        });

        it('spinning_top은 "neutral"을 반환한다', () => {
            expect(getSinglePatternTrend('spinning_top')).toBe('neutral');
        });

        it('flat은 "neutral"을 반환한다', () => {
            expect(getSinglePatternTrend('flat')).toBe('neutral');
        });

        it('bullish는 "neutral"을 반환한다', () => {
            expect(getSinglePatternTrend('bullish')).toBe('neutral');
        });

        it('bearish는 "neutral"을 반환한다', () => {
            expect(getSinglePatternTrend('bearish')).toBe('neutral');
        });
    });
});

describe('getMultiPatternTrend', () => {
    describe('상승 다봉 패턴일 때', () => {
        it('bullish_engulfing은 "bullish"를 반환한다', () => {
            expect(getMultiPatternTrend('bullish_engulfing')).toBe('bullish');
        });

        it('morning_star는 "bullish"를 반환한다', () => {
            expect(getMultiPatternTrend('morning_star')).toBe('bullish');
        });

        it('three_white_soldiers는 "bullish"를 반환한다', () => {
            expect(getMultiPatternTrend('three_white_soldiers')).toBe(
                'bullish'
            );
        });

        it('piercing_line은 "bullish"를 반환한다', () => {
            expect(getMultiPatternTrend('piercing_line')).toBe('bullish');
        });

        it('downside_gap_two_rabbits는 "bullish"를 반환한다', () => {
            expect(getMultiPatternTrend('downside_gap_two_rabbits')).toBe(
                'bullish'
            );
        });

        it('above_the_stomach는 "bullish"를 반환한다', () => {
            expect(getMultiPatternTrend('above_the_stomach')).toBe('bullish');
        });

        it('rising_three_methods는 "bullish"를 반환한다', () => {
            expect(getMultiPatternTrend('rising_three_methods')).toBe(
                'bullish'
            );
        });
    });

    describe('하락 다봉 패턴일 때', () => {
        it('bearish_engulfing은 "bearish"를 반환한다', () => {
            expect(getMultiPatternTrend('bearish_engulfing')).toBe('bearish');
        });

        it('evening_star는 "bearish"를 반환한다', () => {
            expect(getMultiPatternTrend('evening_star')).toBe('bearish');
        });

        it('three_black_crows는 "bearish"를 반환한다', () => {
            expect(getMultiPatternTrend('three_black_crows')).toBe('bearish');
        });

        it('dark_cloud_cover는 "bearish"를 반환한다', () => {
            expect(getMultiPatternTrend('dark_cloud_cover')).toBe('bearish');
        });

        it('upside_gap_two_crows는 "bearish"를 반환한다', () => {
            expect(getMultiPatternTrend('upside_gap_two_crows')).toBe(
                'bearish'
            );
        });

        it('below_the_stomach는 "bearish"를 반환한다', () => {
            expect(getMultiPatternTrend('below_the_stomach')).toBe('bearish');
        });

        it('falling_three_methods는 "bearish"를 반환한다', () => {
            expect(getMultiPatternTrend('falling_three_methods')).toBe(
                'bearish'
            );
        });
    });

    describe('이름과 반대 방향으로 측정된 다봉 패턴일 때 (three-line strike)', () => {
        it('bullish_three_line_strike는 측정 방향대로 "bearish"를 반환한다', () => {
            expect(getMultiPatternTrend('bullish_three_line_strike')).toBe(
                'bearish'
            );
        });

        it('bearish_three_line_strike는 측정 방향대로 "bullish"를 반환한다', () => {
            expect(getMultiPatternTrend('bearish_three_line_strike')).toBe(
                'bullish'
            );
        });
    });

    describe('중립(지속) 다봉 패턴일 때', () => {
        it('on_neck은 "neutral"을 반환한다', () => {
            expect(getMultiPatternTrend('on_neck')).toBe('neutral');
        });

        it('in_neck은 "neutral"을 반환한다', () => {
            expect(getMultiPatternTrend('in_neck')).toBe('neutral');
        });

        it('upside_gap_tasuki는 "neutral"을 반환한다', () => {
            expect(getMultiPatternTrend('upside_gap_tasuki')).toBe('neutral');
        });

        it('downside_gap_tasuki는 "neutral"을 반환한다', () => {
            expect(getMultiPatternTrend('downside_gap_tasuki')).toBe('neutral');
        });
    });
});

describe('EXCLUDED_SINGLE_PATTERNS', () => {
    describe('기본 형태 패턴을 포함한다', () => {
        it('bullish를 포함한다', () => {
            expect(EXCLUDED_SINGLE_PATTERNS.has('bullish')).toBe(true);
        });

        it('bearish를 포함한다', () => {
            expect(EXCLUDED_SINGLE_PATTERNS.has('bearish')).toBe(true);
        });

        it('flat을 포함한다', () => {
            expect(EXCLUDED_SINGLE_PATTERNS.has('flat')).toBe(true);
        });

        it('spinning_top을 포함한다', () => {
            expect(EXCLUDED_SINGLE_PATTERNS.has('spinning_top')).toBe(true);
        });
    });

    describe('의미 있는 패턴은 제외한다', () => {
        it('hammer를 포함하지 않는다', () => {
            expect(EXCLUDED_SINGLE_PATTERNS.has('hammer')).toBe(false);
        });

        it('doji를 포함하지 않는다', () => {
            expect(EXCLUDED_SINGLE_PATTERNS.has('doji')).toBe(false);
        });
    });
});
