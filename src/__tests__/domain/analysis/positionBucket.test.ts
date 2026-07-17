import { describe, expect, it } from 'vitest';
import { bucketizePosition } from '@/domain/analysis/positionBucket';

describe('bucketizePosition', () => {
    it('returns deep-profit when unrealized return is exactly +20% (inclusive lower bound)', () => {
        expect(bucketizePosition(100, 120)).toBe('deep-profit');
    });

    it('returns deep-profit when unrealized return exceeds +20%', () => {
        expect(bucketizePosition(100, 150)).toBe('deep-profit');
    });

    it('returns profit just below the deep-profit boundary (+19.99%)', () => {
        expect(bucketizePosition(100, 119.99)).toBe('profit');
    });

    it('returns profit when unrealized return is exactly +5% (inclusive lower bound)', () => {
        expect(bucketizePosition(100, 105)).toBe('profit');
    });

    it('returns profit mid-band (+10%)', () => {
        expect(bucketizePosition(100, 110)).toBe('profit');
    });

    it('returns near-breakeven just above the profit boundary (+4.99%)', () => {
        expect(bucketizePosition(100, 104.99)).toBe('near-breakeven');
    });

    it('returns near-breakeven at 0% return', () => {
        expect(bucketizePosition(100, 100)).toBe('near-breakeven');
    });

    it('returns near-breakeven just above the loss boundary (-4.99%)', () => {
        expect(bucketizePosition(100, 95.01)).toBe('near-breakeven');
    });

    it('returns loss when unrealized return is exactly -5% (inclusive upper bound)', () => {
        expect(bucketizePosition(100, 95)).toBe('loss');
    });

    it('returns loss mid-band (-10%)', () => {
        expect(bucketizePosition(100, 90)).toBe('loss');
    });

    it('returns loss just above the deep-loss boundary (-19.99%)', () => {
        expect(bucketizePosition(100, 80.01)).toBe('loss');
    });

    it('returns deep-loss when unrealized return is exactly -20% (inclusive upper bound)', () => {
        expect(bucketizePosition(100, 80)).toBe('deep-loss');
    });

    it('returns deep-loss when unrealized return is below -20%', () => {
        expect(bucketizePosition(100, 50)).toBe('deep-loss');
    });

    it('returns null when avg is zero', () => {
        expect(bucketizePosition(0, 100)).toBeNull();
    });

    it('returns null when avg is negative', () => {
        expect(bucketizePosition(-10, 100)).toBeNull();
    });

    it('returns null when currentPrice is zero', () => {
        expect(bucketizePosition(100, 0)).toBeNull();
    });

    it('returns null when currentPrice is negative', () => {
        expect(bucketizePosition(100, -5)).toBeNull();
    });

    it('returns null when avg is NaN', () => {
        expect(bucketizePosition(NaN, 100)).toBeNull();
    });

    it('returns null when currentPrice is Infinity', () => {
        expect(bucketizePosition(100, Infinity)).toBeNull();
    });

    it('returns null when avg is -Infinity', () => {
        expect(bucketizePosition(-Infinity, 100)).toBeNull();
    });
});
