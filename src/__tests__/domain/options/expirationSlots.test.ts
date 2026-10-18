import { describe, it, expect } from 'vitest';
import {
    EXPIRATION_SLOTS,
    EXPIRATION_SLOT_WINDOWS,
    ZERO_DTE_MAX_DAYS,
    mapExpirationsToSlots,
} from '@/domain/options/expirationSlots';
import type { ExpirationSlotKey, SlotMapping } from '@/domain/options/types';

const isMapping = (x: SlotMapping | null): x is SlotMapping => x !== null;

function byKey(
    result: ReadonlyArray<SlotMapping | null>
): Partial<Record<ExpirationSlotKey, string>> {
    return Object.fromEntries(
        result.filter(isMapping).map(m => [m.slot.key, m.expirationDate])
    );
}

/** ET-midnight Date for an ISO day (EDT, valid for the dates used below). */
const etMidnight = (iso: string): Date => new Date(`${iso}T00:00:00-04:00`);

const NVDA_EXPIRATIONS = [
    '2026-10-19',
    '2026-10-21',
    '2026-10-23',
    '2026-10-26',
    '2026-10-28',
    '2026-10-30',
    '2026-11-06',
    '2026-11-13',
    '2026-11-20',
    '2026-11-27',
    '2026-12-18',
    '2027-01-15',
    '2027-02-19',
    '2027-03-19',
    '2027-04-16',
    '2027-05-21',
    '2027-06-17',
    '2027-09-17',
    '2027-12-17',
];

describe('EXPIRATION_SLOTS', () => {
    it('declares the seven canonical chip slots in ascending order', () => {
        expect(EXPIRATION_SLOTS.map(s => s.key)).toEqual([
            '0D',
            '1W',
            '2W',
            '1M',
            '2M',
            '3M',
            '6M',
        ]);
    });

    it('declares `0D` with no minDays and the week-span maxDays', () => {
        const zero = EXPIRATION_SLOTS.find(s => s.key === '0D');
        expect(zero?.targetDays).toBe(0);
        expect(zero?.minDays).toBeUndefined();
        expect(zero?.maxDays).toBe(ZERO_DTE_MAX_DAYS);
    });

    it('derives every other slot from EXPIRATION_SLOT_WINDOWS with target inside [min, max]', () => {
        for (const slot of EXPIRATION_SLOTS) {
            if (slot.key === '0D') continue;
            const w = EXPIRATION_SLOT_WINDOWS[slot.key];
            expect(slot.targetDays).toBe(w.target);
            expect(slot.minDays).toBe(w.min);
            expect(slot.maxDays).toBe(w.max);
            expect(w.min).toBeLessThanOrEqual(w.target);
            expect(w.target).toBeLessThanOrEqual(w.max);
        }
    });

    it('keeps slot windows from overlapping so a far expiration cannot serve two chips', () => {
        const windows = Object.values(EXPIRATION_SLOT_WINDOWS);
        for (let i = 1; i < windows.length; i++) {
            expect(windows[i].min).toBeGreaterThan(windows[i - 1].max);
        }
    });
});

describe('mapExpirationsToSlots — NVDA real list (Sun 2026-10-18)', () => {
    const now = etMidnight('2026-10-18');

    it('picks the weekly Friday for 0D and the nearest-to-target expiration per slot', () => {
        expect(byKey(mapExpirationsToSlots(NVDA_EXPIRATIONS, now))).toEqual({
            '0D': '2026-10-23',
            '1W': '2026-10-26',
            '2W': '2026-10-30',
            '1M': '2026-11-20',
            '2M': '2026-12-18',
            '3M': '2027-01-15',
            '6M': '2027-04-16',
        });
    });

    it('does not reuse an expiration across slots', () => {
        const dates = mapExpirationsToSlots(NVDA_EXPIRATIONS, now)
            .filter(isMapping)
            .map(m => m.expirationDate);
        expect(new Set(dates).size).toBe(dates.length);
    });

    it('is independent of input order', () => {
        const shuffled = [...NVDA_EXPIRATIONS].reverse();
        expect(byKey(mapExpirationsToSlots(shuffled, now))).toEqual(
            byKey(mapExpirationsToSlots(NVDA_EXPIRATIONS, now))
        );
    });
});

