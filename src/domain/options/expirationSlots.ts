import { MS_PER_DAY } from '@/domain/constants/time';
import type { ExpirationSlot, SlotMapping } from './types';

/**
 * Canonical chip slots in render order. Frontends pick the closest matching
 * provider expiration per slot.
 */
export const EXPIRATION_SLOTS: ReadonlyArray<ExpirationSlot> = [
    // 이번 주 만기 위클리 옵션(0~6일) 슬롯. 미국 옵션은 매주 금요일 만기이므로
    // ET 기준 어느 요일에 호출해도 이 범위에 "이번 주 금요일 만기"가 들어온다.
    // label은 의도적으로 '오늘'이 아닌 '이번 주' — 사용자가 호출하는 시점(예:
    // ET 월요일)에는 days=4 위클리가 매핑되는데 '오늘'로 표시하면 어색하다.
    // maxDays가 없으면 8일짜리 다음 주 위클리까지 빨아들여 1W가 비는 케이스가
    // 생기므로 6일 상한을 둔다.
    { key: '0D', label: '이번 주', targetDays: 0, maxDays: 6 },
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
                e.days >= slot.targetDays &&
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
