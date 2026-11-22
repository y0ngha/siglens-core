import {
    verdictOf,
    type VerdictInputs,
} from '@/domain/analysis/baseRateVerdict';
import { BASE_RATE_MIN_N } from '@/domain/analysis/measuredBaseRates';
import { describe, expect, it } from 'vitest';

const verdictInputs = (over: Partial<VerdictInputs> = {}): VerdictInputs => ({
    n: 200,
    significant: true,
    mean: 0.05,
    low: 0.01,
    splits: { early: 0.04, late: 0.06, us: 0.05, kr: 0.05 },
    ...over,
});

describe('verdictOf', () => {
    it('is insufficient below the sample floor, whatever the numbers say', () => {
        expect(verdictOf(verdictInputs({ n: BASE_RATE_MIN_N - 1 }))).toBe(
            'insufficient_sample'
        );
        expect(verdictOf(verdictInputs({ n: BASE_RATE_MIN_N }))).toBe(
            'beats_placebo'
        );
    });

    it('beats the placebo only with a significant positive difference that holds in every split', () => {
        expect(verdictOf(verdictInputs())).toBe('beats_placebo');
        expect(verdictOf(verdictInputs({ significant: false }))).toBe(
            'no_edge'
        );
        expect(verdictOf(verdictInputs({ significant: null }))).toBe('no_edge');
        expect(verdictOf(verdictInputs({ mean: -0.05 }))).toBe('no_edge');
        expect(verdictOf(verdictInputs({ low: -0.001 }))).toBe('no_edge');
        expect(verdictOf(verdictInputs({ low: 0 }))).toBe('no_edge');
    });

    it('fails closed on a split that flips sign or is not covered', () => {
        expect(
            verdictOf(
                verdictInputs({
                    splits: { early: 0.04, late: -0.01, us: 0.05, kr: 0.05 },
                })
            )
        ).toBe('no_edge');
        expect(
            verdictOf(
                verdictInputs({
                    splits: { early: 0.04, late: 0.06, us: 0.05, kr: null },
                })
            )
        ).toBe('no_edge');
        expect(
            verdictOf(
                verdictInputs({
                    splits: { early: 0.04, late: 0.06, us: 0, kr: 0.05 },
                })
            )
        ).toBe('no_edge');
    });
});
