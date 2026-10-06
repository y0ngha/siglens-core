import { describe, it, expect } from 'vitest';
import {
    US_EQUITY_SESSION,
    CRYPTO_SESSION,
    getSessionStatus,
    isRegularSessionOpen,
    latestTradingDayStartUtcMs,
    nextRegularSessionBoundaryMs,
    previousRegularSessionBoundaryMs,
} from '@/domain/session';
import { makeKrSession } from '../helpers/krSession';
import { getEtSessionStatus, isEtRegularSessionOpen } from '@/domain/utils';
import type { MarketSessionSpec } from '@/domain/types';

describe('MarketSessionSpec', () => {
    // 2026-06-22 14:30 UTC = 10:30 ET (Monday) → regular session open.
    const monOpen = new Date('2026-06-22T14:30:00Z');
    // 2026-06-21 14:30 UTC = Sunday → weekend for ET.
    const sun = new Date('2026-06-21T14:30:00Z');
    // 2026-06-22 08:00 UTC = 04:00 EDT (Monday pre-market) → closed for ET.
    const monPremarketUtc = new Date('2026-06-22T08:00:00Z'); // 04:00 ET → closed

    it('US equity session: open during ET regular hours', () => {
        expect(getSessionStatus(US_EQUITY_SESSION, monOpen)).toBe('open');
        expect(isRegularSessionOpen(US_EQUITY_SESSION, monOpen)).toBe(true);
    });

    it('US equity session: weekend and pre-market are not open', () => {
        expect(getSessionStatus(US_EQUITY_SESSION, sun)).toBe('weekend');
        expect(getSessionStatus(US_EQUITY_SESSION, monPremarketUtc)).toBe(
            'closed'
        );
    });

    it('crypto session is always open — every instant', () => {
        expect(getSessionStatus(CRYPTO_SESSION, monOpen)).toBe('open');
        expect(getSessionStatus(CRYPTO_SESSION, sun)).toBe('open');
        expect(getSessionStatus(CRYPTO_SESSION, monPremarketUtc)).toBe('open');
        expect(isRegularSessionOpen(CRYPTO_SESSION, sun)).toBe(true);
    });
});

describe('ET wrappers — expected literal verdicts for concrete ET boundary instants', () => {
    // All instants below are in EDT (UTC-4) unless noted as EST (UTC-5).
    // Regular session: 09:30–16:00 ET, EXCLUSIVE of 16:00.

    it('09:30 ET on a weekday is open (inclusive open boundary)', () => {
        // 2026-06-22 13:30 UTC = 09:30 EDT (Monday)
        const d = new Date('2026-06-22T13:30:00Z');
        expect(getEtSessionStatus(d)).toBe('open');
        expect(isEtRegularSessionOpen(d)).toBe(true);
    });

    it('midday ET on a weekday is open', () => {
        // 2026-06-22 17:00 UTC = 13:00 EDT (Monday)
        const d = new Date('2026-06-22T17:00:00Z');
        expect(getEtSessionStatus(d)).toBe('open');
        expect(isEtRegularSessionOpen(d)).toBe(true);
    });

    it('15:59 ET is open (one minute before exclusive close boundary)', () => {
        // 2026-06-22 19:59 UTC = 15:59 EDT (Monday)
        const d = new Date('2026-06-22T19:59:00Z');
        expect(getEtSessionStatus(d)).toBe('open');
        expect(isEtRegularSessionOpen(d)).toBe(true);
    });

    it('16:00 ET is closed (exclusive close boundary — session is CLOSED at 16:00)', () => {
        // 2026-06-22 20:00 UTC = 16:00 EDT (Monday)
        const d = new Date('2026-06-22T20:00:00Z');
        expect(getEtSessionStatus(d)).toBe('closed');
        expect(isEtRegularSessionOpen(d)).toBe(false);
    });

    it('overnight (pre-market) is closed', () => {
        // 2026-06-22 08:00 UTC = 04:00 EDT (Monday pre-market)
        const d = new Date('2026-06-22T08:00:00Z');
        expect(getEtSessionStatus(d)).toBe('closed');
        expect(isEtRegularSessionOpen(d)).toBe(false);
    });

    it('Sunday is weekend', () => {
        // 2026-06-21 14:30 UTC = Sunday
        const d = new Date('2026-06-21T14:30:00Z');
        expect(getEtSessionStatus(d)).toBe('weekend');
        expect(isEtRegularSessionOpen(d)).toBe(false);
    });
});

