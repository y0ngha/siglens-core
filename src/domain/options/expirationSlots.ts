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

function daysBetween(from: Date, isoDate: string): number {
    const to = new Date(`${isoDate}T00:00:00-04:00`);
    return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}
