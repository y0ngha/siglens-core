import { describe, expect, it } from 'vitest';
import type { PivotPoint } from '@/domain/types';
import type { QualifyContext } from '@/domain/patterns/qualify/context';
import {
    qualifyExtremes,
    qualifyHeadAndShoulders,
} from '@/domain/patterns/qualify/extremes';
import { BOUNDARY_CONTAINMENT_ATR } from '@/domain/patterns/constants';
import { makeHLBars } from '@/__tests__/domain/patterns/helpers';

/**
 * The neckline guard in isolation: with calm bars a candle under the
 * neckline is always a swing of its own (and becomes the trough), so the
 * scenario suite cannot reach it — the pivots are given directly here.
 */
describe('qualifyHeadAndShoulders — neckline containment', () => {
    const pivots: PivotPoint[] = [
        { index: 2, price: 110, kind: 'high' },
        { index: 8, price: 100, kind: 'low' },
        { index: 14, price: 116, kind: 'high' },
        { index: 20, price: 101, kind: 'low' },
        { index: 26, price: 111, kind: 'high' },
    ];
    // Every other bar stays under the shoulders (high 109); bar 0 closes at
    // 98, so price rose into the left shoulder (bar 2 closes at 105).
    const ctx = (lowAt11: number): QualifyContext => ({
        bars: makeHLBars(
            Array.from({ length: 30 }, (_, i): [number, number] => [
                pivots.find(p => p.index === i && p.kind === 'high')?.price ??
                    109,
                i === 0
                    ? 98
                    : i === 8
                      ? 100
                      : i === 20
                        ? 101
                        : i === 11
                          ? lowAt11
                          : 105,
            ])
        ),
        pivots,
        atr: 1,
        lastIndex: 29,
        minHeightPricePct: 0.03,
    });
    // Neckline through (8,100) and (20,101): 100.25 at bar 11.
    const neckAt11 = 100.25;

    it('qualifies when every bar between the troughs stays above the neckline − ε', () => {
        expect(
            qualifyHeadAndShoulders(
                ctx(neckAt11 - BOUNDARY_CONTAINMENT_ATR),
                'high',
                'head_and_shoulders'
            ).map(q => q.id)
        ).toEqual(['head_and_shoulders']);
    });

    it('rejects the pattern when a bar between the troughs pokes under the neckline by more than ε', () => {
        expect(
            qualifyHeadAndShoulders(
                ctx(neckAt11 - BOUNDARY_CONTAINMENT_ATR - 0.05),
                'high',
                'head_and_shoulders'
            )
        ).toEqual([]);
    });
});

describe('qualifyExtremes — the matched peaks are the highs of their span', () => {
    const pivots: PivotPoint[] = [
        { index: 10, price: 110, kind: 'high' },
        { index: 20, price: 103, kind: 'low' },
        { index: 30, price: 110, kind: 'high' },
    ];
    const ctx = (highAt15: number): QualifyContext => ({
        bars: makeHLBars(
            Array.from({ length: 36 }, (_, i): [number, number] => [
                i === 10 || i === 30 ? 110 : i === 15 ? highAt15 : 107,
                i === 20 ? 103 : 105,
            ])
        ),
        pivots,
        atr: 1,
        lastIndex: 35,
        minHeightPricePct: 0.03,
    });

    it('draws the double top when every bar between the peaks stays within ε of them', () => {
        expect(
            qualifyExtremes(ctx(110 + BOUNDARY_CONTAINMENT_ATR), 'high').map(
                q => q.id
            )
        ).toEqual(['double_top']);
    });

    it('rejects it when a bar between the peaks (no pivot) rises over them by more than ε', () => {
        expect(
            qualifyExtremes(ctx(110 + BOUNDARY_CONTAINMENT_ATR + 0.05), 'high')
        ).toEqual([]);
    });
});

