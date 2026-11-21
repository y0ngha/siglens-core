import type { Bar, CandlePriorMove } from '@/domain/types';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * @internal Bars before a candle pattern's first bar over which its prior move
 * is measured. Candle patterns describe a 1-5 bar horizon, so the look-back is
 * half the 20-bar look-back of the chart-pattern `priorTrend` (same rule shape:
 * a close-to-close move in ATR units).
 */
export const CANDLE_PRIOR_TREND_BARS = 10;

/**
 * @internal Minimum prior move, in ATR, for a candle pattern that is defined by
 * the move it follows (hammer after a decline, evening star after an advance).
 * Inclusive on both sides. Pre-registered: never tuned on the
 * evaluation data.
 */
export const CANDLE_PRIOR_TREND_MIN_ATR = 1.0;

/**
 * @internal Minimum body, in ATR, of the first bar of a two- or three-bar
 * reversal. A first bar smaller than this is noise the pattern cannot reverse.
 */
export const CANDLE_MIN_SETUP_BODY_ATR = 0.25;

// ─── Prior move ───────────────────────────────────────────────────────────────

const unmeasuredMove = (): CandlePriorMove => ({
    trend: 'none',
    moveAtr: null,
});

/**
 * @internal The move a candle pattern follows.
 *
 * `s` is the index of the pattern's FIRST bar; the move runs from the close
 * `CANDLE_PRIOR_TREND_BARS` bars before the bar preceding `s` to the close of
 * that bar, in units of the ATR at that bar. The pattern's own bars never feed
 * its trend, so a pattern cannot define the move it is named after.
 *
 * `trend` is `decline` at `moveAtr <= -CANDLE_PRIOR_TREND_MIN_ATR`, `advance`
 * at `>= +CANDLE_PRIOR_TREND_MIN_ATR`, else `none`. The move is unmeasured
 * (`trend: 'none'`, `moveAtr: null`) when fewer than
 * `CANDLE_PRIOR_TREND_BARS + 1` bars precede `s`, or the ATR there is missing,
 * non-finite or not positive.
 *
 * @param bars - OHLCV bars, oldest first.
 * @param s - Index of the pattern's first bar in `bars`.
 * @param atr - ATR series aligned with `bars` (null before the warm-up).
 */
export function candlePriorMove(
    bars: readonly Bar[],
    s: number,
    atr: readonly (number | null)[]
): CandlePriorMove {
    const end = s - 1;
    const start = end - CANDLE_PRIOR_TREND_BARS;
    if (start < 0 || end >= bars.length) return unmeasuredMove();

    const atrAtEnd = atr[end];
    if (
        typeof atrAtEnd !== 'number' ||
        !Number.isFinite(atrAtEnd) ||
        atrAtEnd <= 0
    )
        return unmeasuredMove();

    const moveAtr = (bars[end].close - bars[start].close) / atrAtEnd;
    if (!Number.isFinite(moveAtr)) return unmeasuredMove();
    if (moveAtr <= -CANDLE_PRIOR_TREND_MIN_ATR)
        return { trend: 'decline', moveAtr };
    if (moveAtr >= CANDLE_PRIOR_TREND_MIN_ATR)
        return { trend: 'advance', moveAtr };
    return { trend: 'none', moveAtr };
}
