import { OUTCOME_HORIZON_BARS } from '@/domain/outcomes/constants';
import type {
    ForwardReturnLabel,
    OutcomeWindow,
} from '@/domain/outcomes/types';
import {
    anchorIndex,
    baselineMean,
    closeSeries,
    pctChange,
} from '@/domain/outcomes/windowSeries';

/**
 * Plain forward returns of the window at each of `OUTCOME_HORIZON_BARS`, each next to the
 * symbol's own mean return over the same number of bars (the baseline), so a return is
 * never read without what holding the symbol at random would have paid.
 *
 * `returnPct(h)` is the close `h` bars after the anchor against the reference price. The
 * baseline averages every `h`-bar return inside the window's closes (the up-to-60 closes
 * before the anchor and the forward ones) and is `null` below `BASELINE_MIN_SAMPLES`
 * starts. A horizon the window does not reach has `returnPct: null`, never `0`.
 *
 * @param window - The window from `buildOutcomeWindow`.
 * @returns One entry per horizon, in `OUTCOME_HORIZON_BARS` order.
 */
export function computeForwardReturns(
    window: OutcomeWindow
): ForwardReturnLabel[] {
    const series = closeSeries(window);
    const i0 = anchorIndex(window);
    return OUTCOME_HORIZON_BARS.map(h => {
        const baseline = baselineMean(series, h);
        return {
            h,
            returnPct:
                i0 + h < series.length
                    ? pctChange(window.referencePrice, series[i0 + h])
                    : null,
            baselinePct: baseline.pct,
            baselineN: baseline.n,
        };
    });
}
