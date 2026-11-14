import { hasUsablePrices } from '@/domain/analysis/analysisUtils';
import { MS_PER_SECOND } from '@/domain/constants/time';
import type { Bar } from '@/domain/types';

/** @internal Mutable accumulator for one in-progress period bucket; never escapes this module. */
interface PeriodAccumulator {
    startMs: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

/** @internal Converts a finished accumulator into the output `Bar`, stamped with the period's start in Unix seconds. */
function finalizePeriod(acc: PeriodAccumulator): Bar {
    return {
        time: acc.startMs / MS_PER_SECOND,
        open: acc.open,
        high: acc.high,
        low: acc.low,
        close: acc.close,
        volume: acc.volume,
    };
}

/**
 * @internal Shared OHLCV merge behind {@link aggregateBarsToWeekly} and
 * {@link aggregateBarsToMonthly}: one output bar per period, where
 * `periodStartMs` maps a source bar's Unix-seconds `time` to the Unix-ms start
 * of the period it belongs to. `open` is the period's first open, `close` its
 * last close, `high`/`low` its extremes, `volume` its sum. Bars without usable
 * prices ({@link hasUsablePrices}) are skipped; the last (possibly partial)
 * period is kept.
 *
 * Periods are read from the bar's UTC calendar date, so daily source bars
 * must be stamped at UTC midnight of their trading date (the convention the
 * daily bar loaders use). A bar stamped at local midnight east of UTC
 * (e.g. 00:00 KST = 15:00Z the day before) would land in the previous period.
 *
 * `bars` must be sorted ascending by `time`. Pure: no I/O, no mutation.
 */
export function aggregateBarsByPeriod(
    bars: readonly Bar[],
    periodStartMs: (unixSeconds: number) => number
): Bar[] {
    const periods: Bar[] = [];
    let current: PeriodAccumulator | null = null;

    for (const bar of bars) {
        if (!hasUsablePrices(bar)) continue;
        const startMs = periodStartMs(bar.time);
        if (current === null || startMs !== current.startMs) {
            if (current !== null) periods.push(finalizePeriod(current));
            current = {
                startMs,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.volume,
            };
            continue;
        }
        current = {
            ...current,
            high: Math.max(current.high, bar.high),
            low: Math.min(current.low, bar.low),
            close: bar.close,
            volume: current.volume + bar.volume,
        };
    }

    if (current !== null) periods.push(finalizePeriod(current));
    return periods;
}
