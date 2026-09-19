import { describe, expect, it } from 'vitest';
import {
    computePatternTargets,
    decimalPlacesOf,
    roundToInputPrecision,
} from '@/domain/analysis/patternTargets';

describe('computePatternTargets (spec 2026-09-18)', () => {
    it('up: height = extreme→breakout distance, measured/conservative project above breakout', () => {
        const t = computePatternTargets(100, 90, 'up');
        expect(t.height).toBe(10);
        expect(t.measuredTarget).toBe(110);
        expect(t.conservativeTarget).toBe(105);
    });

    it('down: measured/conservative project below breakout', () => {
        const t = computePatternTargets(100, 110, 'down');
        expect(t.height).toBe(10);
        expect(t.measuredTarget).toBe(90);
        expect(t.conservativeTarget).toBe(95);
    });

    it('conservative target gets one extra decimal when halving needs it (the "100.015" case)', () => {
        // breakout 100.01, extreme 100.02 (2dp inputs) -> height 0.01, half
        // 0.005 -> conservative needs 3dp, one more than either input had.
        const t = computePatternTargets(100.01, 100.02, 'up');
        expect(t.measuredTarget).toBe(100.02); // 100.01 + 0.01, still 2dp
        expect(t.conservativeTarget).toBe(100.015);
    });

    it('rounds off binary-float noise instead of reporting it (e.g. 338.34 + 9.99)', () => {
        const t = computePatternTargets(338.34, 328.35, 'up'); // height 9.99
        expect(t.height).toBeCloseTo(9.99, 6);
        // 338.34 + 9.99 = 348.3299999999999 in raw float arithmetic.
        expect(t.measuredTarget).toBe(348.33);
        expect(String(t.measuredTarget)).not.toContain('99999999');
    });

    // Cross-caller agreement (candidates section vs ai-levels) is verified in
    // chartPatternCandidatesSection.test.ts by re-running this function on the
    // section's PRINTED numbers — calling it twice here could never fail.
});

describe('decimalPlacesOf', () => {
    it('counts fractional digits', () => {
        expect(decimalPlacesOf(348.33)).toBe(2);
        expect(decimalPlacesOf(100)).toBe(0);
        expect(decimalPlacesOf(100.1)).toBe(1);
    });

    it('caps at MAX_TARGET_DECIMALS(8) for scientific notation', () => {
        expect(decimalPlacesOf(1e-10)).toBe(8);
    });
});

describe('roundToInputPrecision', () => {
    it('rounds to the widest input precision plus `extra`', () => {
        expect(roundToInputPrecision(100.015, [100.01, 100.02], 1)).toBe(
            100.015
        );
        expect(roundToInputPrecision(348.3299999999999, [338.34, 9.99])).toBe(
            348.33
        );
    });
});
