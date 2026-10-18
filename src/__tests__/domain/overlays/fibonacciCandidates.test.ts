import { describe, expect, it } from 'vitest';
import type {
    AbcExtensionProjection,
    Bar,
    FibonacciProjection,
    MarketReference,
} from '@/domain/types';
import { buildFibonacciCandidates } from '@/domain/overlays/fibonacciCandidates';

const FMT = { timeframe: '1Day' as const, priceDp: 2 };
// Closes at 110: inside every leg (100–120) and exactly at each ABC's C, so
// no fixture leg or ABC is broken (`isBrokenFibLeg`, `isBrokenAbcExtension`).
const bars: Bar[] = Array.from({ length: 30 }, (_, i) => ({
    time: 5000 + i * 86400,
    open: 110,
    high: 110,
    low: 110,
    close: 110,
    volume: 1,
}));
/** `bars` with the close (and range) of bar `i` moved to `close`. */
const withClose = (i: number, close: number): Bar[] =>
    bars.map((b, k) =>
        k === i ? { ...b, open: close, high: close, low: close, close } : b
    );
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
    it('drops a leg a close after its end has gone past its start (2026-10-18 regression)', () => {
        const only = (f: FibonacciProjection, b: Bar[]) =>
            buildFibonacciCandidates(
                {
                    short: horizon(f),
                    medium: horizon(null),
                    long: horizon(null),
                } as MarketReference,
                b,
                FMT
            ).map(c => c.id);
        // Up-leg 100 (bar 10) → 120 (bar 20): a close under 100 after bar 20
        // leaves its "pullback" levels and ext targets describing the past.
        expect(only(fib(10, 20), withClose(25, 99))).toEqual([]);
        // At the start is not through it; before the leg's end does not count.
        expect(only(fib(10, 20), withClose(25, 100))).toHaveLength(1);
        expect(only(fib(10, 20), withClose(15, 99))).toHaveLength(1);
        // Down-leg 120 (bar 10) → 100 (bar 20): broken by a close over 120.
        expect(only(fib(20, 10), withClose(25, 121))).toEqual([]);
        expect(only(fib(20, 10), withClose(25, 119))).toHaveLength(1);
    });

    it('drops an ABC projection a close after C has gone past C, falling back to the next horizon', () => {
        const ref = (b: AbcExtensionProjection) =>
            ({
                short: abcHorizon(abcUp()),
                medium: abcHorizon(b),
                long: horizon(null),
            }) as MarketReference;
        // abcUp's C is 110 at bar 12: a close at 109 after it voids it, and
        // the medium horizon's ABC (C 108 at bar 26, nothing after 27) takes over.
        const later = { ...abcUp(), c: 108, cIndex: 26 };
        const out = buildFibonacciCandidates(
            ref(later),
            withClose(20, 109),
            FMT
        );
        expect(out.map(c => c.id)).toEqual([`fib:abc:${bars[26].time}`]);
        // Down ABC (C 110): a close at 111 after C voids it.
        expect(
            buildFibonacciCandidates(
                {
                    short: abcHorizon(abcDown()),
                    medium: horizon(null),
                    long: horizon(null),
                } as MarketReference,
                withClose(20, 111),
                FMT
            )
        ).toEqual([]);
    });

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

    it('extensions carry the ext prefix; the 100% duplicate of the end anchor is dropped', () => {
        const ref = {
            short: horizon(fib(20, 10)),
            medium: horizon(null),
            long: horizon(null),
        } as MarketReference;
        const [c] = buildFibonacciCandidates(ref, bars, FMT);
        expect(c.levels.map(l => l.label)).toEqual([
            '23.6%',
            '38.2%',
            '50%',
            '61.8%',
            '78.6%',
            'ext 127.2%',
            'ext 161.8%',
        ]);
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
