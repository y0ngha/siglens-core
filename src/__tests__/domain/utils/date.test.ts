import { describe, expect, it } from 'vitest';
import { addSeconds } from '@/domain/utils/date';

describe('addSeconds', () => {
    it('adds positive seconds to a date', () => {
        const base = new Date('2026-01-01T00:00:00.000Z');
        const result = addSeconds(base, 3600);
        expect(result).toEqual(new Date('2026-01-01T01:00:00.000Z'));
    });

    it('adds fractional seconds correctly', () => {
        const base = new Date('2026-01-01T00:00:00.000Z');
        const result = addSeconds(base, 0.5);
        expect(result).toEqual(new Date('2026-01-01T00:00:00.500Z'));
    });

    it('returns an epoch date when adding 0 seconds', () => {
        const base = new Date('2026-01-01T00:00:00.000Z');
        const result = addSeconds(base, 0);
        expect(result).toEqual(base);
    });

    it('does not mutate the input date', () => {
        const base = new Date('2026-01-01T00:00:00.000Z');
        const original = base.getTime();
        addSeconds(base, 100);
        expect(base.getTime()).toBe(original);
    });
});
