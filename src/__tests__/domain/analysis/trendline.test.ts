import { describe, it, expect } from 'vitest';
import { extendTrendline } from '@/domain/analysis/trendline';
import type { Trendline } from '@/domain/types';

describe('extendTrendline', () => {
    const baseTrendline: Trendline = {
        direction: 'ascending',
        start: { time: 1000, price: 100 },
        end: { time: 2000, price: 110 },
    };

    it('선형 외삽으로 targetTime의 가격을 계산한다', () => {
        const result = extendTrendline(baseTrendline, 3000);
        // slope = (110 - 100) / (2000 - 1000) = 0.01
        // price = 100 + 0.01 * (3000 - 1000) = 120
        expect(result.time).toBe(3000);
        expect(result.price).toBeCloseTo(120);
    });

    it('targetTime이 start.time과 같으면 start.price를 반환한다', () => {
        const result = extendTrendline(baseTrendline, 1000);
        expect(result.price).toBeCloseTo(100);
    });

    it('timeDelta가 0이면 end.price를 그대로 반환한다', () => {
        const trendline: Trendline = {
            direction: 'ascending',
            start: { time: 1000, price: 100 },
            end: { time: 1000, price: 105 },
        };

        const result = extendTrendline(trendline, 2000);

        expect(result.time).toBe(2000);
        expect(result.price).toBe(105);
    });

    it('하강 추세선도 올바르게 외삽한다', () => {
        const descending: Trendline = {
            direction: 'descending',
            start: { time: 0, price: 200 },
            end: { time: 100, price: 100 },
        };

        const result = extendTrendline(descending, 200);
        // slope = (100 - 200) / 100 = -1
        // price = 200 + (-1) * (200 - 0) = 0
        expect(result.price).toBeCloseTo(0);
    });
});
