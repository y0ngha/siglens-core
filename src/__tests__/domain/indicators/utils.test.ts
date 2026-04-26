import { describe, it, expect } from 'vitest';
import {
    sma,
    typicalPrice,
    stdDev,
    rollingHighest,
    rollingLowest,
    linreg,
    lastNonNull,
} from '@/domain/indicators/utils';

describe('sma', () => {
    describe('값이 period보다 적을 때', () => {
        it('null을 반환한다', () => {
            expect(sma([10, 20], 3)).toBeNull();
            expect(sma([], 1)).toBeNull();
        });
    });

    describe('값이 period와 같을 때', () => {
        it('정확한 평균을 반환한다', () => {
            expect(sma([10, 20, 30], 3)).toBeCloseTo(20, 10);
        });
    });

    describe('값이 period보다 많을 때', () => {
        it('마지막 period개의 평균을 반환한다', () => {
            // 마지막 3개: [30, 40, 50] → 평균 40
            expect(sma([10, 20, 30, 40, 50], 3)).toBeCloseTo(40, 10);
        });
    });
});

describe('typicalPrice', () => {
    it('(high + low + close) / 3을 반환한다', () => {
        expect(typicalPrice(12, 8, 10)).toBeCloseTo(10, 10);
        expect(typicalPrice(100, 90, 95)).toBeCloseTo(95, 10);
    });
});

describe('stdDev', () => {
    describe('값이 period보다 적을 때', () => {
        it('null을 반환한다', () => {
            expect(stdDev([10], 3)).toBeNull();
        });
    });

    describe('모든 값이 같을 때', () => {
        it('0을 반환한다', () => {
            expect(stdDev([5, 5, 5], 3)).toBeCloseTo(0, 10);
        });
    });

    describe('값이 다를 때', () => {
        it('모집단 표준편차를 반환한다', () => {
            // [2, 4, 4, 4, 5, 5, 7, 9]의 마지막 4개: [5, 5, 7, 9]
            // mean = 6.5, variance = ((5-6.5)²+(5-6.5)²+(7-6.5)²+(9-6.5)²)/4 = (2.25+2.25+0.25+6.25)/4 = 2.75
            expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9], 4)).toBeCloseTo(
                Math.sqrt(2.75),
                5
            );
        });
    });
});

describe('rollingHighest', () => {
    describe('값이 period보다 적을 때', () => {
        it('null을 반환한다', () => {
            expect(rollingHighest([10, 20], 3)).toBeNull();
        });
    });

    it('마지막 period개의 최댓값을 반환한다', () => {
        expect(rollingHighest([10, 50, 20, 30], 3)).toBe(50);
        expect(rollingHighest([10, 50, 20, 30], 2)).toBe(30);
    });
});

describe('rollingLowest', () => {
    describe('값이 period보다 적을 때', () => {
        it('null을 반환한다', () => {
            expect(rollingLowest([10, 20], 3)).toBeNull();
        });
    });

    it('마지막 period개의 최솟값을 반환한다', () => {
        expect(rollingLowest([10, 50, 20, 30], 3)).toBe(20);
        expect(rollingLowest([10, 50, 20, 30], 2)).toBe(20);
    });
});

describe('lastNonNull', () => {
    it('빈 배열이면 null을 반환한다', () => {
        expect(lastNonNull([])).toBeNull();
    });

    it('모든 값이 null이면 null을 반환한다', () => {
        expect(lastNonNull([null, null, null])).toBeNull();
    });

    it('마지막 non-null 값을 반환한다', () => {
        expect(lastNonNull([1, 2, 3])).toBe(3);
        expect(lastNonNull([null, 2, null])).toBe(2);
        expect(lastNonNull([1, null, 3, null])).toBe(3);
    });
});

describe('linreg', () => {
    describe('값이 period보다 적을 때', () => {
        it('null을 반환한다', () => {
            expect(linreg([10], 3)).toBeNull();
        });
    });

    describe('모든 값이 같을 때', () => {
        it('그 값을 반환한다', () => {
            expect(linreg([5, 5, 5], 3)).toBeCloseTo(5, 10);
        });
    });

    describe('선형으로 증가하는 값일 때', () => {
        it('마지막 bar의 예측값을 반환한다', () => {
            // y = x: [0, 1, 2, 3, 4] with period=5
            // linreg at offset=0 predicts y at x=4 → 4
            expect(linreg([0, 1, 2, 3, 4], 5)).toBeCloseTo(4, 5);
        });
    });
});
