import type { MarketEvent } from '@/domain/types';

/**
 * Days before a report date from which an `earnings` `MarketEvent` is accepted
 * as that report's coverage: the report day minus 1.
 */
export const EARNINGS_EVENT_DAYS_BEFORE = 1;
/**
 * Days after a report date through which coverage is accepted: the report day
 * plus 3.
 *
 * The window is asymmetric on purpose. Reports land after the close, so the
 * coverage is dated the report day or the next session; a weekend in between
 * stretches that to 3 calendar days. Anything earlier than the day before is a
 * preview or a trade setup "into earnings", not the report. No session
 * calendar is available in this pure helper, so the bounds are calendar days.
 */
export const EARNINGS_EVENT_DAYS_AFTER = 3;

const DAY_MS = 86_400_000;

/** UTC midnight of a `Date` or a `YYYY-MM-DD` string; `NaN` when unparsable. */
function utcDayMs(value: Date | string): number {
    const ms =
        typeof value === 'string'
            ? Date.parse(`${value.slice(0, 10)}T00:00:00Z`)
            : Date.UTC(
                  value.getUTCFullYear(),
                  value.getUTCMonth(),
                  value.getUTCDate()
              );
    return ms;
}

/**
 * Whether an event dated `eventDate` is coverage of THIS company's own report,
 * i.e. falls from {@link EARNINGS_EVENT_DAYS_BEFORE} day before to
 * {@link EARNINGS_EVENT_DAYS_AFTER} days after (UTC calendar days, inclusive) one of
 * its real report dates.
 *
 * The news-card category `earnings` is a theme label, not proof: peer
 * results, previews and earnings-season pieces carry it too. A real report
 * date is the only evidence that the company itself reported.
 *
 * @param eventDate - Event publication time, or a `YYYY-MM-DD` string.
 * @param earningsDates - `YYYY-MM-DD` report dates of this company, past and upcoming.
 *   An empty list means "calendar unknown" to the callers that gate on it (see
 *   {@link eventCategoryLabel}); this function itself returns `false` for it.
 */
export function isCompanyEarningsEvent(
    eventDate: Date | string,
    earningsDates: readonly string[]
): boolean {
    const eventMs = utcDayMs(eventDate);
    if (Number.isNaN(eventMs)) return false;
    return earningsDates.some(date => {
        const reportMs = utcDayMs(date);
        const offsetDays = (eventMs - reportMs) / DAY_MS;
        return (
            offsetDays >= -EARNINGS_EVENT_DAYS_BEFORE &&
            offsetDays <= EARNINGS_EVENT_DAYS_AFTER
        );
    });
}

/**
 * The wording a prompt uses for an event's category.
 *
 * Only `earnings` is reinterpreted. With `earningsDates` absent or empty we cannot tell
 * a company report from a themed article, so we never claim a report: the row
 * reads "earnings-related news". With dates supplied, a row off every report
 * date is explicitly "not this company's report".
 *
 * @internal
 */
export function eventCategoryLabel(
    event: Pick<MarketEvent, 'category' | 'publishedAt'>,
    earningsDates: readonly string[] | undefined
): string {
    if (event.category !== 'earnings') return event.category;
    // `[]` is treated like `undefined`: a consumer whose calendar fetch failed
    // may pass an empty list, and "no dates known" must never read as "no report".
    if (earningsDates === undefined || earningsDates.length === 0)
        return 'earnings-related news';
    return isCompanyEarningsEvent(event.publishedAt, earningsDates)
        ? 'earnings'
        : "earnings-related news (not this company's report)";
}
