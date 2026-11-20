import { describe, expect, it } from 'vitest';
import { buildAgentTurnContext } from '@/domain/agent/buildAgentSystemPrompt';
import {
    US_AFTER_HOURS_MINUTES,
    US_PRE_MARKET_OPEN_MINUTE,
    formatLead,
    formatLocalWeek,
    formatMarketLine,
    formatWeekdayClock,
} from '@/domain/agent/turnClock';
import { US_EQUITY_SESSION } from '@/domain/session';
import type { MarketSessionSpec } from '@/domain/types';

/** Test-local KRX: the real list lives in the consumer. 09:00–15:30 KST, Mon–Fri, no holidays. */
const KRX: Extract<MarketSessionSpec, { kind: 'scheduled' }> = {
    kind: 'scheduled',
    timeZone: 'Asia/Seoul',
    openMinute: 540,
    closeMinute: 930,
    weekendDays: [0, 6],
};

const note = (iso: string, extra: { timeZone?: string } = {}): string =>
    buildAgentTurnContext({
        locale: 'ko',
        now: new Date(iso),
        krSession: KRX,
        ...extra,
    });

const WEEK_NOV_16 = 'this week Mon 2026-11-16 to Sun 2026-11-22';
const WEEK_NOV_23 = 'this week Mon 2026-11-23 to Sun 2026-11-29';