describe('qualifyHeadAndShoulders — the right shoulder and the move into the head', () => {
    // The same H&S as above (shoulders 110 / 111, head 116, neckline 100 →
    // 101). `patch` overrides single bars as [high, low] (low = close).
    const pivots: PivotPoint[] = [
        { index: 2, price: 110, kind: 'high' },
        { index: 8, price: 100, kind: 'low' },
        { index: 14, price: 116, kind: 'high' },
        { index: 20, price: 101, kind: 'low' },
        { index: 26, price: 111, kind: 'high' },
    ];
    const ctx = (
        patch: Readonly<Record<number, [number, number]>> = {}
    ): QualifyContext => ({
        bars: makeHLBars(
            Array.from(
                { length: 30 },
                (_, i): [number, number] =>
                    patch[i] ?? [
                        pivots.find(p => p.index === i && p.kind === 'high')
                            ?.price ?? 109,
                        i === 0 ? 98 : i === 8 ? 100 : i === 20 ? 101 : 105,
                    ]
            )
        ),
        pivots,
        atr: 1,
        lastIndex: 29,
        minHeightPricePct: 0.03,
    });
    const ids = (c: QualifyContext): string[] =>
        qualifyHeadAndShoulders(c, 'high', 'head_and_shoulders').map(q => q.id);
    // Neckline through (8, 100) and (20, 101): 101.25 at bar 23.
    const neckAt23 = 101.25;

    it('is drawn with a close between the second trough and the right shoulder within ε of the neckline', () => {
        expect(
            ids(ctx({ 23: [109, neckAt23 - BOUNDARY_CONTAINMENT_ATR + 0.05] }))
        ).toEqual(['head_and_shoulders']);
    });

    it('is not drawn once such a close went through the neckline by more than ε (the "right shoulder" is a rebound)', () => {
        expect(
            ids(ctx({ 23: [109, neckAt23 - BOUNDARY_CONTAINMENT_ATR - 0.05] }))
        ).toEqual([]);
    });

    it('is not drawn without an advance into the left shoulder', () => {
        // Bar 0 closes at 105, level with the left shoulder's bar.
        expect(ids(ctx({ 0: [109, 105] }))).toEqual([]);
    });

    it('is not drawn when a bar before the left shoulder stands over the head', () => {
        expect(ids(ctx({ 1: [117, 104] }))).toEqual([]);
    });
});

describe('qualifyHeadAndShoulders — each shoulder stands clear of the neckline', () => {
    // ATR 5. Troughs 100 (bar 8) and 107 (bar 20): a 7-point (1.4 ATR) rise,
    // short of the sloped class, so the neckline itself is allowed; it reads
    // 110.5 at bar 26. Every bar from the first trough on closes 0.3 over
    // it, so no close breaks it early.
    const ctx = (rightShoulder: number): QualifyContext => {
        const pivots: PivotPoint[] = [
            { index: 2, price: 110, kind: 'high' },
            { index: 8, price: 100, kind: 'low' },
            { index: 14, price: 117, kind: 'high' },
            { index: 20, price: 107, kind: 'low' },
            { index: 26, price: rightShoulder, kind: 'high' },
        ];
        const neckline = (i: number): number => 100 + ((i - 8) * 7) / 12;
        const low = (i: number): number =>
            i === 0
                ? 90
                : i === 8 || i === 20
                  ? neckline(i)
                  : i > 8
                    ? Math.min(neckline(i) + 0.3, rightShoulder - 0.2)
                    : 105;
        return {
            bars: makeHLBars(
                Array.from({ length: 30 }, (_, i): [number, number] => [
                    pivots.find(p => p.index === i && p.kind === 'high')
                        ?.price ?? Math.max(109.5, low(i) + 0.1),
                    low(i),
                ])
            ),
            pivots,
            atr: 5,
            lastIndex: 29,
            minHeightPricePct: 0.03,
        };
    };
    const ids = (c: QualifyContext): string[] =>
        qualifyHeadAndShoulders(c, 'high', 'head_and_shoulders').map(q => q.id);

    it('does not draw it with the right shoulder only 0.5 over the neckline (0.1 ATR)', () => {
        expect(ids(ctx(111))).toEqual([]);
    });
});

describe("qualifyExtremes — a double top's trough sits in the middle half", () => {
    // Peaks 110 at bars 10 and 30 (20 bars apart): the trough must be at
    // least DOUBLE_NECKLINE_EDGE_SHARE × 20 = 5 bars from each peak.
    const ctx = (troughAt: number): QualifyContext => {
        const pivots: PivotPoint[] = [
            { index: 10, price: 110, kind: 'high' },
            { index: troughAt, price: 103, kind: 'low' },
            { index: 30, price: 110, kind: 'high' },
        ];
        return {
            bars: makeHLBars(
                Array.from({ length: 36 }, (_, i): [number, number] => [
                    i === 10 || i === 30 ? 110 : 107,
                    i === troughAt ? 103 : 105,
                ])
            ),
            pivots,
            atr: 1,
            lastIndex: 35,
            minHeightPricePct: 0.03,
        };
    };
    const ids = (troughAt: number): string[] =>
        qualifyExtremes(ctx(troughAt), 'high').map(q => q.id);

    it.each([15, 25])(
        'draws it with the trough at bar %i (exactly 5 bars from a peak)',
        at => {
            expect(ids(at)).toEqual(['double_top']);
        }
    );

    it.each([14, 26, 29])('rejects it with the trough at bar %i', at => {
        expect(ids(at)).toEqual([]);
    });
});
