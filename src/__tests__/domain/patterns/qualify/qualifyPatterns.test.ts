import { describe, expect, it } from 'vitest';
import type { Bar, ChartPatternId, PatternCandidate } from '@/domain/types';
import { qualifyPatterns } from '@/domain/patterns/qualify/qualifyPatterns';
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
const hit = (id: ChartPatternId): PatternCandidate => ({
    id,
    startIndex: 0,
    endIndex: 1,
});

const RECALL_FIXTURES: ReadonlyArray<[string, Fixture, ChartPatternId]> = [
    ['hs-textbook', hsTextbook as Fixture, 'head_and_shoulders'],
    ['double-top', doubleTop as Fixture, 'double_top'],
    ['ascending-triangle', ascendingTriangle as Fixture, 'ascending_triangle'],
    ['bull-flag', bullFlag as Fixture, 'bull_flag'],
    ['cup-and-handle', cupAndHandle as Fixture, 'cup_and_handle'],
];

describe('qualifyPatterns', () => {
    describe('recall fixtures (spec 2026-10-07 §6 tests 10, 12)', () => {
        it.each(RECALL_FIXTURES)(
            '%s: the pre-screener recalls it, it qualifies (not spent), and it is the only drawable pattern',
            (_, f, id) => {
                const loose = screenChartPatterns(f.bars, f.atr);
                expect(loose.map(c => c.id)).toContain(id);
                const { qualified, shapeHints } = qualifyPatterns(
                    loose,
                    f.bars,
                    f.atr,
                    '1Day'
                );
                expect(qualified.map(q => q.id)).toEqual([id]);
                expect(shapeHints).not.toContain(id);
            }
        );
    });

    describe('guards', () => {
        it.each([
            ['no bars', [] as Bar[], 1],
            ['atr 0', (doubleTop as Fixture).bars, 0],
            ['negative atr', (doubleTop as Fixture).bars, -1],
            ['atr NaN', (doubleTop as Fixture).bars, Number.NaN],
        ])(
            '%s: nothing qualifies and every loose id is a sorted, deduped shape hint',
            (_, bars, atr) => {
                expect(
                    qualifyPatterns(
                        [hit('pennant'), hit('double_top'), hit('pennant')],
                        bars,
                        atr,
                        '1Day'
                    )
                ).toEqual({
                    qualified: [],
                    shapeHints: ['double_top', 'pennant'],
                });
            }
        );
    });

    describe('shape hints', () => {
        const f = doubleTop as Fixture;

        it('lists a loose id with no qualified pattern, and not one that qualified', () => {
            const { shapeHints } = qualifyPatterns(
                [hit('double_top'), hit('ascending_wedge')],
                f.bars,
                f.atr,
                '1Day'
            );
            expect(shapeHints).toEqual(['ascending_wedge']);
        });

        it('leaves out a loose id whose qualified pattern is spent — it describes the past', () => {
            // Slide from ~106 through the 95.29 target within the recency
            // window (last peak at bar 49, so at most 20 bars after it).
            const last = f.bars[f.bars.length - 1];
            const spentBars = [
                ...f.bars,
                ...Array.from({ length: 5 }, (_, i) => {
                    const c = 105 - 2.5 * i;
                    return {
                        time: last.time + i + 1,
                        open: c + 0.5,
                        high: c + 0.6,
                        low: c - 0.1,
                        close: c,
                        volume: 1,
                    };
                }),
            ];
            const { qualified, shapeHints } = qualifyPatterns(
                [hit('double_top')],
                spentBars,
                f.atr,
                '1Day'
            );
            expect(qualified.map(q => q.id)).not.toContain('double_top');
            expect(shapeHints).toEqual([]);
        });
    });

    it('qualifies independently of the loose hits (the screener misses textbook flags)', () => {
        const f = bullFlag as Fixture;
        expect(
            qualifyPatterns([], f.bars, f.atr, '1Day').qualified.map(q => q.id)
        ).toEqual(['bull_flag']);
    });

    it('reads pivots over the whole series and keeps indices in it when the input exceeds the lookback', () => {
        const f = hsTextbook as Fixture;
        const padding = makeBars(Array.from({ length: 80 }, () => 100)).map(
            (b, i) => ({ ...b, time: f.bars[0].time - (80 - i) })
        );
        const bars = [...padding, ...f.bars];
        expect(bars.length).toBeGreaterThan(SCREEN_LOOKBACK_BARS);
        const plain = qualifyPatterns([], f.bars, f.atr, '1Day').qualified[0];
        const padded = qualifyPatterns([], bars, f.atr, '1Day').qualified[0];
        expect(padded.id).toBe('head_and_shoulders');
        expect(padded.startIndex).toBe(plain.startIndex + 80);
        expect(padded.pivots.map(p => p.index)).toEqual(
            plain.pivots.map(p => p.index + 80)
        );
    });

    it('ignores confirmed pivots older than the lookback window', () => {
        const f = doubleTop as Fixture;
        // Push the whole double top out of the window with flat bars after it.
        const tail = makeBars(
            Array.from({ length: SCREEN_LOOKBACK_BARS }, () => 106)
        ).map((b, i) => ({
            ...b,
            time: f.bars[f.bars.length - 1].time + i + 1,
        }));
        expect(
            qualifyPatterns([], [...f.bars, ...tail], f.atr, '1Day').qualified
        ).toEqual([]);
    });

    it('is deterministic and does not mutate its input', () => {
        const f = cupAndHandle as Fixture;
        const copy = structuredClone(f.bars);
        const first = qualifyPatterns([], f.bars, f.atr, '1Day');
        expect(qualifyPatterns([], f.bars, f.atr, '1Day')).toEqual(first);
        expect(f.bars).toEqual(copy);
    });
});
