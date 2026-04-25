import { describe, it, expect } from 'vitest';
import {
    CANDLE_PATTERN_LABELS,
    MULTI_CANDLE_PATTERN_LABELS,
    findCandlePatternLabel,
    getCandlePatternLabel,
    getMultiCandlePatternLabel,
} from '@/domain/analysis/candle-labels';
import type { CandlePattern, MultiCandlePattern } from '@/domain/types';

describe('getCandlePatternLabel', () => {
    describe('모든 단봉 패턴에 대해', () => {
        it('CANDLE_PATTERN_LABELS에 정의된 레이블을 반환한다', () => {
            (Object.keys(CANDLE_PATTERN_LABELS) as CandlePattern[]).forEach(
                pattern => {
                    expect(getCandlePatternLabel(pattern)).toBe(
                        CANDLE_PATTERN_LABELS[pattern]
                    );
                }
            );
        });
    });

    describe('대표 값', () => {
        it('hammer는 "망치형"을 반환한다', () => {
            expect(getCandlePatternLabel('hammer')).toBe('망치형');
        });

        it('doji는 "도지"를 반환한다', () => {
            expect(getCandlePatternLabel('doji')).toBe('도지');
        });
    });
});

describe('getMultiCandlePatternLabel', () => {
    describe('모든 다봉 패턴에 대해', () => {
        it('MULTI_CANDLE_PATTERN_LABELS에 정의된 레이블을 반환한다', () => {
            (
                Object.keys(MULTI_CANDLE_PATTERN_LABELS) as MultiCandlePattern[]
            ).forEach(pattern => {
                expect(getMultiCandlePatternLabel(pattern)).toBe(
                    MULTI_CANDLE_PATTERN_LABELS[pattern]
                );
            });
        });
    });

    describe('대표 값', () => {
        it('bullish_engulfing은 "상승 장악형"을 반환한다', () => {
            expect(getMultiCandlePatternLabel('bullish_engulfing')).toBe(
                '상승 장악형'
            );
        });

        it('morning_star는 "샛별형"을 반환한다', () => {
            expect(getMultiCandlePatternLabel('morning_star')).toBe('샛별형');
        });
    });
});

describe('findCandlePatternLabel', () => {
    describe('단봉 패턴 이름이 주어졌을 때', () => {
        it('대응하는 단봉 레이블을 반환한다', () => {
            expect(findCandlePatternLabel('hammer')).toBe('망치형');
        });
    });

    describe('다봉 패턴 이름이 주어졌을 때', () => {
        it('대응하는 다봉 레이블을 반환한다', () => {
            expect(findCandlePatternLabel('bullish_engulfing')).toBe(
                '상승 장악형'
            );
        });
    });

    describe('어디에도 존재하지 않는 이름이 주어졌을 때', () => {
        it('입력 이름을 그대로 반환한다', () => {
            expect(findCandlePatternLabel('nonexistent_pattern')).toBe(
                'nonexistent_pattern'
            );
        });

        it('빈 문자열은 빈 문자열을 반환한다', () => {
            expect(findCandlePatternLabel('')).toBe('');
        });
    });
});