describe('getSessionStatus — calendar, DST and custom-spec boundaries', () => {
    describe('US equity session across daylight-saving changes', () => {
        it('in EST (winter) 09:30 ET is 14:30 UTC — 14:29 UTC is still closed', () => {
            // 2026-01-06 (Tuesday), EST = UTC-5
            expect(
                getSessionStatus(
                    US_EQUITY_SESSION,
                    new Date('2026-01-06T14:29:00Z')
                )
            ).toBe('closed');
            expect(
                getSessionStatus(
                    US_EQUITY_SESSION,
                    new Date('2026-01-06T14:30:00Z')
                )
            ).toBe('open');
        });

        it('the Monday after the spring-forward switch opens at 13:30 UTC, an hour earlier than the prior Friday', () => {
            // DST starts 2026-03-08. Friday 03-06 is EST, Monday 03-09 is EDT.
            expect(
                getSessionStatus(
                    US_EQUITY_SESSION,
                    new Date('2026-03-06T13:30:00Z')
                )
            ).toBe('closed');
            expect(
                getSessionStatus(
                    US_EQUITY_SESSION,
                    new Date('2026-03-09T13:30:00Z')
                )
            ).toBe('open');
        });

        it('Friday 16:00 ET close precedes the Saturday weekend verdict', () => {
            // 2026-06-26 Friday 20:00 UTC = 16:00 EDT → closed (not weekend)
            expect(
                getSessionStatus(
                    US_EQUITY_SESSION,
                    new Date('2026-06-26T20:00:00Z')
                )
            ).toBe('closed');
            // Friday 23:30 ET is 03:30 UTC Saturday — still Friday locally
            expect(
                getSessionStatus(
                    US_EQUITY_SESSION,
                    new Date('2026-06-27T03:30:00Z')
                )
            ).toBe('closed');
            // Saturday 10:30 ET
            expect(
                getSessionStatus(
                    US_EQUITY_SESSION,
                    new Date('2026-06-27T14:30:00Z')
                )
            ).toBe('weekend');
        });
    });

    describe('US equity session with the exchange calendar', () => {
        it('a weekday NYSE holiday (Thanksgiving) is closed even at 10:30 ET', () => {
            // 2026-11-26 Thursday, EST: 15:30 UTC = 10:30 ET
            expect(
                getSessionStatus(
                    US_EQUITY_SESSION,
                    new Date('2026-11-26T15:30:00Z')
                )
            ).toBe('closed');
        });

        it('the day-after-Thanksgiving half day closes at 13:00 ET, not 16:00', () => {
            // 2026-11-27 Friday, EST: 17:59 UTC = 12:59 ET, 18:00 UTC = 13:00 ET
            expect(
                getSessionStatus(
                    US_EQUITY_SESSION,
                    new Date('2026-11-27T17:59:00Z')
                )
            ).toBe('open');
            expect(
                getSessionStatus(
                    US_EQUITY_SESSION,
                    new Date('2026-11-27T18:00:00Z')
                )
            ).toBe('closed');
        });
    });

    describe('custom scheduled specs', () => {
        // KRX-like session: 09:00–15:30 KST, no exchange calendar supplied.
        const krxLike: MarketSessionSpec = {
            kind: 'scheduled',
            timeZone: 'Asia/Seoul',
            openMinute: 9 * 60,
            closeMinute: 15 * 60 + 30,
            weekendDays: [0, 6],
        };

        it('resolves a zone without a pre-built formatter (Asia/Seoul) using spec.closeMinute', () => {
            // 2026-06-22 Monday: 00:00 UTC = 09:00 KST, 06:29 UTC = 15:29 KST
            expect(
                getSessionStatus(krxLike, new Date('2026-06-22T00:00:00Z'))
            ).toBe('open');
            expect(
                getSessionStatus(krxLike, new Date('2026-06-22T06:29:00Z'))
            ).toBe('open');
            expect(
                getSessionStatus(krxLike, new Date('2026-06-22T06:30:00Z'))
            ).toBe('closed');
        });

        it('uses the local weekday, not the UTC weekday', () => {
            // 2026-06-21 Sunday 23:30 UTC = Monday 08:30 KST → closed, not weekend
            expect(
                getSessionStatus(krxLike, new Date('2026-06-21T23:30:00Z'))
            ).toBe('closed');
            // 2026-06-19 Friday 16:00 UTC = Saturday 01:00 KST → weekend
            expect(
                getSessionStatus(krxLike, new Date('2026-06-19T16:00:00Z'))
            ).toBe('weekend');
        });

        it('a closeMinuteFor that returns 0 closes the whole day', () => {
            const holiday: MarketSessionSpec = {
                ...krxLike,
                closeMinuteFor: () => 0,
            };
            expect(
                isRegularSessionOpen(holiday, new Date('2026-06-22T03:00:00Z'))
            ).toBe(false);
        });
    });
});

