import { describe, it, expect } from 'vitest';
import {
    findCrossIndices,
    findThresholdCrossIndices,
    findFlipIndices,
} from '@/domain/validation/triggerScan';

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

describe('findThresholdCrossIndices', () => {
    it('returns empty for an empty array (worst case)', () => {
        expect(findThresholdCrossIndices([], 0, 'up')).toEqual([]);
    });

    it('returns empty for an all-null array (worst case)', () => {
        expect(findThresholdCrossIndices([null, null, null], 0, 'up')).toEqual(
            []
        );
    });

    it('returns empty when the series never crosses the threshold', () => {
        expect(findThresholdCrossIndices([1, 1, 1, 1], 5, 'up')).toEqual([]);
        expect(findThresholdCrossIndices([9, 9, 9, 9], 5, 'down')).toEqual([]);
    });

    it('finds a single upward threshold cross', () => {
        // prev <= 5 && cur > 5 at index 2 (5 -> 6).
        expect(findThresholdCrossIndices([4, 5, 6, 6], 5, 'up')).toEqual([2]);
    });

    it('finds a single downward threshold cross', () => {
        // prev >= 5 && cur < 5 at index 2 (5 -> 4).
        expect(findThresholdCrossIndices([6, 5, 4, 4], 5, 'down')).toEqual([2]);
    });

    it('detects multiple threshold crosses', () => {
        // up-crosses where prev<=5 && cur>5.
        expect(findThresholdCrossIndices([4, 6, 4, 6], 5, 'up')).toEqual([
            1, 3,
        ]);
    });

    it('skips a candidate when values[i] is null', () => {
        // index 1 would be an up-cross but cur is null.
        expect(findThresholdCrossIndices([4, null, 6], 5, 'up')).toEqual([]);
    });

    it('skips a candidate when values[i-1] is null', () => {
        // index 1 has prev null even though cur (6) is above threshold.
        expect(findThresholdCrossIndices([null, 6, 6], 5, 'up')).toEqual([]);
    });

    it('counts an up-cross when the previous value equals the threshold (<= boundary)', () => {
        // prev == 5 (<=5) && cur 6 > 5 → cross at index 1.
        expect(findThresholdCrossIndices([5, 6], 5, 'up')).toEqual([1]);
    });

    it('counts a down-cross when the previous value equals the threshold (>= boundary)', () => {
        // prev == 5 (>=5) && cur 4 < 5 → cross at index 1.
        expect(findThresholdCrossIndices([5, 4], 5, 'down')).toEqual([1]);
    });

    it('does not count an up-cross when the current value equals the threshold', () => {
        // cur == 5 is not strictly > 5.
        expect(findThresholdCrossIndices([4, 5], 5, 'up')).toEqual([]);
    });

    it('handles a negative threshold (MACD-V style)', () => {
        // prev >= -150 && cur < -150 at index 1.
        expect(findThresholdCrossIndices([-140, -160], -150, 'down')).toEqual([
            1,
        ]);
    });
});

describe('findFlipIndices', () => {
    it('returns empty for an empty array (worst case)', () => {
        expect(findFlipIndices<string>([], 'green')).toEqual([]);
    });

    it('returns empty for an all-null array (worst case)', () => {
        expect(findFlipIndices<string>([null, null], 'green')).toEqual([]);
    });

    it('returns empty for a constant state (no flip)', () => {
        expect(findFlipIndices(['green', 'green', 'green'], 'green')).toEqual(
            []
        );
    });

    it('finds a single flip into the target state', () => {
        // index 2: prev 'red' (non-null, !== 'green') -> 'green'.
        expect(findFlipIndices(['red', 'red', 'green'], 'green')).toEqual([2]);
    });

    it('detects multiple flips into the target state', () => {
        const states = ['red', 'green', 'red', 'green'];
        expect(findFlipIndices(states, 'green')).toEqual([1, 3]);
    });

    it('excludes a flip from null (null -> target is not a flip)', () => {
        // index 1 is the first non-null and equals target → not a flip.
        expect(findFlipIndices([null, 'green', 'green'], 'green')).toEqual([]);
    });

    it('excludes the target value at index 0', () => {
        expect(findFlipIndices(['green', 'green'], 'green')).toEqual([]);
    });

    it('counts a flip that returns to the target after leaving it', () => {
        const states = ['green', 'red', 'green'];
        // index 2: prev 'red' -> 'green' is a genuine flip back in.
        expect(findFlipIndices(states, 'green')).toEqual([2]);
    });

    it('works with a three-way string-literal union', () => {
        const states: ('green' | 'red' | 'blue')[] = [
            'blue',
            'green',
            'red',
            'green',
        ];
        expect(findFlipIndices(states, 'green')).toEqual([1, 3]);
    });

    it('works with a boolean state type', () => {
        const states = [false, true, false, true];
        expect(findFlipIndices(states, true)).toEqual([1, 3]);
    });
});
