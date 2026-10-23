import type {
    CalendarImpact,
    CalendarSelection,
    EconomicCalendarEvent,
    SelectCalendarEventsOptions,
} from './types';
import { parseCalendarDate } from '@/domain/analysis/promptFormat';

/** Fill order once rate decisions are placed: High, then Medium, then Low. */
const IMPACT_PRIORITY: Record<CalendarImpact, number> = {
    High: 0,
    Medium: 1,
    Low: 2,
};

const RATE_DECISION_PATTERN = /interest rate decision/i;

/**
 * A central-bank policy-rate decision row (FMP names the US one
 * `'Fed Interest Rate Decision'`).
 */
export function isRateDecisionEvent(event: EconomicCalendarEvent): boolean {
    return RATE_DECISION_PATTERN.test(event.event);
}

/** Sort key; unparseable dates sort after every parseable one. */
function timeOf(event: EconomicCalendarEvent): number {
    return (
        parseCalendarDate(event.date)?.date.getTime() ??
        Number.POSITIVE_INFINITY
    );
}

/** Ascending by time; two unparseable dates tie instead of `Infinity - Infinity` (NaN). */
function byTime(a: EconomicCalendarEvent, b: EconomicCalendarEvent): number {
    const ta = timeOf(a);
    const tb = timeOf(b);
    return ta === tb ? 0 : ta - tb;
}

/**
 * Picks at most `max` calendar events for a prompt or tool result.
 *
 * Rate-decision rows take the first slots (nearest first), then the rest
 * fill by impact (High, Medium, Low), nearest first within each impact —
 * all within `max`, so a `max` below the rate-decision count keeps only the
 * nearest decisions. Taking the first `max` rows by date instead let Low rows
 * (rig count, CFTC positions) fill every slot on an ordinary week, so an FOMC
 * decision days away never reached the model. `omitted` lets the reader say a
 * date is incomplete rather than empty.
 */
export function selectCalendarEvents(
    events: readonly EconomicCalendarEvent[],
    { max, notBefore }: SelectCalendarEventsOptions
): CalendarSelection {
    const eligible =
        notBefore === undefined
            ? events
            : events.filter(e => {
                  const parsed = parseCalendarDate(e.date);
                  return (
                      parsed !== null &&
                      parsed.date.getTime() >= notBefore.getTime()
                  );
              });
    const limit = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;

    // Ranks indices, not objects, so a row object passed twice is counted
    // twice in `omitted`. `.sort` on a fresh array: the client build's lib
    // predates `toSorted`.
    const pickedIndices = eligible
        .map((_, i) => i)
        .sort((ia, ib) => {
            const a = eligible[ia];
            const b = eligible[ib];
            return (
                Number(isRateDecisionEvent(b)) -
                    Number(isRateDecisionEvent(a)) ||
                IMPACT_PRIORITY[a.impact] - IMPACT_PRIORITY[b.impact] ||
                byTime(a, b)
            );
        })
        .slice(0, limit);

    const picked = new Set(pickedIndices);
    const omitted: Record<CalendarImpact, number> = {
        High: 0,
        Medium: 0,
        Low: 0,
    };
    eligible.forEach((e, i) => {
        if (!picked.has(i)) omitted[e.impact] += 1;
    });

    return {
        events: pickedIndices.map(i => eligible[i]).sort(byTime),
        omitted,
    };
}
