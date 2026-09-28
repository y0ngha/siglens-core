import { describe, expect, it } from 'vitest';
import type { Bar, MarketReference } from '@/domain/types';
import { screenChartPatterns } from '@/domain/patterns/screenChartPatterns';
import {
    buildOverlayCandidates,
    runsForward,
} from '@/domain/overlays/buildOverlayCandidates';
import doubleTop from '@/__tests__/domain/patterns/fixtures/double-top.json';

interface Fixture {
    atr: number;
    bars: Bar[];
}

const FMT = { timeframe: '1Day' as const, priceDp: 2 };

const EMPTY_HORIZON = {
    fibProjection: null,
    abcExtension: null,
} as unknown as MarketReference['short'];
const EMPTY_MARKET_REFERENCE: MarketReference = {
    short: EMPTY_HORIZON,
    medium: EMPTY_HORIZON,
    long: EMPTY_HORIZON,
};

describe('buildOverlayCandidates', () => {
    it('composes candidates from every builder, including patterns from the real fixture', () => {
        const f = doubleTop as Fixture;
        const out = buildOverlayCandidates({
            bars: f.bars,
            atr: f.atr,
            rsi: f.bars.map(() => 50),
            patternCandidates: screenChartPatterns(f.bars, f.atr),
            marketReference: EMPTY_MARKET_REFERENCE,
            fmt: FMT,
        });
        expect(out.some(c => c.kind === 'pattern')).toBe(true);
    });

    it('never throws — a builder that fails is dropped, the rest still return', () => {
        const f = doubleTop as Fixture;
        expect(() =>
            buildOverlayCandidates({
                bars: f.bars,
                atr: f.atr,
                rsi: f.bars.map(() => 50),
                patternCandidates: screenChartPatterns(f.bars, f.atr),
                // Forces buildFibonacciCandidates to throw (reads ref[key].fibProjection).
                marketReference: null as unknown as MarketReference,
                fmt: FMT,
            })
        ).not.toThrow();
    });
});

describe('runsForward', () => {
    const seg = (from: number, to: number) => ({
        from: { time: from, price: 1 },
        to: { time: to, price: 2 },
        role: 'x',
        style: 'solid' as const,
        pane: 'price' as const,
    });
    const cand = (segments: ReturnType<typeof seg>[]) => ({
        id: 'x',
        kind: 'pattern' as const,
        skill: 's',
        promptLine: '',
        segments,
        levels: [],
        labels: [],
    });

    it('keeps candidates whose every segment moves forward in time', () => {
        expect(runsForward(cand([seg(1, 2), seg(2, 5)]))).toBe(true);
        expect(runsForward(cand([]))).toBe(true);
    });

    it('drops a candidate with a zero-length or backwards segment', () => {
        expect(runsForward(cand([seg(1, 2), seg(3, 3)]))).toBe(false);
        expect(runsForward(cand([seg(5, 4)]))).toBe(false);
    });
});
