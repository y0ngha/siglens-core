import { describe, expect, it } from 'vitest';
import {
    computeFibonacciProjection,
    computeAbcExtension,
} from '@/domain/analysis/fibLevels';
import type { SMCResult, SMCSwingPoint } from '@/domain/types';

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

// ─────────────────────────────────────────
// computeAbcExtension
// ─────────────────────────────────────────

function swingSmc(
    highs: [index: number, price: number][],
    lows: [index: number, price: number][]
): SMCResult {
    return {
        swingHighs: highs.map(([index, price]): SMCSwingPoint => ({
            index,
            price,
            type: 'high',
        })),
        swingLows: lows.map(([index, price]): SMCSwingPoint => ({
            index,
            price,
            type: 'low',
        })),
        structureBreaks: [],
    } as unknown as SMCResult;
}

describe('computeAbcExtension', () => {
    it('returns null with fewer than 3 confirmed swing points', () => {
        expect(computeAbcExtension(swingSmc([], []))).toBeNull();
        expect(
            computeAbcExtension(swingSmc([[5, 110]], [[0, 100]]))
        ).toBeNull();
    });

    it('up leg: A(low) -> B(high) -> C(low), extensions project above C by the A-B range', () => {
        const abc = computeAbcExtension(
            swingSmc(
                [[5, 110]],
                [
                    [0, 100],
                    [8, 104],
                ]
            )
        );
        expect(abc?.direction).toBe('up');
        expect(abc?.a).toBe(100);
        expect(abc?.b).toBe(110);
        expect(abc?.c).toBe(104);
        const ext100 = abc?.extensions.find(e => e.ratio === 1.0);
        const ext1618 = abc?.extensions.find(e => e.ratio === 1.618);
        expect(ext100?.price).toBeCloseTo(114, 6); // 104 + 1.0 * (110-100)
        expect(ext1618?.price).toBeCloseTo(120.18, 6); // 104 + 1.618 * 10
    });

    it('down leg: A(high) -> B(low) -> C(high), extensions project below C by the A-B range', () => {
        const abc = computeAbcExtension(
            swingSmc(
                [
                    [0, 110],
                    [8, 106],
                ],
                [[5, 100]]
            )
        );
        expect(abc?.direction).toBe('down');
        expect(abc?.a).toBe(110);
        expect(abc?.b).toBe(100);
        expect(abc?.c).toBe(106);
        const ext100 = abc?.extensions.find(e => e.ratio === 1.0);
        expect(ext100?.price).toBeCloseTo(96, 6); // 106 - 1.0 * (110-100)
    });

    it('only the last 3 confirmed swing points are used (earlier swings ignored)', () => {
        // Chronological: low@-2(102, would break alternation if included),
        // low@0(100), high@5(110), low@8(104) — last 3 = low,high,low, valid.
        const abc = computeAbcExtension(
            swingSmc(
                [[5, 110]],
                [
                    [-2, 102],
                    [0, 100],
                    [8, 104],
                ]
            )
        );
        expect(abc?.a).toBe(100);
        expect(abc?.b).toBe(110);
        expect(abc?.c).toBe(104);
    });

    it('returns null when the last 3 swings do not alternate type', () => {
        // low@0, low@2 (two lows back to back), high@5 -> a.type === b.type.
        const abc = computeAbcExtension(
            swingSmc(
                [[5, 110]],
                [
                    [0, 100],
                    [2, 98],
                ]
            )
        );
        expect(abc).toBeNull();
    });

    it('returns null when the A-B range is non-positive (flat anchor)', () => {
        const abc = computeAbcExtension(
            swingSmc(
                [[5, 100]],
                [
                    [0, 100], // same price as B -> range 0
                    [8, 95],
                ]
            )
        );
        expect(abc).toBeNull();
    });

    it('returns null when a triplet price is non-finite', () => {
        const abc = computeAbcExtension(
            swingSmc(
                [[5, Number.NaN]],
                [
                    [0, 100],
                    [8, 104],
                ]
            )
        );
        expect(abc).toBeNull();
    });
});
