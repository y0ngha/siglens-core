import { describe, expect, it } from 'vitest';
import { isLastDailyBarFinished } from '@/domain/analysis/marketReference';
import { formatMarketLine } from '@/domain/agent/turnClock';
import {
    getSessionStatus,
    nextRegularSessionBoundaryMs,
    previousRegularSessionBoundaryMs,
} from '@/domain/session';
import type { Bar, MarketSessionSpec } from '@/domain/types';

type Scheduled = Extract<MarketSessionSpec, { kind: 'scheduled' }>;

/** The one day the synthetic exchange opens late (10:00) and closes late (16:30). */
const SPECIAL_DAY = '2026-11-19';
const REGULAR_OPEN = 9 * 60;
const REGULAR_CLOSE = 15 * 60 + 30;
const SPECIAL_OPEN = 10 * 60;
const SPECIAL_CLOSE = 16 * 60 + 30;

/** Local (Asia/Seoul, no DST) calendar date of an instant. */
const localDate = (now: Date): string =>
    new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);

const SPEC: Scheduled = {
    kind: 'scheduled',
    timeZone: 'Asia/Seoul',
    openMinute: REGULAR_OPEN,
    closeMinute: REGULAR_CLOSE,
    weekendDays: [0, 6],
    openMinuteFor: now =>
        localDate(now) === SPECIAL_DAY ? SPECIAL_OPEN : REGULAR_OPEN,
    closeMinuteFor: now =>
        localDate(now) === SPECIAL_DAY ? SPECIAL_CLOSE : REGULAR_CLOSE,
};

const at = (date: string, clock: string): Date =>
    new Date(`${date}T${clock}:00+09:00`);

describe('getSessionStatus with openMinuteFor', () => {
    it('is closed before the overridden open and open from it', () => {
        expect(getSessionStatus(SPEC, at(SPECIAL_DAY, '09:30'))).toBe('closed');
        expect(getSessionStatus(SPEC, at(SPECIAL_DAY, '09:59'))).toBe('closed');
        expect(getSessionStatus(SPEC, at(SPECIAL_DAY, '10:00'))).toBe('open');
        expect(getSessionStatus(SPEC, at(SPECIAL_DAY, '10:05'))).toBe('open');
    });

    it('stays open until the overridden close', () => {
        expect(getSessionStatus(SPEC, at(SPECIAL_DAY, '16:00'))).toBe('open');
        expect(getSessionStatus(SPEC, at(SPECIAL_DAY, '16:29'))).toBe('open');
        expect(getSessionStatus(SPEC, at(SPECIAL_DAY, '16:31'))).toBe('closed');
    });

    it('leaves an ordinary day on the spec defaults', () => {
        expect(getSessionStatus(SPEC, at('2026-11-18', '09:00'))).toBe('open');
        expect(getSessionStatus(SPEC, at('2026-11-18', '15:29'))).toBe('open');
        expect(getSessionStatus(SPEC, at('2026-11-18', '15:30'))).toBe(
            'closed'
        );
    });

    it('a spec without openMinuteFor keeps using openMinute', () => {
        const { openMinuteFor: _omit, ...plain } = SPEC;
        expect(getSessionStatus(plain, at(SPECIAL_DAY, '09:30'))).toBe('open');
    });
});

describe('session boundaries with openMinuteFor', () => {
    it('next open from the evening before is the overridden open', () => {
        expect(
            nextRegularSessionBoundaryMs(
                SPEC,
                at('2026-11-18', '20:00'),
                'open'
            )
        ).toBe(at(SPECIAL_DAY, '10:00').getTime());
    });

    it('next close during the special day is the overridden close', () => {
        expect(
            nextRegularSessionBoundaryMs(
                SPEC,
                at(SPECIAL_DAY, '15:45'),
                'close'
            )
        ).toBe(at(SPECIAL_DAY, '16:30').getTime());
    });

    it('previous open during the special day is the overridden open', () => {
        expect(
            previousRegularSessionBoundaryMs(
                SPEC,
                at(SPECIAL_DAY, '12:00'),
                'open'
            )
        ).toBe(at(SPECIAL_DAY, '10:00').getTime());
    });

    it('previous open the morning after is still the overridden open, not 09:00', () => {
        expect(
            previousRegularSessionBoundaryMs(
                SPEC,
                at('2026-11-20', '08:00'),
                'open'
            )
        ).toBe(at(SPECIAL_DAY, '10:00').getTime());
    });

    it('previous close at 15:45 on the special day is the prior day, not today', () => {
        expect(
            previousRegularSessionBoundaryMs(
                SPEC,
                at(SPECIAL_DAY, '15:45'),
                'close'
            )
        ).toBe(at('2026-11-18', '15:30').getTime());
    });

    it('previous close after the overridden close is the overridden close', () => {
        expect(
            previousRegularSessionBoundaryMs(
                SPEC,
                at(SPECIAL_DAY, '17:00'),
                'close'
            )
        ).toBe(at(SPECIAL_DAY, '16:30').getTime());
    });
});

describe('isLastDailyBarFinished with a delayed close', () => {
    const todayBar = { time: Date.UTC(2026, 10, 19) / 1000 } as unknown as Bar;
    const clock = (now: Date) => ({ session: SPEC, now });

    it('is not finished at 15:45 local on the special day', () => {
        expect(
            isLastDailyBarFinished(todayBar, clock(at(SPECIAL_DAY, '15:45')))
        ).toBe(false);
    });

    it('is finished once the overridden close has passed', () => {
        expect(
            isLastDailyBarFinished(todayBar, clock(at(SPECIAL_DAY, '16:31')))
        ).toBe(true);
    });
});

describe('formatMarketLine closed state with openMinuteFor', () => {
    const line = (now: Date, extendedHours: boolean): string =>
        formatMarketLine({
            label: 'Test',
            zoneLabel: 'KST',
            now,
            spec: SPEC,
            extendedHours,
        });

    it('reads pre-market hours between the regular open and the overridden open', () => {
        expect(line(at(SPECIAL_DAY, '09:30'), true)).toBe(
            '- Test: pre-market hours; opens Thu 2026-11-19 10:00 KST (in 30m)'
        );
    });

    it('is already open in the same window on an ordinary day', () => {
        expect(line(at('2026-11-18', '09:30'), true)).toContain(': open;');
    });

    it('reads plain closed before the open without extended hours', () => {
        expect(line(at(SPECIAL_DAY, '09:30'), false)).toBe(
            '- Test: closed; opens Thu 2026-11-19 10:00 KST (in 30m)'
        );
    });

    it('reads open from the overridden open, closing at the overridden close', () => {
        expect(line(at(SPECIAL_DAY, '16:00'), false)).toBe(
            '- Test: open; closes Thu 2026-11-19 16:30 KST (in 30m)'
        );
    });
});
