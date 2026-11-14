import { aggregateBarsByPeriod } from '@/domain/analysis/aggregateBarsByPeriod';
import { monthStartMs } from '@/domain/analysis/barPeriods';
import type { Bar } from '@/domain/types';

/**
 * Aggregate daily (or any sub-monthly) bars into calendar-month bars (UTC).
 * Same rules as {@link aggregateBarsToWeekly}: `open` is the month's first
 * open, `close` its last close, `high`/`low` the month's extremes, `volume`
 * the month's sum; bars without usable prices are skipped; the last (possibly
 * partial) month is kept. `time` of each output bar is the 1st of the month,
 * 00:00:00 UTC, in Unix seconds.
 *
 * Months are read from each bar's UTC date, so daily bars must be stamped at
 * UTC midnight of their trading date (see {@link aggregateBarsByPeriod}).
 * `bars` must already be sorted ascending by `time`. Pure: no I/O, no
 * mutation of `bars`, deterministic output.
 *
 * @param bars - Source bars, oldest first.
 * @returns One `Bar` per calendar month that had at least one usable source
 *   bar, oldest first.
 */
export function aggregateBarsToMonthly(bars: readonly Bar[]): Bar[] {
    return aggregateBarsByPeriod(bars, monthStartMs);
}
