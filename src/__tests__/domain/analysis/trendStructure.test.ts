import { describe, expect, it } from 'vitest';
import {
    efficiencyRatio,
    classifyEmaStack,
    classifySwingStructure,
} from '@/domain/analysis/trendStructure';

describe('trendStructure helpers', () => {
    it('efficiencyRatio is 1 for a perfectly monotonic path', () => {
        expect(efficiencyRatio([1, 2, 3, 4, 5], 4)).toBeCloseTo(1, 6);
    });
    it('efficiencyRatio is low for a round trip', () => {
        expect(efficiencyRatio([1, 5, 1], 2)).toBeCloseTo(0, 6);
    });
    it('classifies aligned-up EMA stack', () => {
        expect(classifyEmaStack(30, 25, 20)).toBe('aligned_up'); // price>ema9>ema20
    });
    it('classifies HH_HL from ascending swings', () => {
        expect(classifySwingStructure([100, 110], [90, 95])).toBe('HH_HL');
    });
    it('classifies LH_LL from descending swings', () => {
        expect(classifySwingStructure([110, 100], [95, 90])).toBe('LH_LL');
    });
});
