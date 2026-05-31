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

    it('efficiencyRatio returns null when closes are shorter than period+1', () => {
        expect(efficiencyRatio([1, 2], 5)).toBeNull();
    });

    it('efficiencyRatio returns null for a flat (zero-volatility) path', () => {
        expect(efficiencyRatio([3, 3, 3, 3], 3)).toBeNull();
    });

    it('classifies aligned-down EMA stack', () => {
        // price<ema9<ema20
        expect(classifyEmaStack(10, 15, 20)).toBe('aligned_down');
    });

    it('classifies a mixed EMA stack when alignment is broken', () => {
        // price above short EMA but short below long EMA -> neither aligned
        expect(classifyEmaStack(30, 25, 28)).toBe('mixed');
    });

    it('classifies mixed swing structure with too few swings', () => {
        expect(classifySwingStructure([100], [90])).toBe('mixed');
    });

    it('classifies mixed swing structure when highs and lows disagree', () => {
        // higher high but lower low -> neither HH_HL nor LH_LL
        expect(classifySwingStructure([100, 110], [95, 90])).toBe('mixed');
    });
});
