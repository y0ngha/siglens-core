import { describe, it, expect } from 'vitest';
import {
    computeBarsEffectiveTtl,
    BARS_OPEN_TTL_SECONDS,
} from '@/infrastructure/cache/config';
import { CRYPTO_SESSION } from '@/domain/session';

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
});
