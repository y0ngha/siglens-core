import { describe, it, expect } from 'vitest';
import {
    computeBarsEffectiveTtl,
    BARS_OPEN_TTL_SECONDS,
    BARS_OFFHOURS_TTL_CEILING_SECONDS,
} from '@/infrastructure/cache/config';
import { CRYPTO_SESSION, US_EQUITY_SESSION } from '@/domain/session';
import { SECONDS_PER_HOUR } from '@/domain/constants/time';
import { makeKrSession } from '../helpers/krSession';

describe('computeBarsEffectiveTtl with session spec', () => {
    it('crypto (always-open) returns the open TTL even on a weekend', () => {
        const sun = new Date('2026-06-21T14:30:00Z'); // Sunday
        expect(computeBarsEffectiveTtl('1Day', sun, CRYPTO_SESSION)).toBe(
            BARS_OPEN_TTL_SECONDS
        );
    });

    it('defaults to ET behavior when no spec is passed (backward compat)', () => {
        const sun = new Date('2026-06-21T14:30:00Z');
        // ET weekend → off-hours TTL (> open TTL)
        expect(computeBarsEffectiveTtl('1Day', sun)).toBeGreaterThan(
            BARS_OPEN_TTL_SECONDS
        );
    });

    it('US_EQUITY_SESSION during regular ET session returns the open TTL', () => {
        // 2026-06-22 (Monday) 14:30 UTC = 10:30 EDT — inside 09:30–16:00 ET
        const duringSession = new Date('2026-06-22T14:30:00Z');
        expect(
            computeBarsEffectiveTtl('1Day', duringSession, US_EQUITY_SESSION)
        ).toBe(BARS_OPEN_TTL_SECONDS);
    });

    it('caps off-hours TTL at the ceiling when next open is >24h away (late Saturday ET)', () => {
        // 2026-06-20T04:00:00Z = Saturday 00:00 EDT — next open is Mon 09:30 ET (~57.5 h away),
        // which exceeds BARS_OFFHOURS_TTL_CEILING_SECONDS (86400 s / 24 h).
        const lateSat = new Date('2026-06-20T04:00:00Z');
        expect(computeBarsEffectiveTtl('1Day', lateSat)).toBe(
            BARS_OFFHOURS_TTL_CEILING_SECONDS
        );
    });
});

describe('computeBarsEffectiveTtl — 세션별 장외 TTL', () => {
    it('KR 세션: 월 23:00 KST(14:00Z)의 TTL이 다음 KRX 개장(화 00:00Z)을 넘지 않는다', () => {
        // 종전에는 NYSE 개장 기준(Tue 13:30Z, 23.5h)으로 잡혀 한국 장중 내내 굳었다.
        const now = new Date('2026-07-06T14:00:00Z');
        const ttl = computeBarsEffectiveTtl('1Day', now, makeKrSession());
        expect(ttl).toBeLessThanOrEqual(10 * SECONDS_PER_HOUR);
        expect(ttl).toBe(10 * SECONDS_PER_HOUR);
    });

    it('US 세션 값은 그대로다', () => {
        // Mon 10:00 EDT → 정규장 중이라 개장 TTL.
        const now = new Date('2026-07-06T14:00:00Z');
        expect(computeBarsEffectiveTtl('1Day', now, US_EQUITY_SESSION)).toBe(
            BARS_OPEN_TTL_SECONDS
        );
        // Mon 17:00 EDT → 화 09:30 EDT까지 990분.
        expect(
            computeBarsEffectiveTtl(
                '1Day',
                new Date('2026-07-06T21:00:00Z'),
                US_EQUITY_SESSION
            )
        ).toBe(990 * 60);
    });

    it('KR 세션: 정규장 중에는 개장 TTL이다 (Mon 10:00 KST = 01:00Z)', () => {
        expect(
            computeBarsEffectiveTtl(
                '1Day',
                new Date('2026-07-06T01:00:00Z'),
                makeKrSession()
            )
        ).toBe(BARS_OPEN_TTL_SECONDS);
    });

    it('KR 세션: 휴장일은 건너뛴다 (화 휴장 → 수 00:00Z는 34시간 → 천장)', () => {
        const now = new Date('2026-07-06T14:00:00Z');
        expect(
            computeBarsEffectiveTtl('1Day', now, makeKrSession(['2026-07-07']))
        ).toBe(BARS_OFFHOURS_TTL_CEILING_SECONDS);
    });

    it('KR 세션: 금요일 장 마감 후 주말에는 천장으로 자른다', () => {
        // 2026-07-10(금) 19:00 KST = 10:00Z → 월 00:00Z까지 62시간 > 천장.
        expect(
            computeBarsEffectiveTtl(
                '1Day',
                new Date('2026-07-10T10:00:00Z'),
                makeKrSession()
            )
        ).toBe(BARS_OFFHOURS_TTL_CEILING_SECONDS);
    });
});
