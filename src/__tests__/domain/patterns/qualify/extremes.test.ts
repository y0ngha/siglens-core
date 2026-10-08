import { describe, expect, it } from 'vitest';
import type { PivotPoint } from '@/domain/types';
import type { QualifyContext } from '@/domain/patterns/qualify/context';
import { qualifyHeadAndShoulders } from '@/domain/patterns/qualify/extremes';
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
    const ctx = (lowAt11: number): QualifyContext => ({
        bars: makeHLBars(
            Array.from({ length: 30 }, (_, i): [number, number] => [
                120,
                i === 8 ? 100 : i === 20 ? 101 : i === 11 ? lowAt11 : 105,
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