describe('buildAgentTurnContext — exact notes', () => {
    it('Fri pre-market: US pre-market hours, KRX closed over the weekend', () => {
        expect(note('2026-11-20T14:09:00Z')).toBe(
            [
                '## Now',
                `- User's local time: 2026-11-20 23:09 KST (Friday; ${WEEK_NOV_16})`,
                '- UTC: Fri 2026-11-20 14:09 · ET: Fri 2026-11-20 09:09 · KST: Fri 2026-11-20 23:09',
                '- US stocks (NYSE/Nasdaq): pre-market hours; opens Fri 2026-11-20 09:30 ET (Fri 2026-11-20 23:30 KST) (in 21m)',
                '- Korean stocks (KRX): closed; opens Mon 2026-11-23 09:00 KST (in 2d 9h)',
            ].join('\n')
        );
    });

    it('Fri regular session: US open with its close, KRX closed', () => {
        expect(note('2026-11-20T15:00:00Z')).toBe(
            [
                '## Now',
                `- User's local time: 2026-11-21 00:00 KST (Saturday; ${WEEK_NOV_16})`,
                '- UTC: Fri 2026-11-20 15:00 · ET: Fri 2026-11-20 10:00 · KST: Sat 2026-11-21 00:00',
                '- US stocks (NYSE/Nasdaq): open; closes Fri 2026-11-20 16:00 ET (Sat 2026-11-21 06:00 KST) (in 6h 0m)',
                '- Korean stocks (KRX): closed; opens Mon 2026-11-23 09:00 KST (in 2d 9h)',
            ].join('\n')
        );
    });

    it('Fri evening: US after-hours, next open on Monday', () => {
        expect(note('2026-11-20T22:30:00Z')).toBe(
            [
                '## Now',
                `- User's local time: 2026-11-21 07:30 KST (Saturday; ${WEEK_NOV_16})`,
                '- UTC: Fri 2026-11-20 22:30 · ET: Fri 2026-11-20 17:30 · KST: Sat 2026-11-21 07:30',
                '- US stocks (NYSE/Nasdaq): after-hours; opens Mon 2026-11-23 09:30 ET (Mon 2026-11-23 23:30 KST) (in 2d 16h)',
                '- Korean stocks (KRX): closed; opens Mon 2026-11-23 09:00 KST (in 2d 1h)',
            ].join('\n')
        );
    });

    it('20:00 ET: the after-hours end is exclusive, KRX is open', () => {
        expect(note('2026-11-20T01:00:00Z')).toBe(
            [
                '## Now',
                `- User's local time: 2026-11-20 10:00 KST (Friday; ${WEEK_NOV_16})`,
                '- UTC: Fri 2026-11-20 01:00 · ET: Thu 2026-11-19 20:00 · KST: Fri 2026-11-20 10:00',
                '- US stocks (NYSE/Nasdaq): closed; opens Fri 2026-11-20 09:30 ET (Fri 2026-11-20 23:30 KST) (in 13h 30m)',
                '- Korean stocks (KRX): open; closes Fri 2026-11-20 15:30 KST (in 5h 30m)',
            ].join('\n')
        );
    });

    it('Thanksgiving: the US holiday has no pre-market and opens the next day', () => {
        expect(note('2026-11-26T15:00:00Z')).toBe(
            [
                '## Now',
                `- User's local time: 2026-11-27 00:00 KST (Friday; ${WEEK_NOV_23})`,
                '- UTC: Thu 2026-11-26 15:00 · ET: Thu 2026-11-26 10:00 · KST: Fri 2026-11-27 00:00',
                '- US stocks (NYSE/Nasdaq): closed; opens Fri 2026-11-27 09:30 ET (Fri 2026-11-27 23:30 KST) (in 23h 30m)',
                '- Korean stocks (KRX): closed; opens Fri 2026-11-27 09:00 KST (in 9h 0m)',
            ].join('\n')
        );
    });

    it('half day: US open until 13:00 ET', () => {
        expect(note('2026-11-27T17:30:00Z')).toBe(
            [
                '## Now',
                `- User's local time: 2026-11-28 02:30 KST (Saturday; ${WEEK_NOV_23})`,
                '- UTC: Fri 2026-11-27 17:30 · ET: Fri 2026-11-27 12:30 · KST: Sat 2026-11-28 02:30',
                '- US stocks (NYSE/Nasdaq): open; closes Fri 2026-11-27 13:00 ET (Sat 2026-11-28 03:00 KST) (in 30m)',
                '- Korean stocks (KRX): closed; opens Mon 2026-11-30 09:00 KST (in 2d 6h)',
            ].join('\n')
        );
    });

    it('half day after the 13:00 bell: after-hours starts at the early close', () => {
        expect(note('2026-11-27T18:30:00Z')).toBe(
            [
                '## Now',
                `- User's local time: 2026-11-28 03:30 KST (Saturday; ${WEEK_NOV_23})`,
                '- UTC: Fri 2026-11-27 18:30 · ET: Fri 2026-11-27 13:30 · KST: Sat 2026-11-28 03:30',
                '- US stocks (NYSE/Nasdaq): after-hours; opens Mon 2026-11-30 09:30 ET (Mon 2026-11-30 23:30 KST) (in 2d 20h)',
                '- Korean stocks (KRX): closed; opens Mon 2026-11-30 09:00 KST (in 2d 5h)',
            ].join('\n')
        );
    });

    it('summer time: ET 09:30 is 22:30 KST (EDT), where winter is 23:30', () => {
        expect(note('2026-07-15T12:00:00Z')).toContain(
            '- US stocks (NYSE/Nasdaq): pre-market hours; opens Wed 2026-07-15 09:30 ET (Wed 2026-07-15 22:30 KST) (in 1h 30m)'
        );
    });

    it('a user zone equal to the market zone prints the time once, the other market gets the conversion', () => {
        expect(
            note('2026-11-20T15:00:00Z', { timeZone: 'America/New_York' })
        ).toBe(
            [
                '## Now',
                `- User's local time: 2026-11-20 10:00 EST (Friday; ${WEEK_NOV_16})`,
                '- UTC: Fri 2026-11-20 15:00 · ET: Fri 2026-11-20 10:00 · KST: Sat 2026-11-21 00:00',
                '- US stocks (NYSE/Nasdaq): open; closes Fri 2026-11-20 16:00 ET (in 6h 0m)',
                '- Korean stocks (KRX): closed; opens Mon 2026-11-23 09:00 KST (Sun 2026-11-22 19:00 EST) (in 2d 9h)',
            ].join('\n')
        );
    });

    it('prints no KRX line without krSession', () => {
        const context = buildAgentTurnContext({
            locale: 'ko',
            now: new Date('2026-11-20T14:09:00Z'),
        });
        expect(context).toBe(
            [
                '## Now',
                `- User's local time: 2026-11-20 23:09 KST (Friday; ${WEEK_NOV_16})`,
                '- UTC: Fri 2026-11-20 14:09 · ET: Fri 2026-11-20 09:09 · KST: Fri 2026-11-20 23:09',
                '- US stocks (NYSE/Nasdaq): pre-market hours; opens Fri 2026-11-20 09:30 ET (Fri 2026-11-20 23:30 KST) (in 21m)',
            ].join('\n')
        );
    });

    it('prints no KRX line for an always-open spec', () => {
        const context = buildAgentTurnContext({
            locale: 'ko',
            now: new Date('2026-11-20T14:09:00Z'),
            krSession: { kind: 'always-open' },
        });
        expect(context).not.toContain('KRX');
    });

    it('writes the user line in a non-KST zone while the other lines stay fixed', () => {
        expect(
            note('2026-11-20T14:09:00Z', { timeZone: 'America/Los_Angeles' })
        ).toContain(
            `- User's local time: 2026-11-20 06:09 PST (Friday; ${WEEK_NOV_16})\n- UTC: Fri 2026-11-20 14:09`
        );
    });

    it('falls back to the locale zone for an invalid zone', () => {
        expect(note('2026-11-20T14:09:00Z', { timeZone: 'Not/AZone' })).toBe(
            note('2026-11-20T14:09:00Z')
        );
    });

    it('ignores the deprecated etSessionStatus', () => {
        const base = {
            locale: 'ko' as const,
            now: new Date('2026-11-20T14:09:00Z'),
        };
        expect(
            buildAgentTurnContext({ ...base, etSessionStatus: 'open' })
        ).toBe(buildAgentTurnContext(base));
    });
});

