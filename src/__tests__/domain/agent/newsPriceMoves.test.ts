import { describe, expect, it } from 'vitest';
import {
    NEWS_HEADLINES_PER_MOVE_DAY,
    NEWS_MOVE_DAYS_MAX,
    alignNewsWithPriceMoves,
} from '@/domain/agent/newsPriceMoves';
import { CRYPTO_SESSION, US_EQUITY_SESSION } from '@/domain/session';
import type { MarketDailyClose, MarketSessionSpec } from '@/domain/types';
import { makeKrSession } from '../../helpers/krSession';

function closesOf(rows: readonly [string, number][]): MarketDailyClose[] {
    return rows.map(([date, close]) => ({ date, close }));
}

/**
 * US sessions around Thanksgiving 2026: Thu 11-26 is a holiday (no bar) and
 * Fri 11-27 is a 13:00 half day. Changes against the previous close:
 * 11-19 +1, 11-20 -1.98, 11-23 +1.01, 11-24 +2, 11-25 -0.98, 11-27 +1.98.
 */
const US_CLOSES = closesOf([
    ['2026-11-18', 100],
    ['2026-11-19', 101],
    ['2026-11-20', 99],
    ['2026-11-23', 100],
    ['2026-11-24', 102],
    ['2026-11-25', 101],
    ['2026-11-27', 103],
]);

function itemSessions(
    session: MarketSessionSpec,
    closes: readonly MarketDailyClose[],
    windowStart: string,
    publishedAt: readonly string[]
): (string | null)[] | undefined {
    return alignNewsWithPriceMoves({
        closes,
        publishedAt,
        session,
        windowStart,
    })?.itemSessions;
}

function usSessions(publishedAt: readonly string[]) {
    return itemSessions(
        US_EQUITY_SESSION,
        US_CLOSES,
        '2026-11-19',
        publishedAt
    );
}

