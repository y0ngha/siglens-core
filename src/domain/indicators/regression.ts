import type { RegressionResult } from '@/domain/types';
import { REGRESSION_PERIOD } from './constants';

/**
 * @internal Ordinary-least-squares fit of `y` on x = [0..len-1].
 *
 * slope = (n·Σxy − Σx·Σy) / (n·Σx² − (Σx)²)
 * r²    = 1 − SS_res / SS_tot, where SS_tot = Σ(y−ȳ)², SS_res = Σ(y − ŷ)².
 * `r2` is `null` when SS_tot = 0 (flat → coefficient of determination undefined).
 *
 * Precondition: y.length >= 2 (callers guarantee period >= 2 before calling ols).
 */
function ols(y: number[]): RegressionResult {
    const n = y.length;
    // x is the fixed index grid [0..n-1]; closed forms avoid building the array.
    const sumX = (n * (n - 1)) / 2;
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
    const sumY = y.reduce((sum, v) => sum + v, 0);
    const sumXY = y.reduce((sum, v, i) => sum + i * v, 0);

    // denom > 0 when n >= 2 (x-variance is non-zero for at least 2 distinct points).
    // The period < 2 guard in calculateRegression guarantees n >= 2 here.
    const denom = n * sumX2 - sumX * sumX;
    const slope = (n * sumXY - sumX * sumY) / denom;

    const intercept = (sumY - slope * sumX) / n;
    const meanY = sumY / n;
    const ssTot = y.reduce((sum, v) => sum + (v - meanY) ** 2, 0);
    if (ssTot === 0) return { slope, r2: null };

    const ssRes = y.reduce(
        (sum, v, i) => sum + (v - (intercept + slope * i)) ** 2,
        0
    );
    return { slope, r2: 1 - ssRes / ssTot };
}

/**
 * @internal Rolling linear-regression slope and R² over the trailing `period`
 * closes (OLS of close on the bar index [0..period-1]).
 *
 * `slope` measures the per-bar drift; `r2` measures how linear the trailing
 * window is (1 = perfectly linear, 0 = no linear fit). `r2` is `null` when the
 * window is flat (SS_tot = 0). Both fields are `null` during the warm-up window
 * (first `period − 1` bars).
 */
export function calculateRegression(
    closes: number[],
    period = REGRESSION_PERIOD
): RegressionResult[] {
    const n = closes.length;
    if (n === 0) return [];
    if (period < 2) return new Array(n).fill({ slope: null, r2: null });

    return closes.map((_, i) => {
        // Trailing window of `period` closes ending at bar i: requires i >= period-1.
        if (i < period - 1) return { slope: null, r2: null };
        return ols(closes.slice(i - period + 1, i + 1));
    });
}