describe('mapExpirationsToSlots — 0D (this week)', () => {
    it('takes the last expiration of the current Mon–Sun week, not the first', () => {
        // Wed 2026-10-21: week ends Sun 10-25. Fri 10-23 is the last.
        const result = byKey(
            mapExpirationsToSlots(
                ['2026-10-21', '2026-10-23', '2026-10-26'],
                etMidnight('2026-10-21')
            )
        );
        expect(result['0D']).toBe('2026-10-23');
    });

    it('treats a same-day Monday expiration as this week when it is the only one', () => {
        const result = byKey(
            mapExpirationsToSlots(['2026-10-19'], etMidnight('2026-10-19'))
        );
        expect(result['0D']).toBe('2026-10-19');
    });

    it('excludes next-week expirations on a weekday (week boundary is Sunday)', () => {
        // Fri 2026-10-23 itself: 10-23 is this week, 10-26 (Mon) is not.
        const result = byKey(
            mapExpirationsToSlots(
                ['2026-10-23', '2026-10-26'],
                etMidnight('2026-10-23')
            )
        );
        expect(result['0D']).toBe('2026-10-23');
        expect(result['1W']).toBeUndefined();
    });

    it('rolls Saturday to the upcoming week', () => {
        const result = byKey(
            mapExpirationsToSlots(
                ['2026-10-19', '2026-10-23', '2026-10-30'],
                etMidnight('2026-10-17')
            )
        );
        expect(result['0D']).toBe('2026-10-23');
    });

    it('falls back to the nearest expiration when none remain this week', () => {
        // Thu 2026-05-14: week ends 05-17; nothing in it.
        const result = byKey(
            mapExpirationsToSlots(
                ['2026-05-22', '2026-05-29'],
                etMidnight('2026-05-14')
            )
        );
        expect(result['0D']).toBe('2026-05-22');
    });
});

describe('mapExpirationsToSlots — 0D weekend fallback', () => {
    it.each([
        ['Sunday', '2026-10-18'],
        ['Saturday', '2026-10-17'],
    ])(
        'on a %s with nothing in the upcoming week falls back to the nearest expiration',
        (_label, nowIso) => {
            // Upcoming Mon–Sun week (10-19..10-25) has no expiration.
            const result = byKey(
                mapExpirationsToSlots(
                    ['2026-11-06', '2026-10-30'],
                    etMidnight(nowIso)
                )
            );
            expect(result['0D']).toBe('2026-10-30');
        }
    );

    it('consumes the fallback expiration so the next slot moves on to another one', () => {
        // Sun 2026-10-18: 0D falls back to 10-30 (+12); 2W (11–17) then takes 11-02 (+15).
        const result = byKey(
            mapExpirationsToSlots(
                ['2026-10-30', '2026-11-02'],
                etMidnight('2026-10-18')
            )
        );
        expect(result['0D']).toBe('2026-10-30');
        expect(result['2W']).toBe('2026-11-02');
    });
});

describe('mapExpirationsToSlots — 0D across DST boundaries (ET)', () => {
    it('keeps the fall-back week (Mon 2026-10-26 .. Sun 11-01) intact', () => {
        const result = byKey(
            mapExpirationsToSlots(
                ['2026-10-30', '2026-11-01', '2026-11-02', '2026-11-06'],
                new Date('2026-10-26T00:00:00-04:00')
            )
        );
        expect(result['0D']).toBe('2026-11-01');
    });

    it('treats Sunday 2026-11-01 (fall-back day) as a weekend and rolls to the next week', () => {
        const result = byKey(
            mapExpirationsToSlots(
                ['2026-11-02', '2026-11-06', '2026-11-13'],
                new Date('2026-11-01T00:00:00-04:00')
            )
        );
        expect(result['0D']).toBe('2026-11-06');
    });

    it('anchors to the ET date even when the UTC date is already Monday', () => {
        // 2026-11-01T23:30 EST = 2026-11-02T04:30Z, still Sunday in New York.
        const result = byKey(
            mapExpirationsToSlots(
                ['2026-11-02', '2026-11-06', '2026-11-13'],
                new Date('2026-11-01T23:30:00-05:00')
            )
        );
        expect(result['0D']).toBe('2026-11-06');
    });

    it('rolls Sunday 2026-03-08 (spring-forward day) to the next week', () => {
        const result = byKey(
            mapExpirationsToSlots(
                ['2026-03-09', '2026-03-13', '2026-03-20'],
                new Date('2026-03-08T00:00:00-05:00')
            )
        );
        expect(result['0D']).toBe('2026-03-13');
    });

    it('ends the spring-forward week on Sunday 2026-03-15', () => {
        const result = byKey(
            mapExpirationsToSlots(
                ['2026-03-13', '2026-03-15', '2026-03-16'],
                new Date('2026-03-09T00:00:00-04:00')
            )
        );
        expect(result['0D']).toBe('2026-03-15');
    });
});

