import { calculateMA } from '@/domain/indicators/ma';
import { calculateRSI } from '@/domain/indicators/rsi';
import { calculateWilliamsR } from '@/domain/indicators/williamsR';
import type { Bar } from '@/domain/types';

/**
 * Short-term washout reading of a daily chart.
 *
 * The reading siglens-trader switched its trading rule to on 2026-09-24 (daily RSI(2) < 10
 * above the 200-day average, replacing the confluence rule), re-measured on independent data
 * for the analysis products.
 *
 * Named as readings of the chart, never as instructions — the same rule that keeps the
 * confluence trigger states out of the agent's tool output altogether.
 */
export type PullbackReading =
    'washoutInUptrend' | 'nearWashoutInUptrend' | 'washoutBelowMa200' | 'none';

/** Result of {@link evaluatePullback}. Every number is taken at the last bar. */
export interface PullbackSnapshot {
    /** The reading at the last bar, from {@link classifyPullback}. */
    reading: PullbackReading;
    /** Last bar's close. */
    close: number;
    /** {@link PULLBACK_TREND_MA_PERIOD}-bar simple moving average of closes — the trend filter. */
    ma200: number;
    /** `(close - ma200) / ma200 * 100`. */
    closeVsMa200Pct: number;
    /** The measured exit reference: the washout is treated as resolved on the first close above it. */
    ma5: number | null;
    /** Williams %R over {@link PULLBACK_WILLIAMS_R_PERIOD} bars — the input the reading is classified on. */
    williamsR: number;
    /**
     * RSI over {@link PULLBACK_RSI_PERIOD} bars — siglens-trader's formulation of the same
     * washout. Reported for reference; the reading is classified on Williams %R, which
     * measured as well or better and is the oscillator the chart prompt already prints.
     */
    rsi2: number | null;
}

/** Long-term trend filter: the reading only calls a washout "in an uptrend" above this average. */
export const PULLBACK_TREND_MA_PERIOD = 200;
/** Exit reference average. */
export const PULLBACK_EXIT_MA_PERIOD = 5;
/** Williams %R lookback — the standard 14, the same series the chart prompt prints. */
export const PULLBACK_WILLIAMS_R_PERIOD = 14;
/** RSI lookback of siglens-trader's formulation. */
export const PULLBACK_RSI_PERIOD = 2;
/** Williams %R at or below this closes in the bottom tenth of the lookback range. */
export const PULLBACK_WASHOUT_WILLIAMS_R = -90;
/** Upper bound of the "near washout" band above {@link PULLBACK_WASHOUT_WILLIAMS_R}. */
export const PULLBACK_NEAR_WILLIAMS_R = -80;

/**
 * What each reading has historically meant, in words a model can quote. `none` carries no
 * base rate.
 *
 * Keep in sync: the "66-75% is the share of such short trades exited at the first close above MA5 (or after about 10 days) that ended in profit, never a win rate or a holding-period result" wording is restated in three places — PULLBACK_BASE_RATES (domain/signals/pullback.ts), the analysis prompt Step 3 rule (domain/analysis/prompt.ts) and the agent pullback rule (domain/agent/buildAgentSystemPrompt.ts). Change all three together.
 *
 * Measured on daily bars, entry at the signal day's close, 0.1% cost per side:
 * point-in-time S&P 500 members 2000-01 → 2020-11 (615 symbols) plus nine large caps and
 * SPY/QQQ 2024-07 → 2026-09, split into five periods (2000–07, 2007–09, 2009–14,
 * 2015–20, 2024–26). "Baseline" is any day above MA200.
 */
export const PULLBACK_BASE_RATES: Readonly<
    Record<Exclude<PullbackReading, 'none'>, string>
> = {
    washoutInUptrend:
        'Historical base rate, not an instruction. Daily closes above MA200 with Williams %R(14) at or below -90 were followed by above-baseline 5-day returns in every period backtested (2000-07, 2007-09, 2009-14, 2015-20, 2024-26); a short-term trade exited on the first close above MA5 (or after 10 days) ended in profit in 66-75% of cases — that is the hit rate of that quick exit, not a win rate and not a result for holding the stock. In broad sell-offs the edge was relative, not absolute (2007-09: -0.71% over 10 days vs -1.03% baseline). About 2/3 of these days show a bearish indicator tally; that is the normal state of this reading, not evidence against it.',
    nearWashoutInUptrend:
        'Historical base rate, not an instruction. Above MA200 with Williams %R(14) between -90 and -80: the same direction as the sell-off reading — 5-day returns were above the baseline in every backtested period, but by a small margin that since 2020 has been statistically indistinguishable from the baseline.',
    washoutBelowMa200:
        'Historical base rate, not an instruction. Sell-offs below MA200 rebounded on average, but 10-day losses worse than -10% were more frequent than in the uptrend reading in almost every backtested period (8.8% vs 3.3% pooled; 1.3-2.8x by period): a higher-risk rebound candidate, not the uptrend reading.',
};

