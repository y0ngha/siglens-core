import { describe, it, expect } from 'vitest';
import { calculateSqueezeMomentum } from '@/domain/indicators/squeezeMomentum';
import {
    SQUEEZE_MOMENTUM_BB_LENGTH,
    SQUEEZE_MOMENTUM_KC_LENGTH,
    SQUEEZE_MOMENTUM_KC_MULT,
    SQUEEZE_MOMENTUM_MIN_BARS,
} from '@/domain/indicators/constants';
import type { Bar } from '@/domain/types';

function makeBar(high: number, low: number, close: number, time: number): Bar {
    return { time, open: close, high, low, close, volume: 1000 };
}

describe('calculateSqueezeMomentum', () => {
    describe('빈 배열일 때', () => {
        it('빈 배열을 반환한다', () => {
            expect(calculateSqueezeMomentum([])).toEqual([]);
        });
    });

    describe('충분한 데이터가 없을 때', () => {
        it('전부 momentum이 null이다', () => {
            const bars = Array.from(
                { length: SQUEEZE_MOMENTUM_MIN_BARS - 1 },
                (_, i) => makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateSqueezeMomentum(bars);
            result.forEach(r => {
                expect(r.momentum).toBeNull();
            });
        });
    });

    describe('충분한 데이터가 있을 때', () => {
        it('반환 배열 길이는 입력과 같다', () => {
            const bars = Array.from(
                { length: SQUEEZE_MOMENTUM_MIN_BARS + 5 },
                (_, i) => makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateSqueezeMomentum(
                bars,
                SQUEEZE_MOMENTUM_BB_LENGTH,
                SQUEEZE_MOMENTUM_KC_LENGTH,
                SQUEEZE_MOMENTUM_KC_MULT
            );
            expect(result).toHaveLength(SQUEEZE_MOMENTUM_MIN_BARS + 5);
        });

        it('마지막 결과의 momentum이 null이 아니다', () => {
            const bars = Array.from(
                { length: SQUEEZE_MOMENTUM_MIN_BARS + 5 },
                (_, i) => makeBar(100 + i * 0.5, 90 + i * 0.5, 95 + i * 0.5, i)
            );
            const result = calculateSqueezeMomentum(bars);
            const last = result[result.length - 1];
            expect(last.momentum).not.toBeNull();
        });

        it('sqzOn, sqzOff, noSqz 중 정확히 하나가 true이다', () => {
            const bars = Array.from(
                { length: SQUEEZE_MOMENTUM_MIN_BARS + 5 },
                (_, i) => makeBar(100 + i * 0.5, 90 + i * 0.5, 95 + i * 0.5, i)
            );
            const result = calculateSqueezeMomentum(bars);
            result.forEach(r => {
                if (r.sqzOn !== null && r.sqzOff !== null && r.noSqz !== null) {
                    const trueCount = [r.sqzOn, r.sqzOff, r.noSqz].filter(
                        Boolean
                    ).length;
                    expect(trueCount).toBe(1);
                }
            });
        });

        it('increasing은 boolean이거나 null이다', () => {
            const bars = Array.from(
                { length: SQUEEZE_MOMENTUM_MIN_BARS + 5 },
                (_, i) => makeBar(100 + i, 90 + i, 95 + i, i)
            );
            const result = calculateSqueezeMomentum(bars);
            result.forEach(r => {
                if (r.increasing !== null) {
                    expect(typeof r.increasing).toBe('boolean');
                }
            });
        });

        it('선형 step=0.5 bars에서 첫 유효한 momentum은 4.75이다', () => {
            // high=100+i*0.5, low=90+i*0.5, close=95+i*0.5
            // delta[i] = close[i] - ((highestHigh+lowestLow)/2 + SMA(close,n))/2
            //          = (95+0.5i) - ((100+0.5i + 90+0.5*(i-19))/2 + (95+0.5i-19/4))/2
            //          = 4.75 (constant for all valid i)
            // linreg(constant=4.75, kcLength) = 4.75
            const bars = Array.from(
                { length: SQUEEZE_MOMENTUM_MIN_BARS + 5 },
                (_, i) => makeBar(100 + i * 0.5, 90 + i * 0.5, 95 + i * 0.5, i)
            );
            const result = calculateSqueezeMomentum(bars);
            const firstValid = result.find(r => r.momentum !== null);
            expect(firstValid?.momentum).toBeCloseTo(4.75, 5);
        });
    });
});
