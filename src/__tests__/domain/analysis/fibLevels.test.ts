import { describe, expect, it } from 'vitest';
import {
    computeFibonacciProjection,
    isUsablePrice,
} from '@/domain/analysis/fibLevels';
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

    it('builds down-leg levels when the high forms before the low', () => {
        const proj = computeFibonacciProjection(smc(5, 110, 10, 100));
        expect(proj?.direction).toBe('down');
        const ext100 = proj?.extensions.find(e => e.ratio === 1.0);
        expect(ext100?.price).toBeCloseTo(100, 6); // high - 1.0*range = 110-10
    });

    it('returns null when the swing high is not above the swing low', () => {
        expect(computeFibonacciProjection(smc(10, 100, 5, 100))).toBeNull();
    });

    it('returns null when an anchor price is not usable (non-finite)', () => {
        expect(computeFibonacciProjection(smc(10, NaN, 5, 100))).toBeNull();
    });
});

describe('isUsablePrice', () => {
    it('accepts finite positive prices', () => {
        expect(isUsablePrice(10)).toBe(true);
    });
    it('rejects zero, negatives and non-finite prices', () => {
        expect(isUsablePrice(0)).toBe(false);
        expect(isUsablePrice(-1)).toBe(false);
        expect(isUsablePrice(Number.NaN)).toBe(false);
        expect(isUsablePrice(Number.POSITIVE_INFINITY)).toBe(false);
    });
});
