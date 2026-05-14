import { describe, it, expect } from 'vitest';
import { calculateImpliedMove } from '@/domain/options/calculateImpliedMove';

describe('calculateImpliedMove', () => {
    it('returns IV * sqrt(daysToExpiration / 365) as percent', () => {
        // IV=0.30, DTE=30 → 0.30 * sqrt(30/365) ≈ 0.0860 → 8.60%
        const result = calculateImpliedMove(0.30, 30);
        expect(result).not.toBeNull();
        expect(result!).toBeCloseTo(8.6, 1);
    });

    it('returns null when ATM IV is null', () => {
        expect(calculateImpliedMove(null, 30)).toBeNull();
    });

    it('returns null when daysToExpiration is 0 or negative', () => {
        expect(calculateImpliedMove(0.30, 0)).toBeNull();
        expect(calculateImpliedMove(0.30, -1)).toBeNull();
    });
});
