import { describe, expect, it } from 'vitest';
import { roundNumberLevels } from '@/domain/analysis/referenceLevels';

describe('roundNumberLevels', () => {
    it('uses $5 increments in the 50–200 tier', () => {
        const prices = roundNumberLevels(123)
            .map(l => l.price)
            .sort((a, b) => a - b);
        expect(prices).toContain(120);
        expect(prices).toContain(125);
    });
    it('uses $0.50 increments under $5', () => {
        const prices = roundNumberLevels(3.2).map(l => l.price);
        expect(prices).toContain(3);
        expect(prices).toContain(3.5);
    });
    it('labels every level kind round', () => {
        expect(roundNumberLevels(123).every(l => l.kind === 'round')).toBe(
            true
        );
    });
});
