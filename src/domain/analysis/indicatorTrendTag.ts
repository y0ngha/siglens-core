// detectTrend 의 상대 임계값 비율 (윈도 내 최대 절대값의 몇 % 를 'flat' 으로 간주할지).
const INDICATOR_TREND_THRESHOLD_RATIO = 0.01;
// ratio × maxAbs가 0에 수렴할 때 잡음이 rising/falling으로 오분류되는 것을 방지.
const INDICATOR_TREND_MIN_THRESHOLD = 1e-8;

/** @internal The `[rising]` / `[falling]` / `[flat]` tag the indicator lines print. */
export type IndicatorTrend = 'rising' | 'falling' | 'flat';

/**
 * @internal The direction a series moved over its last `sampleCount` values: the slope of a
 * least-squares line through the finite ones, against 1% of the window's largest magnitude.
 * `null` with fewer than two values. One implementation for the prompt's tags and the cards
 * built from the same lines, so the two can never disagree.
 */
export const detectTrend = (
    values: readonly (number | null)[],
    sampleCount: number
): IndicatorTrend | null => {
    const nonNull = values
        .slice(-sampleCount)
        .filter((v): v is number => v !== null);
    if (nonNull.length < 2) return null;

    // 선형 회귀 slope 기반 — 극단치 whipsaw에 강하고 windowSpan은 fitted line 총 변화량.
    const n = nonNull.length;
    const xMean = (n - 1) / 2;
    const yMean = nonNull.reduce((sum, v) => sum + v, 0) / n;
    const numerator = nonNull.reduce(
        (sum, v, i) => sum + (i - xMean) * (v - yMean),
        0
    );
    const denominator = nonNull.reduce(
        (sum, _, i) => sum + (i - xMean) ** 2,
        0
    );
    if (denominator === 0) return 'flat';
    const windowSpan = (numerator / denominator) * (n - 1);

    // 지표 스케일 비례 임계값 — MACD/CCI/CMF 영점 교차 구간의 잡음 오분류 방지.
    const windowMaxAbs = nonNull.reduce(
        (max, v) => Math.max(max, Math.abs(v)),
        0
    );
    const threshold = Math.max(
        windowMaxAbs * INDICATOR_TREND_THRESHOLD_RATIO,
        INDICATOR_TREND_MIN_THRESHOLD
    );
    if (windowSpan > threshold) return 'rising';
    if (windowSpan < -threshold) return 'falling';
    return 'flat';
};