/**
 * Classify a washout from the trend side and Williams %R.
 *
 * `nearWashoutInUptrend` exists only above MA200: below it, a %R between -90 and -80 has no
 * measured meaning distinct from an ordinary down move.
 *
 * @param aboveMa200 - Whether the last close is above its {@link PULLBACK_TREND_MA_PERIOD}-bar average.
 * @param williamsR - Williams %R over {@link PULLBACK_WILLIAMS_R_PERIOD} bars at the same bar.
 * @returns The reading; `'none'` when %R is above {@link PULLBACK_NEAR_WILLIAMS_R} (or above
 *   {@link PULLBACK_WASHOUT_WILLIAMS_R} below MA200).
 */
export function classifyPullback(
    aboveMa200: boolean,
    williamsR: number
): PullbackReading {
    if (williamsR <= PULLBACK_WASHOUT_WILLIAMS_R) {
        return aboveMa200 ? 'washoutInUptrend' : 'washoutBelowMa200';
    }
    if (aboveMa200 && williamsR <= PULLBACK_NEAR_WILLIAMS_R) {
        return 'nearWashoutInUptrend';
    }
    return 'none';
}

const lastOf = (series: readonly (number | null)[]): number | null => {
    const v = series.at(-1);
    return v !== undefined && v !== null && Number.isFinite(v) ? v : null;
};

/**
 * Evaluate the short-term washout reading at the last bar.
 *
 * Pure: the caller passes daily bars sorted oldest-first. Returns `null` when the input
 * cannot support a reading — too few bars for MA200, a non-finite last close, or no
 * Williams %R. Callers should treat `null` as an abstention.
 *
 * The measurement behind {@link PULLBACK_BASE_RATES} is on **daily** bars only. The
 * function does not know the timeframe; rendering it for an intraday chart would put an
 * unmeasured claim in front of the reader, so callers gate on the timeframe.
 *
 * @param bars - Daily bars, oldest first; at least {@link PULLBACK_TREND_MA_PERIOD} are needed.
 * @returns The snapshot at the last bar, or `null` when the reading cannot be taken (too few
 *   bars, a non-finite or non-positive last close, an MA200 that is non-finite or non-positive,
 *   or no Williams %R).
 *
 * @example
 * ```ts
 * const snap = evaluatePullback(dailyBars);
 * if (snap && snap.reading !== 'none') console.log(PULLBACK_BASE_RATES[snap.reading]);
 * ```
 */
export function evaluatePullback(
    bars: readonly Bar[]
): PullbackSnapshot | null {
    if (bars.length < PULLBACK_TREND_MA_PERIOD) return null;
    const last = bars[bars.length - 1];
    if (!last || !Number.isFinite(last.close) || last.close <= 0) return null;
    const close = last.close;
    // `calculateMA` / `calculateWilliamsR` predate `readonly` inputs and take `Bar[]`; both only
    // read the array (map/slice), never mutate it, so widening here cannot change the caller's bars.
    const mutable = bars as Bar[];
    const ma200 = lastOf(calculateMA(mutable, PULLBACK_TREND_MA_PERIOD));
    const williamsR = lastOf(
        calculateWilliamsR(mutable, PULLBACK_WILLIAMS_R_PERIOD)
    );
    if (ma200 === null || ma200 <= 0 || williamsR === null) return null;
    return {
        reading: classifyPullback(close > ma200, williamsR),
        close,
        ma200,
        closeVsMa200Pct: ((close - ma200) / ma200) * 100,
        ma5: lastOf(calculateMA(mutable, PULLBACK_EXIT_MA_PERIOD)),
        williamsR,
        rsi2: lastOf(
            calculateRSI(
                bars.map(b => b.close),
                PULLBACK_RSI_PERIOD
            )
        ),
    };
}
