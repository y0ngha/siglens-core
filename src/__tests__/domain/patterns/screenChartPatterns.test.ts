import { describe, it, expect } from 'vitest';
import type { Bar } from '@/domain/types';
import { screenChartPatterns } from '@/domain/patterns/screenChartPatterns';
import { SCREEN_LOOKBACK_BARS } from '@/domain/patterns/constants';
import { makeBars } from '@/__tests__/domain/patterns/helpers';

import hsTextbook from '@/__tests__/domain/patterns/fixtures/hs-textbook.json';
import doubleTop from '@/__tests__/domain/patterns/fixtures/double-top.json';
import ascendingTriangle from '@/__tests__/domain/patterns/fixtures/ascending-triangle.json';
import bullFlag from '@/__tests__/domain/patterns/fixtures/bull-flag.json';
import cupAndHandle from '@/__tests__/domain/patterns/fixtures/cup-and-handle.json';

interface Fixture {
    atr: number;
    bars: Bar[];
}

const RECALL_FIXTURES: Array<{
    name: string;
    fixture: Fixture;
    expectedId: string;
}> = [
    {
        name: 'hs-textbook',
        fixture: hsTextbook as Fixture,
        expectedId: 'head_and_shoulders',
    },
    {
        name: 'double-top',
        fixture: doubleTop as Fixture,
        expectedId: 'double_top',
    },
    {
        name: 'ascending-triangle',
        fixture: ascendingTriangle as Fixture,
        expectedId: 'ascending_triangle',
    },
    {
        name: 'bull-flag',
        fixture: bullFlag as Fixture,
        expectedId: 'bull_flag',
    },
    {
        name: 'cup-and-handle',
        fixture: cupAndHandle as Fixture,
        expectedId: 'cup_and_handle',
    },
];

describe('screenChartPatterns — recall fixtures', () => {
    for (const { name, fixture, expectedId } of RECALL_FIXTURES) {
        it(`recalls ${expectedId} from the ${name} fixture`, () => {
            const candidates = screenChartPatterns(fixture.bars, fixture.atr);
            const ids = candidates.map(c => c.id);

            expect(ids).toContain(expectedId);
        });
    }
});

describe('screenChartPatterns — determinism, ordering, dedup', () => {
    it('returns deeply equal output for the same input across repeated calls', () => {
        const first = screenChartPatterns(
            hsTextbook.bars as Bar[],
            hsTextbook.atr
        );
        const second = screenChartPatterns(
            hsTextbook.bars as Bar[],
            hsTextbook.atr
        );

        expect(second).toEqual(first);
    });

    it('sorts candidates by id.localeCompare and never emits duplicate ids', () => {
        const candidates = screenChartPatterns(
            bullFlag.bars as Bar[],
            bullFlag.atr
        );

        const ids = candidates.map(c => c.id);
        const sortedIds = ids.toSorted((a, b) => a.localeCompare(b, 'en'));
        expect(ids).toEqual(sortedIds);

        expect(new Set(ids).size).toBe(ids.length);
    });

    it('does not mutate the input bars array', () => {
        const barsCopy = JSON.parse(JSON.stringify(hsTextbook.bars)) as Bar[];

        screenChartPatterns(hsTextbook.bars as Bar[], hsTextbook.atr);

        expect(hsTextbook.bars).toEqual(barsCopy);
    });
});

describe('screenChartPatterns — window + index rebasing', () => {
    it('rebases window-local indices back onto the original bars array when input exceeds SCREEN_LOOKBACK_BARS', () => {
        // Pad a large chunk of quiet, low-volatility bars in FRONT of the
        // head-and-shoulders fixture so the pattern sits inside the tail
        // window the screener actually scans, while the full input exceeds
        // SCREEN_LOOKBACK_BARS.
        const padding = makeBars(Array.from({ length: 80 }, () => 100));
        const bars = [...padding, ...(hsTextbook.bars as Bar[])];
        expect(bars.length).toBeGreaterThan(SCREEN_LOOKBACK_BARS);

        const candidates = screenChartPatterns(bars, hsTextbook.atr);
        const hs = candidates.find(c => c.id === 'head_and_shoulders');

        expect(hs).toBeDefined();
        const windowStart = bars.length - SCREEN_LOOKBACK_BARS;
        expect(hs!.startIndex).toBeGreaterThanOrEqual(windowStart);
        expect(hs!.endIndex).toBeGreaterThanOrEqual(windowStart);
        expect(hs!.endIndex).toBeLessThan(bars.length);
    });
});

describe('screenChartPatterns — guards', () => {
    it('returns [] for empty bars', () => {
        expect(screenChartPatterns([], 1)).toEqual([]);
    });

    it('returns [] for atr === 0', () => {
        expect(screenChartPatterns(hsTextbook.bars as Bar[], 0)).toEqual([]);
    });

    it('returns [] for negative atr', () => {
        expect(screenChartPatterns(hsTextbook.bars as Bar[], -1)).toEqual([]);
    });
});
