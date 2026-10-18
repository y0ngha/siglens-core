import { MS_PER_DAY } from '@/domain/constants/time';
import type { ExpirationSlot, ExpirationSlotKey, SlotMapping } from './types';

/**
 * @internal Inclusive upper-bound on days-to-expiration for the `0D` slot.
 * The `0D` slot is chosen by ET calendar week (see `mapExpirationsToSlots`),
 * so this value only documents the widest span a same-week lookup can cover
 * (Mon–Sun = 6 days ahead of Monday) and is exposed as the slot's `maxDays`.
 */
export const ZERO_DTE_MAX_DAYS = 6;

/**
 * @internal Per-slot selection windows in calendar days from the ET date of
 * `now`. `target` is the ideal distance; `min`/`max` are inclusive bounds. An
 * expiration outside `[min, max]` is never borrowed for the slot — the slot is
 * left unmapped instead, so a "2주" chip can never show a 3-week expiration.
 */
export const EXPIRATION_SLOT_WINDOWS = {
    '1W': { target: 7, min: 5, max: 10 },
    '2W': { target: 14, min: 11, max: 17 },
    '1M': { target: 30, min: 24, max: 45 },
    '2M': { target: 60, min: 50, max: 75 },
    '3M': { target: 90, min: 76, max: 120 },
    '6M': { target: 180, min: 150, max: 240 },
} as const;

/**
 * @internal
 * Canonical chip slots in render order. Frontends pick the closest matching
 * provider expiration per slot.
 *
 * The `0D` slot represents the current ET week's last expiration. The label
 * is "이번 주" ("this week") rather than "today" because it usually resolves
 * to the week's Friday weekly, several days away.
 */
export const EXPIRATION_SLOTS: ReadonlyArray<ExpirationSlot> = [
    { key: '0D', label: '이번 주', targetDays: 0, maxDays: ZERO_DTE_MAX_DAYS },
    { key: '1W', label: '1주', ...slotWindow('1W') },
    { key: '2W', label: '2주', ...slotWindow('2W') },
    { key: '1M', label: '1개월', ...slotWindow('1M') },
    { key: '2M', label: '2개월', ...slotWindow('2M') },
    { key: '3M', label: '3개월', ...slotWindow('3M') },
    { key: '6M', label: '6개월', ...slotWindow('6M') },
];

function slotWindow(
    key: WindowedSlotKey
): Pick<ExpirationSlot, 'targetDays' | 'minDays' | 'maxDays'> {
    const w = EXPIRATION_SLOT_WINDOWS[key];
    return { targetDays: w.target, minDays: w.min, maxDays: w.max };
}

type WindowedSlotKey = keyof typeof EXPIRATION_SLOT_WINDOWS;

function isWindowedKey(key: ExpirationSlotKey): key is WindowedSlotKey {
    return key in EXPIRATION_SLOT_WINDOWS;
}

const FRIDAY = 5;
const SATURDAY = 6;
const DAYS_PER_WEEK = 7;

interface DatedExpiration {
    date: string;
    days: number;
}

function isFriday(isoDate: string): boolean {
    return new Date(`${isoDate}T12:00:00Z`).getUTCDay() === FRIDAY;
}

/**
 * Inclusive `[start, end]` day offsets of the "current" trading week. Mon–Fri
 * use the rest of the Mon–Sun week containing `now`. Saturday and Sunday roll
 * to the upcoming Mon–Sun week: nothing can still expire in the finished week,
 * and the user looking at the chain on a weekend means the coming week.
 */
function currentWeekRange(from: Date): { start: number; end: number } {
    const p = etCalendarParts(from);
    const weekday = new Date(
        Date.UTC(p.year, p.month - 1, p.day, 12)
    ).getUTCDay();
    if (weekday === 0) return { start: 1, end: DAYS_PER_WEEK };
    if (weekday === SATURDAY) return { start: 2, end: DAYS_PER_WEEK + 1 };
    return { start: 0, end: DAYS_PER_WEEK - weekday };
}

/**
 * `0D` ("이번 주"): the LAST expiration inside the current week, which is the
 * regular Friday weekly rather than a Monday/Wednesday one. When nothing
 * remains this week, falls back to the nearest upcoming expiration.
 */
function pickThisWeek(
    candidates: ReadonlyArray<DatedExpiration>,
    now: Date
): DatedExpiration | undefined {
    const { start, end } = currentWeekRange(now);
    const inWeek = candidates.filter(e => e.days >= start && e.days <= end);
    if (inWeek.length > 0) return inWeek[inWeek.length - 1];
    return candidates[0];
}

/**
 * Nearest expiration to `window.target` within `[min, max]`. Ties prefer a
 * Friday (standard weekly/monthly), then the earlier date.
 */
function pickNearestInWindow(
    candidates: ReadonlyArray<DatedExpiration>,
    window: { target: number; min: number; max: number }
): DatedExpiration | undefined {
    const rank = (e: DatedExpiration): [number, number] => [
        Math.abs(e.days - window.target),
        isFriday(e.date) ? 0 : 1,
    ];
    return candidates
        .filter(e => e.days >= window.min && e.days <= window.max)
        .sort((a, b) => {
            const [distA, nonFriA] = rank(a);
            const [distB, nonFriB] = rank(b);
            return distA - distB || nonFriA - nonFriB || a.days - b.days;
        })[0];
}

/**
 * Map provider expirations to slots.
 *
 * - `0D`: the last expiration in the current ET week (weekend rolls to the
 *   coming week); nearest expiration when none remain.
 * - Other slots: the expiration nearest to the slot target inside its
 *   {@link EXPIRATION_SLOT_WINDOWS} window; ties prefer a Friday, then the
 *   earlier date. No expiration in the window leaves the slot `null` — a far
 *   expiration is never borrowed.
 *
 * An expiration mapped to one slot is not reused for later slots.
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

    // `used` is function-local; no external observer sees it mid-build.
    const used = new Set<string>();
    const result: (SlotMapping | null)[] = [];
    for (const slot of EXPIRATION_SLOTS) {
        const available = dated.filter(e => !used.has(e.date));
        const match = !isWindowedKey(slot.key)
            ? pickThisWeek(available, now)
            : pickNearestInWindow(available, EXPIRATION_SLOT_WINDOWS[slot.key]);
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