describe('alignNewsWithPriceMoves', () => {
    describe('US session attribution', () => {
        it('attributes a headline published before the close to the same session', () => {
            // Thu 2026-11-19 10:00 ET
            expect(usSessions(['2026-11-19T15:00:00Z'])).toEqual([
                '2026-11-19',
            ]);
        });

        it('attributes a headline published after the close to the next session', () => {
            // Thu 2026-11-19 17:00 ET
            expect(usSessions(['2026-11-19T22:00:00Z'])).toEqual([
                '2026-11-20',
            ]);
        });

        it('attributes a headline published exactly at the close to the next session', () => {
            // Thu 2026-11-19 16:00 ET: the close minute is exclusive
            expect(usSessions(['2026-11-19T21:00:00Z'])).toEqual([
                '2026-11-20',
            ]);
        });

        it('attributes a headline one minute before the close to the same session', () => {
            expect(usSessions(['2026-11-19T20:59:00Z'])).toEqual([
                '2026-11-19',
            ]);
        });

        it('attributes a pre-market headline to the session it precedes', () => {
            // Thu 2026-11-19 07:00 ET
            expect(usSessions(['2026-11-19T12:00:00Z'])).toEqual([
                '2026-11-19',
            ]);
        });

        it('attributes a Saturday headline to Monday', () => {
            expect(usSessions(['2026-11-21T12:00:00Z'])).toEqual([
                '2026-11-23',
            ]);
        });

        it('attributes a Sunday headline to Monday', () => {
            expect(usSessions(['2026-11-22T12:00:00Z'])).toEqual([
                '2026-11-23',
            ]);
        });

        it('attributes a headline after the close before a holiday to the next trading session', () => {
            // Wed 2026-11-25 20:00 ET = Thu 11-26 01:00 UTC; Thu is Thanksgiving
            expect(usSessions(['2026-11-26T01:00:00Z'])).toEqual([
                '2026-11-27',
            ]);
        });

        it('attributes a headline published on the holiday to the next trading session', () => {
            expect(usSessions(['2026-11-26T15:00:00Z'])).toEqual([
                '2026-11-27',
            ]);
        });

        it('uses the 13:00 close on the half day: 12:30 ET is still that session', () => {
            expect(usSessions(['2026-11-27T17:30:00Z'])).toEqual([
                '2026-11-27',
            ]);
        });

        it('uses the 13:00 close on the half day: 13:30 ET is after the last close', () => {
            expect(usSessions(['2026-11-27T18:30:00Z'])).toEqual([null]);
        });

        it('gives a headline published before the window no session', () => {
            // Mon 2026-11-16, and Wed 11-18 15:00 ET (the prior session, not in the window)
            expect(
                usSessions(['2026-11-16T15:00:00Z', '2026-11-18T20:00:00Z'])
            ).toEqual([null, null]);
        });

        it('reads the window start in the local date: 22:00 ET the evening before is before it', () => {
            // 2026-11-19T03:00Z = 2026-11-18 22:00 ET
            expect(usSessions(['2026-11-19T03:00:00Z'])).toEqual([null]);
        });

        it('reads the window start in the local date: 00:00 ET on the start day is inside it', () => {
            // 2026-11-19T05:00Z = 2026-11-19 00:00 ET
            expect(usSessions(['2026-11-19T05:00:00Z'])).toEqual([
                '2026-11-19',
            ]);
        });

        it('leaves each session unaffected by items of the others', () => {
            expect(
                usSessions([
                    '2026-11-24T15:00:00Z',
                    '2026-11-19T15:00:00Z',
                    '2026-11-23T15:00:00Z',
                ])
            ).toEqual(['2026-11-24', '2026-11-19', '2026-11-23']);
        });
    });

    describe('DST change on 2026-11-01', () => {
        const closes = closesOf([
            ['2026-10-29', 100],
            ['2026-10-30', 101],
            ['2026-11-02', 102],
        ]);
        const sessionsFor = (publishedAt: readonly string[]) =>
            itemSessions(US_EQUITY_SESSION, closes, '2026-10-30', publishedAt);

        it('reads a Friday headline in EDT: 16:30 ET is after the close', () => {
            expect(sessionsFor(['2026-10-30T20:30:00Z'])).toEqual([
                '2026-11-02',
            ]);
        });

        it('reads a Friday headline in EDT: 15:30 ET is before the close', () => {
            expect(sessionsFor(['2026-10-30T19:30:00Z'])).toEqual([
                '2026-10-30',
            ]);
        });

        it('reads a Monday headline in EST: 20:30 UTC is 15:30 ET, before the close', () => {
            expect(sessionsFor(['2026-11-02T20:30:00Z'])).toEqual([
                '2026-11-02',
            ]);
        });

        it('reads a Monday headline in EST: 21:30 UTC is 16:30 ET, after the last close', () => {
            expect(sessionsFor(['2026-11-02T21:30:00Z'])).toEqual([null]);
        });
    });

    describe('KRX session', () => {
        // 2026-09-24 and 09-25 are closed in this test calendar
        const krClosed = makeKrSession(['2026-09-24', '2026-09-25']);
        const closes = closesOf([
            ['2026-09-22', 100],
            ['2026-09-23', 110],
            ['2026-09-28', 99],
        ]);
        const sessionsFor = (publishedAt: readonly string[]) =>
            itemSessions(krClosed, closes, '2026-09-23', publishedAt);

        it('attributes a headline before the 15:30 KST close to the same session', () => {
            // 2026-09-23 15:29 KST
            expect(sessionsFor(['2026-09-23T06:29:00Z'])).toEqual([
                '2026-09-23',
            ]);
        });

        it('attributes a headline exactly at 15:30 KST to the next session', () => {
            expect(sessionsFor(['2026-09-23T06:30:00Z'])).toEqual([
                '2026-09-28',
            ]);
        });

        it('reads the local KST date when the UTC date is still the day before', () => {
            // 2026-09-22 23:00 UTC = 2026-09-23 08:00 KST, before the open
            expect(sessionsFor(['2026-09-22T23:00:00Z'])).toEqual([
                '2026-09-23',
            ]);
        });

        it('reads the local KST date when the UTC date is still the same day', () => {
            // 2026-09-23 16:00 UTC = 2026-09-24 01:00 KST, a holiday
            expect(sessionsFor(['2026-09-23T16:00:00Z'])).toEqual([
                '2026-09-28',
            ]);
        });

        it('attributes a headline on a holiday to the next trading session', () => {
            // 2026-09-24 10:00 KST
            expect(sessionsFor(['2026-09-24T01:00:00Z'])).toEqual([
                '2026-09-28',
            ]);
        });

        it('attributes a headline after the last close to null', () => {
            // 2026-09-28 16:00 KST
            expect(sessionsFor(['2026-09-28T07:00:00Z'])).toEqual([null]);
        });

        it('takes the close from the calendar: a day the calendar closes early is cut short', () => {
            const earlyClose: MarketSessionSpec = {
                ...makeKrSession(),
                closeMinuteFor: now =>
                    now.toISOString().slice(0, 10) === '2026-09-23'
                        ? 12 * 60
                        : 15 * 60 + 30,
            };
            // 2026-09-23 13:00 KST is after that day's 12:00 close
            expect(
                itemSessions(earlyClose, closes, '2026-09-23', [
                    '2026-09-23T04:00:00Z',
                ])
            ).toEqual(['2026-09-28']);
        });

        it('uses the regular close when the calendar says closed on a date that has a bar', () => {
            // 2026-09-23 is a calendar holiday here, yet a bar exists for it
            const contradicted = makeKrSession(['2026-09-23']);
            expect(
                itemSessions(contradicted, closes, '2026-09-23', [
                    '2026-09-23T06:29:00Z',
                    '2026-09-23T06:30:00Z',
                ])
            ).toEqual(['2026-09-23', '2026-09-28']);
        });

        it('falls back to the spec close minute when there is no calendar', () => {
            const noCalendar: MarketSessionSpec = {
                kind: 'scheduled',
                timeZone: 'Asia/Seoul',
                openMinute: 9 * 60,
                closeMinute: 15 * 60 + 30,
                weekendDays: [0, 6],
            };
            expect(
                itemSessions(noCalendar, closes, '2026-09-23', [
                    '2026-09-23T06:29:00Z',
                    '2026-09-23T06:30:00Z',
                ])
            ).toEqual(['2026-09-23', '2026-09-28']);
        });
    });

    describe('always-open session', () => {
        const closes = closesOf([
            ['2026-11-19', 100],
            ['2026-11-20', 110],
            ['2026-11-21', 99],
            ['2026-11-22', 99],
        ]);
        const sessionsFor = (publishedAt: readonly string[]) =>
            itemSessions(CRYPTO_SESSION, closes, '2026-11-20', publishedAt);

        it('attributes a headline to its UTC date', () => {
            expect(sessionsFor(['2026-11-21T23:59:00Z'])).toEqual([
                '2026-11-21',
            ]);
        });

        it('moves to the next session at the UTC midnight', () => {
            expect(sessionsFor(['2026-11-22T00:00:00Z'])).toEqual([
                '2026-11-22',
            ]);
        });

        it('attributes a headline after the last UTC day to null', () => {
            expect(sessionsFor(['2026-11-23T01:00:00Z'])).toEqual([null]);
        });

        it('attributes a headline on a day with no close to the next close', () => {
            const gapped = closesOf([
                ['2026-11-19', 100],
                ['2026-11-20', 110],
                ['2026-11-22', 99],
            ]);
            expect(
                itemSessions(CRYPTO_SESSION, gapped, '2026-11-20', [
                    '2026-11-21T10:00:00Z',
                ])
            ).toEqual(['2026-11-22']);
        });

        it('gives a headline older than the window no session', () => {
            expect(sessionsFor(['2026-11-10T10:00:00Z'])).toEqual([null]);
        });
    });

    describe('window and moves', () => {
        const base = {
            closes: US_CLOSES,
            publishedAt: [] as string[],
            session: US_EQUITY_SESSION,
            windowStart: '2026-11-19',
        };

        it('spans the first window session to the last, counting sessions', () => {
            expect(alignNewsWithPriceMoves(base)?.window).toEqual({
                from: '2026-11-19',
                to: '2026-11-27',
                sessions: 6,
            });
        });

        it('opens the window at the first session on or after windowStart when that day has no bar', () => {
            // 2026-11-21 is a Saturday: the window opens on Monday 11-23
            expect(
                alignNewsWithPriceMoves({ ...base, windowStart: '2026-11-21' })
                    ?.window
            ).toEqual({ from: '2026-11-23', to: '2026-11-27', sessions: 4 });
        });

        it('measures the median absolute daily change over the window', () => {
            // |changes| 0.98 1 1.01 1.98 1.98 2 → (1.01 + 1.98) / 2 = 1.495 → 1.5
            expect(alignNewsWithPriceMoves(base)?.medianAbsDailyChangePct).toBe(
                1.5
            );
        });

        it('lists the three largest moves, ties going to the later date', () => {
            const result = alignNewsWithPriceMoves(base);
            expect(NEWS_MOVE_DAYS_MAX).toBe(3);
            expect(
                result?.moveDays.map(day => [day.date, day.changePct, day.rank])
            ).toEqual([
                ['2026-11-24', 2, 1],
                ['2026-11-27', 1.98, 2],
                ['2026-11-20', -1.98, 3],
            ]);
        });

        it('computes the first window session against the close before the window', () => {
            const result = alignNewsWithPriceMoves({
                closes: closesOf([
                    ['2026-11-18', 100],
                    ['2026-11-19', 110],
                    ['2026-11-20', 111],
                ]),
                publishedAt: [],
                session: US_EQUITY_SESSION,
                windowStart: '2026-11-19',
            });
            expect(result?.moveDays[0]).toMatchObject({
                date: '2026-11-19',
                changePct: 10,
                rank: 1,
            });
        });

        it('skips the first window session as a move day when no earlier close exists', () => {
            const result = alignNewsWithPriceMoves({
                closes: closesOf([
                    ['2026-11-19', 100],
                    ['2026-11-20', 101],
                    ['2026-11-23', 99],
                ]),
                publishedAt: ['2026-11-19T15:00:00Z'],
                session: US_EQUITY_SESSION,
                windowStart: '2026-11-19',
            });
            expect(result?.window.sessions).toBe(3);
            expect(result?.moveDays.map(day => day.date)).toEqual([
                '2026-11-23',
                '2026-11-20',
            ]);
            expect(result?.itemSessions).toEqual(['2026-11-19']);
        });

        it('lists fewer than the cap when the window has fewer measurable sessions', () => {
            const result = alignNewsWithPriceMoves({
                closes: closesOf([
                    ['2026-11-18', 100],
                    ['2026-11-19', 101],
                    ['2026-11-20', 102],
                ]),
                publishedAt: [],
                session: US_EQUITY_SESSION,
                windowStart: '2026-11-19',
            });
            expect(result?.moveDays).toHaveLength(2);
        });

        it('sorts unsorted closes and keeps the first of a duplicated date', () => {
            const result = alignNewsWithPriceMoves({
                closes: closesOf([
                    ['2026-11-20', 101],
                    ['2026-11-18', 100],
                    ['2026-11-19', 110],
                    ['2026-11-19', 500],
                ]),
                publishedAt: [],
                session: US_EQUITY_SESSION,
                windowStart: '2026-11-19',
            });
            expect(
                result?.moveDays.map(day => [day.date, day.changePct])
            ).toEqual([
                ['2026-11-19', 10],
                ['2026-11-20', -8.18],
            ]);
        });

        it('drops closes with an invalid date or a non-finite or non-positive price', () => {
            const result = alignNewsWithPriceMoves({
                closes: closesOf([
                    ['2026-11-18', 100],
                    ['2026-11-19', 110],
                    ['2026-11-20', NaN],
                    ['2026-11-21', 0],
                    ['2026-11-22', -4],
                    ['2026-13-01', 120],
                    ['not a date', 120],
                    ['2026-11-23', 121],
                ]),
                publishedAt: [],
                session: CRYPTO_SESSION,
                windowStart: '2026-11-19',
            });
            expect(result?.window).toEqual({
                from: '2026-11-19',
                to: '2026-11-23',
                sessions: 2,
            });
            expect(
                result?.moveDays.map(day => [day.date, day.changePct])
            ).toEqual([
                ['2026-11-23', 10],
                ['2026-11-19', 10],
            ]);
        });
    });

    describe('items on move days', () => {
        // Index: session
        //  0 11-19   1 11-20   2 11-23   3 11-23   4 11-27   5 11-27   6 11-27
        //  7 null (after the half-day close)   8 null (unparseable)
        //  9 null (before the window)   10 11-27
        const publishedAt = [
            '2026-11-19T15:00:00Z',
            '2026-11-19T22:00:00Z',
            '2026-11-21T12:00:00Z',
            '2026-11-22T12:00:00Z',
            '2026-11-26T01:00:00Z',
            '2026-11-26T15:00:00Z',
            '2026-11-27T17:30:00Z',
            '2026-11-27T18:30:00Z',
            'not a date',
            '2026-11-16T15:00:00Z',
            '2026-11-27T14:00:00Z',
        ];
        const result = alignNewsWithPriceMoves({
            closes: US_CLOSES,
            publishedAt,
            session: US_EQUITY_SESSION,
            windowStart: '2026-11-19',
        });

        it('reports a session or null for every input item, in input order', () => {
            expect(result?.itemSessions).toEqual([
                '2026-11-19',
                '2026-11-20',
                '2026-11-23',
                '2026-11-23',
                '2026-11-27',
                '2026-11-27',
                '2026-11-27',
                null,
                null,
                null,
                '2026-11-27',
            ]);
        });

        it('counts only parseable headlines published after the last close', () => {
            expect(result?.afterLastCloseCount).toBe(1);
        });

        it('counts a headline published before the window apart from the after-close count', () => {
            expect(result?.beforeWindowCount).toBe(1);
        });

        it('counts neither unparseable nor in-window headlines as before the window', () => {
            const none = alignNewsWithPriceMoves({
                closes: US_CLOSES,
                publishedAt: ['not a date', '2026-11-19T15:00:00Z'],
                session: US_EQUITY_SESSION,
                windowStart: '2026-11-19',
            });
            expect(none?.beforeWindowCount).toBe(0);
            expect(none?.afterLastCloseCount).toBe(0);
        });

        it('lists the newest headlines first up to the cap and keeps the full count', () => {
            expect(NEWS_HEADLINES_PER_MOVE_DAY).toBe(3);
            const day = result?.moveDays.find(d => d.date === '2026-11-27');
            // published: idx6 11-27T17:30, idx10 11-27T14:00, idx5 11-26T15:00, idx4 11-26T01:00
            expect(day?.itemIndexes).toEqual([6, 10, 5]);
            expect(day?.itemCount).toBe(4);
        });

        it('lists a move day with one headline', () => {
            const day = result?.moveDays.find(d => d.date === '2026-11-20');
            expect(day?.itemIndexes).toEqual([1]);
            expect(day?.itemCount).toBe(1);
        });

        it('lists a move day with no headline as empty', () => {
            const day = result?.moveDays.find(d => d.date === '2026-11-24');
            expect(day?.itemIndexes).toEqual([]);
            expect(day?.itemCount).toBe(0);
        });

        it('orders headlines published at the same instant by input index', () => {
            const tied = alignNewsWithPriceMoves({
                closes: closesOf([
                    ['2026-11-18', 100],
                    ['2026-11-19', 110],
                    ['2026-11-20', 111],
                ]),
                publishedAt: [
                    '2026-11-19T15:00:00Z',
                    '2026-11-19T15:00:00Z',
                    '2026-11-19T16:00:00Z',
                ],
                session: US_EQUITY_SESSION,
                windowStart: '2026-11-19',
            });
            expect(tied?.moveDays[0]?.itemIndexes).toEqual([2, 0, 1]);
        });

        it('returns an empty itemSessions and zero after-close for no items', () => {
            const none = alignNewsWithPriceMoves({
                closes: US_CLOSES,
                publishedAt: [],
                session: US_EQUITY_SESSION,
                windowStart: '2026-11-19',
            });
            expect(none?.itemSessions).toEqual([]);
            expect(none?.afterLastCloseCount).toBe(0);
            expect(none?.beforeWindowCount).toBe(0);
        });
    });

    describe('no result', () => {
        it('returns null when the window holds one session', () => {
            expect(
                alignNewsWithPriceMoves({
                    closes: US_CLOSES,
                    publishedAt: [],
                    session: US_EQUITY_SESSION,
                    windowStart: '2026-11-27',
                })
            ).toBeNull();
        });

        it('returns null when no session is on or after windowStart', () => {
            expect(
                alignNewsWithPriceMoves({
                    closes: US_CLOSES,
                    publishedAt: [],
                    session: US_EQUITY_SESSION,
                    windowStart: '2026-12-01',
                })
            ).toBeNull();
        });

        it('returns null for no closes', () => {
            expect(
                alignNewsWithPriceMoves({
                    closes: [],
                    publishedAt: [],
                    session: US_EQUITY_SESSION,
                    windowStart: '2026-11-19',
                })
            ).toBeNull();
        });

        it.each(['2026-13-01', '2026-02-30', '20261119', 'yesterday', ''])(
            'returns null for the invalid windowStart %j',
            windowStart => {
                expect(
                    alignNewsWithPriceMoves({
                        closes: US_CLOSES,
                        publishedAt: [],
                        session: US_EQUITY_SESSION,
                        windowStart,
                    })
                ).toBeNull();
            }
        );
    });

    it('does not mutate its inputs', () => {
        const closes = closesOf([
            ['2026-11-20', 101],
            ['2026-11-18', 100],
            ['2026-11-19', 110],
        ]);
        const publishedAt = ['2026-11-19T15:00:00Z'];
        const closesCopy = structuredClone(closes);
        const publishedCopy = structuredClone(publishedAt);
        alignNewsWithPriceMoves({
            closes,
            publishedAt,
            session: US_EQUITY_SESSION,
            windowStart: '2026-11-19',
        });
        expect(closes).toEqual(closesCopy);
        expect(publishedAt).toEqual(publishedCopy);
    });
});
