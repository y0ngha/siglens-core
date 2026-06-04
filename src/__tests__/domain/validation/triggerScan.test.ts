import { describe, it, expect } from 'vitest';
import { findCrossIndices } from '@/domain/validation/triggerScan';

describe('findCrossIndices', () => {
    it('finds upward crossover indices', () => {
        const fast = [1, 1, 3, 3];
        const slow = [2, 2, 2, 2];
        // fast crosses above slow at index 2.
        expect(findCrossIndices(fast, slow, 'up')).toEqual([2]);
    });

    it('finds downward crossover indices', () => {
        const fast = [3, 3, 1, 1];
        const slow = [2, 2, 2, 2];
        expect(findCrossIndices(fast, slow, 'down')).toEqual([2]);
    });

    it('skips bars with null on either series (worst case)', () => {
        const fast = [null, 1, 3, null, 5];
        const slow = [2, 2, 2, 2, 2];
        // only index 2 is a valid up-cross (1<=2 && 3>2). index 4 has prev null.
        expect(findCrossIndices(fast, slow, 'up')).toEqual([2]);
    });

    it('returns empty for no crossover / empty / single-element input (worst case)', () => {
        expect(findCrossIndices([1, 1], [2, 2], 'up')).toEqual([]);
        expect(findCrossIndices([], [], 'up')).toEqual([]);
        expect(findCrossIndices([5], [2], 'up')).toEqual([]);
    });

    it('detects multiple crossovers', () => {
        const fast = [1, 3, 1, 3];
        const slow = [2, 2, 2, 2];
        expect(findCrossIndices(fast, slow, 'up')).toEqual([1, 3]);
    });
});