describe('formatMarketLine — session windows', () => {
    const us = (iso: string): string =>
        formatMarketLine({
            label: 'US',
            zoneLabel: 'ET',
            now: new Date(iso),
            spec: US_EQUITY_SESSION,
            extendedHours: true,
        });

    it('keeps the window constants at 04:00 ET and four hours after the close', () => {
        expect(US_PRE_MARKET_OPEN_MINUTE).toBe(240);
        expect(US_AFTER_HOURS_MINUTES).toBe(240);
    });

    it('04:00 ET is pre-market, 03:59 ET is closed', () => {
        expect(us('2026-11-20T09:00:00Z')).toBe(
            '- US: pre-market hours; opens Fri 2026-11-20 09:30 ET (in 5h 30m)'
        );
        expect(us('2026-11-20T08:59:00Z')).toBe(
            '- US: closed; opens Fri 2026-11-20 09:30 ET (in 5h 31m)'
        );
    });

    it('09:30 ET is open', () => {
        expect(us('2026-11-20T14:30:00Z')).toBe(
            '- US: open; closes Fri 2026-11-20 16:00 ET (in 6h 30m)'
        );
    });

    it('16:00 ET is after-hours, one minute before 16:00 is still open', () => {
        expect(us('2026-11-20T21:00:00Z')).toBe(
            '- US: after-hours; opens Mon 2026-11-23 09:30 ET (in 2d 17h)'
        );
        expect(us('2026-11-20T20:59:00Z')).toBe(
            '- US: open; closes Fri 2026-11-20 16:00 ET (in 1m)'
        );
    });

    it('a Saturday is closed even at a pre-market clock time', () => {
        expect(us('2026-11-21T14:00:00Z')).toBe(
            '- US: closed; opens Mon 2026-11-23 09:30 ET (in 2d 0h)'
        );
    });

    it('a non-US line never prints the extended-hours states', () => {
        const line = formatMarketLine({
            label: 'KRX',
            zoneLabel: 'KST',
            now: new Date('2026-11-20T23:30:00Z'), // Sat 08:30 KST
            spec: KRX,
            extendedHours: false,
        });
        expect(line).toBe(
            '- KRX: closed; opens Mon 2026-11-23 09:00 KST (in 2d 0h)'
        );
    });

    it('an always-open spec prints open alone', () => {
        expect(
            formatMarketLine({
                label: 'Crypto',
                zoneLabel: 'UTC',
                now: new Date('2026-11-20T14:09:00Z'),
                spec: { kind: 'always-open' },
                extendedHours: false,
            })
        ).toBe('- Crypto: open');
    });

    it('prints the state alone when the spec has no trading day', () => {
        expect(
            formatMarketLine({
                label: 'X',
                zoneLabel: 'KST',
                now: new Date('2026-11-20T14:09:00Z'),
                spec: {
                    kind: 'scheduled',
                    timeZone: 'Asia/Seoul',
                    openMinute: 540,
                    closeMinute: 930,
                    weekendDays: [0, 1, 2, 3, 4, 5, 6],
                },
                extendedHours: false,
            })
        ).toBe('- X: closed');
    });
});

describe('formatLead', () => {
    it.each([
        [1, 'in 1m'],
        [20 * 60_000 + 10_000, 'in 21m'],
        [59 * 60_000, 'in 59m'],
        [60 * 60_000, 'in 1h 0m'],
        [(3 * 60 + 5) * 60_000, 'in 3h 5m'],
        [(23 * 60 + 59) * 60_000, 'in 23h 59m'],
        [24 * 3_600_000, 'in 1d 0h'],
        [(2 * 24 + 9) * 3_600_000 + 51 * 60_000, 'in 2d 9h'],
    ])('%d ms is %s', (ms, expected) => {
        expect(formatLead(ms)).toBe(expected);
    });
});

describe('formatWeekdayClock and formatLocalWeek', () => {
    it('formats the weekday and clock in the given zone', () => {
        expect(
            formatWeekdayClock(new Date('2026-11-20T14:09:00Z'), 'UTC')
        ).toBe('Fri 2026-11-20 14:09');
        expect(
            formatWeekdayClock(new Date('2026-11-20T14:09:00Z'), 'Asia/Seoul')
        ).toBe('Fri 2026-11-20 23:09');
    });

    it('a Sunday belongs to the week that started the Monday before', () => {
        expect(formatLocalWeek(new Date('2026-11-22T12:00:00Z'), 'UTC')).toBe(
            'Mon 2026-11-16 to Sun 2026-11-22'
        );
    });

    it('a Monday starts its own week', () => {
        expect(formatLocalWeek(new Date('2026-11-23T12:00:00Z'), 'UTC')).toBe(
            'Mon 2026-11-23 to Sun 2026-11-29'
        );
    });

    it('reads the week by the zone calendar, not UTC', () => {
        // Sun 23:30 UTC is already Monday in Seoul.
        expect(
            formatLocalWeek(new Date('2026-11-22T23:30:00Z'), 'Asia/Seoul')
        ).toBe('Mon 2026-11-23 to Sun 2026-11-29');
    });

    it('crosses a year boundary', () => {
        expect(formatLocalWeek(new Date('2026-12-31T12:00:00Z'), 'UTC')).toBe(
            'Mon 2026-12-28 to Sun 2027-01-03'
        );
    });
});
