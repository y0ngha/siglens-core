import { SECONDS_PER_DAY } from '@/domain/constants/time';
import { LOOKBACK_DAYS_BY_TIMEFRAME } from '@/domain/dashboard';
import { calculateIndicators } from '@/domain/indicators';
import { detectSignals } from '@/domain/signals';
import type { Bar, Signal } from '@/domain/types';

const MIN_BARS_FOR_SCAN = 2;
const PERCENT_FACTOR = 100;

/**
 * Calendar days of bars the dashboard scanner evaluates on a daily bar. Same
 * value as the `'1Day'` lookback of `lookbackIsoFromNow` (one source, so the
 * two cannot drift).
 */
export const SIGNAL_SCAN_DAILY_LOOKBACK_DAYS =
    LOOKBACK_DAYS_BY_TIMEFRAME['1Day'];

/** The confirmed signals the daily scanner would have reported on one bar. Descriptive only. */
export interface ConfirmedSignalDay {
    /** `bar.time` of the evaluated bar (UTC seconds). */
    readonly time: number;
    readonly close: number;
    /** Change vs the previous bar's close in percent; `null` for the first bar of `bars` or a zero previous close. */
    readonly changePercent: number | null;
    /**
     * `phase === 'confirmed'` signals of `detectSignals` on the window, detector
     * order. `[]` means the window was evaluated and nothing was confirmed;
     * `null` means the window could not be evaluated (fewer than 2 bars, a
     * non-finite close inside it, or `bars` not strictly increasing in time), so
     * the day must not be read as "no signal".
     */
    readonly signals: readonly Signal[] | null;
}

export interface ConfirmedSignalTimelineOptions {
    /** How many of the most recent bars to evaluate (clamped to `bars.length`). */
    readonly days: number;
    /** Window length in calendar days; defaults to {@link SIGNAL_SCAN_DAILY_LOOKBACK_DAYS}. */
    readonly lookbackDays?: number;
}

function changePercentAt(bars: readonly Bar[], index: number): number | null {
    if (index === 0) return null;
    const previous = bars[index - 1].close;
    const current = bars[index].close;
    if (previous === 0 || !Number.isFinite(previous)) return null;
    if (!Number.isFinite(current)) return null;
    return ((current - previous) / previous) * PERCENT_FACTOR;
}

function confirmedSignalsIn(bars: Bar[]): readonly Signal[] | null {
    if (bars.length < MIN_BARS_FOR_SCAN) return null;
    if (bars.some(bar => !Number.isFinite(bar.close))) return null;
    return detectSignals(bars, calculateIndicators(bars)).filter(
        signal => signal.phase === 'confirmed'
    );
}

function isStrictlyIncreasingInTime(bars: readonly Bar[]): boolean {
    return bars.every(
        (bar, i) =>
            Number.isFinite(bar.time) &&
            (i === 0 || bar.time > bars[i - 1].time)
    );
}

/** Moves a window start forward to the first bar not older than `cutoff`. */
function advanceStart(
    bars: readonly Bar[],
    start: number,
    cutoff: number
): number {
    return start < bars.length && bars[start].time < cutoff
        ? advanceStart(bars, start + 1, cutoff)
        : start;
}

function resolveLookbackDays(lookbackDays: number | undefined): number {
    return lookbackDays !== undefined &&
        Number.isFinite(lookbackDays) &&
        lookbackDays > 0
        ? lookbackDays
        : SIGNAL_SCAN_DAILY_LOOKBACK_DAYS;
}

/**
 * For each of the last `days` bars, `detectSignals(window,
 * calculateIndicators(window))` restricted to confirmed signals, where
 * `window` is the bars with `time >= bar.time - lookbackDays * 86400` up to and
 * including that bar. That is exactly what `computeStockSignalResult` sees when
 * the dashboard scanner runs on that bar's session, so each day equals the
 * scanner run on that prefix (no look-ahead: later bars are never read). It
 * evaluates whatever detectors `detectSignals` has, with no signal-type list of
 * its own.
 *
 * Cost is one indicator suite per day; callers that need many days chunk the
 * call. A day that cannot be evaluated (window under 2 bars, or a non-finite
 * close in it) has `signals: null`, distinct from `[]`. `bars` must be strictly
 * increasing in `time`; otherwise every day is returned with `signals: null`
 * (fail closed). `lookbackDays` that is not a finite number above 0 falls back
 * to the default.
 *
 * Descriptive only: which signals were confirmed on each past bar, not a
 * forecast.
 *
 * @param bars - OHLCV bars sorted oldest-first.
 * @param options - `days` to evaluate; optional `lookbackDays` window length.
 * @returns One entry per evaluated bar, oldest first; `[]` when `bars` is empty
 *   or `days < 1`.
 */
export function confirmedSignalTimeline(
    bars: readonly Bar[],
    options: ConfirmedSignalTimelineOptions
): readonly ConfirmedSignalDay[] {
    const days = Math.min(Math.floor(options.days), bars.length);
    if (!(days >= 1)) return [];
    const lookbackSeconds =
        resolveLookbackDays(options.lookbackDays) * SECONDS_PER_DAY;
    const firstIndex = bars.length - days;
    const ordered = isStrictlyIncreasingInTime(bars);
    // Forward-only window start: each evaluated bar's cutoff is later than the last.
    const cursor = {
        start: ordered
            ? bars.findIndex(
                  b => b.time >= bars[firstIndex].time - lookbackSeconds
              )
            : 0,
    };
    return Array.from({ length: days }, (_, offset) => {
        const index = firstIndex + offset;
        const bar = bars[index];
        cursor.start = ordered
            ? advanceStart(bars, cursor.start, bar.time - lookbackSeconds)
            : cursor.start;
        return {
            time: bar.time,
            close: bar.close,
            changePercent: changePercentAt(bars, index),
            signals: ordered
                ? confirmedSignalsIn(bars.slice(cursor.start, index + 1))
                : null,
        };
    });
}
