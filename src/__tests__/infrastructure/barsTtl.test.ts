import { describe, it, expect } from 'vitest';
import {
    computeBarsEffectiveTtl,
    BARS_OPEN_TTL_SECONDS,
} from '@/infrastructure/cache/config';
import { CRYPTO_SESSION, US_EQUITY_SESSION } from '@/domain/session';

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
});
