import { describe, it, expect } from 'vitest';
import { extractPivots } from '@/domain/patterns/pivots';
import {
    classifyDoubleTripleTop,
    classifyDoubleTripleBottom,
} from '@/domain/patterns/classifiers';
import { makeBars } from '@/__tests__/domain/patterns/helpers';

const ATR = 1;

describe('classifyDoubleTripleTop / classifyDoubleTripleBottom', () => {
    it('double_top: 두 고점이 근접하고 그 사이에 저점이 있으면 감지한다', () => {
        const bars = makeBars([10, 15, 11, 15.2, 11]);
        const pivots = extractPivots(bars, ATR);

        const candidates = classifyDoubleTripleTop(pivots, bars, ATR);

        expect(candidates).toEqual([
            { id: 'double_top', startIndex: 1, endIndex: 3 },
        ]);
    });

    it('triple_top: 세 고점이 pairwise 근접하고 저점이 교대로 있으면 triple과 double을 모두 방출한다', () => {
        const bars = makeBars([10, 15, 11, 15.2, 11, 15.1, 11]);
        const pivots = extractPivots(bars, ATR);

        const candidates = classifyDoubleTripleTop(pivots, bars, ATR);

        expect(candidates).toEqual([
            { id: 'triple_top', startIndex: 1, endIndex: 5 },
            { id: 'double_top', startIndex: 3, endIndex: 5 },
        ]);
        for (const c of candidates) {
            expect(c.startIndex).toBeLessThan(c.endIndex);
            expect(c.endIndex).toBeLessThanOrEqual(bars.length - 1);
        }
    });

    it('고점이 하나뿐이면 감지하지 않는다', () => {
        const bars = makeBars([10, 15, 11]);
        const pivots = extractPivots(bars, ATR);
        expect(pivots.filter(p => p.kind === 'high')).toHaveLength(1);

        expect(classifyDoubleTripleTop(pivots, bars, ATR)).toEqual([]);
    });

    it('고점 차이가 정확히 EXTREME_MATCH_ATR_MULT * atr 이면 감지한다 (느슨한 경계)', () => {
        // Highs at 15.05 and 16.05 — exactly 1.0 apart, matching
        // EXTREME_MATCH_ATR_MULT(1.0) * atr(1). The boundary is inclusive
        // (loose interpretation), so this must still detect.
        const bars = makeBars([10, 15, 11, 16, 11]);
        const pivots = extractPivots(bars, ATR);
        const highs = pivots.filter(p => p.kind === 'high');
        expect(highs).toHaveLength(2);
        expect(Math.abs(highs[0].price - highs[1].price)).toBe(1);

        const candidates = classifyDoubleTripleTop(pivots, bars, ATR);

        expect(candidates).toEqual([
            { id: 'double_top', startIndex: 1, endIndex: 3 },
        ]);
    });

    it('double_bottom: 두 저점이 근접하고 그 사이에 고점이 있으면 감지한다', () => {
        const bars = makeBars([10, 5, 9, 4, 9]);
        const pivots = extractPivots(bars, ATR);

        const candidates = classifyDoubleTripleBottom(pivots, bars, ATR);

        expect(candidates).toEqual([
            { id: 'double_bottom', startIndex: 1, endIndex: 3 },
        ]);
    });

    it('atr가 0 이하이면 감지하지 않는다', () => {
        const bars = makeBars([10, 15, 11, 15.2, 11]);
        const pivots = extractPivots(bars, ATR);
        expect(classifyDoubleTripleTop(pivots, bars, 0)).toEqual([]);
        expect(classifyDoubleTripleTop(pivots, bars, -1)).toEqual([]);
    });
});
