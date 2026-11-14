import { aggregateBarsByPeriod } from '@/domain/analysis/aggregateBarsByPeriod';
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
 * not re-sort. Weeks are read from each bar's UTC date, so daily bars must be
 * stamped at UTC midnight (see {@link aggregateBarsByPeriod}). Pure: no I/O, no mutation of `bars`, deterministic output.
 *
 * @param bars - Source bars, oldest first.
 * @returns One `Bar` per ISO week that had at least one usable source bar,
 *   oldest first.
 */
export function aggregateBarsToWeekly(bars: readonly Bar[]): Bar[] {
    return aggregateBarsByPeriod(bars, isoWeekStartMs);
}
