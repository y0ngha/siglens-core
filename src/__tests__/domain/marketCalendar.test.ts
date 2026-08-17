import { describe, it, expect } from 'vitest';
import {
    EARLY_CLOSE_MINUTE,
    REGULAR_CLOSE_MINUTE,
    etCalendarDate,
    isUsMarketEarlyClose,
    isUsMarketHoliday,
    minutesUntilUsMarketClose,
    usMarketCloseMinute,
    UNSCHEDULED_CLOSURES,
} from '@/domain/marketCalendar';
import { getEtSessionStatus, isEtRegularSessionOpen } from '@/domain/utils';
import {
    ACTUAL_CLOSED_WEEKDAYS,
    ACTUAL_RANGE,
} from './__fixtures__/nyseActualClosedDays';

/**
 * Expected values are the NYSE Group / ICE published calendar, transcribed
 * verbatim from "NYSE Group Announces 2025, 2026 and 2027 Holiday and Early
 * Closings Calendar" (2024-11-08). The asterisk footnotes in that document list
 * the early closes separately from the holiday table — reading them as part of
 * the table is what makes secondary sources disagree about July 3, 2026.
 */
const PUBLISHED = {
    2024: {
        holidays: [
            '01-01', // New Year's Day (Mon)
            '01-15', // MLK Jr. Day
            '02-19', // Washington's Birthday
            '03-29', // Good Friday (Easter = Mar 31)
            '05-27', // Memorial Day
            '06-19', // Juneteenth (Wed)
            '07-04', // Independence Day (Thu)
            '09-02', // Labor Day
            '11-28', // Thanksgiving
            '12-25', // Christmas (Wed)
        ],
        earlyCloses: [
            '07-03', // Wed — July 4 is a weekday
            '11-29', // day after Thanksgiving
            '12-24', // Tue — Christmas is a weekday
        ],
    },
    2025: {
        holidays: [
            '01-01', // New Year's Day (Wed)
            '01-20', // MLK Jr. Day
            '02-17', // Washington's Birthday
            '04-18', // Good Friday
            '05-26', // Memorial Day
            '06-19', // Juneteenth (Thu)
            '07-04', // Independence Day (Fri)
            '09-01', // Labor Day
            '11-27', // Thanksgiving
            '12-25', // Christmas (Thu)
        ],
        earlyCloses: [
            '07-03', // July 4 is a weekday → eve is a half day
            '11-28', // day after Thanksgiving
            '12-24', // Christmas Eve (Wed)
        ],
    },
    2026: {
        holidays: [
            '01-01', // New Year's Day (Thu)
            '01-19',
            '02-16',
            '04-03', // Good Friday (Easter = Apr 5)
            '05-25',
            '06-19', // Juneteenth (Fri)
            '07-03', // Independence Day observed — Jul 4 is a Saturday
            '09-07',
            '11-26',
            '12-25', // Christmas (Fri)
        ],
        // No July half day: July 3 is the observed closure, and a closure wins.
        earlyCloses: ['11-27', '12-24'],
    },
    2027: {
        holidays: [
            '01-01', // New Year's Day (Fri)
            '01-18',
            '02-15',
            '03-26', // Good Friday (Easter = Mar 28)
            '05-31',
            '06-18', // Juneteenth observed — Jun 19 is a Saturday
            '07-05', // Independence Day observed — Jul 4 is a Sunday
            '09-06',
            '11-25',
            '12-24', // Christmas observed — Dec 25 is a Saturday
        ],
        // Neither July nor Christmas Eve qualifies: Jul 4 falls on a weekend and
        // Dec 24 is itself the observed closure.
        earlyCloses: ['11-26'],
    },
} as const;

/** Noon ET on the given date — safely inside the session, DST irrelevant. */
function etNoon(year: number, monthDay: string): Date {
    const [month, day] = monthDay.split('-').map(Number);
    return new Date(Date.UTC(year, (month as number) - 1, day as number, 17));
}

