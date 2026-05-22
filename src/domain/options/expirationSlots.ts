import { MS_PER_DAY } from '@/domain/constants/time';
import type { ExpirationSlot, SlotMapping } from './types';

/**
 * @internal Inclusive upper-bound on days-to-expiration for the `0D` slot;
 * expirations beyond this boundary fall through to the `1W` slot. Set to
 * 6 (= 1 week minus 1 day) so a single weekly Friday expiration lands in
 * `0D` regardless of which ET weekday the lookup is performed on.
 */
export const ZERO_DTE_MAX_DAYS = 6;

/**
 * Canonical chip slots in render order. Frontends pick the closest matching
 * provider expiration per slot.
 *
 * The `0D` slot represents same-week expirations (≤ 6 days out). The label
 * is "이번 주" ("this week") rather than "today" because a Monday call may
 * match a Friday weekly that is 4 days away — labelling it "today" would
 * be misleading.
 */
export const EXPIRATION_SLOTS: ReadonlyArray<ExpirationSlot> = [
    { key: '0D', label: '이번 주', targetDays: 0, maxDays: ZERO_DTE_MAX_DAYS },
    { key: '1W', label: '1주', targetDays: 7 },
    { key: '2W', label: '2주', targetDays: 14 },
    { key: '1M', label: '1개월', targetDays: 30 },
    { key: '2M', label: '2개월', targetDays: 60 },
    { key: '3M', label: '3개월', targetDays: 90 },
    { key: '6M', label: '6개월', targetDays: 180 },
];

/**
 * Map provider expirations to slots. For each slot, pick the closest
 * expiration whose `daysToExpiration` falls within `[targetDays, maxDays]`
 * (or simply `>= targetDays` when `maxDays` is absent — standard slots
 * from `1W` onward omit the upper bound). An expiration mapped to one
 * slot is not reused for later slots.
 *
 * @param expirations - Expiration dates (ISO 'YYYY-MM-DD'), unsorted OK.
 * @param now - Reference date (typically ET-midnight today).
 * @returns Array same length as EXPIRATION_SLOTS; null entries are unmapped slots.
 */
export function mapExpirationsToSlots(
    expirations: ReadonlyArray<string>,
    now: Date
): ReadonlyArray<SlotMapping | null> {
    const dated = expirations
        .map(d => ({ date: d, days: daysBetween(now, d) }))
        .filter(e => e.days >= 0)
        .toSorted((a, b) => a.days - b.days);

    // `used` is a function-local Set — no external observer sees it mid-
    // build. Using a for-of with pre-allocated result keeps the mutation
    // and the array build co-located instead of mixing a `.map` callback
    // with `used.add` side effects. The alternative (rebuilding an
    // immutable Set per slot) would be O(N²) for no readability gain. Set
    // lookup is O(1) per `find` predicate evaluation (vs O(N) for
    // Array.includes).
    const used = new Set<string>();
    const result: (SlotMapping | null)[] = [];
    for (const slot of EXPIRATION_SLOTS) {
        const match = dated.find(
            e =>
                slot.targetDays <= e.days &&
                (slot.maxDays === undefined || e.days <= slot.maxDays) &&
                !used.has(e.date)
        );
        if (!match) {
            result.push(null);
            continue;
        }
        used.add(match.date);
        result.push({ slot, expirationDate: match.date });
    }
    return result;
}

/**
 * Days between two calendar dates anchored to America/New_York (market TZ).
 *
 * Compares the day-of-month/month/year of `from` and `isoDate` *as observed
 * in ET*, ignoring the time-of-day component. This avoids DST drift — hard-
 * coding `-04:00` (EDT) was wrong during EST months (Nov–Mar), where the
 * boundary between two calendar days shifts by an hour.
 *
 * Implementation: `Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York' })`
 * resolves the correct offset for each Date instance based on its calendar
 * position. We extract Y/M/D parts and convert both endpoints to a UTC noon
 * Date for subtraction (noon avoids DST transition windows).
 */
function daysBetween(from: Date, isoDate: string): number {
    const fromParts = etCalendarParts(from);
    const toParts = etCalendarParts(new Date(`${isoDate}T12:00:00Z`));
    const fromUtc = Date.UTC(
        fromParts.year,
        fromParts.month - 1,
        fromParts.day,
        12
    );
    const toUtc = Date.UTC(toParts.year, toParts.month - 1, toParts.day, 12);
    return Math.round((toUtc - fromUtc) / MS_PER_DAY);
}

const ET_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

/**
 * Numeric calendar parts (Y/M/D) of a given instant *as observed in
 * America/New_York*. Used only by `daysBetween`.
 */
interface EtCalendarParts {
    year: number;
    month: number;
    day: number;
}

function etCalendarParts(d: Date): EtCalendarParts {
    const parts = ET_DATE_FORMATTER.formatToParts(d);
    return {
        year: extractDatePart(parts, 'year'),
        month: extractDatePart(parts, 'month'),
        day: extractDatePart(parts, 'day'),
    };
}

function extractDatePart(
    parts: Intl.DateTimeFormatPart[],
    type: 'year' | 'month' | 'day'
): number {
    // Intl.DateTimeFormat configured with { year, month, day } always emits
    // these three parts for any valid Date, so `.find()` is guaranteed to
    // return a defined entry.
    const found = parts.find(p => p.type === type)!;
    return Number.parseInt(found.value, 10);
}
