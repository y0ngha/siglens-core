import { describe, it, expect } from 'vitest';
import {
    mapExpirationsToSlots,
    EXPIRATION_SLOTS,
} from '@/domain/options/expirationSlots';

describe('mapExpirationsToSlots', () => {
    const now = new Date('2026-05-14T00:00:00-04:00'); // ET midnight

    it('maps closest expiration ≥ target days to each slot', () => {
        const expirations = [
            '2026-05-22', // 8 days
            '2026-05-29', // 15 days
            '2026-06-14', // 31 days
            '2026-07-15', // 62 days
            '2026-08-15', // 93 days
            '2026-11-13', // 183 days
        ];
        const result = mapExpirationsToSlots(expirations, now);
        const filled = result.filter(x => x !== null);
        expect(filled).toHaveLength(6);
        expect(filled[0]?.slot.key).toBe('1W');
        expect(filled[0]?.expirationDate).toBe('2026-05-22');
        expect(filled[5]?.slot.key).toBe('6M');
    });

    it('omits slots with no satisfying expiration', () => {
        const expirations = ['2026-05-22']; // only 1W
        const result = mapExpirationsToSlots(expirations, now);
        expect(result.filter(x => x !== null)).toHaveLength(1);
        expect(result.filter(x => x !== null)[0]?.slot.key).toBe('1W');
    });

    it('does not reuse the same expiration across slots', () => {
        const expirations = ['2026-05-22']; // 8 days
        const result = mapExpirationsToSlots(expirations, now);
        const filled = result.filter(x => x !== null);
        expect(filled).toHaveLength(1);
    });
});
