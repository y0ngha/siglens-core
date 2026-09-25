import { describe, it, expect } from 'vitest';
import {
    classifyPullback,
    evaluatePullback,
    PULLBACK_BASE_RATES,
    PULLBACK_EXIT_MA_PERIOD,
    PULLBACK_NEAR_WILLIAMS_R,
    PULLBACK_TREND_MA_PERIOD,
    PULLBACK_WASHOUT_WILLIAMS_R,
    PULLBACK_WILLIAMS_R_PERIOD,
} from '@/domain/signals/pullback';
import type { PullbackReading } from '@/domain/signals/pullback';
import type { Bar } from '@/domain/types';

/** 종가 배열로 봉을 만든다 — 고가/저가는 종가 ±1. */
function buildBars(closes: number[]): Bar[] {
    return closes.map((c, i) => ({
        time: 1700000000 + i * 86400,
        open: c,
        high: c + 1,
        low: c - 1,
        close: c,
        volume: 1000,
    }));
}

/** `n`개 종가가 `start`에서 `step`씩 선형으로 움직인다. */
const linear = (n: number, start: number, step: number): number[] =>
    Array.from({ length: n }, (_, i) => start + i * step);

const mean = (xs: number[]): number =>
    xs.reduce((sum, x) => sum + x, 0) / xs.length;

/** core 구현과 독립적으로 계산한 마지막 봉의 Williams %R. */
function williamsRAtLast(bars: Bar[]): number {
    const window = bars.slice(-PULLBACK_WILLIAMS_R_PERIOD);
    const hh = Math.max(...window.map(b => b.high));
    const ll = Math.min(...window.map(b => b.low));
    return ((hh - bars.at(-1)!.close) / (hh - ll)) * -100;
}

describe('classifyPullback', () => {
    describe('MA200 위', () => {
        it('%R이 -90 이하면 washoutInUptrend (경계 -90 포함)', () => {
            expect(classifyPullback(true, -95)).toBe('washoutInUptrend');
            expect(classifyPullback(true, PULLBACK_WASHOUT_WILLIAMS_R)).toBe(
                'washoutInUptrend'
            );
        });

        it('%R이 -90 초과 -80 이하면 nearWashoutInUptrend (경계 -80 포함)', () => {
            expect(classifyPullback(true, -85)).toBe('nearWashoutInUptrend');
            expect(classifyPullback(true, PULLBACK_NEAR_WILLIAMS_R)).toBe(
                'nearWashoutInUptrend'
            );
        });

        it('%R이 -80 초과면 none', () => {
            expect(classifyPullback(true, -79.9)).toBe('none');
            expect(classifyPullback(true, -10)).toBe('none');
        });
    });

    describe('MA200 아래', () => {
        it('%R이 -90 이하면 washoutBelowMa200', () => {
            expect(classifyPullback(false, -95)).toBe('washoutBelowMa200');
        });

        it('-90 초과 구간에는 near 판독이 없다 — none', () => {
            expect(classifyPullback(false, -85)).toBe('none');
            expect(classifyPullback(false, -30)).toBe('none');
        });
    });
});

