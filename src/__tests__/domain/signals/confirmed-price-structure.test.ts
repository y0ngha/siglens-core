import { describe, it, expect } from 'vitest';
import {
    detectGapDown,
    detectGapUp,
    detectNew52WeekHigh,
    detectNew52WeekLow,
} from '@/domain/signals/confirmed';
import { detectSignals } from '@/domain/signals';
import {
    FIFTY_TWO_WEEK_LOOKBACK_DAYS,
    FIFTY_TWO_WEEK_MIN_COVERAGE_DAYS,
    GAP_MIN_ATR_MULT,
} from '@/domain/signals/constants';
import { EMPTY_INDICATOR_RESULT } from '@/domain/indicators/constants';
import { SECONDS_PER_DAY } from '@/domain/constants/time';
import type { Bar, IndicatorResult } from '@/domain/types';

const T0 = 1_600_000_000;

/** `n` daily bars (high 101 / low 99 / close 100), with per-index overrides. */
function dailyBars(
    n: number,
    overrides: Record<number, Partial<Bar>> = {}
): Bar[] {
    return Array.from({ length: n }, (_, i) => ({
        time: T0 + i * SECONDS_PER_DAY,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1000,
        ...overrides[i],
    }));
}

/** A two-bar series: `prev` then `last` (opening at its own close), one day apart. */
function pair(prev: Partial<Bar>, last: Partial<Bar>): Bar[] {
    return dailyBars(2, { 0: prev, 1: { open: last.close, ...last } });
}

const withAtr = (atr: (number | null)[]): IndicatorResult => ({
    ...EMPTY_INDICATOR_RESULT,
    atr,
});

describe('detectNew52WeekHigh', () => {
    // 366 daily bars: the window [last − 365d, last) starts at bar 0.
    const N = FIFTY_TWO_WEEK_LOOKBACK_DAYS + 1;
    const LAST = N - 1;

    it('마지막 종가가 52주 창의 최고가를 넘으면 bullish 확정 신호를 낸다', () => {
        const bars = dailyBars(N, { [LAST]: { high: 103, close: 102 } });
        expect(detectNew52WeekHigh(bars, EMPTY_INDICATOR_RESULT)).toEqual({
            type: 'new_52w_high',
            direction: 'bullish',
            phase: 'confirmed',
            detectedAt: LAST,
        });
    });

    it('마지막 종가가 창 최고가와 같으면(초과 아님) 발화하지 않는다', () => {
        const bars = dailyBars(N, { [LAST]: { high: 102, close: 101 } });
        expect(detectNew52WeekHigh(bars, EMPTY_INDICATOR_RESULT)).toBeNull();
    });

    it(`창 첫 봉이 마지막 봉보다 정확히 ${FIFTY_TWO_WEEK_MIN_COVERAGE_DAYS}일 앞이면 커버리지 충족으로 발화한다`, () => {
        const n = FIFTY_TWO_WEEK_MIN_COVERAGE_DAYS + 1;
        const bars = dailyBars(n, { [n - 1]: { high: 103, close: 102 } });
        expect(
            detectNew52WeekHigh(bars, EMPTY_INDICATOR_RESULT)
        ).not.toBeNull();
    });

    it(`이력이 ${FIFTY_TWO_WEEK_MIN_COVERAGE_DAYS}일에 못 미치면(커버리지 부족) null을 반환한다`, () => {
        const n = FIFTY_TWO_WEEK_MIN_COVERAGE_DAYS;
        const bars = dailyBars(n, { [n - 1]: { high: 103, close: 102 } });
        expect(detectNew52WeekHigh(bars, EMPTY_INDICATOR_RESULT)).toBeNull();
    });

    it('365일보다 오래된 봉의 고가는 창 밖이라 무시한다', () => {
        const n = FIFTY_TWO_WEEK_LOOKBACK_DAYS + 2; // bar 0 is 366 days back
        const bars = dailyBars(n, {
            0: { high: 500 },
            [n - 1]: { high: 103, close: 102 },
        });
        expect(
            detectNew52WeekHigh(bars, EMPTY_INDICATOR_RESULT)
        ).not.toBeNull();
    });

    it('정확히 365일 앞의 봉은 창에 포함된다', () => {
        const bars = dailyBars(N, {
            0: { high: 500 },
            [LAST]: { high: 103, close: 102 },
        });
        expect(detectNew52WeekHigh(bars, EMPTY_INDICATOR_RESULT)).toBeNull();
    });

    it('봉이 2개 미만이면 null을 반환한다', () => {
        expect(
            detectNew52WeekHigh(dailyBars(1), EMPTY_INDICATOR_RESULT)
        ).toBeNull();
    });

    it('창 안에 이전 봉이 하나도 없으면(직전 봉이 1년 넘게 전) null을 반환한다', () => {
        const bars: Bar[] = [
            { ...dailyBars(1)[0] },
            {
                ...dailyBars(1)[0],
                time: T0 + 400 * SECONDS_PER_DAY,
                high: 103,
                close: 102,
            },
        ];
        expect(detectNew52WeekHigh(bars, EMPTY_INDICATOR_RESULT)).toBeNull();
    });

    it('일봉이 아니어도 시간 기준 1년치가 없으면 발화하지 않는다 (시간봉 500개)', () => {
        const hourly = Array.from({ length: 500 }, (_, i) => ({
            time: T0 + i * 3600,
            open: 100,
            high: 101,
            low: 99,
            close: i === 499 ? 102 : 100,
            volume: 1000,
        }));
        expect(detectNew52WeekHigh(hourly, EMPTY_INDICATOR_RESULT)).toBeNull();
    });
});

