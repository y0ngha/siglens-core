import { describe, expect, it } from 'vitest';
import { anchoredVwap } from '@/domain/analysis/anchoredVwap';
import type { Bar } from '@/domain/types';

const bar = (i: number, h: number, l: number, c: number, v: number): Bar => ({
    time: i,
    open: c,
    high: h,
    low: l,
    close: c,
    volume: v,
});

describe('anchoredVwap', () => {
    it('마지막 봉에 앵커링하면 전형가격과 같다', () => {
        const bars = [bar(0, 10, 8, 9, 100), bar(1, 12, 10, 11, 50)];
        // anchor at index 1 -> only that bar: (12+10+11)/3 = 11
        expect(anchoredVwap(bars, 1)).toBeCloseTo(11, 6);
    });
    it('앵커 구간 전체에서 전형가격을 거래량 가중한다', () => {
        const bars = [bar(0, 10, 10, 10, 100), bar(1, 20, 20, 20, 300)];
        // anchor 0: (10*100 + 20*300) / 400 = 17.5
        expect(anchoredVwap(bars, 0)).toBeCloseTo(17.5, 6);
    });
    it('범위를 벗어난 앵커는 null을 반환한다', () => {
        expect(anchoredVwap([bar(0, 10, 8, 9, 100)], 5)).toBeNull();
        expect(anchoredVwap([bar(0, 10, 8, 9, 100)], -1)).toBeNull();
    });
    it('누적 거래량이 0 이하이면 null을 반환한다', () => {
        expect(anchoredVwap([bar(0, 10, 8, 9, 0)], 0)).toBeNull();
    });
});