/** Every ET calendar day of a year, as `MM-DD`. */
function everyDayOf(year: number): string[] {
    const days: string[] = [];
    for (
        let d = new Date(Date.UTC(year, 0, 1));
        d.getUTCFullYear() === year;
        d.setUTCDate(d.getUTCDate() + 1)
    ) {
        days.push(
            `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
                d.getUTCDate()
            ).padStart(2, '0')}`
        );
    }
    return days;
}

describe('marketCalendar — NYSE 발표 캘린더 대조', () => {
    for (const year of [2024, 2025, 2026, 2027] as const) {
        const expected = PUBLISHED[year];

        it(`${year}: 전휴장 ${expected.holidays.length}일이 발표와 정확히 일치한다`, () => {
            const computed = everyDayOf(year)
                .filter(md => isUsMarketHoliday(etNoon(year, md)))
                // 예정 외 휴장은 발표 캘린더에 없다 — 별도 describe에서 검증한다.
                .filter(md => !UNSCHEDULED_CLOSURES.has(`${year}-${md}`));
            expect(computed).toEqual([...expected.holidays]);
        });

        it(`${year}: 반장 ${expected.earlyCloses.length}일이 발표와 정확히 일치한다`, () => {
            const computed = everyDayOf(year).filter(md =>
                isUsMarketEarlyClose(etNoon(year, md))
            );
            expect(computed).toEqual([...expected.earlyCloses]);
        });

        it(`${year}: 전휴장과 반장은 겹치지 않는다`, () => {
            const overlap = expected.holidays.filter(md =>
                (expected.earlyCloses as readonly string[]).includes(md)
            );
            expect(overlap).toEqual([]);
        });
    }
});

describe('marketCalendar — 관측 이동 규칙', () => {
    it('토요일 고정 휴일은 앞 금요일로 당긴다', () => {
        // 2026-07-04는 토요일 → 07-03(금) 관측.
        expect(isUsMarketHoliday(etNoon(2026, '07-03'))).toBe(true);
        expect(isUsMarketHoliday(etNoon(2026, '07-04'))).toBe(false);
        // 2027-06-19는 토요일 → 06-18(금) 관측.
        expect(isUsMarketHoliday(etNoon(2027, '06-18'))).toBe(true);
    });

    it('일요일 고정 휴일은 다음 월요일로 미룬다', () => {
        // 2027-07-04는 일요일 → 07-05(월) 관측.
        expect(isUsMarketHoliday(etNoon(2027, '07-05'))).toBe(true);
        expect(isUsMarketHoliday(etNoon(2027, '07-02'))).toBe(false);
    });

    it('신정이 토요일이면 아예 관측하지 않는다 — 12/31을 닫지 않는다', () => {
        // NYSE: "Because the holiday falls on Saturday, January 1, 2028,
        // no New Year's Day holiday is observed."
        expect(isUsMarketHoliday(etNoon(2028, '01-01'))).toBe(false);
        expect(isUsMarketHoliday(etNoon(2027, '12-31'))).toBe(false);
        // 같은 해의 다른 휴일은 정상 동작한다 (규칙이 통째로 꺼진 게 아니다).
        expect(isUsMarketHoliday(etNoon(2028, '01-17'))).toBe(true); // MLK
    });

    it('Juneteenth는 NYSE가 관측을 시작한 2022년부터만 휴장이다', () => {
        expect(isUsMarketHoliday(etNoon(2021, '06-18'))).toBe(false);
        expect(isUsMarketHoliday(etNoon(2021, '06-19'))).toBe(false);
        // 2022-06-19는 일요일 → 06-20(월) 관측.
        expect(isUsMarketHoliday(etNoon(2022, '06-20'))).toBe(true);
    });

    it('성금요일은 부활절 −2일이다', () => {
        // 부활절: 2025-04-20, 2026-04-05, 2027-03-28
        expect(isUsMarketHoliday(etNoon(2025, '04-18'))).toBe(true);
        expect(isUsMarketHoliday(etNoon(2026, '04-03'))).toBe(true);
        expect(isUsMarketHoliday(etNoon(2027, '03-26'))).toBe(true);
    });
});

