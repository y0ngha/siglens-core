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
