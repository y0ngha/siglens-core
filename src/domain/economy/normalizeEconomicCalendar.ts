import {
    asArray,
    asEnum,
    asNumberOrNull,
    asObject,
    asString,
} from '@/domain/analysis/normalizePrimitives';
import type { CalendarImpact, EconomicCalendarEvent } from './types';

const IMPACTS: readonly CalendarImpact[] = ['Low', 'Medium', 'High'];

/** ISO-3166 alpha-2 code FMP uses to mark US events. */
const US_COUNTRY_CODE = 'US' as const;

/**
 * Normalize an FMP economic-calendar response (all countries) to US-only events.
 *
 * Filters to `country === 'US'`, drops items missing `date` or `event`, coerces
 * `impact` to the `Low | Medium | High` enum (unknown values fall back to `Low`),
 * and returns the result sorted ascending by date (upcoming first).
 *
 * @param raw - FMP economic-calendar response (arbitrary shape; non-arrays
 *   resolve to an empty list).
 * @returns Normalized, US-only, date-ascending calendar events.
 */
export function normalizeEconomicCalendar(
    raw: unknown
): EconomicCalendarEvent[] {
    return asArray(raw)
        .map(item => {
            const obj = asObject(item);
            if (obj === null) return null;
            if (asString(obj.country) !== US_COUNTRY_CODE) return null;
            const date = asString(obj.date);
            const event = asString(obj.event);
            if (date === '' || event === '') return null;
            return {
                date,
                event,
                impact: asEnum<CalendarImpact>(obj.impact, IMPACTS, 'Low'),
                actual: asNumberOrNull(obj.actual),
                estimate: asNumberOrNull(obj.estimate),
                previous: asNumberOrNull(obj.previous),
                unit: asString(obj.unit),
            } satisfies EconomicCalendarEvent;
        })
        .filter((e): e is EconomicCalendarEvent => e !== null)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