describe('marketCalendar — 마감 시각', () => {
    it('정규일은 16:00, 반장은 13:00, 휴장은 0', () => {
        expect(usMarketCloseMinute(etNoon(2026, '11-25'))).toBe(
            REGULAR_CLOSE_MINUTE
        );
        expect(usMarketCloseMinute(etNoon(2026, '11-27'))).toBe(
            EARLY_CLOSE_MINUTE
        );
        expect(usMarketCloseMinute(etNoon(2026, '11-26'))).toBe(0);
    });

    it('반장 마감 후에는 남은 시간이 0이다', () => {
        const earlyCloseDay = etNoon(2026, '12-24');
        // 12:30 ET → 30분 남음
        expect(minutesUntilUsMarketClose(earlyCloseDay, 12 * 60 + 30)).toBe(30);
        // 13:05 ET → 이미 마감. 종전에는 16:00까지 175분이 남은 것으로 계산됐다.
        expect(minutesUntilUsMarketClose(earlyCloseDay, 13 * 60 + 5)).toBe(0);
    });

    it('휴장일은 언제 물어도 0이다', () => {
        expect(minutesUntilUsMarketClose(etNoon(2026, '07-03'), 10 * 60)).toBe(
            0
        );
    });

    it('정규일 마감 전에는 남은 분이 정확하다', () => {
        expect(minutesUntilUsMarketClose(etNoon(2026, '11-25'), 15 * 60)).toBe(
            60
        );
    });
});

describe('etCalendarDate', () => {
    it('UTC가 아니라 ET 달력 날짜를 돌려준다', () => {
        // 2026-01-02T02:00Z = 2026-01-01 21:00 ET — UTC로는 이미 다음 날이다.
        const d = etCalendarDate(new Date('2026-01-02T02:00:00Z'));
        expect(d).toEqual({ year: 2026, month: 1, day: 1, weekday: 4 });
    });

    it('서머타임 전환을 넘겨도 ET 날짜가 맞는다', () => {
        // 2026-03-08 02:00 ET에 EDT 전환. 전환 직후 시각.
        const d = etCalendarDate(new Date('2026-03-08T07:30:00Z'));
        expect(d.month).toBe(3);
        expect(d.day).toBe(8);
    });
});

describe('세션 판정 배선 — 캘린더가 실제로 적용된다', () => {
    it('휴장일 정오는 개장이 아니다', () => {
        // 추수감사절 2026-11-26 12:00 ET. 종전에는 목요일 정오라 'open'이었다.
        expect(isEtRegularSessionOpen(new Date('2026-11-26T17:00:00Z'))).toBe(
            false
        );
        expect(getEtSessionStatus(new Date('2026-11-26T17:00:00Z'))).toBe(
            'closed'
        );
    });

    it('반장은 13:00 전까지만 개장이다', () => {
        // 2026-11-27(금) 반장. EST라 ET = UTC−5.
        expect(isEtRegularSessionOpen(new Date('2026-11-27T17:00:00Z'))).toBe(
            true // 12:00 ET
        );
        // 13:05 ET — 종전에는 16:00까지 개장으로 읽혔다.
        expect(isEtRegularSessionOpen(new Date('2026-11-27T18:05:00Z'))).toBe(
            false
        );
    });

    it('정규일은 종전과 동일하게 동작한다', () => {
        // 2026-11-25(수) 12:00 ET / 15:59 ET / 16:00 ET
        expect(isEtRegularSessionOpen(new Date('2026-11-25T17:00:00Z'))).toBe(
            true
        );
        expect(isEtRegularSessionOpen(new Date('2026-11-25T20:59:00Z'))).toBe(
            true
        );
        expect(isEtRegularSessionOpen(new Date('2026-11-25T21:00:00Z'))).toBe(
            false
        );
    });

    it('주말 판정은 캘린더보다 먼저다', () => {
        expect(getEtSessionStatus(new Date('2026-11-28T17:00:00Z'))).toBe(
            'weekend'
        );
    });
});