describe('mapExpirationsToSlots — windows', () => {
    // Sun 2026-10-18 as day 0.
    const now = etMidnight('2026-10-18');
    const plus = (days: number): string => {
        const d = new Date(etMidnight('2026-10-18').getTime());
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
    };

    it('omits a slot when no expiration lies in its window instead of borrowing a far one', () => {
        // 19 days sits between the 2W window (11–17) and the 1M window (24–45).
        const result = byKey(mapExpirationsToSlots([plus(19)], now));
        expect(result['2W']).toBeUndefined();
        expect(result['1M']).toBeUndefined();
        // Only 0D (nearest fallback) is filled.
        expect(Object.keys(result)).toEqual(['0D']);
    });

    it.each([
        ['1W', 5, 10],
        ['2W', 11, 17],
        ['1M', 24, 45],
        ['2M', 50, 75],
        ['3M', 76, 120],
        ['6M', 150, 240],
    ] as const)(
        '%s accepts both inclusive boundaries and rejects outside',
        (key, min, max) => {
            // Day 6 is the last day of the coming week, so 0D consumes it and never
            // the boundary date under test.
            const near = plus(6);
            for (const [days, expected] of [
                [min - 1, false],
                [min, true],
                [max, true],
                [max + 1, false],
            ] as const) {
                const mapped = byKey(
                    mapExpirationsToSlots([near, plus(days)], now)
                );
                expect(mapped[key] === plus(days)).toBe(expected);
            }
        }
    );

    it('breaks distance ties toward a Friday', () => {
        // 2M target 60: Wed 2026-12-16 (+59) and Fri 2026-12-18 (+61) are equidistant.
        const result = byKey(
            mapExpirationsToSlots(
                ['2026-10-19', '2026-12-16', '2026-12-18'],
                now
            )
        );
        expect(result['2M']).toBe('2026-12-18');
    });

    it('breaks equal-distance non-Friday ties toward the earlier date', () => {
        // 2M target 60: Tue 2026-12-15 (+58) and Sat-free pair +62 (2026-12-19) are equidistant, neither a Friday.
        const result = byKey(
            mapExpirationsToSlots(
                ['2026-10-19', '2026-12-19', '2026-12-15'],
                now
            )
        );
        expect(result['2M']).toBe('2026-12-15');
    });

    it('prefers a strictly nearer non-Friday over a farther Friday', () => {
        // Wed 2026-12-16 (+59, d1) vs Fri 2026-12-11 (+54, d6).
        const result = byKey(
            mapExpirationsToSlots(
                ['2026-10-19', '2026-12-11', '2026-12-16'],
                now
            )
        );
        expect(result['2M']).toBe('2026-12-16');
    });
});

describe('mapExpirationsToSlots — general', () => {
    const now = etMidnight('2026-05-14');

    it('past expirations (days < 0) are filtered out', () => {
        const result = byKey(
            mapExpirationsToSlots(['2026-05-01', '2026-05-22'], now)
        );
        expect(Object.values(result)).toEqual(['2026-05-22']);
    });

    it('returns all-null when expirations is empty', () => {
        const result = mapExpirationsToSlots([], now);
        expect(result).toHaveLength(EXPIRATION_SLOTS.length);
        expect(result.every(r => r === null)).toBe(true);
    });
});
