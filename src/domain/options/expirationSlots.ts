const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ExpirationSlot {
    key: '1W' | '2W' | '1M' | '2M' | '3M' | '6M';
    label: string;
    targetDays: number;
}

export const EXPIRATION_SLOTS: ReadonlyArray<ExpirationSlot> = [
    { key: '1W', label: '1주', targetDays: 7 },
    { key: '2W', label: '2주', targetDays: 14 },
    { key: '1M', label: '1개월', targetDays: 30 },
    { key: '2M', label: '2개월', targetDays: 60 },
    { key: '3M', label: '3개월', targetDays: 90 },
    { key: '6M', label: '6개월', targetDays: 180 },
];

export interface SlotMapping {
    slot: ExpirationSlot;
    expirationDate: string;
}

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
        .sort((a, b) => a.days - b.days);

    const used = new Set<string>();
    return EXPIRATION_SLOTS.map(slot => {
        const match = dated.find(
            e => e.days >= slot.targetDays && !used.has(e.date)
        );
        if (!match) return null;
        used.add(match.date);
        return { slot, expirationDate: match.date };
    });
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
    let year = 0;
    let month = 0;
    let day = 0;
    for (const part of ET_DATE_FORMATTER.formatToParts(d)) {
        if (part.type === 'year') year = Number.parseInt(part.value, 10);
        else if (part.type === 'month')
            month = Number.parseInt(part.value, 10);
        else if (part.type === 'day') day = Number.parseInt(part.value, 10);
    }
    return { year, month, day };
}
