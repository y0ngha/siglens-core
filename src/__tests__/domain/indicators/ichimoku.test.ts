import { describe, it, expect } from 'vitest';
import {
    calculateIchimoku,
    calculateIchimokuFutureCloud,
} from '@/domain/indicators/ichimoku';
import {
    ICHIMOKU_CONVERSION_PERIOD,
    ICHIMOKU_SPAN_B_PERIOD,
    ICHIMOKU_DISPLACEMENT,
} from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBar(high: number, low: number, close: number, time: number): Bar {
    return { time, open: close, high, low, close, volume: 1000 };
}

const MIN_BARS = ICHIMOKU_SPAN_B_PERIOD + ICHIMOKU_DISPLACEMENT;

describe('calculateIchimoku', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateIchimoku([])).toEqual([]);
        });
    });

    describe('데이터가 부족할 때', () => {
        it('반환 배열 길이는 입력과 같다', () => {
            const bars = Array.from({ length: 5 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateIchimoku(bars);
            expect(result).toHaveLength(5);
        });

        it('conversion period 미만이면 tenkan이 null이다', () => {
            const bars = Array.from(
                { length: ICHIMOKU_CONVERSION_PERIOD - 1 },
                (_, i) => makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateIchimoku(bars);
            result.forEach(r => {
                expect(r.tenkan).toBeNull();
            });
        });
    });

    describe('충분한 데이터가 있을 때', () => {
        it('마지막 결과에서 tenkan과 kijun이 null이 아니다', () => {
            const bars = Array.from({ length: MIN_BARS + 5 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateIchimoku(bars);
            const last = result[result.length - 1];
            expect(last.tenkan).not.toBeNull();
            expect(last.kijun).not.toBeNull();
        });

        it('반환 배열 길이는 입력과 같다', () => {
            const bars = Array.from({ length: MIN_BARS + 5 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateIchimoku(bars);
            expect(result).toHaveLength(MIN_BARS + 5);
        });

        it('tenkan은 high+low의 중간값이다', () => {
            const bars = Array.from(
                { length: ICHIMOKU_CONVERSION_PERIOD + 5 },
                (_, i) => makeBar(110, 90, 100, i)
            );
            const result = calculateIchimoku(bars);
            const last = result[result.length - 1];
            expect(last.tenkan).not.toBeNull();
            expect(last.tenkan).toBeCloseTo(100);
        });

        it('kijun은 high+low의 중간값이다', () => {
            const bars = Array.from({ length: MIN_BARS + 5 }, (_, i) =>
                makeBar(110, 90, 100, i)
            );
            const result = calculateIchimoku(bars);
            const last = result[result.length - 1];
            expect(last.kijun).not.toBeNull();
            expect(last.kijun).toBeCloseTo(100);
        });

        it('senkouA와 senkouB의 계산값이 명세와 일치한다', () => {
            const bars = Array.from({ length: MIN_BARS + 5 }, (_, i) =>
                makeBar(110, 90, 100, i)
            );
            const result = calculateIchimoku(bars);
            const last = result[result.length - 1];
            expect(last.senkouA).not.toBeNull();
            expect(last.senkouA).toBeCloseTo(100);
            expect(last.senkouB).not.toBeNull();
            expect(last.senkouB).toBeCloseTo(100);
        });

        it('displacement만큼 이전 bar가 없으면 senkouA와 senkouB가 null이다', () => {
            const bars = Array.from({ length: MIN_BARS + 5 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateIchimoku(bars);
            // 처음 DISPLACEMENT개는 sourceIndex < 0이므로 null
            for (let i = 0; i < ICHIMOKU_DISPLACEMENT; i++) {
                expect(result[i].senkouA).toBeNull();
                expect(result[i].senkouB).toBeNull();
            }
        });
    });
});

describe('calculateIchimokuFutureCloud', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateIchimokuFutureCloud([])).toEqual([]);
        });
    });

    describe('데이터가 displacement보다 짧을 때', () => {
        it('미래 구름 값은 NaN이 아니라 null이다', () => {
            const bars = Array.from(
                { length: ICHIMOKU_DISPLACEMENT - 1 },
                (_, i) => makeBar(100 + i, 90 + i, 95 + i, i)
            );

            const result = calculateIchimokuFutureCloud(bars);

            expect(result).toHaveLength(ICHIMOKU_DISPLACEMENT);
            result.forEach(point => {
                expect(point.senkouA).toBeNull();
                expect(point.senkouB).toBeNull();
            });
        });
    });

    describe('충분한 데이터가 있을 때', () => {
        it('반환 배열 길이는 displacement와 같다', () => {
            const bars = Array.from({ length: MIN_BARS + 5 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateIchimokuFutureCloud(bars);
            expect(result).toHaveLength(ICHIMOKU_DISPLACEMENT);
        });

        it('각 포인트는 senkouA와 senkouB를 가진다', () => {
            const bars = Array.from({ length: MIN_BARS + 10 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateIchimokuFutureCloud(bars);
            result.forEach(point => {
                expect('senkouA' in point).toBe(true);
                expect('senkouB' in point).toBe(true);
            });
        });

        it('고정 입력(high=110, low=90)에서 senkouA와 senkouB가 명세와 일치한다', () => {
            // high=110, low=90 고정: 모든 sliding window 최댓값=110, 최솟값=90
            // tenkan = kijun = (110+90)/2 = 100, senkouA = (100+100)/2 = 100, senkouB = (110+90)/2 = 100
            const bars = Array.from({ length: MIN_BARS + 10 }, (_, i) =>
                makeBar(110, 90, 100, i)
            );
            const result = calculateIchimokuFutureCloud(bars);
            result.forEach(point => {
                expect(point.senkouA).toBeCloseTo(100, 5);
                expect(point.senkouB).toBeCloseTo(100, 5);
            });
        });
    });
});
