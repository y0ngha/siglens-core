import { calculateIndicators } from '@/domain/indicators';
import { detectSignals } from '@/domain/signals';
import type { Bar, Signal, SignalType } from '@/domain/types';

const MIN_BARS_FOR_NEW_SIGNALS = 2;

function confirmedTypes(bars: Bar[]): ReadonlySet<SignalType> {
    return new Set(
        detectSignals(bars, calculateIndicators(bars))
            .filter(s => s.phase === 'confirmed')
            .map(s => s.type)
    );
}

/**
 * Confirmed signals that begin on the last bar: `phase === 'confirmed'` in
 * `detectSignals(bars, calculateIndicators(bars))` and absent (as a confirmed
 * signal of the same `type`) from the same detection on `bars.slice(0, -1)`.
 *
 * This is the episode-start rule a once-per-session recorder applies, computed
 * from the bars alone, so a missed run cannot invent or hide a start. A cross
 * that fired one bar earlier (still inside its lookback window) is already
 * present on the previous bar and is therefore not new; a state signal such as
 * RSI oversold that keeps holding is not new either, while one that ended and
 * restarted on the last bar is.
 *
 * The caller owns session freshness: this judges the last bar of `bars`
 * whatever its date. Expected-phase signals are never returned. Descriptive
 * only — a fact about the last bar, not a forecast.
 *
 * @param bars - OHLCV bars sorted oldest-first.
 * @returns New confirmed signals in detector order; `[]` for fewer than 2 bars.
 */
export function detectNewConfirmedSignals(bars: Bar[]): readonly Signal[] {
    if (bars.length < MIN_BARS_FOR_NEW_SIGNALS) return [];
    const previous = confirmedTypes(bars.slice(0, -1));
    return detectSignals(bars, calculateIndicators(bars)).filter(
        s => s.phase === 'confirmed' && !previous.has(s.type)
    );
}
