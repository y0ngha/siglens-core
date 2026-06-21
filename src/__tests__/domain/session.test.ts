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
