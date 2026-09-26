import { describe, it, expect, vi } from 'vitest';
import type { PatternCandidate } from '@/domain/types';
import { screenChartPatterns } from '@/domain/patterns/screenChartPatterns';
import { SCREEN_LOOKBACK_BARS } from '@/domain/patterns/constants';
import { makeBars } from '@/__tests__/domain/patterns/helpers';

// Two stub classifiers that both claim `double_top` — no real classifier pair
// does this today, but the facade documents "first occurrence wins" so that a
// future overlapping classifier degrades predictably instead of overwriting.
const FIRST: PatternCandidate = {
    id: 'double_top',
    startIndex: 1,
    endIndex: 4,
    pivots: [
        { index: 1, price: 15, kind: 'high' },
        { index: 4, price: 15.2, kind: 'high' },
    ],
};
const SECOND: PatternCandidate = {
    id: 'double_top',
    startIndex: 2,
    endIndex: 9,
};
const OTHER: PatternCandidate = { id: 'bull_flag', startIndex: 0, endIndex: 3 };

vi.mock('@/domain/patterns/classifiers', () => ({
    CLASSIFIERS: [() => [FIRST], () => [SECOND, OTHER]],
}));

describe('screenChartPatterns — duplicate ids across classifiers', () => {
    it('keeps the first classifier hit, drops the later duplicate, and rebases indices by the window offset', () => {
        const offset = 30;
        const bars = makeBars(
            Array.from(
                { length: SCREEN_LOOKBACK_BARS + offset },
                (_, i) => 100 + (i % 5)
            )
        );

        const result = screenChartPatterns(bars, 1);

        expect(result).toEqual([
            { id: 'bull_flag', startIndex: offset, endIndex: offset + 3 },
            {
                id: 'double_top',
                startIndex: offset + 1,
                endIndex: offset + 4,
                pivots: [
                    { index: offset + 1, price: 15, kind: 'high' },
                    { index: offset + 4, price: 15.2, kind: 'high' },
                ],
            },
        ]);
    });
});