describe('detectNew52WeekLow', () => {
    const N = FIFTY_TWO_WEEK_LOOKBACK_DAYS + 1;
    const LAST = N - 1;

    it('마지막 종가가 52주 창의 최저가 아래면 bearish 확정 신호를 낸다', () => {
        const bars = dailyBars(N, { [LAST]: { low: 97, close: 98 } });
        expect(detectNew52WeekLow(bars, EMPTY_INDICATOR_RESULT)).toEqual({
            type: 'new_52w_low',
            direction: 'bearish',
            phase: 'confirmed',
            detectedAt: LAST,
        });
    });

    it('마지막 종가가 창 최저가와 같으면 발화하지 않는다', () => {
        const bars = dailyBars(N, { [LAST]: { low: 98, close: 99 } });
        expect(detectNew52WeekLow(bars, EMPTY_INDICATOR_RESULT)).toBeNull();
    });

    it('커버리지가 부족하면 null을 반환한다', () => {
        const n = FIFTY_TWO_WEEK_MIN_COVERAGE_DAYS;
        const bars = dailyBars(n, { [n - 1]: { low: 97, close: 98 } });
        expect(detectNew52WeekLow(bars, EMPTY_INDICATOR_RESULT)).toBeNull();
    });
});

describe('detectGapUp', () => {
    it(`갭이 정확히 GAP_MIN_ATR_MULT(${GAP_MIN_ATR_MULT}) × ATR이면 발화한다`, () => {
        const bars = pair(
            { high: 100 },
            { low: 100.25, high: 102, close: 101 }
        );
        expect(detectGapUp(bars, withAtr([1, 1]))).toEqual({
            type: 'gap_up',
            direction: 'bullish',
            phase: 'confirmed',
            detectedAt: 1,
        });
    });

    it('갭이 GAP_MIN_ATR_MULT × ATR보다 작으면 발화하지 않는다', () => {
        const bars = pair(
            { high: 100 },
            { low: 100.24, high: 102, close: 101 }
        );
        expect(detectGapUp(bars, withAtr([1, 1]))).toBeNull();
    });

    it('ATR이 없으면 저가가 전봉 고가 위이기만 하면 발화한다', () => {
        const bars = pair(
            { high: 100 },
            { low: 100.01, high: 102, close: 101 }
        );
        expect(detectGapUp(bars, EMPTY_INDICATOR_RESULT)).not.toBeNull();
    });

    it('마지막 ATR 값이 null이면 ATR 없음으로 취급한다', () => {
        const bars = pair(
            { high: 100 },
            { low: 100.01, high: 102, close: 101 }
        );
        expect(detectGapUp(bars, withAtr([1, null]))).not.toBeNull();
    });

    it('저가가 전봉 고가와 같으면(갭 없음) ATR이 없어도 발화하지 않는다', () => {
        const bars = pair({ high: 100 }, { low: 100, high: 102, close: 101 });
        expect(detectGapUp(bars, EMPTY_INDICATOR_RESULT)).toBeNull();
    });

    it('봉이 2개 미만이면 null을 반환한다', () => {
        expect(detectGapUp(dailyBars(1), EMPTY_INDICATOR_RESULT)).toBeNull();
    });
});

describe('detectGapDown', () => {
    it('갭이 정확히 GAP_MIN_ATR_MULT × ATR이면 bearish로 발화한다', () => {
        const bars = pair({ low: 100 }, { high: 99.75, low: 98, close: 99 });
        expect(detectGapDown(bars, withAtr([1, 1]))).toEqual({
            type: 'gap_down',
            direction: 'bearish',
            phase: 'confirmed',
            detectedAt: 1,
        });
    });

    it('갭이 GAP_MIN_ATR_MULT × ATR보다 작으면 발화하지 않는다', () => {
        const bars = pair({ low: 100 }, { high: 99.76, low: 98, close: 99 });
        expect(detectGapDown(bars, withAtr([1, 1]))).toBeNull();
    });

    it('봉이 2개 미만이면 null을 반환한다', () => {
        expect(detectGapDown(dailyBars(1), EMPTY_INDICATOR_RESULT)).toBeNull();
    });

    it('고가가 전봉 저가와 같으면 발화하지 않는다', () => {
        const bars = pair({ low: 100 }, { high: 100, low: 98, close: 99 });
        expect(detectGapDown(bars, EMPTY_INDICATOR_RESULT)).toBeNull();
    });
});

describe('detectSignals — 가격 구조 신호 배선', () => {
    it('52주 신고가와 갭 상승이 detectSignals 결과에 포함된다', () => {
        const n = FIFTY_TWO_WEEK_LOOKBACK_DAYS + 1;
        const bars = dailyBars(n, {
            [n - 1]: { open: 103, low: 102, high: 104, close: 103.5 },
        });
        const types = detectSignals(bars, EMPTY_INDICATOR_RESULT).map(
            s => s.type
        );
        expect(types).toEqual(
            expect.arrayContaining(['new_52w_high', 'gap_up'])
        );
    });

    it('52주 신저가와 갭 하락이 detectSignals 결과에 포함된다', () => {
        const n = FIFTY_TWO_WEEK_LOOKBACK_DAYS + 1;
        const bars = dailyBars(n, {
            [n - 1]: { open: 97, low: 96, high: 98, close: 96.5 },
        });
        const types = detectSignals(bars, EMPTY_INDICATOR_RESULT).map(
            s => s.type
        );
        expect(types).toEqual(
            expect.arrayContaining(['new_52w_low', 'gap_down'])
        );
    });
});
