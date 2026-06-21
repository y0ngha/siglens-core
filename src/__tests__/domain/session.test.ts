import { describe, it, expect } from 'vitest';
import {
    US_EQUITY_SESSION,
    CRYPTO_SESSION,
    getSessionStatus,
    isRegularSessionOpen,
} from '@/domain/session';
import { getEtSessionStatus, isEtRegularSessionOpen } from '@/domain/utils';

describe('MarketSessionSpec', () => {
    // 2026-06-22 14:30 UTC = 10:30 ET (Monday) → regular session open.
    const monOpen = new Date('2026-06-22T14:30:00Z');
    // 2026-06-21 14:30 UTC = Sunday → weekend for ET.
    const sun = new Date('2026-06-21T14:30:00Z');
    // 2026-06-22 02:00 UTC = 22:00 ET prev day (Sunday night) → closed for ET.
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

describe('ET wrappers stay behavior-compatible', () => {
    const samples = [
        new Date('2026-06-22T14:30:00Z'), // Mon 10:30 ET → open
        new Date('2026-06-21T14:30:00Z'), // Sun → weekend
        new Date('2026-06-22T08:00:00Z'), // Mon 04:00 ET → closed
        new Date('2026-06-22T20:30:00Z'), // Mon 16:30 ET → closed
    ];
    it.each(samples)('matches spec-driven status for %s', d => {
        expect(getEtSessionStatus(d)).toBe(
            getSessionStatus(US_EQUITY_SESSION, d)
        );
        expect(isEtRegularSessionOpen(d)).toBe(
            isRegularSessionOpen(US_EQUITY_SESSION, d)
        );
    });
});
