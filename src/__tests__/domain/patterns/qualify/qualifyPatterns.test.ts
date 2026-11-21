import { describe, expect, it } from 'vitest';
import type { Bar, ChartPatternId, PatternCandidate } from '@/domain/types';
import { qualifyPatterns } from '@/domain/patterns/qualify/qualifyPatterns';
import { screenChartPatterns } from '@/domain/patterns/screenChartPatterns';
import {
    PATTERN_MIN_HEIGHT_PRICE_PCT,
    SCREEN_LOOKBACK_BARS,
} from '@/domain/patterns/constants';
import { calculateATR } from '@/domain/indicators/atr';
import { lineValueAt } from '@/domain/patterns/boundaryLines';
import { computeCandidateGeometry } from '@/domain/patterns/patternGeometry';
import { extractPivots } from '@/domain/patterns/pivots';
import { qualifyTrendlines } from '@/domain/patterns/qualify/trendlines';
import { makeBars } from '@/__tests__/domain/patterns/helpers';
import { chartFixture } from '@/__tests__/domain/patterns/fixtures/chartFixture';
import apexUnbrokenFile from '@/__tests__/domain/patterns/fixtures/charts/daily-triangle-reaches-apex-unbroken.json';
import pennantBelowZeroFile from '@/__tests__/domain/patterns/fixtures/charts/daily-pennant-target-below-zero.json';
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
    describe('recall fixtures', () => {
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
                    arbitrationDropped: [],
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

describe('qualifyPatterns — pivot thresholds read the per-bar ATR series', () => {
    const f = doubleTop as Fixture;
    const ids = (series: readonly number[]): ChartPatternId[] =>
        qualifyPatterns([], f.bars, f.atr, '1Day', series).qualified.map(
            q => q.id
        );

    it('draws the double top with the fixture ATR at every bar', () => {
        expect(ids(f.bars.map(() => f.atr))).toContain('double_top');
    });

    it('confirms none of its swings when the series reads ten times that ATR, whatever the latest ATR', () => {
        expect(ids(f.bars.map(() => 10 * f.atr))).not.toContain('double_top');
    });
});

describe('qualifyPatterns — arbitration losers are reported for logging', () => {
    it('the cup fixture’s base also qualifies as a rounding bottom; it is dropped and reported as lost to the cup', () => {
        const f = cupAndHandle as Fixture;
        const result = qualifyPatterns([], f.bars, f.atr, '1Day');
        expect(result.qualified.map(q => q.id)).toEqual(['cup_and_handle']);
        expect(result.arbitrationDropped).toHaveLength(1);
        expect(result.arbitrationDropped[0]).toMatchObject({
            id: 'rounding_bottom',
            lostTo: 'cup_and_handle',
        });
        const { startIndex, endIndex } = result.arbitrationDropped[0];
        expect(endIndex).toBeGreaterThan(startIndex);
    });

    it('nothing is reported when nothing overlaps, or when nothing can qualify', () => {
        const f = doubleTop as Fixture;
        expect(
            qualifyPatterns([], f.bars, f.atr, '1Day').arbitrationDropped
        ).toEqual([]);
        expect(
            qualifyPatterns([hit('double_top')], [], 1, '1Day')
                .arbitrationDropped
        ).toEqual([]);
    });
});

describe('a pattern whose geometry a guard dropped is withheld like a spent one', () => {
    // The pennant's measured move runs below zero (see breakoutFreezeCharts),
    // so it has no geometry: not qualified, and not a shape hint either — a
    // hint would still inject the pennant skill guide.
    const chart = chartFixture(pennantBelowZeroFile);
    const series = calculateATR(chart.bars);
    const atr = series[series.length - 1];
    if (atr === null || atr === undefined) throw new Error('ATR not ready');

    it('is neither qualified nor listed as a shape hint when the screener also hit it', () => {
        const { qualified, shapeHints } = qualifyPatterns(
            [hit('pennant')],
            chart.bars,
            atr,
            '1Day',
            series
        );
        expect(qualified).toEqual([]);
        expect(shapeHints).toEqual([]);
    });

    it('a screener hit of another id that did not qualify stays a hint', () => {
        const { shapeHints } = qualifyPatterns(
            [hit('pennant'), hit('rounding_top')],
            chart.bars,
            atr,
            '1Day',
            series
        );
        expect(shapeHints).toEqual(['rounding_top']);
    });
});

describe('a triangle that reaches its apex unbroken has no geometry and is withheld too', () => {
    // The symmetrical triangle's lines meet on the last bar of the full chart
    // before any close has gone beyond either line, so there is nothing left to
    // break out of; two bars earlier the same pair is still open.
    const chart = chartFixture(apexUnbrokenFile);
    const atrOf = (length: number) => {
        const bars = chart.bars.slice(0, length);
        const series = calculateATR(bars);
        const atr = series[series.length - 1];
        if (atr === null || atr === undefined) throw new Error('ATR not ready');
        return { bars, series, atr };
    };
    const hits = [hit('symmetrical_triangle')];

    it('the pair is found, unbroken, with its lines crossed on the last bar', () => {
        const { bars, series, atr } = atrOf(250);
        const windowStart = Math.max(0, bars.length - SCREEN_LOOKBACK_BARS);
        const [pair] = qualifyTrendlines({
            bars,
            pivots: extractPivots(bars, series, {
                onePivotPerBar: true,
            }).filter(p => p.index >= windowStart),
            atr,
            lastIndex: bars.length - 1,
            minHeightPricePct: PATTERN_MIN_HEIGHT_PRICE_PCT['1Day'],
        });
        if (pair.shape.kind !== 'trendline') throw new Error('trendline');
        const last = bars.length - 1;
        expect(pair.id).toBe('symmetrical_triangle');
        expect(pair.shape.breakoutIndex).toBe(last);
        expect(lineValueAt(pair.shape.upper, last)).toBeLessThan(
            lineValueAt(pair.shape.lower, last)
        );
        expect(computeCandidateGeometry(pair, bars, atr)).toBeNull();
    });

    it('is neither qualified nor a shape hint although the screener hit it', () => {
        const { bars, series, atr } = atrOf(250);
        const { qualified, shapeHints } = qualifyPatterns(
            hits,
            bars,
            atr,
            '1Day',
            series
        );
        expect(qualified).toEqual([]);
        expect(shapeHints).toEqual([]);
    });

    it('control: the same pair while still open is qualified (and so not a hint)', () => {
        const { bars, series, atr } = atrOf(244);
        const { qualified, shapeHints } = qualifyPatterns(
            hits,
            bars,
            atr,
            '1Day',
            series
        );
        expect(qualified.map(q => q.id)).toEqual(['symmetrical_triangle']);
        expect(shapeHints).toEqual([]);
    });
});
