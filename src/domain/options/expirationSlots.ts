import { MS_PER_DAY } from '@/domain/constants/time';
import type { ExpirationSlot, SlotMapping } from './types';

/**
 * Canonical chip slots in render order. Frontends pick the closest matching
 * provider expiration per slot.
 */
export const EXPIRATION_SLOTS: ReadonlyArray<ExpirationSlot> = [
    { key: '1W', label: '1주', targetDays: 7 },
    { key: '2W', label: '2주', targetDays: 14 },
    { key: '1M', label: '1개월', targetDays: 30 },
    { key: '2M', label: '2개월', targetDays: 60 },
    { key: '3M', label: '3개월', targetDays: 90 },
    { key: '6M', label: '6개월', targetDays: 180 },
];

/**
 * Map provider expirations to slots. For each slot, pick the closest
 * expiration whose daysToExpiration is ≥ targetDays. An expiration
 * mapped to one slot is not reused for later slots.
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

    // Slot count is bounded (EXPIRATION_SLOTS.length === 6) and each
    // already-used date never re-enters consideration, so an immutable
    // reduce with `[...used, match.date]` keeps the same once-per-slot
    // semantics without any in-place mutation of a shared Set.
    return EXPIRATION_SLOTS.reduce<
        readonly [ReadonlyArray<SlotMapping | null>, ReadonlyArray<string>]
    >(
        ([mappings, used], slot) => {
            const match = dated.find(
                e => e.days >= slot.targetDays && !used.includes(e.date)
            );
            if (!match) return [[...mappings, null], used];
            return [
                [...mappings, { slot, expirationDate: match.date }],
                [...used, match.date],
            ];
        },
        [[], []]
    )[0];
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

function etCalendarParts(d: Date): {
    year: number;
    month: number;
    day: number;
} {
    const parts = ET_DATE_FORMATTER.formatToParts(d);
    const part = (type: 'year' | 'month' | 'day'): number => {
        const found = parts.find(p => p.type === type);
        return found ? Number.parseInt(found.value, 10) : 0;
    };
    return { year: part('year'), month: part('month'), day: part('day') };
}
