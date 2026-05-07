import { describe, expect, it } from 'vitest';
import type { FearGreedSnapshot } from '@/domain/types';
import { formatFearGreedSection } from '@/domain/analysis/fearGreedSection';

const baseGroups: FearGreedSnapshot['groups'] = [
    { name: 'Flow', score: 30, factors: [] },
    { name: 'Trend', score: 70, factors: [] },
];

const baseSnapshot: FearGreedSnapshot = {
    score: 50,
    label: 'NEUTRAL',
    groups: baseGroups,
    confidence: 'normal',
    sampleSize: 200,
    warning: null,
};

describe('formatFearGreedSection', () => {
    it('emits English heading and instruction; Math.round on score and group scores', () => {
        const out = formatFearGreedSection({
            ...baseSnapshot,
            score: 49.6,
            groups: [
                { name: 'Flow', score: 30.4, factors: [] },
                { name: 'Trend', score: 69.7, factors: [] },
            ],
        });
        expect(out).toContain('## Fear & Greed Index (Reference)');
        expect(out).toContain('- Score: 50 / 100 (NEUTRAL)');
        expect(out).toContain('- Flow Group: 30 | Trend Group: 70');
        expect(out).toContain(
            'Please interpret this sentiment in conjunction with the price and volume analysis above.'
        );
    });

    it('omits warning note when warning is null', () => {
        const out = formatFearGreedSection(baseSnapshot);
        expect(out).not.toContain('Note:');
    });

    it('includes English chronic-weakness warning when warning is CHRONIC_WEAKNESS', () => {
        const out = formatFearGreedSection({
            ...baseSnapshot,
            warning: 'CHRONIC_WEAKNESS',
        });
        expect(out).toContain('long-term bearish cycle');
        expect(out).toContain('Note:');
    });

    it('includes English chronic-strength warning when warning is CHRONIC_STRENGTH', () => {
        const out = formatFearGreedSection({
            ...baseSnapshot,
            warning: 'CHRONIC_STRENGTH',
        });
        expect(out).toContain('long-term bullish cycle');
        expect(out).toContain('Note:');
    });

    it('throws when Flow or Trend group is missing', () => {
        expect(() =>
            formatFearGreedSection({
                ...baseSnapshot,
                groups: [{ name: 'Flow', score: 50, factors: [] }],
            })
        ).toThrow(/Flow and Trend/);
        expect(() =>
            formatFearGreedSection({
                ...baseSnapshot,
                groups: [{ name: 'Trend', score: 50, factors: [] }],
            })
        ).toThrow(/Flow and Trend/);
    });
});
