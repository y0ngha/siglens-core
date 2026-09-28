import { describe, expect, it } from 'vitest';
import type {
    AbcExtensionProjection,
    Bar,
    FibonacciProjection,
    MarketReference,
} from '@/domain/types';
import { buildFibonacciCandidates } from '@/domain/overlays/fibonacciCandidates';

const FMT = { timeframe: '1Day' as const, priceDp: 2 };
const bars: Bar[] = Array.from({ length: 30 }, (_, i) => ({
    time: 5000 + i * 86400,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1,
}));
const fib = (lowIndex: number, highIndex: number): FibonacciProjection => ({
    high: 120,
    low: 100,
    highIndex,
    lowIndex,
    direction: lowIndex < highIndex ? 'up' : 'down',
    retracements: [{ ratio: 0.618, price: 107.64 }],
    extensions: [{ ratio: 1.618, price: 132.36 }],
});
const horizon = (f: FibonacciProjection | null) =>
    ({
        fibProjection: f,
        abcExtension: null,
    }) as unknown as MarketReference['short'];
const abcHorizon = (abc: AbcExtensionProjection) =>
    ({
        fibProjection: null,
        abcExtension: abc,
    }) as unknown as MarketReference['short'];
// Extension prices are deliberately NOT `c ± ratio * |b - a|` (e.g. up: 110 + 1.0*20
// would be 130, not 999) so a test that recomputes instead of reading `extensions`
// verbatim would fail.
const abcUp = (): AbcExtensionProjection => ({
    a: 100,
    b: 120,
    c: 110,
    aIndex: 3,
    bIndex: 8,
    cIndex: 12,
    direction: 'up',
    extensions: [
        { ratio: 1.0, price: 999 },
        { ratio: 1.272, price: 1001.5 },
        { ratio: 1.618, price: 1004.3 },
    ],
});
const abcDown = (): AbcExtensionProjection => ({
    a: 120,
    b: 100,
    c: 110,
    aIndex: 3,
    bIndex: 8,
    cIndex: 12,
    direction: 'down',
    extensions: [
        { ratio: 1.0, price: 55 },
        { ratio: 1.272, price: 53.5 },
        { ratio: 1.618, price: 51 },
    ],
});

describe('buildFibonacciCandidates', () => {
    it('one candidate per distinct anchor leg; horizons sharing a leg collapse', () => {
        const ref = {
            short: horizon(fib(10, 20)),
            medium: horizon(fib(10, 20)),
            long: horizon(fib(2, 20)),
        } as MarketReference;
        const out = buildFibonacciCandidates(ref, bars, FMT);
        expect(out.map(c => c.id)).toEqual([
            `fib:short:${bars[20].time}`,
            `fib:long:${bars[20].time}`,
        ]);
    });

    it('anchor segment runs forward in time; levels start at the later anchor', () => {
        const ref = {
            short: horizon(fib(20, 10)),
            medium: horizon(null),
            long: horizon(null),
        } as MarketReference;
        const [c] = buildFibonacciCandidates(ref, bars, FMT);
        expect(c.segments[0].from.time).toBe(bars[10].time);
        expect(c.segments[0].to.time).toBe(bars[20].time);
        expect(c.levels.every(l => l.fromTime === bars[20].time)).toBe(true);
        expect(c.levels.map(l => l.label)).toContain('61.8%');
    });

    it('never exceeds the candidate limit', () => {
        const ref = {
            short: horizon(fib(1, 2)),
            medium: horizon(fib(3, 4)),
            long: horizon(fib(5, 6)),
        } as MarketReference;
        expect(
            buildFibonacciCandidates(ref, bars, FMT).length
        ).toBeLessThanOrEqual(4);
    });

    it('ABC up: id, A->B->C segment order, level prices from abc.extensions, labels', () => {
        const abc = abcUp();
        const ref = {
            short: abcHorizon(abc),
            medium: horizon(null),
            long: horizon(null),
        } as MarketReference;
        const [c] = buildFibonacciCandidates(ref, bars, FMT);
        expect(c.id).toBe(`fib:abc:${bars[abc.cIndex].time}`);
        expect(c.segments).toEqual([
            {
                from: { time: bars[abc.aIndex].time, price: abc.a },
                to: { time: bars[abc.bIndex].time, price: abc.b },
                role: 'anchor',
                style: 'dashed',
                pane: 'price',
            },
            {
                from: { time: bars[abc.bIndex].time, price: abc.b },
                to: { time: bars[abc.cIndex].time, price: abc.c },
                role: 'anchor',
                style: 'dashed',
                pane: 'price',
            },
        ]);
        expect(c.levels.map(l => l.price)).toEqual(
            abc.extensions.map(l => l.price)
        );
        expect(c.levels.every(l => l.fromTime === bars[abc.cIndex].time)).toBe(
            true
        );
        expect(c.labels).toEqual([
            {
                at: { time: bars[abc.aIndex].time, price: abc.a },
                text: 'A',
                position: 'below',
            },
            {
                at: { time: bars[abc.bIndex].time, price: abc.b },
                text: 'B',
                position: 'above',
            },
            {
                at: { time: bars[abc.cIndex].time, price: abc.c },
                text: 'C',
                position: 'below',
            },
        ]);
    });

    it('ABC down: level prices from abc.extensions, labels flipped', () => {
        const abc = abcDown();
        const ref = {
            short: abcHorizon(abc),
            medium: horizon(null),
            long: horizon(null),
        } as MarketReference;
        const [c] = buildFibonacciCandidates(ref, bars, FMT);
        expect(c.id).toBe(`fib:abc:${bars[abc.cIndex].time}`);
        expect(c.segments[0].from.time).toBe(bars[abc.aIndex].time);
        expect(c.segments[1].to.time).toBe(bars[abc.cIndex].time);
        expect(c.levels.map(l => l.price)).toEqual(
            abc.extensions.map(l => l.price)
        );
        expect(c.labels.map(l => l.position)).toEqual([
            'above',
            'below',
            'above',
        ]);
    });
});
