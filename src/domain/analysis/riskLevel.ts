import { newsDrivenWashoutEvent } from '@/domain/analysis/confluenceSection';
import { ATR_DEFAULT_PERIOD } from '@/domain/indicators/constants';
import { calculateATR } from '@/domain/indicators/atr';
import { evaluatePullback } from '@/domain/signals/pullback';
import type { RiskLevel, RiskLevelInputs } from '@/domain/types';

/** ATR% (of close, daily scale) at which volatility adds 1 / 2 / 3 points. */
export const RISK_ATR_PCT_STEPS = [2.5, 4, 6] as const;
/** Intraday ATR% is multiplied by this before comparing with the daily-scale steps. */
export const INTRADAY_ATR_SCALE = 3;
/** Points for a close at or under MA200 (daily charts). */
export const RISK_BELOW_MA200_POINTS = 1;
/** Extra points when the pullback reading is `washoutBelowMa200`. */
export const RISK_WASHOUT_BELOW_MA200_POINTS = 1;
/** Points for a qualifying company event in the last sessions. */
export const RISK_EVENT_POINTS = 2;
/** Bars (including the last) whose highest close the drawdown is measured from. */
export const RISK_DRAWDOWN_LOOKBACK_BARS = 60;
/** Drawdown from that high, in percent, at which the factor adds 1 / 2 points. */
export const RISK_DRAWDOWN_PCT_STEPS = [10, 20] as const;
/** Score at or above this is `medium`. */
export const RISK_MEDIUM_MIN_SCORE = 2;
/** Score at or above this is `high`. */
export const RISK_HIGH_MIN_SCORE = 5;

const stepsReached = (value: number, steps: readonly number[]): number =>
    steps.filter(step => value >= step).length;

/** The raw point score — exposed for calibration and tests. @internal */
export function scoreRisk(inputs: RiskLevelInputs): number {
    const { bars, timeframe, events = [], earningsDates } = inputs;
    const last = bars.at(-1);
    if (last === undefined || !(last.close > 0)) return 0;
    const daily = timeframe === '1Day';

    const atr = calculateATR(bars, ATR_DEFAULT_PERIOD).at(-1) ?? null;
    const atrPoints =
        atr !== null && atr > 0
            ? stepsReached(
                  (daily ? 1 : INTRADAY_ATR_SCALE) * ((atr / last.close) * 100),
                  RISK_ATR_PCT_STEPS
              )
            : 0;
    if (!daily) return atrPoints;

    const pullback = evaluatePullback(bars);
    const maPoints =
        pullback !== null && pullback.close <= pullback.ma200
            ? RISK_BELOW_MA200_POINTS
            : 0;
    const washoutPoints =
        pullback?.reading === 'washoutBelowMa200'
            ? RISK_WASHOUT_BELOW_MA200_POINTS
            : 0;
    const eventPoints =
        newsDrivenWashoutEvent(events, bars, earningsDates) !== null
            ? RISK_EVENT_POINTS
            : 0;
    const high = Math.max(
        ...bars.slice(-RISK_DRAWDOWN_LOOKBACK_BARS).map(b => b.close)
    );
    const drawdownPoints = stepsReached(
        ((high - last.close) / high) * 100,
        RISK_DRAWDOWN_PCT_STEPS
    );
    return atrPoints + maPoints + washoutPoints + eventPoints + drawdownPoints;
}

/**
 * Deterministic `riskLevel`.
 *
 * The model used to pick the enum freely: the schema gave no rubric, and every
 * locale is its own LLM run, so the same analysis time came back "high" in Korean
 * and "medium" in English. The level is now a small point score over facts core
 * already has for the last bar; the pipeline overwrites the model's value with it,
 * so every locale of the same inputs gets the same level.
 *
 * Rationale per component — each is a plain, separately explainable reason a
 * position in this chart is riskier than average:
 * - **Volatility** (ATR(14) / close): the size of a typical bar. Cuts are daily-scale;
 *   intraday bars are scaled up by {@link INTRADAY_ATR_SCALE} (the same 6% vs 2%
 *   daily/intraday ratio the extreme-volatility sizing note uses).
 * - **Long-term trend** (daily only): a close at or under MA200, and the pullback
 *   reading `washoutBelowMa200` on top of it (measured: 10-day losses worse than
 *   -10% were 1.3-2.8x as frequent as in the uptrend reading).
 * - **Company event**: a high/medium-impact, non-bullish earnings (a real report
 *   date, see `isCompanyEarningsEvent`), guidance or regulation event in the last
 *   3 sessions — the same gate that suspends the washout verdict.
 * - **Drawdown** (daily only): how far the close sits below the highest close of
 *   the last {@link RISK_DRAWDOWN_LOOKBACK_BARS} bars. Intraday charts skip it:
 *   60 intraday bars span hours to days, which says little about the position.
 *
 * Which numbers are measured and which are judgement calls (DS-3):
 * - Measured: the washout-below-MA200 risk (10-day losses worse than -10% were
 *   1.3-2.8x as frequent), and the 6% daily ATR "extreme" line shared with the
 *   sizing note.
 * - Judgement calls, not measured: ATR steps 2.5 / 4 / 6%, the x3 intraday
 *   scale, the MA200 and event point weights, drawdown steps 10 / 20% over 60
 *   bars, and the level cuts (medium >= 2, high >= 5). The cuts were chosen from
 *   the spread over a 38-symbol calibration (low 45.9 / medium 32.6 / high
 *   21.5%): utilities and SPY mostly low, high-volatility names often high.
 *
 * Every input is market data: nothing the model writes (its stop, its levels) is
 * read, so the level cannot differ between locales or runs.
 *
 * `low` below {@link RISK_MEDIUM_MIN_SCORE}, `high` from {@link RISK_HIGH_MIN_SCORE}.
 */
export function computeRiskLevel(inputs: RiskLevelInputs): RiskLevel {
    const score = scoreRisk(inputs);
    if (score >= RISK_HIGH_MIN_SCORE) return 'high';
    if (score >= RISK_MEDIUM_MIN_SCORE) return 'medium';
    return 'low';
}
