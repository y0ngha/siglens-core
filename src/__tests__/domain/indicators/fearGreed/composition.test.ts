import { describe, expect, it } from 'vitest';
import {
    scoreToLabel,
    detectWarning,
    composeSnapshot,
    FEAR_GREED_CONFIDENCE_THRESHOLDS,
} from '@/domain/indicators/fearGreed/composition';
import type { FactorValues } from '@/domain/indicators/fearGreed/types';

const NEUTRAL_RAW: FactorValues = {
    volumeZ: 0,
    buySellImb: 0,
    pocDist: 0,
    ma200Dist: 0,
    rangePosition: 0.5,
};

/**
 * Build a sample where half the entries are below `current` and half above.
 * With strict-less-than percentile, this places `current` at exactly the 50th
 * percentile for every factor — yielding score 50 (NEUTRAL).
 *
 * Requires `count` to be even; throws otherwise.
 */
function makeMedianSample(
    count: number,
    current: FactorValues
): FactorValues[] {
    if (count % 2 !== 0) {
        throw new Error(`makeMedianSample requires even count, got ${count}`);
    }
    return Array.from({ length: count }, (_, i) => {
        const offset = i < count / 2 ? -1 : 1;
        return {
            volumeZ: current.volumeZ + offset,
            buySellImb: current.buySellImb + offset * 0.1,
            pocDist: current.pocDist + offset * 0.01,
            ma200Dist: current.ma200Dist + offset * 0.01,
            rangePosition: current.rangePosition + offset * 0.1,
        };
    });
}

describe('scoreToLabel', () => {
    it.each([
        [0, 'EXTREME_FEAR'],
        [24.99, 'EXTREME_FEAR'],
        [25, 'FEAR'],
        [44.99, 'FEAR'],
        [45, 'NEUTRAL'],
        [54.99, 'NEUTRAL'],
        [55, 'GREED'],
        [74.99, 'GREED'],
        [75, 'EXTREME_GREED'],
        [100, 'EXTREME_GREED'],
    ])('score %f → %s', (score, label) => {
        expect(scoreToLabel(score)).toBe(label);
    });
});

describe('detectWarning', () => {
    it('returns CHRONIC_WEAKNESS when MA200 < 0 AND 52w < 0.30 AND score >= 55', () => {
        expect(
            detectWarning(60, {
                ...NEUTRAL_RAW,
                ma200Dist: -0.05,
                rangePosition: 0.2,
            })
        ).toBe('CHRONIC_WEAKNESS');
    });

    it('returns CHRONIC_STRENGTH when MA200 > 0 AND 52w > 0.70 AND score <= 45', () => {
        expect(
            detectWarning(40, {
                ...NEUTRAL_RAW,
                ma200Dist: 0.05,
                rangePosition: 0.85,
            })
        ).toBe('CHRONIC_STRENGTH');
    });

    it('returns null in NEUTRAL or non-paradox cases', () => {
        expect(detectWarning(50, NEUTRAL_RAW)).toBeNull();
        // MA200 < 0 but score < 55 → null
        expect(
            detectWarning(40, {
                ...NEUTRAL_RAW,
                ma200Dist: -0.05,
                rangePosition: 0.2,
            })
        ).toBeNull();
        // 52w boundary 0.30 (strict <) — should NOT trigger
        expect(
            detectWarning(60, {
                ...NEUTRAL_RAW,
                ma200Dist: -0.05,
                rangePosition: 0.3,
            })
        ).toBeNull();
    });
});

describe('composeSnapshot', () => {
    it('returns null when current factors are null', () => {
        expect(composeSnapshot(null, [])).toBeNull();
    });

    it('returns null when sample size < LIMITED threshold (insufficient confidence)', () => {
        const samples = makeMedianSample(
            FEAR_GREED_CONFIDENCE_THRESHOLDS.LIMITED - 4,
            NEUTRAL_RAW
        );
        expect(composeSnapshot(NEUTRAL_RAW, samples)).toBeNull();
    });

    it('returns confidence "limited" with score/label/warning when LIMITED <= sample size < NORMAL', () => {
        const t = FEAR_GREED_CONFIDENCE_THRESHOLDS;
        // Pick an even sample size strictly between LIMITED and NORMAL.
        const mid = Math.floor((t.LIMITED + t.NORMAL) / 2);
        const sampleSize = mid % 2 === 0 ? mid : mid + 1; // ensure even
        const samples = makeMedianSample(sampleSize, NEUTRAL_RAW);
        const snap = composeSnapshot(NEUTRAL_RAW, samples);
        expect(snap?.confidence).toBe('limited');
        expect(snap?.score).toBeCloseTo(50, 1);
        expect(snap?.label).toBe('NEUTRAL');
        expect(snap?.warning).toBeNull();
    });

    it('returns confidence "normal" and score ≈ 50 with median-balanced sample', () => {
        const samples = makeMedianSample(
            FEAR_GREED_CONFIDENCE_THRESHOLDS.NORMAL,
            NEUTRAL_RAW
        );
        const snap = composeSnapshot(NEUTRAL_RAW, samples);
        expect(snap?.confidence).toBe('normal');
        expect(snap?.score).toBeCloseTo(50, 1);
        expect(snap?.label).toBe('NEUTRAL');
        expect(snap?.groups).toHaveLength(2);
        expect(snap?.groups[0].name).toBe('Flow');
        expect(snap?.groups[1].name).toBe('Trend');
        expect(snap?.groups[0].factors).toHaveLength(3);
        expect(snap?.groups[1].factors).toHaveLength(2);
    });
});