describe('latestTradingDayStartUtcMs', () => {
    const utcMidnight = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

    it('오늘이 거래일이면 장중·개장 전·마감 후 모두 오늘 자정(UTC)을 돌려준다', () => {
        // 2026-10-06 화요일. 개장 전(04:00 ET)·장중(10:30 ET)·마감 후(20:00 ET).
        for (const iso of [
            '2026-10-06T08:00:00Z',
            '2026-10-06T14:30:00Z',
            '2026-10-07T00:00:00Z',
        ]) {
            expect(
                latestTradingDayStartUtcMs(US_EQUITY_SESSION, new Date(iso))
            ).toBe(utcMidnight('2026-10-06'));
        }
    });

    it('토요일·일요일은 직전 금요일을 돌려준다', () => {
        for (const iso of ['2026-10-03T15:00:00Z', '2026-10-04T15:00:00Z']) {
            expect(
                latestTradingDayStartUtcMs(US_EQUITY_SESSION, new Date(iso))
            ).toBe(utcMidnight('2026-10-02'));
        }
    });

    it('날짜는 UTC가 아니라 현지 날짜로 읽는다', () => {
        // 2026-10-07 02:00 UTC = 10-06 22:00 ET(화) → 화요일.
        expect(
            latestTradingDayStartUtcMs(
                US_EQUITY_SESSION,
                new Date('2026-10-07T02:00:00Z')
            )
        ).toBe(utcMidnight('2026-10-06'));
        // 2026-10-05 02:00 UTC = 10-04 22:00 ET(일) → 직전 금요일.
        expect(
            latestTradingDayStartUtcMs(
                US_EQUITY_SESSION,
                new Date('2026-10-05T02:00:00Z')
            )
        ).toBe(utcMidnight('2026-10-02'));
    });

    it('휴장일(노동절 월요일)은 건너뛰고 직전 금요일을 돌려준다', () => {
        expect(
            latestTradingDayStartUtcMs(
                US_EQUITY_SESSION,
                new Date('2026-09-07T15:00:00Z')
            )
        ).toBe(utcMidnight('2026-09-04'));
    });

    it('KRX(UTC+9): 월요일 새벽 KST는 월요일, 토요일 KST는 금요일, 금요일 저녁 KST는 금요일이다', () => {
        const krx: MarketSessionSpec = {
            kind: 'scheduled',
            timeZone: 'Asia/Seoul',
            openMinute: 9 * 60,
            closeMinute: 15 * 60 + 30,
            weekendDays: [0, 6],
        };
        // 월요일 08:00 KST = 일요일 23:00Z — UTC 날짜는 일요일이지만 현지는 월요일.
        expect(
            latestTradingDayStartUtcMs(krx, new Date('2026-10-04T23:00:00Z'))
        ).toBe(utcMidnight('2026-10-05'));
        // 토요일 12:00 KST.
        expect(
            latestTradingDayStartUtcMs(krx, new Date('2026-10-03T03:00:00Z'))
        ).toBe(utcMidnight('2026-10-02'));
        // 금요일 21:00 KST(= 12:00Z)·23:59 KST(= 14:59Z).
        for (const iso of ['2026-10-02T12:00:00Z', '2026-10-02T14:59:00Z']) {
            expect(latestTradingDayStartUtcMs(krx, new Date(iso))).toBe(
                utcMidnight('2026-10-02')
            );
        }
        // 토요일 00:30 KST(= 금요일 15:30Z)는 이미 토요일 → 금요일.
        expect(
            latestTradingDayStartUtcMs(krx, new Date('2026-10-02T15:30:00Z'))
        ).toBe(utcMidnight('2026-10-02'));
    });

    it('always-open 스펙에는 거래일이 없어 null이다', () => {
        expect(
            latestTradingDayStartUtcMs(
                CRYPTO_SESSION,
                new Date('2026-10-06T15:00:00Z')
            )
        ).toBeNull();
    });

    it('거래일이 탐색 상한 안에 없는 스펙은 null이다', () => {
        const neverOpen: MarketSessionSpec = {
            kind: 'scheduled',
            timeZone: 'America/New_York',
            openMinute: 570,
            closeMinute: 960,
            weekendDays: [0, 1, 2, 3, 4, 5, 6],
        };
        expect(
            latestTradingDayStartUtcMs(
                neverOpen,
                new Date('2026-10-06T15:00:00Z')
            )
        ).toBeNull();
    });
});

