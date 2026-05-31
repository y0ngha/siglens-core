import { describe, it, expect } from 'vitest';
import { calculateVolumeProfile } from '@/domain/indicators/volume-profile';
import {
    VP_MIN_BARS,
    VP_DEFAULT_ROW_SIZE,
} from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBar(high: number, low: number, close: number, time: number): Bar {
    return { time, open: close, high, low, close, volume: 1000 };
}

function makeVolBar(price: number, volume: number, time: number): Bar {
    return { time, open: price, high: price, low: price, close: price, volume };
}

describe('calculateVolumeProfile', () => {
    describe('bars가 VP_MIN_BARS 미만일 때', () => {
        it('null을 반환한다', () => {
            const bars = Array.from({ length: VP_MIN_BARS - 1 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            expect(calculateVolumeProfile(bars)).toBeNull();
        });
    });

    describe('price range가 0일 때', () => {
        it('null을 반환한다', () => {
            const bars = Array.from({ length: VP_MIN_BARS }, () =>
                makeBar(100, 100, 100, 0)
            );
            expect(calculateVolumeProfile(bars)).toBeNull();
        });
    });

    describe('충분한 데이터가 있을 때', () => {
        it('결과가 null이 아니다', () => {
            const bars = Array.from({ length: VP_MIN_BARS + 5 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            expect(calculateVolumeProfile(bars)).not.toBeNull();
        });

        it('profile 배열 길이는 rowSize와 같다', () => {
            const bars = Array.from({ length: VP_MIN_BARS + 5 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateVolumeProfile(bars, VP_DEFAULT_ROW_SIZE);
            expect(result?.profile).toHaveLength(VP_DEFAULT_ROW_SIZE);
        });

        it('poc는 vah보다 작거나 같고 val보다 크거나 같다', () => {
            const bars = Array.from({ length: VP_MIN_BARS + 5 }, (_, i) =>
                makeBar(100 + (i % 10), 90 + (i % 8), 95 + (i % 9), i)
            );
            const result = calculateVolumeProfile(bars);
            if (result) {
                expect(result.poc).toBeLessThanOrEqual(result.vah);
                expect(result.poc).toBeGreaterThanOrEqual(result.val);
            }
        });

        it('vah >= val이다', () => {
            const bars = Array.from({ length: VP_MIN_BARS + 5 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateVolumeProfile(bars);
            if (result) {
                expect(result.vah).toBeGreaterThanOrEqual(result.val);
            }
        });

        it('비대칭 분포에서 POC와 70% 값영역 확장 경로가 핀 고정된다', () => {
            // high=low=close=price → barRange 0 → 각 봉 거래량이 한 버킷에 전부 들어간다.
            // lowMin=0, highMax=5, rowSize=5 → bucketSize=1.
            // 버킷 [0,1)[1,2)[2,3)[3,4)[4,5], center 0.5/1.5/2.5/3.5/4.5.
            // 가격→버킷: 0→b0, 1→b1, 2→b2, 3→b3, 5→b4(마지막 버킷 경계 포함).
            // 버킷 거래량 = [10, 40, 100, 30, 5], total=185, POC=b2(center 2.5).
            //   target = 0.7 × 185 = 129.5
            //   start: vah=val=2, acc=100
            //   step: nextAbove=b3=30, nextBelow=b1=40 → 30 >= 40 거짓 → 아래로 확장
            //         val=1, acc=140 ≥ 129.5 → 종료
            //   ⇒ POC center 2.5, VAH center 2.5(b2), VAL center 1.5(b1)
            const groups: ReadonlyArray<{
                price: number;
                volume: number;
                count: number;
            }> = [
                { price: 2, volume: 10, count: 10 }, // b2 total 100 (POC)
                { price: 1, volume: 5, count: 8 }, // b1 total 40
                { price: 3, volume: 5, count: 6 }, // b3 total 30
                { price: 0, volume: 2, count: 5 }, // b0 total 10
                { price: 5, volume: 5, count: 1 }, // b4 total 5
            ];
            const bars = groups.flatMap(({ price, volume, count }) =>
                Array.from({ length: count }, () => ({ price, volume }))
            );
            expect(bars).toHaveLength(30); // ≥ VP_MIN_BARS
            const result = calculateVolumeProfile(
                bars.map((b, i) => makeVolBar(b.price, b.volume, i)),
                5
            );
            expect(result?.poc).toBeCloseTo(2.5, 10);
            expect(result?.vah).toBeCloseTo(2.5, 10);
            expect(result?.val).toBeCloseTo(1.5, 10);
        });

        it('profile 각 row에 price와 volume이 있다', () => {
            const bars = Array.from({ length: VP_MIN_BARS + 5 }, (_, i) =>
                makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateVolumeProfile(bars);
            result?.profile.forEach(row => {
                expect(typeof row.price).toBe('number');
                expect(typeof row.volume).toBe('number');
                expect(row.volume).toBeGreaterThanOrEqual(0);
            });
        });
    });
});