describe('예정 외 휴장 — 규칙이 아니라 목록', () => {
    it('2025-01-09는 발표 캘린더에 없지만 실제로 폐장이었다 (카터 국가 애도의 날)', () => {
        expect(isUsMarketHoliday(etNoon(2025, '01-09'))).toBe(true);
        expect(isEtRegularSessionOpen(new Date('2025-01-09T17:00:00Z'))).toBe(
            false
        );
    });

    it('허리케인 샌디(2012)와 부시 애도일(2018)도 폐장으로 잡힌다', () => {
        expect(isUsMarketHoliday(etNoon(2012, '10-29'))).toBe(true);
        expect(isUsMarketHoliday(etNoon(2012, '10-30'))).toBe(true);
        expect(isUsMarketHoliday(etNoon(2018, '12-05'))).toBe(true);
    });

    it('전후 거래일은 정상이다 — 목록이 과잉 적용되지 않는다', () => {
        expect(isUsMarketHoliday(etNoon(2025, '01-08'))).toBe(false);
        expect(isUsMarketHoliday(etNoon(2025, '01-10'))).toBe(false);
    });
});

describe('구조적 백테스트 — 1990~2050', () => {
    const YEARS = Array.from({ length: 61 }, (_, i) => 1990 + i);

    it('휴장일이 주말에 오지 않는다', () => {
        const offenders: string[] = [];
        for (const year of YEARS) {
            for (const md of everyDayOf(year)) {
                const d = etNoon(year, md);
                if (!isUsMarketHoliday(d)) continue;
                if (UNSCHEDULED_CLOSURES.has(`${year}-${md}`)) continue;
                const weekday = new Date(`${year}-${md}T12:00:00Z`).getUTCDay();
                if (weekday === 0 || weekday === 6) {
                    offenders.push(`${year}-${md}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('반장도 주말에 오지 않고 휴장일과 겹치지 않는다', () => {
        const offenders: string[] = [];
        for (const year of YEARS) {
            for (const md of everyDayOf(year)) {
                const d = etNoon(year, md);
                if (!isUsMarketEarlyClose(d)) continue;
                const weekday = new Date(`${year}-${md}T12:00:00Z`).getUTCDay();
                if (weekday === 0 || weekday === 6 || isUsMarketHoliday(d)) {
                    offenders.push(`${year}-${md}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('연간 휴장일 수가 규칙이 허용하는 범위 안이다', () => {
        // Juneteenth 도입 전 9일, 도입 후 10일. 신정이 토요일인 해는 1일 줄어든다.
        for (const year of YEARS) {
            const count = everyDayOf(year).filter(
                md =>
                    isUsMarketHoliday(etNoon(year, md)) &&
                    !UNSCHEDULED_CLOSURES.has(`${year}-${md}`)
            ).length;
            const base = year >= 2022 ? 10 : 9;
            const newYearOnSaturday =
                new Date(Date.UTC(year, 0, 1)).getUTCDay() === 6;
            expect(count).toBe(base - (newYearOnSaturday ? 1 : 0));
        }
    });

    it('반장은 매년 1~3일이며, 추수감사절 다음 날은 반드시 포함된다', () => {
        for (const year of YEARS) {
            const earlyCloses = everyDayOf(year).filter(md =>
                isUsMarketEarlyClose(etNoon(year, md))
            );
            expect(earlyCloses.length).toBeGreaterThanOrEqual(1);
            expect(earlyCloses.length).toBeLessThanOrEqual(3);
            // 추수감사절 다음 날은 항상 금요일이라 어떤 해에도 빠지지 않는다.
            const hasNovemberEarlyClose = earlyCloses.some(md =>
                md.startsWith('11-')
            );
            expect(hasNovemberEarlyClose).toBe(true);
        }
    });

    it('부활절은 3/22~4/25 범위를 벗어나지 않는다 (성금요일 = 그 −2일)', () => {
        for (const year of YEARS) {
            const goodFriday = everyDayOf(year).find(md => {
                const [m, d] = md.split('-').map(Number);
                // 3~4월 휴장일 중 금요일인 것 = 성금요일
                if (m !== 3 && m !== 4) return false;
                if (!isUsMarketHoliday(etNoon(year, md))) return false;
                return (
                    new Date(
                        Date.UTC(year, (m as number) - 1, d)
                    ).getUTCDay() === 5
                );
            });
            expect(goodFriday).toBeDefined();
            const [m, d] = (goodFriday as string).split('-').map(Number);
            const dayOfYear = (m as number) * 100 + (d as number);
            expect(dayOfYear).toBeGreaterThanOrEqual(320); // 3/20
            expect(dayOfYear).toBeLessThanOrEqual(424); // 4/24
        }
    });
});

describe('실데이터 대조 — FMP 일봉으로 뽑은 실제 거래일 (2015~2026)', () => {
    const actualClosed = new Set(ACTUAL_CLOSED_WEEKDAYS);

    /** 구간 안의 모든 평일을 `YYYY-MM-DD`로. */
    function weekdaysInRange(): string[] {
        const out: string[] = [];
        const end = new Date(`${ACTUAL_RANGE.to}T00:00:00Z`);
        for (
            let d = new Date(`${ACTUAL_RANGE.from}T00:00:00Z`);
            d <= end;
            d.setUTCDate(d.getUTCDate() + 1)
        ) {
            const wd = d.getUTCDay();
            if (wd === 0 || wd === 6) continue;
            out.push(d.toISOString().slice(0, 10));
        }
        return out;
    }

    it('계산한 휴장일이 실제 거래 없던 날과 정확히 일치한다', () => {
        const missed: string[] = []; // 실제로 닫혔는데 열렸다고 판정
        const overcalled: string[] = []; // 실제로 열렸는데 닫혔다고 판정

        for (const iso of weekdaysInRange()) {
            // 정오 ET. 날짜만 보는 판정이라 시각은 구간 안이기만 하면 된다.
            const at = new Date(`${iso}T17:00:00Z`);
            const computed = isUsMarketHoliday(at);
            const actual = actualClosed.has(iso);
            if (actual && !computed) missed.push(iso);
            if (!actual && computed) overcalled.push(iso);
        }

        expect({ missed, overcalled }).toEqual({ missed: [], overcalled: [] });
    });

    it('구간 안 거래일 수가 실데이터와 같다', () => {
        const computedTradingDays = weekdaysInRange().filter(
            iso => !isUsMarketHoliday(new Date(`${iso}T17:00:00Z`))
        ).length;
        const actualTradingDays = weekdaysInRange().length - actualClosed.size;
        expect(computedTradingDays).toBe(actualTradingDays);
    });

    it('실데이터가 신정 토요일 미관측을 뒷받침한다', () => {
        // 2022-01-01은 토요일. 앞 금요일(2021-12-31)도 실제로 거래일이었다.
        expect(actualClosed.has('2021-12-31')).toBe(false);
        expect(isUsMarketHoliday(new Date('2021-12-31T17:00:00Z'))).toBe(false);
    });

    it('실데이터가 2026-07-03 전휴장을 뒷받침한다', () => {
        // 7/4가 토요일이라 7/3이 관측 휴장이다 — 반장이 아니다.
        expect(actualClosed.has('2026-07-03')).toBe(true);
        expect(isUsMarketHoliday(new Date('2026-07-03T17:00:00Z'))).toBe(true);
        expect(isUsMarketEarlyClose(new Date('2026-07-03T17:00:00Z'))).toBe(
            false
        );
    });

    it('실데이터가 Juneteenth 2022년 도입을 뒷받침한다', () => {
        // 2021-06-18(금)은 거래일이었고, 2022-06-20(월, 6/19 일요일의 관측일)은 휴장이다.
        expect(actualClosed.has('2021-06-18')).toBe(false);
        expect(actualClosed.has('2022-06-20')).toBe(true);
        expect(isUsMarketHoliday(new Date('2022-06-20T17:00:00Z'))).toBe(true);
    });
});