describe('evaluatePullback', () => {
    describe('판독', () => {
        it('상승 추세 끝의 급락 종가는 washoutInUptrend이고 모든 값을 마지막 봉 기준으로 싣는다', () => {
            // 250봉 상승 후 마지막 봉만 14봉 저점 아래로 급락 — MA200보다는 여전히 위.
            const closes = [...linear(249, 100, 0.5), 205];
            const bars = buildBars(closes);

            const snap = evaluatePullback(bars);

            const ma200 = mean(closes.slice(-PULLBACK_TREND_MA_PERIOD));
            expect(snap).not.toBeNull();
            expect(snap!.reading).toBe('washoutInUptrend');
            expect(snap!.close).toBe(205);
            expect(snap!.ma200).toBeCloseTo(ma200, 10);
            expect(snap!.closeVsMa200Pct).toBeCloseTo(
                ((205 - ma200) / ma200) * 100,
                10
            );
            expect(snap!.ma5).toBeCloseTo(
                mean(closes.slice(-PULLBACK_EXIT_MA_PERIOD)),
                10
            );
            expect(snap!.williamsR).toBeCloseTo(williamsRAtLast(bars), 10);
            expect(snap!.williamsR).toBeLessThanOrEqual(
                PULLBACK_WASHOUT_WILLIAMS_R
            );
            // 하루 급락 뒤의 RSI(2)는 과매도 영역이다.
            expect(snap!.rsi2).not.toBeNull();
            expect(snap!.rsi2!).toBeLessThan(10);
        });

        it('하락 추세 끝의 급락 종가는 washoutBelowMa200', () => {
            const closes = [...linear(249, 300, -0.5), 170];
            const snap = evaluatePullback(buildBars(closes));
            expect(snap?.reading).toBe('washoutBelowMa200');
            expect(snap!.closeVsMa200Pct).toBeLessThan(0);
        });

        it('범위 한가운데에서 끝나면 none', () => {
            // 상승 추세, 마지막 14봉이 좁은 박스권이고 종가가 그 중앙.
            const closes = [
                ...linear(236, 100, 0.5),
                ...Array.from({ length: 14 }, (_, i) =>
                    i % 2 === 0 ? 220 : 224
                ),
            ];
            closes[closes.length - 1] = 222;
            const snap = evaluatePullback(buildBars(closes));
            expect(snap?.reading).toBe('none');
        });

        it('14봉 고가=저가(폭 0)면 %R은 중앙값 -50이라 none', () => {
            const bars: Bar[] = [
                ...buildBars(linear(236, 100, 0.2)),
                ...Array.from({ length: 14 }, (_, i) => ({
                    time: 1800000000 + i * 86400,
                    open: 200,
                    high: 200,
                    low: 200,
                    close: 200,
                    volume: 1000,
                })),
            ];
            const snap = evaluatePullback(bars);
            expect(snap?.williamsR).toBe(-50);
            expect(snap?.reading).toBe('none');
        });
    });

    describe('기권(null)', () => {
        it('MA200을 만들 수 없는 짧은 계열(200봉 미만)', () => {
            expect(
                evaluatePullback(buildBars(linear(199, 100, 0.5)))
            ).toBeNull();
        });

        it('빈 배열', () => {
            expect(evaluatePullback([])).toBeNull();
        });

        it('마지막 종가가 비유한값이거나 0 이하', () => {
            const nan = buildBars(linear(250, 100, 0.5));
            nan[nan.length - 1] = { ...nan[nan.length - 1]!, close: NaN };
            expect(evaluatePullback(nan)).toBeNull();

            const zero = buildBars(linear(250, 100, 0.5));
            zero[zero.length - 1] = { ...zero[zero.length - 1]!, close: 0 };
            expect(evaluatePullback(zero)).toBeNull();
        });

        // 아래 세 케이스는 봉 수·마지막 종가 가드를 통과한 입력으로 MA200/%R 가드 자체를 검증한다.
        it('MA200 창 안의 과거 종가가 비유한값이면 MA200을 만들 수 없어 기권한다', () => {
            const bars = buildBars(linear(250, 100, 0.5));
            // 마지막 14봉(%R 창) 밖, MA200 창 안의 봉 — 누적합이 NaN이 된다.
            bars[100] = { ...bars[100]!, close: NaN };
            expect(Number.isFinite(bars.at(-1)!.close)).toBe(true);
            expect(evaluatePullback(bars)).toBeNull();
        });

        it('MA200이 0 이하이면(음수 가격이 섞인 비정상 계열) 기권한다', () => {
            // 과거 종가가 음수라 평균이 음수 — 마지막 종가만 양수.
            const closes = [...Array.from({ length: 249 }, () => -100), 1];
            expect(evaluatePullback(buildBars(closes))).toBeNull();
        });

        it('Williams %R을 만들 수 없으면(창 안 고가가 비유한값) 기권한다', () => {
            const bars = buildBars(linear(250, 100, 0.5));
            // MA200은 종가만 읽으므로 온전하고, %R 창의 최고가만 NaN이 된다.
            bars[bars.length - 1] = { ...bars[bars.length - 1]!, high: NaN };
            expect(evaluatePullback(bars)).toBeNull();
        });
    });
});

describe('PULLBACK_BASE_RATES', () => {
    it('none을 뺀 모든 판독에 기저율 문장이 있고, 지시가 아니라고 밝힌다', () => {
        const readings: Exclude<PullbackReading, 'none'>[] = [
            'washoutInUptrend',
            'nearWashoutInUptrend',
            'washoutBelowMa200',
        ];
        for (const reading of readings) {
            expect(PULLBACK_BASE_RATES[reading]).toContain(
                'not an instruction'
            );
        }
        expect(Object.keys(PULLBACK_BASE_RATES).sort()).toEqual(
            [...readings].sort()
        );
    });
});
