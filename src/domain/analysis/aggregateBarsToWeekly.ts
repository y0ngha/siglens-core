import { hasUsablePrices } from '@/domain/analysis/analysisUtils';
import { MS_PER_DAY, MS_PER_SECOND } from '@/domain/constants/time';
import type { Bar } from '@/domain/types';

/**
 * @internal Unix-ms timestamp of Monday 00:00:00 UTC for the ISO week
 * containing `unixSeconds`. ISO weeks start Monday; `getUTCDay()` returns
 * `0` for Sunday, so Sunday maps to ISO day 7 (end of the previous week's
 * bucket, not the start of a new one).
 */
function isoWeekStartMs(unixSeconds: number): number {
    const d = new Date(unixSeconds * MS_PER_SECOND);
    const utcDay = d.getUTCDay(); // 0 (Sun) .. 6 (Sat)
    const isoDay = utcDay === 0 ? 7 : utcDay; // 1 (Mon) .. 7 (Sun)
    const daysSinceMonday = isoDay - 1;
    const dayStartMs = Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate()
    );
    return dayStartMs - daysSinceMonday * MS_PER_DAY;
}

/** @internal Mutable accumulator for one in-progress weekly bucket. Immutable to callers — only {@link finalizeWeek} reads it, and it never escapes this module. */
interface WeeklyAccumulator {
    weekStartMs: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

/** @internal Converts a finished accumulator into the output `Bar`. `time` is the week's Monday 00:00:00 UTC, in Unix seconds — the ISO-week bucket's own start, not any single source bar's timestamp. */
function finalizeWeek(acc: WeeklyAccumulator): Bar {
    return {
        time: acc.weekStartMs / MS_PER_SECOND,
        open: acc.open,
        high: acc.high,
        low: acc.low,
        close: acc.close,
        volume: acc.volume,
    };
}

/**
 * Aggregate daily (or any sub-weekly) bars into ISO-week bars: Monday-start,
 * UTC. `open` is the first bar's open in the week, `close` the last bar's
 * close, `high`/`low` the week's extremes, `volume` the week's sum.
 *
 * Bars whose OHLC is not a usable price (non-finite, zero, or negative — see
 * {@link hasUsablePrices}) are skipped entirely, so a placeholder row never
 * corrupts a week's high/low/close. The last (possibly partial) week is kept
 * — a trading week in progress still has bars worth aggregating.
 *
 * `bars` must already be sorted ascending by `time` (the convention every
 * other bar-consuming function in this codebase assumes); this function does
 * not re-sort. Pure: no I/O, no mutation of `bars`, deterministic output.
 *
 * @param bars - Source bars, oldest first.
 * @returns One `Bar` per ISO week that had at least one usable source bar,
 *   oldest first.
 */
export function aggregateBarsToWeekly(bars: readonly Bar[]): Bar[] {
    const weeks: Bar[] = [];
    let current: WeeklyAccumulator | null = null;

    for (const bar of bars) {
        if (!hasUsablePrices(bar)) continue;
        const weekStartMs = isoWeekStartMs(bar.time);

        if (current === null) {
            current = {
                weekStartMs,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.volume,
            };
            continue;
        }

        if (weekStartMs !== current.weekStartMs) {
            weeks.push(finalizeWeek(current));
            current = {
                weekStartMs,
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

    if (current !== null) weeks.push(finalizeWeek(current));
    return weeks;
}