describe('previousRegularSessionBoundaryMs', () => {
    const US = US_EQUITY_SESSION as Extract<
        MarketSessionSpec,
        { kind: 'scheduled' }
    >;
    const at = (iso: string) => new Date(iso);
    const iso = (ms: number | null) =>
        ms === null ? null : new Date(ms).toISOString();

    it('장중에는 직전 거래일 마감(+버퍼)을 돌려준다', () => {
        // 2026-09-29 화 14:00 ET → 월 16:00 ET + 30분 = 20:30Z
        expect(
            iso(
                previousRegularSessionBoundaryMs(
                    US,
                    at('2026-09-29T18:00:00Z'),
                    'close',
                    30
                )
            )
        ).toBe('2026-09-28T20:30:00.000Z');
    });

    it('마감+버퍼 직후에는 오늘 마감(+버퍼)을 돌려준다', () => {
        expect(
            iso(
                previousRegularSessionBoundaryMs(
                    US,
                    at('2026-09-29T21:00:00Z'),
                    'close',
                    30
                )
            )
        ).toBe('2026-09-29T20:30:00.000Z');
    });

    it('경계 순간 자체는 이전 경계로 포함된다(<= now)', () => {
        expect(
            iso(
                previousRegularSessionBoundaryMs(
                    US,
                    at('2026-09-29T20:00:00Z'),
                    'close'
                )
            )
        ).toBe('2026-09-29T20:00:00.000Z');
    });

    it('휴장일(노동절)과 주말을 건너뛴다', () => {
        // 2026-09-08 화 10:00 ET — 월요일은 노동절, 직전 마감은 금요일 9/4
        expect(
            iso(
                previousRegularSessionBoundaryMs(
                    US,
                    at('2026-09-08T14:00:00Z'),
                    'close'
                )
            )
        ).toBe('2026-09-04T20:00:00.000Z');
    });

    it('KRX 스펙: 저녁 19:00 KST에는 같은 날 15:30+30분(16:00 KST)', () => {
        expect(
            iso(
                previousRegularSessionBoundaryMs(
                    makeKrSession(),
                    at('2026-09-29T10:00:00Z'),
                    'close',
                    30
                )
            )
        ).toBe('2026-09-29T07:00:00.000Z');
    });

    it('다음 경계와 맞물려 [이전, 다음)이 한 세션 버킷이 된다', () => {
        const kr = makeKrSession();
        const now = at('2026-09-29T20:30:00Z'); // 05:30 KST 수
        const prev = previousRegularSessionBoundaryMs(kr, now, 'close', 30);
        const next = nextRegularSessionBoundaryMs(kr, now, 'close', 30);
        expect(iso(prev)).toBe('2026-09-29T07:00:00.000Z');
        expect(iso(next)).toBe('2026-09-30T07:00:00.000Z');
    });

    it('탐색 상한 안에 거래일이 없는 스펙은 null', () => {
        const never: Extract<MarketSessionSpec, { kind: 'scheduled' }> = {
            ...makeKrSession(),
            closeMinuteFor: () => 0,
        };
        expect(
            previousRegularSessionBoundaryMs(
                never,
                at('2026-09-29T10:00:00Z'),
                'close'
            )
        ).toBeNull();
    });
});
