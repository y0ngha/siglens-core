import { describe, expect, it } from 'vitest';
import { computeFibonacciProjection } from '@/domain/analysis/fibLevels';
import type { SMCResult } from '@/domain/types';

function smc(
    highIdx: number,
    highPrice: number,
    lowIdx: number,
    lowPrice: number
): SMCResult {
    return {
        swingHighs: [{ index: highIdx, price: highPrice, time: highIdx }],
        swingLows: [{ index: lowIdx, price: lowPrice, time: lowIdx }],
        structureBreaks: [],
    } as unknown as SMCResult;
}

describe('computeFibonacciProjection', () => {
    it('returns null without swings', () => {
        expect(
            computeFibonacciProjection({
                swingHighs: [],
                swingLows: [],
                structureBreaks: [],
            } as unknown as SMCResult)
        ).toBeNull();
    });

    it('builds up-leg retracements from high downward', () => {
        const proj = computeFibonacciProjection(smc(10, 110, 5, 100));
        expect(proj?.direction).toBe('up');
        const r50 = proj?.retracements.find(r => r.ratio === 0.5);
        expect(r50?.price).toBeCloseTo(105, 6); // 110 - 0.5*10
    });
});
