import { describe, it, expect } from 'vitest';
import {
    getConfidenceLevel,
    confidenceLabel,
    roleLabel,
    MEDIUM_CONFIDENCE_THRESHOLD,
} from '@/domain/analysis/confidenceLevel';
import { HIGH_CONFIDENCE_WEIGHT } from '@/domain/indicators/constants';

describe('getConfidenceLevel — boundary values', () => {
    it.each([
        [0.0, 'low'],
        [0.49, 'low'],
        [0.5, 'medium'],
        [0.79, 'medium'],
        [0.8, 'high'],
        [1.0, 'high'],
    ] as const)('weight %f → %s', (weight, level) => {
        expect(getConfidenceLevel(weight)).toBe(level);
    });

    it('thresholds are 0.5 and HIGH_CONFIDENCE_WEIGHT', () => {
        expect(MEDIUM_CONFIDENCE_THRESHOLD).toBe(0.5);
        expect(HIGH_CONFIDENCE_WEIGHT).toBe(0.8);
    });
});

describe('confidenceLabel', () => {
    it.each([
        [0.0, '[Low Confidence]'],
        [0.5, '[Medium Confidence]'],
        [0.8, '[High Confidence]'],
    ] as const)('weight %f → %s', (weight, label) => {
        expect(confidenceLabel(weight)).toBe(label);
    });
});

describe('roleLabel — canonical order, indicator-only', () => {
    it('returns empty string for undefined/empty roles', () => {
        expect(roleLabel(undefined)).toBe('');
        expect(roleLabel([])).toBe('');
    });

    it('orders roles canonically regardless of input order', () => {
        expect(roleLabel(['confirmation', 'signal'])).toBe(
            ' [Roles: Signal, Confirmation]'
        );
        expect(roleLabel(['risk', 'measurement', 'regime'])).toBe(
            ' [Roles: Regime, Measurement, Risk]'
        );
    });
});
